import { prisma } from '../../config/database.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/custom.error.js';
import type { EventoRevenueCat } from './revenuecat.client.js';
import type { ProveedorPago } from '@prisma/client';

export type RecursoLimitado = 'usuarios' | 'clientes' | 'rutas' | 'prestamosActivos';

const CLAVE_LIMITE: Record<RecursoLimitado, string> = {
  usuarios: 'maxUsuarios',
  clientes: 'maxClientes',
  rutas: 'maxRutas',
  prestamosActivos: 'maxPrestamosActivos',
};

const ETIQUETA_RECURSO: Record<RecursoLimitado, string> = {
  usuarios: 'usuarios',
  clientes: 'clientes',
  rutas: 'rutas',
  prestamosActivos: 'préstamos activos',
};

function fechaDesdeMs(ms: number | null | undefined): Date | undefined {
  return typeof ms === 'number' ? new Date(ms) : undefined;
}

export class SuscripcionService {
  async obtenerMiSuscripcion(organizacionId: string) {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { organizacionId },
      include: { plan: true },
    });

    if (!suscripcion) {
      throw new NotFoundError('Esta organización no tiene una suscripción registrada.');
    }

    const uso = await this.obtenerUsoActual(organizacionId);

    return {
      id: suscripcion.id,
      estado: suscripcion.estado,
      proveedor: suscripcion.proveedor,
      trialTerminaEn: suscripcion.trialTerminaEn,
      periodoFinEn: suscripcion.periodoFinEn,
      canceladaEn: suscripcion.canceladaEn,
      ultimoPagoEn: suscripcion.ultimoPagoEn,
      plan: {
        codigo: suscripcion.plan.codigo,
        nombre: suscripcion.plan.nombre,
        precioMensual: Number(suscripcion.plan.precioMensual),
        moneda: suscripcion.plan.moneda,
        limites: suscripcion.plan.limites,
      },
      uso,
    };
  }

  /** Catálogo público de planes activos, para que la pantalla de facturación ofrezca a cuál suscribirse. */
  async listarPlanesActivos() {
    const planes = await prisma.plan.findMany({ where: { activo: true }, orderBy: { orden: 'asc' } });
    return planes.map((plan) => ({
      id: plan.id,
      codigo: plan.codigo,
      nombre: plan.nombre,
      descripcion: plan.descripcion,
      precioMensual: Number(plan.precioMensual),
      moneda: plan.moneda,
      limites: plan.limites,
      revenueCatDisponible: !!plan.revenueCatEntitlementId,
    }));
  }

  async obtenerUsoActual(organizacionId: string) {
    const [usuarios, clientes, rutas, prestamosActivos] = await Promise.all([
      prisma.usuario.count({ where: { organizacionId, deletedAt: null } }),
      prisma.cliente.count({ where: { organizacionId, deletedAt: null } }),
      prisma.ruta.count({ where: { organizacionId, deletedAt: null } }),
      prisma.prestamo.count({ where: { cliente: { organizacionId }, estado: 'ACTIVO', deletedAt: null } }),
    ]);
    return { usuarios, clientes, rutas, prestamosActivos };
  }

  /**
   * Lanza ForbiddenError si crear `incremento` recursos de este tipo
   * excedería el límite del plan activo. `null`/ausente en `plan.limites`
   * significa sin límite (plan Empresarial).
   */
  async verificarLimite(organizacionId: string, recurso: RecursoLimitado, incremento: number): Promise<void> {
    if (incremento <= 0) return;

    const suscripcion = await prisma.suscripcion.findUnique({
      where: { organizacionId },
      include: { plan: true },
    });
    // Sin suscripción: requireActiveSubscription ya debió bloquear la
    // petición antes de llegar aquí; no hay límite que verificar.
    if (!suscripcion) return;

    const limites = (suscripcion.plan.limites as Record<string, unknown>) ?? {};
    const limite = limites[CLAVE_LIMITE[recurso]];
    if (limite === null || limite === undefined) return;

    const uso = await this.obtenerUsoActual(organizacionId);
    const actual = uso[recurso];
    if (actual + incremento > (limite as number)) {
      throw new ForbiddenError(
        `Alcanzaste el límite de ${ETIQUETA_RECURSO[recurso]} de tu plan (${limite}). Sube de plan en Ajustes > Plan y facturación para agregar más.`
      );
    }
  }

  /** true si la organización puede seguir escribiendo (TRIAL vigente o ACTIVA). */
  async tieneAccesoActivo(organizacionId: string): Promise<boolean> {
    const suscripcion = await prisma.suscripcion.findUnique({ where: { organizacionId } });
    // Sin fila de suscripción (org creada antes de este cambio, o el seed de
    // planes no había corrido aún) no se asume acceso: se trata como bloqueada.
    if (!suscripcion) return false;

    if (suscripcion.estado === 'ACTIVA') return true;
    if (suscripcion.estado === 'TRIAL') {
      return !suscripcion.trialTerminaEn || suscripcion.trialTerminaEn.getTime() > Date.now();
    }
    return false;
  }

  /**
   * Aplica un evento de webhook de RevenueCat (ya autenticado) de forma
   * idempotente. La compra en sí (Android o Web) ocurre enteramente dentro
   * del SDK de RevenueCat en el cliente — este webhook es la única forma en
   * que el backend se entera de altas, renovaciones y cancelaciones.
   *
   * El SDK se configura con `Purchases.configure({ appUserID: organizacionId })`,
   * así que `evento.app_user_id` ya es directamente el organizacionId: no hace
   * falta una tabla puente para mapear un id externo al tenant.
   */
  async procesarEventoRevenueCat(evento: EventoRevenueCat): Promise<void> {
    const organizacionId = evento.app_user_id;
    const suscripcion = await prisma.suscripcion.findUnique({ where: { organizacionId } });

    await this.registrarEventoIdempotente({
      proveedor: 'REVENUE_CAT',
      externalEventId: evento.id,
      tipo: evento.type,
      payload: evento,
      suscripcionId: suscripcion?.id,
      aplicar: async () => {
        // Organización que no reconocemos (id mal configurado en el cliente,
        // o el evento llegó de un ambiente de pruebas) — se registra para
        // auditoría pero no hay nada que actualizar.
        if (!suscripcion) return;

        const entitlementId = evento.entitlement_ids?.[0];
        const plan = entitlementId
          ? await prisma.plan.findFirst({ where: { revenueCatEntitlementId: entitlementId } })
          : null;

        const periodoFinEn = fechaDesdeMs(evento.expiration_at_ms);
        const base = plan ? { planId: plan.id } : {};

        switch (evento.type) {
          case 'INITIAL_PURCHASE':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: {
                ...base,
                estado: 'ACTIVA',
                periodoInicioEn: fechaDesdeMs(evento.purchased_at_ms) ?? new Date(),
                periodoFinEn,
                ultimoPagoEn: new Date(),
              },
            });
            break;
          case 'RENEWAL':
          case 'NON_RENEWING_PURCHASE':
          case 'PRODUCT_CHANGE':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { ...base, estado: 'ACTIVA', periodoFinEn, ultimoPagoEn: new Date() },
            });
            break;
          case 'UNCANCELLATION':
            // El usuario reactivó el auto-renovado antes de que expirara: no
            // hubo cobro nuevo, solo se limpia la marca de cancelación.
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { ...base, estado: 'ACTIVA', periodoFinEn, canceladaEn: null },
            });
            break;
          case 'CANCELLATION':
            // El usuario apagó el auto-renovado: el acceso sigue vivo hasta
            // `periodoFinEn` — el estado solo cambia cuando llegue EXPIRATION.
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { canceladaEn: new Date() },
            });
            break;
          case 'EXPIRATION':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'EXPIRADA', periodoFinEn: periodoFinEn ?? new Date() },
            });
            break;
          case 'BILLING_ISSUE':
          case 'SUBSCRIPTION_PAUSED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'SUSPENDIDA' },
            });
            break;
          default:
            // TRANSFER, TEST u otros tipos nuevos que RevenueCat agregue:
            // quedan en SuscripcionEvento para auditoría, sin cambio de estado.
            break;
        }
      },
    });
  }

  /**
   * Registra un evento externo de forma idempotente antes de aplicarlo: si
   * `externalEventId` ya fue procesado (RevenueCat reintenta webhooks que no
   * respondieron 2xx), `aplicar` no se vuelve a ejecutar.
   */
  async registrarEventoIdempotente(params: {
    proveedor: ProveedorPago;
    externalEventId: string;
    tipo: string;
    payload: unknown;
    suscripcionId?: string;
    aplicar: () => Promise<void>;
  }): Promise<void> {
    try {
      await prisma.suscripcionEvento.create({
        data: {
          proveedor: params.proveedor,
          externalEventId: params.externalEventId,
          tipo: params.tipo,
          payload: params.payload as any,
          suscripcionId: params.suscripcionId,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Evento ya procesado (reintento del proveedor) — no reaplicar.
        return;
      }
      throw error;
    }

    await params.aplicar();
  }
}
