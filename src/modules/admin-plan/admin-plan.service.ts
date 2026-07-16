import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../shared/errors/custom.error.js';
import { crearProductoPaypal, crearPlanBillingPaypal } from '../suscripcion/paypal.client.js';
import type { crearPlanSchema, actualizarPlanSchema } from './admin-plan.schema.js';
import type { Plan } from '@prisma/client';
import type { z } from 'zod';

type CrearPlanInput = z.infer<typeof crearPlanSchema>;
type ActualizarPlanInput = z.infer<typeof actualizarPlanSchema>;

export class AdminPlanService {
  /** Prisma serializa Decimal como string; el panel espera un número plano. */
  private toResponse(plan: Plan) {
    return { ...plan, precioMensual: Number(plan.precioMensual) };
  }

  /** Catálogo completo (activos e inactivos) para la tabla del panel. */
  async listar() {
    const planes = await prisma.plan.findMany({ orderBy: { orden: 'asc' } });
    return planes.map((plan) => this.toResponse(plan));
  }

  async crear(data: CrearPlanInput) {
    const existente = await prisma.plan.findUnique({ where: { codigo: data.codigo } });
    if (existente) {
      throw new ConflictError(`Ya existe un plan con el código "${data.codigo}".`);
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (data.esPredeterminado) {
        await tx.plan.updateMany({ data: { esPredeterminado: false } });
      }
      return tx.plan.create({ data });
    });
    return this.toResponse(plan);
  }

  async actualizar(id: string, data: ActualizarPlanInput) {
    const existente = await prisma.plan.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundError('El plan no existe.');
    }

    if (data.codigo && data.codigo !== existente.codigo) {
      const otro = await prisma.plan.findUnique({ where: { codigo: data.codigo } });
      if (otro) {
        throw new ConflictError(`Ya existe un plan con el código "${data.codigo}".`);
      }
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (data.esPredeterminado) {
        await tx.plan.updateMany({ where: { id: { not: id } }, data: { esPredeterminado: false } });
      }
      return tx.plan.update({ where: { id }, data });
    });
    return this.toResponse(plan);
  }

  /**
   * Automatiza lo que antes se hacía a mano por PowerShell: crea el producto
   * y el billing plan mensual en PayPal, y guarda el paypalPlanId resultante.
   * Rechaza si el plan ya tiene uno vinculado (evita duplicar en PayPal por
   * doble click).
   */
  async generarEnPaypal(id: string) {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundError('El plan no existe.');
    }
    if (plan.paypalPlanId) {
      throw new ConflictError('Este plan ya tiene un paypalPlanId vinculado a PayPal.');
    }

    const producto = await crearProductoPaypal({
      nombre: plan.nombre,
      descripcion: plan.descripcion ?? undefined,
    });
    const planBilling = await crearPlanBillingPaypal({
      productId: producto.id,
      nombre: `${plan.nombre} Mensual`,
      precioMensual: Number(plan.precioMensual),
      moneda: plan.moneda,
    });

    const actualizado = await prisma.plan.update({ where: { id }, data: { paypalPlanId: planBilling.id } });
    return this.toResponse(actualizado);
  }
}
