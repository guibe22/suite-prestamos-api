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

  /** Lista registros (Pagos, Préstamos, Jornadas o Gastos) para el panel de soporte con búsqueda rápida y paginación. */
  async buscarRegistrosSoporte(organizacionId: string, tipo: string, search?: string, pageNum: number = 1, limitNum: number = 10) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    const page = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const limit = Number(limitNum) > 0 ? Number(limitNum) : 10;
    const { skip, take } = getPagination({ page, limit });

    const cleanSearch = search?.trim();
    const tipoUpper = tipo.toUpperCase();

    if (tipoUpper === 'PAGO') {
      const where: Prisma.PagoWhereInput = {
        deletedAt: null,
        prestamo: { cliente: { organizacionId } },
        ...(cleanSearch
          ? {
              OR: [
                { id: { contains: cleanSearch, mode: 'insensitive' } },
                { prestamo: { codigo: { contains: cleanSearch, mode: 'insensitive' } } },
                { prestamo: { cliente: { nombres: { contains: cleanSearch, mode: 'insensitive' } } } },
                { prestamo: { cliente: { apellidos: { contains: cleanSearch, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      };

      const [totalItems, pagos] = await Promise.all([
        prisma.pago.count({ where }),
        prisma.pago.findMany({
          where,
          include: {
            prestamo: {
              include: {
                cliente: { select: { nombres: true, apellidos: true, codigo: true } },
              },
            },
          },
          orderBy: { fechaPago: 'desc' },
          skip,
          take,
        }),
      ]);

      const data = pagos.map((p) => ({
        id: p.id,
        fecha: p.fechaPago ? new Date(p.fechaPago).toISOString() : new Date().toISOString(),
        clienteNombre: p.prestamo?.cliente ? `${p.prestamo.cliente.nombres} ${p.prestamo.cliente.apellidos || ''}`.trim() : 'Desconocido',
        codigoPrestamo: p.prestamo?.codigo || p.prestamoId,
        monto: Number(p.monto || 0),
        metodoPago: p.metodoPago || 'EFECTIVO',
        referencia: p.referencia || '—',
      }));

      return {
        data,
        meta: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    }

    if (tipoUpper === 'PRESTAMO') {
      const where: Prisma.PrestamoWhereInput = {
        deletedAt: null,
        cliente: { organizacionId },
        ...(cleanSearch
          ? {
              OR: [
                { id: { contains: cleanSearch, mode: 'insensitive' } },
                { codigo: { contains: cleanSearch, mode: 'insensitive' } },
                { cliente: { nombres: { contains: cleanSearch, mode: 'insensitive' } } },
                { cliente: { apellidos: { contains: cleanSearch, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const [totalItems, prestamos] = await Promise.all([
        prisma.prestamo.count({ where }),
        prisma.prestamo.findMany({
          where,
          include: {
            cliente: { select: { nombres: true, apellidos: true, codigo: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      ]);

      const data = prestamos.map((p) => ({
        id: p.id,
        codigo: p.codigo || p.id,
        clienteNombre: p.cliente ? `${p.cliente.nombres} ${p.cliente.apellidos || ''}`.trim() : 'Desconocido',
        monto: Number(p.monto || 0),
        tasaInteres: Number(p.tasaInteres || 0),
        plazo: p.plazo || 1,
        estado: p.estado || 'ACTIVO',
        fechaInicio: p.fechaInicio ? new Date(p.fechaInicio).toISOString() : new Date().toISOString(),
      }));

      return {
        data,
        meta: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    }

    if (tipoUpper === 'JORNADA') {
      const where: Prisma.JornadaCobranzaWhereInput = {
        deletedAt: null,
        organizacionId,
        ...(cleanSearch
          ? {
              OR: [
                { id: { contains: cleanSearch, mode: 'insensitive' } },
                { ruta: { nombre: { contains: cleanSearch, mode: 'insensitive' } } },
                { usuario: { nombre: { contains: cleanSearch, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const [totalItems, jornadas] = await Promise.all([
        prisma.jornadaCobranza.count({ where }),
        prisma.jornadaCobranza.findMany({
          where,
          include: {
            ruta: { select: { nombre: true } },
            usuario: { select: { nombre: true, email: true } },
          },
          orderBy: { fecha: 'desc' },
          skip,
          take,
        }),
      ]);

      const data = jornadas.map((j) => ({
        id: j.id,
        fecha: j.fecha ? new Date(j.fecha).toISOString() : new Date().toISOString(),
        // Timestamp real de creación (distinto de `fecha`, que es el día de
        // trabajo): con dos jornadas del mismo día/ruta, esto es lo único que
        // deja ver si son de horas distintas (reapertura legítima) o casi
        // simultáneas (indicio de duplicado por doble clic/sync).
        creadaEn: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        rutaNombre: j.ruta?.nombre || 'Sin Ruta',
        cobradorNombre: j.usuario?.nombre || 'Desconocido',
        saldoInicial: Number(j.saldoInicial || 0),
        saldoFinal: j.saldoFinal != null ? Number(j.saldoFinal) : null,
        efectivoCobrado: Number(j.efectivoCobrado || 0),
        gastos: Number(j.gastos || 0),
        estado: j.estado || 'ABIERTA',
      }));

      return {
        data,
        meta: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    }

    if (tipoUpper === 'GASTO') {
      // OJO: el scope de organización y el filtro de búsqueda usan ambos la
      // clave "OR" — deben ir en un AND separado, nunca en el mismo objeto,
      // porque un spread posterior con la misma clave "OR" sobrescribiría (no
      // combinaría) el OR anterior y dejaría la búsqueda sin scope de organización.
      const where: Prisma.GastoWhereInput = {
        deletedAt: null,
        AND: [
          { OR: [{ caja: { organizacionId } }, { jornada: { organizacionId } }] },
          ...(cleanSearch
            ? [
                {
                  OR: [
                    { id: { contains: cleanSearch, mode: 'insensitive' as const } },
                    { descripcion: { contains: cleanSearch, mode: 'insensitive' as const } },
                    { categoria: { contains: cleanSearch, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      };

      const [totalItems, gastos] = await Promise.all([
        prisma.gasto.count({ where }),
        prisma.gasto.findMany({
          where,
          orderBy: { fechaGasto: 'desc' },
          skip,
          take,
        }),
      ]);

      const data = gastos.map((g) => ({
        id: g.id,
        fecha: g.fechaGasto ? new Date(g.fechaGasto).toISOString() : new Date().toISOString(),
        categoria: g.categoria || 'Sin categoría',
        descripcion: g.descripcion || 'Gasto registrado',
        monto: Number(g.monto || 0),
      }));

      return {
        data,
        meta: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    }

    return {
      data: [],
      meta: { page, limit, totalItems: 0, totalPages: 1 },
    };
  }

  /**
   * Detalle completo de una jornada de cobranza para el drawer de soporte:
   * cuadre de caja, ingresos (pagos), egresos (gastos) y desembolsos atribuidos.
   *
   * Replica el cálculo que la app móvil hace en JornadaDetalleModal.tsx para que
   * ambas pantallas cuadren con los mismos números.
   */
  async obtenerDetalleJornada(organizacionId: string, jornadaId: string) {
    const jornada = await prisma.jornadaCobranza.findFirst({
      where: { id: jornadaId, organizacionId, deletedAt: null },
      include: {
        ruta: { select: { id: true, nombre: true, codigo: true } },
        usuario: { select: { id: true, nombre: true, email: true, rol: { select: { nombre: true } } } },
      },
    });
    if (!jornada) throw new NotFoundError('La jornada no fue encontrada en esta organización.');

    // Los desembolsos no guardan jornadaId (a diferencia de Pago y Gasto), así
    // que se atribuyen por ventana de tiempo + ruta, igual que la app móvil.
    // Para una jornada CERRADA, `updatedAt` es el cierre (la app usa closedAt);
    // mientras sigue ABIERTA se toma el día completo desde su creación.
    const inicioVentana = jornada.createdAt;
    const finVentana =
      jornada.estado === 'CERRADA' && jornada.updatedAt > jornada.createdAt
        ? jornada.updatedAt
        : new Date(jornada.createdAt.getTime() + 24 * 60 * 60 * 1000);

    const [pagos, gastos, prestamosOtorgados] = await Promise.all([
      prisma.pago.findMany({
        where: { jornadaId, deletedAt: null },
        include: {
          prestamo: {
            select: {
              codigo: true,
              plazo: true,
              cliente: { select: { nombres: true, apellidos: true, codigo: true } },
            },
          },
        },
        orderBy: { fechaPago: 'desc' },
      }),
      prisma.gasto.findMany({
        where: { jornadaId, deletedAt: null },
        orderBy: { fechaGasto: 'desc' },
      }),
      prisma.prestamo.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: inicioVentana, lte: finVentana },
          cliente: { organizacionId, rutaId: jornada.rutaId },
          // NULL = préstamos anteriores a este campo, se tratan como incluidos.
          // Se lista explícitamente en vez de `NOT: { incluirEnJornada: false }`
          // porque en SQL una comparación contra NULL no es TRUE y descartaría
          // justo esas filas antiguas.
          OR: [{ incluirEnJornada: null }, { incluirEnJornada: true }],
        },
        include: { cliente: { select: { nombres: true, apellidos: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const nombreCliente = (c: { nombres: string; apellidos: string | null } | null | undefined) =>
      c ? `${c.nombres} ${c.apellidos || ''}`.trim() : 'Desconocido';

    const pagosDetalle = pagos.map((p) => ({
      id: p.id,
      fechaPago: new Date(p.fechaPago).toISOString(),
      clienteNombre: nombreCliente(p.prestamo?.cliente),
      codigoPrestamo: p.prestamo?.codigo || p.prestamoId,
      monto: Number(p.monto || 0),
      moraCobrada: Number(p.moraCobrada || 0),
      metodoPago: p.metodoPago || 'EFECTIVO',
      referencia: p.referencia || null,
      cuotaNumero: p.cuotaNumero ?? null,
      totalCuotas: p.prestamo?.plazo ?? null,
      esParcial: !!p.esParcial,
    }));

    const gastosDetalle = gastos.map((g) => ({
      id: g.id,
      fechaGasto: new Date(g.fechaGasto).toISOString(),
      categoria: g.categoria || 'Sin categoría',
      descripcion: g.descripcion || 'Gasto registrado',
      monto: Number(g.monto || 0),
    }));

    const prestamosDetalle = prestamosOtorgados.map((p) => {
      const monto = Number(p.monto || 0);
      // Retención administrativa del desembolso: el cliente recibió
      // `monto - gastosCierre` en la mano, y eso es lo que salió de la caja
      // (mismo criterio que egresoDePrestamo en la app móvil).
      const gastosCierre = p.gastosCierre != null ? Number(p.gastosCierre) : 0;
      return {
        id: p.id,
        createdAt: new Date(p.createdAt).toISOString(),
        codigo: p.codigo || p.id,
        clienteNombre: nombreCliente(p.cliente),
        monto,
        gastosCierre,
        efectivoEntregado: Math.max(0, monto - gastosCierre),
        tasaInteres: Number(p.tasaInteres || 0),
        plazo: p.plazo || 1,
      };
    });

    const saldoInicial = Number(jornada.saldoInicial || 0);
    const saldoFinal = jornada.saldoFinal != null ? Number(jornada.saldoFinal) : null;
    const efectivoCobrado = Number(jornada.efectivoCobrado || 0);
    const gastosCampo = Number(jornada.gastos || 0);

    // El total de desembolsos del cuadre sale del campo acumulado de la jornada
    // (fuente de verdad del cierre); la lista derivada solo lo respalda cuando
    // el campo viene en 0 — mismo criterio que la app móvil.
    const totalPrestamosListados = prestamosDetalle.reduce((s, p) => s + p.efectivoEntregado, 0);
    const prestamosCampo = Number(jornada.prestamos || 0);
    const totalPrestamos = prestamosCampo > 0 ? prestamosCampo : totalPrestamosListados;

    const totalPagos = pagosDetalle.reduce((s, p) => s + p.monto, 0);
    const totalPagosEfectivo = pagosDetalle
      .filter((p) => p.metodoPago === 'EFECTIVO')
      .reduce((s, p) => s + p.monto, 0);
    const totalMora = pagosDetalle.reduce((s, p) => s + p.moraCobrada, 0);
    const totalGastosDetalle = gastosDetalle.reduce((s, g) => s + g.monto, 0);

    const cajaEsperada = saldoInicial + efectivoCobrado - gastosCampo - totalPrestamos;

    return {
      id: jornada.id,
      fecha: new Date(jornada.fecha).toISOString(),
      creadaEn: new Date(jornada.createdAt).toISOString(),
      actualizadaEn: new Date(jornada.updatedAt).toISOString(),
      estado: jornada.estado,
      ruta: { id: jornada.ruta?.id || jornada.rutaId, nombre: jornada.ruta?.nombre || 'Sin Ruta', codigo: jornada.ruta?.codigo || null },
      cobrador: {
        id: jornada.usuario?.id || jornada.usuarioId,
        nombre: jornada.usuario?.nombre || 'Desconocido',
        email: jornada.usuario?.email || null,
        rol: jornada.usuario?.rol?.nombre || null,
      },
      cuadre: {
        saldoInicial,
        efectivoCobrado,
        gastos: gastosCampo,
        prestamos: totalPrestamos,
        cajaEsperada,
        saldoFinal,
        diferencia: saldoFinal != null ? saldoFinal - cajaEsperada : null,
      },
      progreso: {
        clientesVisitados: jornada.clientesVisitados || 0,
        clientesPendientes: jornada.clientesPendientes || 0,
      },
      // Sumas reales de los detalles: si no coinciden con los campos acumulados
      // de la jornada, el drawer lo marca (indicio de borrado manual de un pago
      // o gasto sin recalcular el cuadre).
      totales: {
        pagos: totalPagos,
        pagosEfectivo: totalPagosEfectivo,
        mora: totalMora,
        gastos: totalGastosDetalle,
        prestamosListados: totalPrestamosListados,
      },
      pagos: pagosDetalle,
      gastos: gastosDetalle,
      prestamos: prestamosDetalle,
    };
  }

  /**
   * Elimina un registro de soporte (Pago, Préstamo, Jornada o Gasto) de la organización.
   * Usa borrado lógico (deletedAt/deletedBy), igual que el borrado normal vía sync
   * (sincronizacion.service.ts): un hard delete no genera tombstone, así que los
   * clientes móviles que ya sincronizaron el registro nunca reciben la orden de
   * borrarlo y este sigue apareciendo en pantallas como el Historial de Cuadres.
   */
  async eliminarRegistroSoporte(organizacionId: string, tipo: string, registroId: string, adminUserId: string) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    const tipoUpper = tipo.toUpperCase();
    const softDelete = { deletedAt: new Date(), deletedBy: adminUserId };

    if (tipoUpper === 'PAGO') {
      const pago = await prisma.pago.findFirst({
        where: { id: registroId, deletedAt: null, prestamo: { cliente: { organizacionId } } },
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

      await prisma.pago.update({ where: { id: registroId }, data: softDelete });
      return { mensaje: 'Pago eliminado con éxito.' };
    }

    if (tipoUpper === 'PRESTAMO') {
      const prestamo = await prisma.prestamo.findFirst({
        where: { id: registroId, deletedAt: null, cliente: { organizacionId } },
      });
      if (!prestamo) throw new NotFoundError('El préstamo no fue encontrado en esta organización.');

      await prisma.$transaction([
        prisma.cuota.updateMany({ where: { prestamoId: registroId }, data: softDelete }),
        prisma.pago.updateMany({ where: { prestamoId: registroId }, data: softDelete }),
        prisma.prestamo.update({ where: { id: registroId }, data: softDelete }),
      ]);
      return { mensaje: 'Préstamo y sus registros asociados eliminados con éxito.' };
    }

    if (tipoUpper === 'JORNADA') {
      const jornada = await prisma.jornadaCobranza.findFirst({
        where: { id: registroId, deletedAt: null, organizacionId },
      });
      if (!jornada) throw new NotFoundError('La jornada no fue encontrada en esta organización.');

      await prisma.jornadaCobranza.update({ where: { id: registroId }, data: softDelete });
      return { mensaje: 'Jornada eliminada con éxito.' };
    }

    if (tipoUpper === 'GASTO') {
      const gasto = await prisma.gasto.findFirst({
        where: {
          id: registroId,
          deletedAt: null,
          OR: [
            { caja: { organizacionId } },
            { jornada: { organizacionId } },
          ],
        },
      });
      if (!gasto) throw new NotFoundError('El gasto no fue encontrado en esta organización.');

      await prisma.gasto.update({ where: { id: registroId }, data: softDelete });
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

  /** Lista las rutas activas de la organización (para el selector del importador). */
  async listarRutas(organizacionId: string) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    return prisma.ruta.findMany({
      where: { organizacionId, deletedAt: null },
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  /** Importa clientes y préstamos desde un JSON formateado a la organización. */
  async importarClientesYPrestamos(organizacionId: string, payload: any) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!org) throw new NotFoundError('La organización no existe.');

    if (!payload || !Array.isArray(payload.clientes)) {
      throw new Error('Formato de datos inválido: se requiere un objeto con el arreglo "clientes".');
    }

    // Ruta por defecto elegida en el modal: por id (ruta existente) o por nombre (ruta nueva a crear)
    let rutaDefault = payload.rutaId
      ? await prisma.ruta.findFirst({ where: { id: payload.rutaId, organizacionId, deletedAt: null } })
      : null;

    if (!rutaDefault && payload.rutaNombre) {
      const nombreDefault = String(payload.rutaNombre).trim();
      if (nombreDefault) {
        rutaDefault = await prisma.ruta.findFirst({
          where: {
            organizacionId,
            deletedAt: null,
            OR: [{ nombre: { equals: nombreDefault, mode: 'insensitive' } }, { codigo: { equals: nombreDefault, mode: 'insensitive' } }],
          },
        });
        if (!rutaDefault) {
          rutaDefault = await prisma.ruta.create({ data: { organizacionId, nombre: nombreDefault, diaSemana: 'LUNES' } });
        }
      }
    }

    if (!rutaDefault) {
      rutaDefault = await prisma.ruta.findFirst({ where: { organizacionId, deletedAt: null } });
    }

    if (!rutaDefault) {
      rutaDefault = await prisma.ruta.create({
        data: {
          organizacionId,
          nombre: 'Ruta Principal',
          codigo: 'RP-01',
          diaSemana: 'LUNES',
        },
      });
    }

    // Cache de rutas por nombre/código (en minúsculas) para resolver el campo opcional "ruta" de cada cliente sin repetir consultas
    const rutasPorNombre = new Map<string, { id: string }>();
    let rutasCreadas = 0;

    const resolverRutaId = async (nombreRuta?: string): Promise<string> => {
      const clave = nombreRuta?.trim().toLowerCase();
      if (!clave) return rutaDefault!.id;

      const cacheada = rutasPorNombre.get(clave);
      if (cacheada) return cacheada.id;

      let ruta = await prisma.ruta.findFirst({
        where: {
          organizacionId,
          deletedAt: null,
          OR: [{ nombre: { equals: clave, mode: 'insensitive' } }, { codigo: { equals: clave, mode: 'insensitive' } }],
        },
        select: { id: true },
      });

      if (!ruta) {
        ruta = await prisma.ruta.create({
          data: { organizacionId, nombre: nombreRuta!.trim(), diaSemana: 'LUNES' },
          select: { id: true },
        });
        rutasCreadas++;
      }

      rutasPorNombre.set(clave, ruta);
      return ruta.id;
    };

    let clientesCreados = 0;
    let prestamosCreados = 0;

    for (const cData of payload.clientes) {
      if (!cData.nombres) continue;

      const codigoCliente = cData.codigo || `C-${Math.floor(100000 + Math.random() * 900000)}`;
      const rutaId = await resolverRutaId(cData.ruta);

      const cliente = await prisma.cliente.create({
        data: {
          organizacionId,
          rutaId,
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

    return { clientesCreados, prestamosCreados, rutasCreadas };
  }
}
