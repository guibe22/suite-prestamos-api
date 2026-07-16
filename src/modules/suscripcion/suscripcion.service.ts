import { prisma } from '../../config/database.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/custom.error.js';
import { crearSuscripcion as crearSuscripcionPaypal } from './paypal.client.js';
import { verificarCompraGoogle as verificarCompraGoogleApi } from './google-play.client.js';
import type { ProveedorPago } from '@prisma/client';

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
      paypalDisponible: !!plan.paypalPlanId,
      googleDisponible: !!plan.googleProductId,
    }));
  }

  async obtenerUsoActual(organizacionId: string) {
    const [usuarios, clientes, rutas] = await Promise.all([
      prisma.usuario.count({ where: { organizacionId, deletedAt: null } }),
      prisma.cliente.count({ where: { organizacionId, deletedAt: null } }),
      prisma.ruta.count({ where: { organizacionId, deletedAt: null } }),
    ]);
    return { usuarios, clientes, rutas };
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

  /** Crea la suscripción en PayPal para el plan indicado y la vincula a la organización. */
  async iniciarSuscripcionPaypal(
    organizacionId: string,
    planId: string,
    returnUrl: string,
    cancelUrl: string,
  ): Promise<{ approveUrl: string }> {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.activo) {
      throw new NotFoundError('El plan solicitado no existe o no está disponible.');
    }
    if (!plan.paypalPlanId) {
      throw new BadRequestError('Este plan todavía no tiene configurado un paypalPlanId.');
    }

    const { id: paypalSubscriptionId, approveUrl } = await crearSuscripcionPaypal({
      paypalPlanId: plan.paypalPlanId,
      returnUrl,
      cancelUrl,
    });

    // Queda en PENDIENTE_PAGO hasta que el webhook confirme la activación
    // (BILLING.SUBSCRIPTION.ACTIVATED) tras la aprobación del usuario en PayPal.
    await prisma.suscripcion.update({
      where: { organizacionId },
      data: {
        planId: plan.id,
        proveedor: 'PAYPAL',
        estado: 'PENDIENTE_PAGO',
        paypalSubscriptionId,
      },
    });

    return { approveUrl };
  }

  /** Aplica un evento de webhook de PayPal (ya verificado) de forma idempotente. */
  async procesarEventoPaypal(evento: { id: string; event_type: string; resource?: any }): Promise<void> {
    const paypalSubscriptionId: string | undefined =
      evento.resource?.id ?? evento.resource?.billing_agreement_id;
    const suscripcion = paypalSubscriptionId
      ? await prisma.suscripcion.findUnique({ where: { paypalSubscriptionId } })
      : null;

    await this.registrarEventoIdempotente({
      proveedor: 'PAYPAL',
      externalEventId: evento.id,
      tipo: evento.event_type,
      payload: evento,
      suscripcionId: suscripcion?.id,
      aplicar: async () => {
        // Evento de una suscripción que no reconocemos (de otra integración,
        // o llegó antes de que /paypal/iniciar terminara de persistir) — se
        // registra para auditoría pero no hay nada que actualizar.
        if (!suscripcion) return;

        switch (evento.event_type) {
          case 'BILLING.SUBSCRIPTION.ACTIVATED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'ACTIVA', periodoInicioEn: new Date(), ultimoPagoEn: new Date() },
            });
            break;
          case 'PAYMENT.SALE.COMPLETED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'ACTIVA', ultimoPagoEn: new Date() },
            });
            break;
          case 'BILLING.SUBSCRIPTION.CANCELLED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'CANCELADA', canceladaEn: new Date() },
            });
            break;
          case 'BILLING.SUBSCRIPTION.SUSPENDED':
          case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'SUSPENDIDA' },
            });
            break;
          case 'BILLING.SUBSCRIPTION.EXPIRED':
            await prisma.suscripcion.update({
              where: { id: suscripcion.id },
              data: { estado: 'EXPIRADA' },
            });
            break;
          default:
            // Otros eventos (UPDATED, RE-ACTIVATED, etc.): quedan en
            // SuscripcionEvento para auditoría, sin cambio de estado aún.
            break;
        }
      },
    });
  }

  /**
   * El app envía purchaseToken+productId tras completar una compra de Play
   * Billing; se verifica contra la Developer API y se persiste la entitlement.
   */
  async verificarCompraGoogle(
    organizacionId: string,
    purchaseToken: string,
    productId: string,
  ): Promise<{ estado: string }> {
    const plan = await prisma.plan.findFirst({ where: { googleProductId: productId, activo: true } });
    if (!plan) {
      throw new NotFoundError('No se encontró un plan activo asociado a este producto de Google Play.');
    }

    const compra = await verificarCompraGoogleApi(purchaseToken);

    await prisma.suscripcion.update({
      where: { organizacionId },
      data: {
        planId: plan.id,
        proveedor: 'GOOGLE_PLAY',
        estado: compra.estado,
        googlePurchaseToken: purchaseToken,
        googleOrderId: compra.latestOrderId,
        periodoFinEn: compra.expiryTime,
        ...(compra.estado === 'ACTIVA' ? { ultimoPagoEn: new Date() } : {}),
      },
    });

    return { estado: compra.estado };
  }

  /**
   * Aplica una notificación RTDN de Google (ya decodificada) de forma
   * idempotente: siempre re-verifica la verdad contra la Developer API antes
   * de actualizar, en vez de confiar en el contenido del push.
   */
  async procesarNotificacionGoogle(
    messageId: string,
    purchaseToken: string,
    notificationType: number,
  ): Promise<void> {
    const suscripcion = await prisma.suscripcion.findUnique({ where: { googlePurchaseToken: purchaseToken } });

    await this.registrarEventoIdempotente({
      proveedor: 'GOOGLE_PLAY',
      externalEventId: messageId,
      tipo: `RTDN_${notificationType}`,
      payload: { purchaseToken, notificationType },
      suscripcionId: suscripcion?.id,
      aplicar: async () => {
        // Token que todavía no vinculamos a ninguna organización (p.ej. el
        // push llegó antes de que /google/verificar-compra terminara) — se
        // registra para auditoría, sin nada que actualizar todavía.
        if (!suscripcion) return;

        const compra = await verificarCompraGoogleApi(purchaseToken);
        await prisma.suscripcion.update({
          where: { id: suscripcion.id },
          data: {
            estado: compra.estado,
            googlePurchaseToken: purchaseToken,
            googleOrderId: compra.latestOrderId ?? suscripcion.googleOrderId,
            periodoFinEn: compra.expiryTime,
            ...(compra.estado === 'ACTIVA' ? { ultimoPagoEn: new Date() } : {}),
          },
        });
      },
    });
  }

  /**
   * Registra un evento externo de forma idempotente antes de aplicarlo: si
   * `externalEventId` ya fue procesado (reintento de webhook de PayPal o
   * entrega "at-least-once" de Pub/Sub de Google), `aplicar` no se vuelve a
   * ejecutar.
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
