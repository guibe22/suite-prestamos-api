import { prisma } from '../../config/database.js';
import type { PullResponse, WatermelonChanges } from './sincronizacion.types.js';

export class SincronizacionService {
  /**
   * Helper para mapear fechas (objetos Date) a timestamps (milisegundos)
   * y Decimales de Prisma a numbers para su consumo en el cliente
   */
  private mapPrismaDataToClient(obj: any): any {
    if (!obj) return obj;
    const newObj = { ...obj };
    for (const key in newObj) {
      if (newObj[key] instanceof Date) {
        newObj[key] = newObj[key].getTime();
      } else if (newObj[key] && typeof newObj[key] === 'object' && 'd' in newObj[key]) {
        // Mapear Prisma.Decimal a Number
        newObj[key] = Number(newObj[key]);
      }
    }
    return newObj;
  }

  /**
   * Helper para limpiar datos del cliente antes de enviarlos a Prisma
   */
  private mapClientDataToPrisma(data: any): any {
    if (!data) return data;
    const prismaData = { ...data };

    // Limpiar campos temporales o internos de WatermelonDB si existiesen
    delete prismaData._status;
    delete prismaData._changed;

    // Campos que representan fechas en el esquema de la base de datos
    const dateFields = [
      'createdAt',
      'updatedAt',
      'deletedAt',
      'fechaInicio',
      'fechaVencimiento',
      'fechaPago',
      'fechaApertura',
      'fechaCierre',
      'fechaGasto',
    ];

    for (const field of dateFields) {
      if (prismaData[field] !== undefined && prismaData[field] !== null) {
        prismaData[field] = new Date(prismaData[field]);
      }
    }

    return prismaData;
  }

  /**
   * Pull: Retorna los cambios del servidor ocurridos desde lastPulledAt para la organizacion dada
   */
  async pull(lastPulledAt: number, organizacionId: string): Promise<PullResponse> {
    const serverTimestamp = Date.now();
    const lastPulledDate = lastPulledAt > 0 ? new Date(lastPulledAt) : null;

    const changes: WatermelonChanges = {};

    // Tablas a sincronizar y sus respectivas consultas
    const tables = [
      {
        name: 'organizaciones',
        model: prisma.organizacion,
        whereClause: (date: Date | null) => ({
          id: organizacionId,
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'usuarios',
        model: prisma.usuario,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'clientes',
        model: prisma.cliente,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'prestamos',
        model: prisma.prestamo,
        whereClause: (date: Date | null) => ({
          cliente: { organizacionId },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'cuotas',
        model: prisma.cuota,
        whereClause: (date: Date | null) => ({
          prestamo: { cliente: { organizacionId } },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'pagos',
        model: prisma.pago,
        whereClause: (date: Date | null) => ({
          prestamo: { cliente: { organizacionId } },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'cajas',
        model: prisma.caja,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'gastos',
        model: prisma.gasto,
        whereClause: (date: Date | null) => ({
          caja: { organizacionId },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'movimientos_cajas',
        model: prisma.movimientoCaja,
        whereClause: (date: Date | null) => ({
          caja: { organizacionId },
          ...(date ? { createdAt: { gt: date } } : {}),
        }),
      },
    ];

    for (const table of tables) {
      const created: any[] = [];
      const updated: any[] = [];
      const deleted: string[] = [];

      const queryWhere = table.whereClause(lastPulledDate);

      // Buscar todos los registros que cambiaron (o todos si lastPulledDate es nulo)
      const records = await (table.model as any).findMany({
        where: queryWhere,
      });

      for (const record of records) {
        const clientRecord = this.mapPrismaDataToClient(record);

        if (clientRecord.deletedAt) {
          // Si está marcado como borrado, va a la lista de eliminados
          deleted.push(clientRecord.id);
        } else if (!lastPulledDate || new Date(record.createdAt) > lastPulledDate) {
          // Creado después de la última sincronización (o primera sincronización)
          created.push(clientRecord);
        } else {
          // Modificado después de la última sincronización pero creado antes
          updated.push(clientRecord);
        }
      }

      changes[table.name] = { created, updated, deleted };
    }

    return {
      changes,
      timestamp: serverTimestamp,
    };
  }

  /**
   * Push: Aplica los cambios enviados por el cliente al servidor en una sola transaccion
   */
  async push(changes: WatermelonChanges, organizacionId: string, userId: string): Promise<void> {
    // Definimos el orden de las operaciones para evitar problemas de FK
    const tableOrder = [
      { name: 'organizaciones', model: prisma.organizacion, hasOrgId: false },
      { name: 'usuarios', model: prisma.usuario, hasOrgId: true },
      { name: 'clientes', model: prisma.cliente, hasOrgId: true },
      { name: 'cajas', model: prisma.caja, hasOrgId: true },
      { name: 'prestamos', model: prisma.prestamo, hasOrgId: false },
      { name: 'cuotas', model: prisma.cuota, hasOrgId: false },
      { name: 'pagos', model: prisma.pago, hasOrgId: false },
      { name: 'gastos', model: prisma.gasto, hasOrgId: false },
      { name: 'movimientos_cajas', model: prisma.movimientoCaja, hasOrgId: false },
    ];

    // Ejecutamos todo dentro de una transaccion de Prisma
    await prisma.$transaction(async (tx) => {
      // 1. Procesar Eliminaciones (de atrás hacia adelante en orden para evitar romper FKs en cascada)
      for (const table of [...tableOrder].reverse()) {
        const tableChanges = changes[table.name];
        if (tableChanges && tableChanges.deleted.length > 0) {
          const idsToDelete = tableChanges.deleted;

          // Borrado lógico actualizando el campo deletedAt (excepto movimientoCaja que no tiene)
          if (table.name === 'movimientos_cajas') {
            await (tx as any).movimientoCaja.deleteMany({
              where: { id: { in: idsToDelete } },
            });
          } else {
            await (tx as any)[table.name.replace(/_([a-z])/g, (g) => g[1].toUpperCase()).replace(/s$/, '')].updateMany({
              where: { id: { in: idsToDelete } },
              data: {
                deletedAt: new Date(),
                deletedBy: userId,
              },
            });
          }
        }
      }

      // Helper para convertir el nombre de la tabla de WatermelonDB al nombre de modelo de Prisma
      const getModelName = (tableName: string) => {
        switch (tableName) {
          case 'organizaciones': return 'organizacion';
          case 'usuarios': return 'usuario';
          case 'clientes': return 'cliente';
          case 'cajas': return 'caja';
          case 'prestamos': return 'prestamo';
          case 'cuotas': return 'cuota';
          case 'pagos': return 'pago';
          case 'gastos': return 'gasto';
          case 'movimientos_cajas': return 'movimientoCaja';
          default: return tableName.replace(/s$/, '');
        }
      };

      // 2. Procesar Creaciones y Actualizaciones
      for (const table of tableOrder) {
        const tableChanges = changes[table.name];
        if (!tableChanges) continue;

        const modelName = getModelName(table.name);
        const modelTx = (tx as any)[modelName];

        // Creaciones
        if (tableChanges.created.length > 0) {
          for (const item of tableChanges.created) {
            const mappedData = this.mapClientDataToPrisma(item);
            
            // Forzar que el registro pertenezca a la organizacion del usuario si el modelo lo tiene
            if (table.hasOrgId) {
              mappedData.organizacionId = organizacionId;
            }

            // Realizamos upsert para evitar errores de duplicidad si por alguna razón la petición falló a medio camino previamente
            const { id, ...dataWithoutId } = mappedData;
            await modelTx.upsert({
              where: { id },
              update: dataWithoutId,
              create: mappedData,
            });
          }
        }

        // Actualizaciones
        if (tableChanges.updated.length > 0) {
          for (const item of tableChanges.updated) {
            const mappedData = this.mapClientDataToPrisma(item);
            const { id, ...dataWithoutId } = mappedData;

            await modelTx.update({
              where: { id },
              data: dataWithoutId,
            });
          }
        }
      }
    });
  }
}
