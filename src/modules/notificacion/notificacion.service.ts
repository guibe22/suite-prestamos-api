import type { CategoriaNotificacion } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { enviarPush, type MensajePush } from '../../shared/push/expo-push.client.js';

/**
 * Notificaciones: bandeja, dispositivos y preferencias.
 *
 * Regla que atraviesa todo el módulo: el alcance SIEMPRE sale del JWT
 * (`organizacionId`, `usuarioId`), nunca del body ni de la query. El push de
 * sincronización ya tuvo un IDOR por confiar en un id enviado por el cliente;
 * acá no se repite.
 */

/**
 * Las cinco categorías son 1:1 con los canales de Android que crea la app
 * (`services/notificaciones.ts`) y con las columnas de PreferenciaNotificacion.
 * El mapa es explícito en vez de un `toLowerCase()` para que agregar una
 * categoría nueva sin su canal y su columna falle al compilar, no en
 * producción con una notificación que Android descarta en silencio.
 */
const COLUMNA_PREFERENCIA: Record<CategoriaNotificacion, string> = {
  COBRANZA: 'cobranza',
  JORNADA: 'jornada',
  EQUIPO: 'equipo',
  SUSCRIPCION: 'suscripcion',
  SINCRONIZACION: 'sincronizacion',
};

/** Id del canal de Android que corresponde a cada categoría. */
const CANAL_ANDROID: Record<CategoriaNotificacion, string> = COLUMNA_PREFERENCIA;

const PAGINA_MAXIMA = 50;

export interface CrearNotificacionInput {
  organizacionId: string;
  /** Null = dirigida a todos los usuarios de la organización. */
  usuarioId: string | null;
  categoria: CategoriaNotificacion;
  titulo: string;
  cuerpo: string;
  data?: Record<string, unknown>;
  /** Si se repite, la notificación no se vuelve a crear (idempotencia del worker). */
  claveIdempotencia?: string;
}

export class NotificacionService {
  // -------------------------------------------------------------------------
  // Dispositivos
  // -------------------------------------------------------------------------

  /**
   * Registra o actualiza el token de este dispositivo.
   *
   * La unicidad es del token, no del par (usuario, token): cuando dos cobradores
   * comparten un teléfono, el segundo login debe REASIGNAR el token, no crear
   * una fila paralela — si no, el primero seguiría recibiendo las
   * notificaciones del segundo.
   */
  async registrarDispositivo(params: {
    usuarioId: string;
    token: string;
    plataforma: string;
    appVersion?: string;
  }): Promise<{ id: string }> {
    const dispositivo = await prisma.dispositivoPush.upsert({
      where: { token: params.token },
      create: {
        usuarioId: params.usuarioId,
        token: params.token,
        plataforma: params.plataforma,
        appVersion: params.appVersion,
      },
      update: {
        usuarioId: params.usuarioId,
        plataforma: params.plataforma,
        appVersion: params.appVersion,
        // Reactivar: el mismo token puede haberse desactivado en un logout
        // anterior y ahora vuelve a estar en uso.
        activo: true,
        ultimoUsoEn: new Date(),
      },
      select: { id: true },
    });

    return dispositivo;
  }

  /**
   * Da de baja un dispositivo al cerrar sesión. Exige que el token pertenezca
   * al usuario del JWT: sin esa condición, cualquiera con un token ajeno
   * podría silenciar el teléfono de otro.
   */
  async darDeBajaDispositivo(usuarioId: string, token: string): Promise<void> {
    await prisma.dispositivoPush.updateMany({
      where: { token, usuarioId },
      data: { activo: false },
    });
  }

  // -------------------------------------------------------------------------
  // Bandeja
  // -------------------------------------------------------------------------

  /**
   * Filtro de lo que este usuario puede ver: lo suyo, más lo dirigido a toda
   * su organización. Nunca lo de otro usuario, ni siquiera de la misma
   * organización.
   *
   * CUIDADO con `usuarioId: null`: hoy NADA crea filas así (hasta los anuncios
   * de plataforma generan una fila por usuario, ver admin-notificacion). El
   * motivo es que `leidaEn` vive en la fila, de modo que una fila compartida
   * quedaría marcada como leída para toda la organización en cuanto el primer
   * usuario la abriera. Si alguna vez hacen falta filas compartidas de verdad,
   * el estado de leído necesita su propia tabla — no basta con empezar a
   * escribir `usuarioId: null`.
   */
  private filtroVisible(organizacionId: string, usuarioId: string) {
    return {
      organizacionId,
      OR: [{ usuarioId }, { usuarioId: null }],
    };
  }

  async listar(params: {
    organizacionId: string;
    usuarioId: string;
    limite?: number;
    cursor?: string;
  }): Promise<{ items: unknown[]; siguienteCursor: string | null; noLeidas: number }> {
    const limite = Math.min(Math.max(params.limite ?? 20, 1), PAGINA_MAXIMA);
    const where = this.filtroVisible(params.organizacionId, params.usuarioId);

    const [filas, noLeidas] = await Promise.all([
      prisma.notificacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limite + 1, // una de más para saber si hay página siguiente
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          categoria: true,
          titulo: true,
          cuerpo: true,
          data: true,
          leidaEn: true,
          createdAt: true,
        },
      }),
      prisma.notificacion.count({ where: { ...where, leidaEn: null } }),
    ]);

    const hayMas = filas.length > limite;
    const items = hayMas ? filas.slice(0, limite) : filas;

    return {
      items,
      siguienteCursor: hayMas ? items[items.length - 1].id : null,
      noLeidas,
    };
  }

  async marcarLeida(organizacionId: string, usuarioId: string, id: string): Promise<void> {
    // updateMany con el filtro de visibilidad en vez de update por id: así una
    // notificación ajena devuelve 0 filas y termina en 404, nunca se modifica.
    const { count } = await prisma.notificacion.updateMany({
      where: { id, ...this.filtroVisible(organizacionId, usuarioId), leidaEn: null },
      data: { leidaEn: new Date() },
    });

    if (count === 0) {
      // Puede ser que no exista, que sea de otro, o que ya estuviera leída.
      const existe = await prisma.notificacion.findFirst({
        where: { id, ...this.filtroVisible(organizacionId, usuarioId) },
        select: { id: true },
      });
      if (!existe) {
        throw new NotFoundError('La notificación no existe o no es tuya.');
      }
    }
  }

  async marcarTodasLeidas(organizacionId: string, usuarioId: string): Promise<{ actualizadas: number }> {
    const { count } = await prisma.notificacion.updateMany({
      where: { ...this.filtroVisible(organizacionId, usuarioId), leidaEn: null },
      data: { leidaEn: new Date() },
    });
    return { actualizadas: count };
  }

  // -------------------------------------------------------------------------
  // Preferencias
  // -------------------------------------------------------------------------

  async obtenerPreferencias(usuarioId: string) {
    const existentes = await prisma.preferenciaNotificacion.findUnique({ where: { usuarioId } });
    if (existentes) return existentes;

    // Sin fila todavía: devolver los valores por defecto del esquema sin
    // escribir nada. Crear una fila en cada lectura llenaría la tabla de
    // usuarios que nunca abrieron la pantalla de ajustes.
    return {
      usuarioId,
      cobranza: true,
      jornada: true,
      equipo: true,
      suscripcion: true,
      sincronizacion: false,
      sonido: true,
      vibracion: true,
      updatedAt: null,
    };
  }

  async guardarPreferencias(
    usuarioId: string,
    datos: Partial<Record<string, boolean>>
  ): Promise<unknown> {
    return prisma.preferenciaNotificacion.upsert({
      where: { usuarioId },
      create: { usuarioId, ...datos },
      update: datos,
    });
  }

  // -------------------------------------------------------------------------
  // Creación y envío (lo usan los disparadores del servidor)
  // -------------------------------------------------------------------------

  /**
   * Crea la fila y encola el envío. Son dos pasos separados a propósito: si el
   * push falla, la notificación sigue en la bandeja y el usuario la ve al abrir
   * la app. El push es la entrega oportuna, no la fuente de verdad.
   *
   * Devuelve null si `claveIdempotencia` ya existía — es decir, si el
   * disparador ya corrió para este mismo hecho.
   */
  async crear(input: CrearNotificacionInput): Promise<{ id: string } | null> {
    if (input.claveIdempotencia) {
      const previa = await prisma.notificacion.findUnique({
        where: { claveIdempotencia: input.claveIdempotencia },
        select: { id: true },
      });
      if (previa) return null;
    }

    try {
      const notificacion = await prisma.notificacion.create({
        data: {
          organizacionId: input.organizacionId,
          usuarioId: input.usuarioId,
          categoria: input.categoria,
          titulo: input.titulo,
          cuerpo: input.cuerpo,
          data: (input.data ?? undefined) as never,
          claveIdempotencia: input.claveIdempotencia,
        },
        select: { id: true },
      });
      return notificacion;
    } catch (e: unknown) {
      // Carrera entre dos ejecuciones del mismo disparador: la unicidad de
      // claveIdempotencia es la que decide, y perder la carrera no es un error.
      const codigo = (e as { code?: string } | null)?.code;
      if (codigo === 'P2002') return null;
      throw e;
    }
  }

  /**
   * Crea la notificación y la envía por push a los dispositivos activos del
   * destinatario, respetando sus preferencias.
   *
   * Devuelve false si la notificación ya existía (clave de idempotencia
   * repetida), para que los disparadores puedan contar lo realmente nuevo.
   */
  async crearYEnviar(input: CrearNotificacionInput): Promise<boolean> {
    const notificacion = await this.crear(input);
    if (!notificacion) return false; // ya existía: el disparador es idempotente

    try {
      await this.enviarPorPush(notificacion.id, input);
    } catch (e) {
      // La fila ya está en la bandeja; que el push falle no revierte eso ni
      // debe tumbar al disparador.
      logger.error(e, '💥 Falló el envío push de una notificación ya creada.');
    }
    return true;
  }

  /** Destinatarios reales: el usuario indicado, o todos los de la organización. */
  private async resolverDestinatarios(input: CrearNotificacionInput): Promise<string[]> {
    if (input.usuarioId) return [input.usuarioId];

    const usuarios = await prisma.usuario.findMany({
      where: { organizacionId: input.organizacionId, deletedAt: null },
      select: { id: true },
    });
    return usuarios.map((u) => u.id);
  }

  private async enviarPorPush(notificacionId: string, input: CrearNotificacionInput): Promise<void> {
    const destinatarios = await this.resolverDestinatarios(input);
    if (destinatarios.length === 0) return;

    const columna = COLUMNA_PREFERENCIA[input.categoria];

    // Quienes apagaron esta categoría. La fila solo existe si el usuario tocó
    // sus ajustes alguna vez; su ausencia significa "valores por defecto".
    const preferencias = await prisma.preferenciaNotificacion.findMany({
      where: { usuarioId: { in: destinatarios } },
    });
    const silenciados = new Set(
      preferencias.filter((p) => (p as never as Record<string, boolean>)[columna] === false).map((p) => p.usuarioId)
    );

    const conPush = destinatarios.filter((id) => !silenciados.has(id));
    if (conPush.length === 0) {
      await prisma.notificacion.update({
        where: { id: notificacionId },
        data: { errorEnvio: 'Todos los destinatarios tienen la categoría silenciada.' },
      });
      return;
    }

    const dispositivos = await prisma.dispositivoPush.findMany({
      where: { usuarioId: { in: conPush }, activo: true },
      select: { token: true },
    });
    if (dispositivos.length === 0) {
      await prisma.notificacion.update({
        where: { id: notificacionId },
        data: { errorEnvio: 'Ningún destinatario tiene un dispositivo activo registrado.' },
      });
      return;
    }

    const mensajes: MensajePush[] = dispositivos.map((d) => ({
      to: d.token,
      title: input.titulo,
      body: input.cuerpo,
      data: { ...(input.data ?? {}), notificacionId, categoria: input.categoria },
      channelId: CANAL_ANDROID[input.categoria],
      sound: 'default',
    }));

    const resultados = await enviarPush(mensajes);

    // Desactivar los tokens que Expo declaró muertos. Sin esto la tabla se
    // llena de dispositivos fantasma y cada envío se vuelve más lento.
    const muertos = resultados.filter((r) => !r.ok && r.dispositivoNoRegistrado).map((r) => r.token);
    if (muertos.length > 0) {
      await prisma.dispositivoPush.updateMany({
        where: { token: { in: muertos } },
        data: { activo: false },
      });
    }

    const entregados = resultados.filter((r) => r.ok).length;
    const fallidos = resultados.filter((r) => !r.ok);

    await prisma.notificacion.update({
      where: { id: notificacionId },
      data: {
        enviadaEn: entregados > 0 ? new Date() : null,
        errorEnvio:
          fallidos.length > 0
            ? `${fallidos.length} de ${resultados.length} envíos fallaron: ${fallidos[0].error}`.slice(0, 500)
            : null,
      },
    });
  }
}
