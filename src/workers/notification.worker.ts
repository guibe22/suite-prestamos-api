import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { NotificacionService } from '../modules/notificacion/notificacion.service.js';

/**
 * Disparadores de notificaciones del servidor.
 *
 * Diseño por SONDEO, no por gancho dentro de las rutas de negocio. La
 * alternativa era disparar desde `sincronizacion.service.ts` (al cerrarse una
 * jornada) y desde `suscripcion.service.ts` (al suspenderse), pero:
 *
 *   - El push de sincronización es una transacción grande con lógica de
 *     idempotencia delicada. Meter ahí una llamada de red (el envío a Expo)
 *     alargaría la transacción y, si fallara, podría tumbar un push entero de
 *     datos de cobranza por culpa de una notificación.
 *   - `evaluarYAplicarVencimientoManual` también corre en una ruta de LECTURA
 *     (el chequeo perezoso de /mi-suscripcion). Enviar push desde ahí metería
 *     latencia de red en una consulta que la app hace al abrir.
 *
 * Sondear desacopla por completo: ninguna ruta caliente cambia, y
 * `claveIdempotencia` garantiza que un hecho genere UNA notificación aunque la
 * ventana de sondeo se solape o el worker reinicie a mitad de pasada.
 */

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;

/**
 * Ventana que se mira hacia atrás en cada pasada. Es intencionalmente mucho
 * mayor que el intervalo del cron (10 min): si el proceso estuvo caído un rato,
 * la siguiente pasada recupera lo perdido, y lo ya notificado se descarta solo
 * por la clave de idempotencia.
 */
const VENTANA_SONDEO_MS = 45 * MINUTO_MS;

const service = new NotificacionService();

const formatearMonto = (valor: number): string =>
  valor.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ids de los ADMIN/SUPER_ADMIN vigentes de una organización. */
async function adminsDe(organizacionId: string): Promise<string[]> {
  const admins = await prisma.usuario.findMany({
    where: {
      organizacionId,
      deletedAt: null,
      rol: { nombre: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/**
 * Quién debe enterarse de lo que pasa en una ruta: sus responsables y
 * colaboradores, más los ADMIN de la organización. Respeta el mismo alcance
 * por ruta que ya aplica el API al resto de los datos — un GERENTE no recibe
 * avisos de rutas que no puede ver.
 */
async function interesadosEnRuta(rutaId: string, organizacionId: string): Promise<string[]> {
  const ruta = await prisma.ruta.findFirst({
    where: { id: rutaId, organizacionId },
    select: {
      responsableId: true,
      colaboradores: { where: { deletedAt: null }, select: { usuarioId: true } },
    },
  });

  const ids = new Set<string>(await adminsDe(organizacionId));
  if (ruta?.responsableId) ids.add(ruta.responsableId);
  for (const c of ruta?.colaboradores ?? []) ids.add(c.usuarioId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Disparadores por sondeo
// ---------------------------------------------------------------------------

/** Jornadas que se cerraron hace poco: el ADMIN quiere saberlo el mismo día. */
async function avisarJornadasCerradas(desde: Date): Promise<number> {
  const jornadas = await prisma.jornadaCobranza.findMany({
    where: { estado: 'CERRADA', deletedAt: null, updatedAt: { gte: desde } },
    select: {
      id: true,
      organizacionId: true,
      rutaId: true,
      usuarioId: true,
      efectivoCobrado: true,
      clientesVisitados: true,
      ruta: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
    },
  });

  let enviadas = 0;

  for (const jornada of jornadas) {
    const destinatarios = await interesadosEnRuta(jornada.rutaId, jornada.organizacionId);

    for (const usuarioId of destinatarios) {
      // El propio cobrador que la cerró no necesita que le avisen de lo que
      // acaba de hacer.
      if (usuarioId === jornada.usuarioId) continue;

      const creada = await service.crearYEnviar({
        organizacionId: jornada.organizacionId,
        usuarioId,
        categoria: 'JORNADA',
        titulo: 'Jornada cerrada',
        cuerpo: `${jornada.usuario?.nombre ?? 'Un cobrador'} cerró la jornada de ${
          jornada.ruta?.nombre ?? 'su ruta'
        }: ${formatearMonto(Number(jornada.efectivoCobrado))} cobrados en ${
          jornada.clientesVisitados
        } visitas.`,
        data: { ruta: '/jornadas-activas' },
        claveIdempotencia: `jornada-cerrada:${jornada.id}:${usuarioId}`,
      });
      if (creada) enviadas++;
    }
  }

  return enviadas;
}

/** Suscripciones que acaban de pasar a SUSPENDIDA. */
async function avisarSuscripcionesSuspendidas(desde: Date): Promise<number> {
  const suscripciones = await prisma.suscripcion.findMany({
    where: { estado: 'SUSPENDIDA', updatedAt: { gte: desde } },
    select: { id: true, organizacionId: true, periodoFinEn: true },
  });

  let enviadas = 0;

  for (const suscripcion of suscripciones) {
    for (const usuarioId of await adminsDe(suscripcion.organizacionId)) {
      const creada = await service.crearYEnviar({
        organizacionId: suscripcion.organizacionId,
        usuarioId,
        categoria: 'SUSCRIPCION',
        titulo: 'Suscripción suspendida',
        cuerpo:
          'Tu suscripción quedó suspendida por falta de pago. Regularízala para no perder el acceso al terminar el periodo de gracia.',
        data: { ruta: '/(tabs)/ajustes/plan-facturacion' },
        // El periodo entra en la clave: si más adelante se renueva y vuelve a
        // suspenderse, eso es un hecho NUEVO y debe volver a avisar.
        claveIdempotencia: `suscripcion-suspendida:${suscripcion.id}:${
          suscripcion.periodoFinEn?.toISOString() ?? 'sin-periodo'
        }:${usuarioId}`,
      });
      if (creada) enviadas++;
    }
  }

  return enviadas;
}

/** Invitaciones al equipo aceptadas: el ADMIN que invitó quiere confirmarlo. */
async function avisarInvitacionesAceptadas(desde: Date): Promise<number> {
  const nuevos = await prisma.usuario.findMany({
    where: { deletedAt: null, invitacionAceptadaEn: { gte: desde }, organizacionId: { not: null } },
    select: { id: true, nombre: true, organizacionId: true, rol: { select: { nombre: true } } },
  });

  let enviadas = 0;

  for (const nuevo of nuevos) {
    const organizacionId = nuevo.organizacionId!;
    for (const usuarioId of await adminsDe(organizacionId)) {
      if (usuarioId === nuevo.id) continue;

      const creada = await service.crearYEnviar({
        organizacionId,
        usuarioId,
        categoria: 'EQUIPO',
        titulo: 'Nuevo miembro en el equipo',
        cuerpo: `${nuevo.nombre} aceptó la invitación y ya puede entrar como ${
          nuevo.rol?.nombre ?? 'miembro'
        }.`,
        data: { ruta: '/(tabs)/ajustes/equipo' },
        claveIdempotencia: `invitacion-aceptada:${nuevo.id}:${usuarioId}`,
      });
      if (creada) enviadas++;
    }
  }

  return enviadas;
}

/**
 * Una pasada de sondeo. Cada disparador se aísla: si uno falla, los otros
 * siguen — un error consultando suscripciones no puede dejar sin aviso a una
 * jornada cerrada.
 */
export async function despacharEventos(ahora = new Date()): Promise<void> {
  const desde = new Date(ahora.getTime() - VENTANA_SONDEO_MS);

  const disparadores: [string, () => Promise<number>][] = [
    ['jornadas-cerradas', () => avisarJornadasCerradas(desde)],
    ['suscripciones-suspendidas', () => avisarSuscripcionesSuspendidas(desde)],
    ['invitaciones-aceptadas', () => avisarInvitacionesAceptadas(desde)],
  ];

  for (const [nombre, ejecutar] of disparadores) {
    try {
      await ejecutar();
    } catch (e) {
      logger.error(e, `💥 Falló el disparador de notificaciones "${nombre}".`);
    }
  }
}

// ---------------------------------------------------------------------------
// Resumen diario
// ---------------------------------------------------------------------------

/**
 * Resumen de la cobranza de ayer, una notificación por organización dirigida a
 * sus ADMIN. Se envía a las 4:00 AM, después de que `mora-recalc` (3:30) dejó
 * la mora del día ya devengada.
 */
export async function despacharResumenDiario(ahora = new Date()): Promise<void> {
  const finAyer = new Date(ahora);
  finAyer.setHours(0, 0, 0, 0);
  const inicioAyer = new Date(finAyer.getTime() - DIA_MS);
  const diaAyer = inicioAyer.toISOString().slice(0, 10);

  const organizaciones = await prisma.organizacion.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  for (const organizacion of organizaciones) {
    try {
      const pagos = await prisma.pago.findMany({
        where: {
          deletedAt: null,
          fechaPago: { gte: inicioAyer, lt: finAyer },
          prestamo: { cliente: { organizacionId: organizacion.id } },
        },
        select: { monto: true, prestamo: { select: { clienteId: true } } },
      });

      // Sin movimiento no se manda nada: una notificación diaria que dice
      // "cero" todos los días es exactamente como se entrena a un usuario a
      // ignorar el canal.
      if (pagos.length === 0) continue;

      const total = pagos.reduce((suma, p) => suma + Number(p.monto), 0);
      const clientes = new Set(pagos.map((p) => p.prestamo.clienteId)).size;

      for (const usuarioId of await adminsDe(organizacion.id)) {
        await service.crearYEnviar({
          organizacionId: organizacion.id,
          usuarioId,
          categoria: 'COBRANZA',
          titulo: 'Resumen de ayer',
          cuerpo: `Se cobraron ${formatearMonto(total)} de ${clientes} cliente${
            clientes === 1 ? '' : 's'
          } en ${pagos.length} pago${pagos.length === 1 ? '' : 's'}.`,
          data: { ruta: '/estadisticas' },
          claveIdempotencia: `resumen-diario:${organizacion.id}:${diaAyer}:${usuarioId}`,
        });
      }
    } catch (e) {
      logger.error(e, `💥 Falló el resumen diario de la organización ${organizacion.id}.`);
    }
  }
}

export const startNotificationWorker = (): void => {
  // Sondeo de eventos cada 10 minutos: suficientemente fino para que un ADMIN
  // se entere el mismo día de que cerraron una jornada, y suficientemente
  // espaciado para no castigar la base de datos.
  cron.schedule('*/10 * * * *', () => {
    despacharEventos().catch((e) => logger.error(e, '💥 Error en notification.worker (eventos)'));
  });

  // 4:00 AM: después de score-recalc (3:00) y de mora-recalc + vencimientos
  // de suscripción (3:30), para que el resumen vea los números ya recalculados.
  cron.schedule('0 4 * * *', () => {
    despacharResumenDiario().catch((e) =>
      logger.error(e, '💥 Error en notification.worker (resumen diario)')
    );
  });

  logger.info('⚙️  Notification Worker programado (eventos cada 10 min, resumen diario 4:00 AM).');
};
