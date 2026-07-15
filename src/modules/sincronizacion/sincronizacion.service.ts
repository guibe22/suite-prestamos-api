import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
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
    // WatermelonDB gestiona los timestamps con columnas raw en snake_case
    // (created_at/updated_at). Renombramos las claves camelCase de Prisma para
    // que coincidan con el schema del cliente.
    if ('createdAt' in newObj) {
      newObj.created_at = newObj.createdAt;
      delete newObj.createdAt;
    }
    if ('updatedAt' in newObj) {
      newObj.updated_at = newObj.updatedAt;
      delete newObj.updatedAt;
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

    // El cliente envía los timestamps en snake_case (created_at/updated_at).
    // Los pasamos a las claves camelCase que espera Prisma.
    if ('created_at' in prismaData) {
      prismaData.createdAt = prismaData.created_at;
      delete prismaData.created_at;
    }
    if ('updated_at' in prismaData) {
      prismaData.updatedAt = prismaData.updated_at;
      delete prismaData.updated_at;
    }

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
      'fechaNacimiento',
      'fecha',
    ];

    for (const field of dateFields) {
      if (prismaData[field] !== undefined && prismaData[field] !== null) {
        prismaData[field] = new Date(prismaData[field]);
      }
    }

    return prismaData;
  }

  /**
   * Normaliza registros por tabla para que Prisma los acepte.
   * Si un campo NOT NULL con default llega en null, el payload deja de encajar
   * en el input "unchecked" (con FKs escalares) y Prisma exige el objeto de
   * relación ("Argument organizacion is missing"). Eliminamos esos nulls para
   * que apliquen los defaults, y coalescemos los String requeridos que
   * registros locales antiguos (pre-modelo de negocio) traen en null.
   */
  /**
   * Auto-reparación de FK: si un cliente referencia una ruta que no existe en
   * el servidor (p. ej. el dispositivo la tiene marcada como sincronizada
   * contra una base anterior), se crea una ruta mínima con ese id para no
   * romper la restricción. El cobrador puede renombrarla después.
   */
  private async ensureRutaExists(tx: any, rutaId: string, organizacionId: string): Promise<void> {
    const existe = await tx.ruta.findUnique({ where: { id: rutaId }, select: { id: true } });
    if (existe) return;
    logger.warn(
      `⚠️  [SYNC PUSH] La ruta ${rutaId} no existe en el servidor; se crea un placeholder para preservar la FK del cliente.`
    );
    await tx.ruta.create({
      data: {
        id: rutaId,
        organizacionId,
        nombre: 'Ruta recuperada',
        diaSemana: 'LUNES',
      },
    });
  }

  private sanitizeForPrisma(tableName: string, data: any): any {
    if (tableName === 'clientes') {
      for (const campo of ['puntuacion', 'nivelRiesgo', 'calificacion', 'ordenRuta', 'estado']) {
        if (data[campo] === null || data[campo] === undefined) delete data[campo];
      }
      data.nombres = data.nombres ?? '';
      data.telefono = data.telefono ?? '';
      data.direccion = data.direccion ?? '';
      if (!data.codigo) data.codigo = `C-${String(data.id ?? '').slice(-6).toUpperCase()}`;
    }
    if (tableName === 'jornadas_cobranza') {
      // Int NOT NULL con default en Prisma; opcionales en WatermelonDB. Un
      // null explícito rompe el input "unchecked" igual que ya pasaba con
      // clientes — se coalescen a 0 en vez de abortar el push completo.
      data.clientesVisitados = data.clientesVisitados ?? 0;
      data.clientesPendientes = data.clientesPendientes ?? 0;
    }
    return data;
  }

  /**
   * Convierte el nombre de tabla de WatermelonDB (snake_case, plural) al nombre
   * del accessor de Prisma (camelCase, singular). Debe usarse en TODOS los paths
   * (create/update/delete): un mapeo hecho a mano en un solo path fue el origen
   * de un bug donde `jornadas_cobranza` resolvía a `jornadasCobranza` (accessor
   * real: `jornadaCobranza`) y reventaba el borrado.
   */
  private getModelName(tableName: string): string {
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
      case 'jornadas_cobranza': return 'jornadaCobranza';
      default: return tableName.replace(/s$/, '');
    }
  }

  /**
   * Filtro `where` que restringe cualquier registro a la organización del
   * usuario. Se aplica en TODA escritura del push (update/delete y verificación
   * de propiedad en create) para impedir accesos cross-tenant: sin esto, un
   * dispositivo podía modificar/borrar registros de otra organización enviando
   * su `id`.
   */
  private orgScopeWhere(tableName: string, organizacionId: string): any {
    switch (tableName) {
      case 'organizaciones':
        return { id: organizacionId };
      case 'usuarios':
      case 'rutas':
      case 'jornadas_cobranza':
      case 'clientes':
      case 'cajas':
        return { organizacionId };
      case 'prestamos':
        return { cliente: { organizacionId } };
      case 'cuotas':
      case 'pagos':
        return { prestamo: { cliente: { organizacionId } } };
      case 'gastos':
      case 'movimientos_cajas':
        return { caja: { organizacionId } };
      default:
        return {};
    }
  }

  /**
   * Igual que `orgScopeWhere`, pero devuelve el `where` COMPLETO (organización +
   * alcance de rol) en un único objeto por tabla — no se combina por spread con
   * `orgScopeWhere` porque varias tablas anidan la condición bajo la misma clave
   * (`cliente`, `prestamo`) y un merge superficial pisaría la mitad de la condición.
   * Restringe la escritura de un COBRADOR a su(s) ruta(s) asignada(s) vía
   * `Ruta.responsableId` y a sus propias jornadas, para que no pueda editar/borrar
   * registros de otra ruta empujando un `push` manual. Para cualquier otro rol,
   * es idéntico a `orgScopeWhere`.
   */
  private scopeWhere(tableName: string, organizacionId: string, actorId: string, actorRol: string): any {
    if (actorRol !== 'COBRADOR') return this.orgScopeWhere(tableName, organizacionId);
    switch (tableName) {
      case 'rutas':
        return { organizacionId, responsableId: actorId };
      case 'clientes':
        return { organizacionId, ruta: { responsableId: actorId } };
      case 'prestamos':
        return { cliente: { organizacionId, ruta: { responsableId: actorId } } };
      case 'cuotas':
      case 'pagos':
        return { prestamo: { cliente: { organizacionId, ruta: { responsableId: actorId } } } };
      case 'jornadas_cobranza':
        return { organizacionId, usuarioId: actorId };
      case 'cajas':
        return { organizacionId, estado: 'ABIERTA', usuarioId: actorId };
      case 'gastos':
      case 'movimientos_cajas':
        return { caja: { organizacionId, estado: 'ABIERTA', usuarioId: actorId } };
      default:
        return this.orgScopeWhere(tableName, organizacionId);
    }
  }

  /**
   * Verifica que el registro padre referenciado por una FK pertenezca a la
   * organización del usuario, antes de crear un hijo (préstamo/cuota/pago/gasto/
   * movimiento). Evita colgar registros de clientes/cajas de otra organización.
   */
  private async validateParentInOrg(
    tx: any,
    tableName: string,
    data: any,
    organizacionId: string,
    actorId: string,
    actorRol: string
  ): Promise<boolean> {
    const esCobrador = actorRol === 'COBRADOR';
    switch (tableName) {
      case 'clientes': {
        // Antes se saltaba esta validación por completo para ADMIN/CAJERO,
        // dejando que un cliente quedara con rutaId de otra organización
        // (ensureRutaExists solo comprueba existencia, no organización).
        if (!data.rutaId) return false;
        const ruta = await tx.ruta.findFirst({
          where: { id: data.rutaId, organizacionId, ...(esCobrador ? { responsableId: actorId } : {}) },
          select: { id: true },
        });
        return !!ruta;
      }
      case 'prestamos': {
        if (!data.clienteId) return false;
        const c = await tx.cliente.findFirst({
          where: { id: data.clienteId, organizacionId, ...(esCobrador ? { ruta: { responsableId: actorId } } : {}) },
          select: { id: true },
        });
        return !!c;
      }
      case 'cuotas':
      case 'pagos': {
        if (!data.prestamoId) return false;
        const p = await tx.prestamo.findFirst({
          where: {
            id: data.prestamoId,
            cliente: { organizacionId, ...(esCobrador ? { ruta: { responsableId: actorId } } : {}) },
          },
          select: { id: true },
        });
        return !!p;
      }
      case 'gastos':
      case 'movimientos_cajas': {
        if (!data.cajaId) return false;
        const caja = await tx.caja.findFirst({
          where: {
            id: data.cajaId,
            organizacionId,
            ...(esCobrador ? { estado: 'ABIERTA', usuarioId: actorId } : {}),
          },
          select: { id: true },
        });
        return !!caja;
      }
      case 'jornadas_cobranza': {
        if (esCobrador && data.usuarioId && data.usuarioId !== actorId) return false;
        if (!data.rutaId) return false;
        const ruta = await tx.ruta.findFirst({
          where: { id: data.rutaId, organizacionId, ...(esCobrador ? { responsableId: actorId } : {}) },
          select: { id: true },
        });
        return !!ruta;
      }
      default:
        // Tablas con organizacionId directo: el propio push fuerza el org.
        return true;
    }
  }

  /**
   * Elimina campos que el cliente NUNCA debe poder fijar vía sync. `organizacionId`
   * y `cuentaId` se gestionan en el servidor; en `usuarios` se bloquean además las
   * credenciales y el rol para impedir escalada de privilegios (un cobrador
   * pusheando `rolId=ADMIN` o un `password` conocido).
   */
  private stripProtectedFields(tableName: string, data: any, actorRol: string): any {
    delete data.organizacionId;
    delete data.cuentaId;
    if (tableName === 'usuarios') {
      delete data.password;
      delete data.rolId;
      delete data.email;
    }
    // Reasignar quién es el responsable de una ruta es una decisión administrativa;
    // un COBRADOR/CAJERO no debe poder auto-asignarse (o quitarle) una ruta vía sync.
    if (tableName === 'rutas' && actorRol !== 'ADMIN' && actorRol !== 'SUPER_ADMIN') {
      delete data.responsableId;
    }
    // El dueño de una caja se fija en el servidor al crearla (siempre el
    // actor que hace el push) y nunca se reasigna vía sync — de lo contrario
    // un dispositivo podría atribuir su caja a otro cobrador.
    if (tableName === 'cajas') {
      delete data.usuarioId;
    }
    // Igual que cajas: quién desembolsó el préstamo se fija en el servidor al
    // crearlo y no se reasigna vía sync, para que el cálculo de caja no se
    // pueda falsear atribuyendo un préstamo a otro cobrador.
    if (tableName === 'prestamos') {
      delete data.usuarioId;
    }
    return data;
  }

  /**
   * Pull: Retorna los cambios del servidor ocurridos desde lastPulledAt para la organizacion dada.
   * Un COBRADOR solo recibe sus propias rutas asignadas (Ruta.responsableId) y todo lo que cuelga
   * de ellas (clientes/préstamos/cuotas/pagos), sus propias jornadas, y solo cajas ABIERTAS (para
   * poder seguir registrando gastos del día). ADMIN/SUPER_ADMIN/CAJERO reciben toda la organización.
   */
  async pull(lastPulledAt: number, organizacionId: string, actorId: string, actorRol: string): Promise<PullResponse> {
    const serverTimestamp = Date.now();
    const lastPulledDate = lastPulledAt > 0 ? new Date(lastPulledAt) : null;
    const esCobrador = actorRol === 'COBRADOR';

    logger.info(
      `📥 [SYNC PULL] Inicio | org=${organizacionId} | actor=${actorId} (${actorRol}) | ${
        lastPulledDate
          ? `cambios desde ${lastPulledDate.toISOString()}`
          : 'PRIMERA sincronización (envía TODO)'
      }`
    );

    const changes: WatermelonChanges = {};
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;

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
        // Nunca se envía el hash de la contraseña a los dispositivos.
        omit: { password: true },
        whereClause: (date: Date | null) => ({
          ...(esCobrador ? { id: actorId } : { organizacionId }),
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'clientes',
        model: prisma.cliente,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(esCobrador ? { ruta: { responsableId: actorId } } : {}),
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'prestamos',
        model: prisma.prestamo,
        whereClause: (date: Date | null) => ({
          cliente: { organizacionId, ...(esCobrador ? { ruta: { responsableId: actorId } } : {}) },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'cuotas',
        model: prisma.cuota,
        whereClause: (date: Date | null) => ({
          prestamo: {
            cliente: { organizacionId, ...(esCobrador ? { ruta: { responsableId: actorId } } : {}) },
          },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'pagos',
        model: prisma.pago,
        whereClause: (date: Date | null) => ({
          prestamo: {
            cliente: { organizacionId, ...(esCobrador ? { ruta: { responsableId: actorId } } : {}) },
          },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'cajas',
        model: prisma.caja,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(esCobrador ? { estado: 'ABIERTA', usuarioId: actorId } : {}),
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'gastos',
        model: prisma.gasto,
        whereClause: (date: Date | null) => ({
          caja: { organizacionId, ...(esCobrador ? { estado: 'ABIERTA', usuarioId: actorId } : {}) },
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'rutas',
        model: prisma.ruta,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(esCobrador ? { responsableId: actorId } : {}),
          ...(date ? { updatedAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'movimientos_cajas',
        model: prisma.movimientoCaja,
        whereClause: (date: Date | null) => ({
          caja: { organizacionId, ...(esCobrador ? { estado: 'ABIERTA', usuarioId: actorId } : {}) },
          ...(date ? { createdAt: { gt: date } } : {}),
        }),
      },
      {
        name: 'jornadas_cobranza',
        model: prisma.jornadaCobranza,
        whereClause: (date: Date | null) => ({
          organizacionId,
          ...(esCobrador ? { usuarioId: actorId } : {}),
          ...(date ? { updatedAt: { gt: date } } : {}),
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
        ...((table as any).omit ? { omit: (table as any).omit } : {}),
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

      totalCreated += created.length;
      totalUpdated += updated.length;
      totalDeleted += deleted.length;

      // Solo mostramos las tablas que tienen algo que enviar, para no llenar la consola
      if (created.length || updated.length || deleted.length) {
        logger.info(
          `   → ${table.name}: ${created.length} nuevos, ${updated.length} modificados, ${deleted.length} borrados`
        );
      }
    }

    const totalCambios = totalCreated + totalUpdated + totalDeleted;
    if (totalCambios === 0) {
      logger.info('✅ [SYNC PULL] Sin cambios en el servidor. El cliente ya está al día.');
    } else {
      logger.info(
        `✅ [SYNC PULL] Enviando al cliente ${totalCambios} cambios ` +
          `(${totalCreated} nuevos, ${totalUpdated} modificados, ${totalDeleted} borrados) | timestamp=${serverTimestamp}`
      );
    }

    return {
      changes,
      timestamp: serverTimestamp,
    };
  }

  /**
   * Push: Aplica los cambios enviados por el cliente al servidor en una sola transaccion
   */
  async push(changes: WatermelonChanges, organizacionId: string, userId: string, userRol: string): Promise<void> {
    // Resumen de lo que el cliente quiere subir, ANTES de aplicarlo
    let entrantesCreated = 0;
    let entrantesUpdated = 0;
    let entrantesDeleted = 0;
    for (const tabla in changes) {
      const c = changes[tabla];
      if (!c) continue;
      entrantesCreated += c.created?.length ?? 0;
      entrantesUpdated += c.updated?.length ?? 0;
      entrantesDeleted += c.deleted?.length ?? 0;
      if (c.created?.length || c.updated?.length || c.deleted?.length) {
        logger.info(
          `   ← ${tabla}: ${c.created?.length ?? 0} nuevos, ${c.updated?.length ?? 0} modificados, ${c.deleted?.length ?? 0} borrados`
        );
      }
    }
    const totalEntrantes = entrantesCreated + entrantesUpdated + entrantesDeleted;

    logger.info(
      `📤 [SYNC PUSH] Inicio | org=${organizacionId} | user=${userId} | ` +
        `recibidos ${totalEntrantes} cambios (${entrantesCreated} nuevos, ${entrantesUpdated} modificados, ${entrantesDeleted} borrados)`
    );

    if (totalEntrantes === 0) {
      logger.info('✅ [SYNC PUSH] El cliente no tenía cambios locales que subir.');
      return;
    }

    // Definimos el orden de las operaciones para evitar problemas de FK.
    // rutas va ANTES que clientes: Cliente.rutaId es FK obligatoria, así que
    // una ruta creada en el dispositivo debe existir antes que sus clientes.
    const tableOrder = [
      { name: 'organizaciones', model: prisma.organizacion, hasOrgId: false },
      { name: 'usuarios', model: prisma.usuario, hasOrgId: true },
      { name: 'rutas', model: prisma.ruta, hasOrgId: true },
      { name: 'jornadas_cobranza', model: prisma.jornadaCobranza, hasOrgId: true },
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
        // La organización no se elimina desde el cliente; los usuarios se
        // gestionan solo en el servidor (nunca vía sync).
        if (table.name === 'organizaciones' || table.name === 'usuarios') continue;
        const tableChanges = changes[table.name];
        if (tableChanges && tableChanges.deleted.length > 0) {
          const idsToDelete = tableChanges.deleted;
          const modelTx = (tx as any)[this.getModelName(table.name)];
          // El `where` se restringe a la organización (y, si es COBRADOR, a su
          // ruta asignada): un id fuera de ese alcance simplemente no coincide
          // (0 filas afectadas), en vez de permitir un borrado cross-tenant o
          // cross-ruta.
          const orgScope = this.scopeWhere(table.name, organizacionId, userId, userRol);

          // Borrado lógico actualizando el campo deletedAt (excepto movimientoCaja que no tiene)
          if (table.name === 'movimientos_cajas') {
            await modelTx.deleteMany({
              where: { id: { in: idsToDelete }, ...orgScope },
            });
          } else {
            await modelTx.updateMany({
              where: { id: { in: idsToDelete }, ...orgScope },
              data: {
                deletedAt: new Date(),
                deletedBy: userId,
              },
            });
          }
        }
      }

      // 2. Procesar Creaciones y Actualizaciones
      for (const table of tableOrder) {
        const tableChanges = changes[table.name];
        if (!tableChanges) continue;

        // Los usuarios (credenciales, roles) se administran exclusivamente en el
        // servidor. Nunca se crean ni modifican vía sync para cerrar el vector de
        // escalada de privilegios.
        if (table.name === 'usuarios') {
          if (tableChanges.created.length || tableChanges.updated.length) {
            logger.warn(
              `⚠️  [SYNC PUSH] Se ignoraron ${tableChanges.created.length + tableChanges.updated.length} cambios en 'usuarios' (no editable vía sync).`
            );
          }
          continue;
        }

        const modelName = this.getModelName(table.name);
        const modelTx = (tx as any)[modelName];
        const orgScope = this.scopeWhere(table.name, organizacionId, userId, userRol);

        // La organización nunca se crea desde el cliente: ya existe en el servidor
        // (se crea en el registro) y el registro local puede traer un id distinto.
        // Aplicamos solo los campos editables sobre la organización del usuario,
        // ignorando el id del cliente y campos sensibles como cuentaId (FK a Cuenta).
        if (table.name === 'organizaciones') {
          const camposEditables = ['nombre', 'identificacionTributaria', 'direccion', 'telefono'];
          for (const item of [...tableChanges.created, ...tableChanges.updated]) {
            const mappedData = this.mapClientDataToPrisma(item);
            const data: any = {};
            for (const campo of camposEditables) {
              if (mappedData[campo] !== undefined) data[campo] = mappedData[campo];
            }
            if (Object.keys(data).length > 0) {
              await modelTx.update({
                where: { id: organizacionId },
                data,
              });
            }
          }
          continue;
        }

        // Creaciones
        if (tableChanges.created.length > 0) {
          for (const item of tableChanges.created) {
            const mappedData = this.stripProtectedFields(
              table.name,
              this.sanitizeForPrisma(table.name, this.mapClientDataToPrisma(item)),
              userRol
            );

            // Forzar que el registro pertenezca a la organizacion del usuario si el modelo lo tiene
            if (table.hasOrgId) {
              mappedData.organizacionId = organizacionId;
            }

            // La caja siempre pertenece a quien la crea (ver stripProtectedFields).
            if (table.name === 'cajas') {
              mappedData.usuarioId = userId;
            }

            // El préstamo siempre queda atribuido a quien lo desembolsa (ver
            // stripProtectedFields), para poder excluirlo del balance de caja
            // de otros cobradores.
            if (table.name === 'prestamos') {
              mappedData.usuarioId = userId;
            }

            // clientes.rutaId es FK obligatoria: sin ruta no se puede crear.
            // Se omite el registro (en vez de abortar toda la transacción) para
            // que un único registro heredado inválido no bloquee el resto.
            if (table.name === 'clientes' && !mappedData.rutaId) {
              logger.warn(
                `⚠️  [SYNC PUSH] Cliente ${mappedData.id} sin rutaId; se omite (ruta obligatoria).`
              );
              continue;
            }
            if (table.name === 'clientes' && mappedData.rutaId) {
              await this.ensureRutaExists(tx, mappedData.rutaId, organizacionId);
            }

            const { id, ...dataWithoutId } = mappedData;

            // Si el id ya existe, solo se sobrescribe cuando pertenece a la
            // organización del usuario; un id ajeno se ignora (no cross-tenant).
            const yaExiste = await modelTx.findUnique({ where: { id }, select: { id: true } });
            if (yaExiste) {
              const propio = await modelTx.findFirst({
                where: { id, ...orgScope },
                select: { id: true },
              });
              if (!propio) {
                logger.warn(
                  `⚠️  [SYNC PUSH] Se ignoró la creación de ${table.name} ${id}: el id pertenece a otra organización.`
                );
                continue;
              }
              // Revalidar la FK padre también aquí: sin esto, un registro
              // propio podía reasignarse (p. ej. clienteId de un préstamo)
              // hacia el id de otra organización en este mismo upsert.
              const padreValidoUpsert = await this.validateParentInOrg(tx, table.name, mappedData, organizacionId, userId, userRol);
              if (!padreValidoUpsert) {
                logger.warn(
                  `⚠️  [SYNC PUSH] Se ignoró la actualización (upsert) de ${table.name} ${id}: FK padre inexistente o de otra organización.`
                );
                continue;
              }
              await modelTx.update({ where: { id }, data: dataWithoutId });
              continue;
            }

            // Colisión de `codigo` entre dispositivos (conteo local, único por
            // organización en el servidor): antes se omitía el registro para
            // no dejar que Prisma abortara todo el lote con P2002, pero eso
            // dejaba al cliente huérfano localmente para siempre (cada push
            // repetía la misma colisión). En vez de descartarlo, se le agrega
            // un sufijo desambiguador y se crea de todos modos; el próximo
            // pull le trae el código corregido al dispositivo.
            if (table.name === 'clientes' && mappedData.codigo) {
              const codigoOriginal = mappedData.codigo;
              let intento = 1;
              while (
                await modelTx.findFirst({
                  where: { organizacionId, codigo: mappedData.codigo, id: { not: id } },
                  select: { id: true },
                })
              ) {
                intento += 1;
                mappedData.codigo = `${codigoOriginal}-${intento}`;
              }
              if (mappedData.codigo !== codigoOriginal) {
                logger.warn(
                  `⚠️  [SYNC PUSH] El código '${codigoOriginal}' del cliente ${id} ya estaba en uso; se le asignó '${mappedData.codigo}' para no perder el registro.`
                );
              }
            }

            // Registro nuevo: validar que el padre (cliente/prestamo/caja) sea de la org
            // y, si es COBRADOR, que además sea de su ruta asignada.
            const padreValido = await this.validateParentInOrg(tx, table.name, mappedData, organizacionId, userId, userRol);
            if (!padreValido) {
              logger.warn(
                `⚠️  [SYNC PUSH] Se ignoró la creación de ${table.name} ${id}: FK padre inexistente o de otra organización.`
              );
              continue;
            }
            await modelTx.create({ data: mappedData });
          }
        }

        // Actualizaciones
        if (tableChanges.updated.length > 0) {
          for (const item of tableChanges.updated) {
            const mappedData = this.stripProtectedFields(
              table.name,
              this.sanitizeForPrisma(table.name, this.mapClientDataToPrisma(item)),
              userRol
            );

            if (table.name === 'clientes' && mappedData.rutaId) {
              await this.ensureRutaExists(tx, mappedData.rutaId, organizacionId);
            }

            const { id, ...dataWithoutId } = mappedData;

            // Solo se actualiza si el registro pertenece a la organización del
            // usuario. Si no existe o es de otra org, se omite (esto también
            // resuelve la idempotencia: un `update` sobre un id inexistente ya
            // no lanza P2025 abortando toda la transacción).
            const propio = await modelTx.findFirst({
              where: { id, ...orgScope },
              select: { id: true },
            });
            if (!propio) {
              logger.warn(
                `⚠️  [SYNC PUSH] Se ignoró la actualización de ${table.name} ${id}: inexistente o de otra organización.`
              );
              continue;
            }
            // Revalidar la FK padre: sin esto, un update podía reasignar la FK
            // (p. ej. clienteId/cajaId/rutaId) de un registro propio hacia el
            // id de otra organización.
            const padreValido = await this.validateParentInOrg(tx, table.name, mappedData, organizacionId, userId, userRol);
            if (!padreValido) {
              logger.warn(
                `⚠️  [SYNC PUSH] Se ignoró la actualización de ${table.name} ${id}: FK padre inexistente o de otra organización.`
              );
              continue;
            }
            await modelTx.update({ where: { id }, data: dataWithoutId });
          }
        }
      }
    });

    logger.info(
      `✅ [SYNC PUSH] Transacción confirmada. ${totalEntrantes} cambios aplicados en el servidor.`
    );
  }
}
