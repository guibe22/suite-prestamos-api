import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { getPagination, getPaginationMeta } from '../../utils/pagination.js';
import type { actualizarSuscripcionOrgSchema, listarOrganizacionesQuerySchema } from './admin-organizacion.schema.js';
import type { z } from 'zod';
import type { EstadoSuscripcion, Prisma } from '@prisma/client';

type ActualizarSuscripcionInput = z.infer<typeof actualizarSuscripcionOrgSchema>;
type ListarOrganizacionesQuery = Partial<z.infer<typeof listarOrganizacionesQuerySchema>>;

/** undefined = no tocar el campo, null = limpiarlo, string = fecha nueva. */
function normalizarFecha(valor?: string | null): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(valor);
}

export class AdminOrganizacionService {
  /** Catálogo paginado y filtrado de organizaciones para el panel de PLATAFORMA. */
  async listar(query: ListarOrganizacionesQuery = {}) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Number(query.limit) : 10;
    const { skip, take } = getPagination({ page, limit });

    const search = query.search?.trim();
    const estado = query.estado;
    const planId = query.planId;

    const where: Prisma.OrganizacionWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { id: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(estado && estado !== 'TODOS'
        ? estado === 'SIN_SUSCRIPCION'
          ? { suscripcion: null }
          : { suscripcion: { estado: estado as EstadoSuscripcion } }
        : {}),
      ...(planId && planId !== 'TODOS'
        ? { suscripcion: { planId } }
        : {}),
    };

    const [totalItems, organizaciones, stats] = await Promise.all([
      prisma.organizacion.count({ where }),
      prisma.organizacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          suscripcion: { include: { plan: true } },
          _count: { select: { usuarios: true, clientes: true } },
        },
      }),
      this.obtenerEstadisticas(),
    ]);

    const data = organizaciones.map((org) => ({
      id: org.id,
      nombre: org.nombre,
      createdAt: org.createdAt,
      usuarios: org._count.usuarios,
      clientes: org._count.clientes,
      suscripcion: org.suscripcion
        ? {
            estado: org.suscripcion.estado,
            proveedor: org.suscripcion.proveedor,
            trialTerminaEn: org.suscripcion.trialTerminaEn,
            periodoFinEn: org.suscripcion.periodoFinEn,
            canceladaEn: org.suscripcion.canceladaEn,
            avisoDias: org.suscripcion.avisoDias,
            diasGraciaSuspension: org.suscripcion.diasGraciaSuspension,
            avisoEnviadoEn: org.suscripcion.avisoEnviadoEn,
            plan: {
              id: org.suscripcion.plan.id,
              codigo: org.suscripcion.plan.codigo,
              nombre: org.suscripcion.plan.nombre,
            },
          }
        : null,
    }));

    const meta = {
      ...getPaginationMeta(page, limit, totalItems),
      stats,
    };

    return { data, meta };
  }

  /** Estadísticas globales para las tarjetas KPI de la cabecera. */
  private async obtenerEstadisticas() {
    const [total, activas, trial, sinSub] = await Promise.all([
      prisma.organizacion.count({ where: { deletedAt: null } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: { estado: 'ACTIVA' } } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: { estado: 'TRIAL' } } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: null } }),
    ]);

    return {
      total,
      activas,
      trial,
      bloqueadas: Math.max(0, total - activas - trial - sinSub),
      sinSub,
    };
  }

  /** Alta/edición manual de la suscripción de una organización. */
  async actualizarSuscripcion(organizacionId: string, data: ActualizarSuscripcionInput) {
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!organizacion) {
      throw new NotFoundError('La organización no existe.');
    }

    const plan = await prisma.plan.findUnique({ where: { id: data.planId } });
    if (!plan) {
      throw new NotFoundError('El plan indicado no existe.');
    }

    const actual = await prisma.suscripcion.findUnique({ where: { organizacionId } });
    const periodoFinEn = normalizarFecha(data.periodoFinEn);
    const periodoFinEnCambio = periodoFinEn !== undefined && periodoFinEn?.getTime() !== actual?.periodoFinEn?.getTime();

    const campos = {
      planId: data.planId,
      proveedor: data.proveedor,
      estado: data.estado,
      trialTerminaEn: normalizarFecha(data.trialTerminaEn),
      periodoFinEn,
      canceladaEn: normalizarFecha(data.canceladaEn),
      avisoDias: data.avisoDias,
      diasGraciaSuspension: data.diasGraciaSuspension,
      ...(periodoFinEnCambio ? { avisoEnviadoEn: null } : {}),
    };

    return prisma.suscripcion.upsert({
      where: { organizacionId },
      update: campos,
      create: { organizacionId, ...campos },
      include: { plan: true },
    });
  }

  /** Bitácora de auditoría de una organización. */
  async listarAuditoria(organizacionId: string) {
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!organizacion) {
      throw new NotFoundError('La organización no existe.');
    }

    return prisma.auditoria.findMany({
      where: { usuario: { organizacionId } },
      include: { usuario: { select: { nombre: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Elimina un registro de soporte (Pago, Préstamo, Jornada o Gasto) de la organización. */
  async eliminarRegistroSoporte(organizacionId: string, tipo: string, registroId: string) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    const tipoUpper = tipo.toUpperCase();

    if (tipoUpper === 'PAGO') {
      const pago = await prisma.pago.findFirst({
        where: { id: registroId, prestamo: { cliente: { organizacionId } } },
        include: { prestamo: true },
      });
      if (!pago) throw new NotFoundError('El pago no fue encontrado en esta organización.');

      // Revertir estado del préstamo si estaba LIQUIDADO
      if (pago.prestamo?.estado === 'LIQUIDADO') {
        await prisma.prestamo.update({
          where: { id: pago.prestamoId },
          data: { estado: 'ACTIVO' },
        });
      }

      await prisma.pago.delete({ where: { id: registroId } });
      return { mensaje: 'Pago eliminado con éxito.' };
    }

    if (tipoUpper === 'PRESTAMO') {
      const prestamo = await prisma.prestamo.findFirst({
        where: { id: registroId, cliente: { organizacionId } },
      });
      if (!prestamo) throw new NotFoundError('El préstamo no fue encontrado en esta organización.');

      await prisma.$transaction([
        prisma.cuota.deleteMany({ where: { prestamoId: registroId } }),
        prisma.pago.deleteMany({ where: { prestamoId: registroId } }),
        prisma.prestamo.delete({ where: { id: registroId } }),
      ]);
      return { mensaje: 'Préstamo y sus registros asociados eliminados con éxito.' };
    }

    if (tipoUpper === 'JORNADA') {
      const jornada = await prisma.jornadaCobranza.findFirst({
        where: { id: registroId, organizacionId },
      });
      if (!jornada) throw new NotFoundError('La jornada no fue encontrada en esta organización.');

      await prisma.jornadaCobranza.delete({ where: { id: registroId } });
      return { mensaje: 'Jornada eliminada con éxito.' };
    }

    if (tipoUpper === 'GASTO') {
      const gasto = await prisma.gasto.findFirst({
        where: {
          id: registroId,
          OR: [
            { caja: { organizacionId } },
            { jornada: { organizacionId } },
          ],
        },
      });
      if (!gasto) throw new NotFoundError('El gasto no fue encontrado en esta organización.');

      await prisma.gasto.delete({ where: { id: registroId } });
      return { mensaje: 'Gasto eliminado con éxito.' };
    }

    throw new Error('Tipo de registro no soportado. Tipos válidos: PAGO, PRESTAMO, JORNADA, GASTO.');
  }

  /** Exporta la estructura completa de Clientes y Préstamos de la organización a JSON. */
  async exportarClientesYPrestamos(organizacionId: string) {
    const clientes = await prisma.cliente.findMany({
      where: { organizacionId, deletedAt: null },
      include: {
        prestamos: {
          where: { deletedAt: null },
          include: {
            cuotas: { where: { deletedAt: null }, orderBy: { numeroCuota: 'asc' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      version: '1.0',
      fechaExportacion: new Date().toISOString(),
      organizacionId,
      clientes: clientes.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nombres: c.nombres,
        apellidos: c.apellidos,
        identificacion: c.identificacion,
        telefono: c.telefono,
        direccion: c.direccion,
        empresa: c.empresa,
        puntuacion: c.puntuacion,
        estado: c.estado,
        prestamos: c.prestamos.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          monto: Number(p.monto),
          tasaInteres: Number(p.tasaInteres),
          plazo: p.plazo,
          estado: p.estado,
          fechaInicio: p.fechaInicio,
          fechaVencimiento: p.fechaVencimiento,
          cuotas: p.cuotas.map((cu) => ({
            numeroCuota: cu.numeroCuota,
            montoPrincipal: Number(cu.montoPrincipal),
            montoInteres: Number(cu.montoInteres),
            montoTotal: Number(cu.montoTotal),
            montoPagado: Number(cu.montoPagado),
            fechaVencimiento: cu.fechaVencimiento,
            estado: cu.estado,
          })),
        })),
      })),
    };
  }

  /** Importa clientes y préstamos desde un JSON formateado a la organización. */
  async importarClientesYPrestamos(organizacionId: string, payload: any) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    if (!payload || !Array.isArray(payload.clientes)) {
      throw new Error('Formato de datos inválido: se requiere un objeto con el arreglo "clientes".');
    }

    // Buscar una ruta válida o crear "Ruta Principal" por defecto
    let ruta = await prisma.ruta.findFirst({
      where: { organizacionId, deletedAt: null },
    });

    if (!ruta) {
      ruta = await prisma.ruta.create({
        data: {
          organizacionId,
          nombre: 'Ruta Principal',
          codigo: 'RP-01',
          diaSemana: 'LUNES',
        },
      });
    }

    let clientesCreados = 0;
    let prestamosCreados = 0;

    for (const cData of payload.clientes) {
      if (!cData.nombres) continue;

      const codigoCliente = cData.codigo || `C-${Math.floor(100000 + Math.random() * 900000)}`;

      const cliente = await prisma.cliente.create({
        data: {
          organizacionId,
          rutaId: ruta.id,
          codigo: codigoCliente,
          nombres: cData.nombres,
          apellidos: cData.apellidos || null,
          identificacion: cData.identificacion || null,
          telefono: cData.telefono || '8090000000',
          direccion: cData.direccion || 'Sin dirección',
          empresa: cData.empresa || null,
          puntuacion: cData.puntuacion ?? 100,
          estado: 'ACTIVO',
        },
      });

      clientesCreados++;

      if (Array.isArray(cData.prestamos)) {
        for (const pData of cData.prestamos) {
          const monto = Number(pData.monto) || 0;
          const tasa = Number(pData.tasaInteres) || 0;
          const plazo = Number(pData.plazo) || 1;
          if (monto <= 0) continue;

          const prestamo = await prisma.prestamo.create({
            data: {
              clienteId: cliente.id,
              monto,
              tasaInteres: tasa,
              plazo,
              estado: pData.estado || 'ACTIVO',
              fechaInicio: pData.fechaInicio ? new Date(pData.fechaInicio) : new Date(),
              fechaVencimiento: pData.fechaVencimiento ? new Date(pData.fechaVencimiento) : new Date(Date.now() + plazo * 86400000),
              codigo: pData.codigo || `P-${Math.floor(100000 + Math.random() * 900000)}`,
            },
          });

          prestamosCreados++;

          // Generar cuotas
          const totalInteres = monto * (tasa / 100);
          const cuotaTotal = (monto + totalInteres) / plazo;
          const cuotaPrincipal = monto / plazo;
          const cuotaInteres = totalInteres / plazo;

          if (Array.isArray(pData.cuotas) && pData.cuotas.length > 0) {
            for (const cuData of pData.cuotas) {
              await prisma.cuota.create({
                data: {
                  prestamoId: prestamo.id,
                  numeroCuota: cuData.numeroCuota,
                  montoPrincipal: Number(cuData.montoPrincipal) || cuotaPrincipal,
                  montoInteres: Number(cuData.montoInteres) || cuotaInteres,
                  montoTotal: Number(cuData.montoTotal) || cuotaTotal,
                  montoPagado: Number(cuData.montoPagado) || 0,
                  fechaVencimiento: cuData.fechaVencimiento ? new Date(cuData.fechaVencimiento) : new Date(),
                  estado: cuData.estado || 'PENDIENTE',
                },
              });
            }
          } else {
            const fechaInicio = prestamo.fechaInicio;
            for (let i = 0; i < plazo; i++) {
              const due = new Date(fechaInicio);
              due.setDate(due.getDate() + (i + 1));
              await prisma.cuota.create({
                data: {
                  prestamoId: prestamo.id,
                  numeroCuota: i + 1,
                  montoPrincipal: cuotaPrincipal,
                  montoInteres: cuotaInteres,
                  montoTotal: cuotaTotal,
                  montoPagado: 0,
                  fechaVencimiento: due,
                  estado: 'PENDIENTE',
                },
              });
            }
          }
        }
      }
    }

    return { clientesCreados, prestamosCreados };
  }
}
