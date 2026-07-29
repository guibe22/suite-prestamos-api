import { describe, it, expect, vi } from 'vitest';

// scopeWhere/validateParentInOrg no tocan prisma directamente (validateParentInOrg
// recibe su `tx` como parámetro) — se mockea igual por higiene, para que ningún otro
// método de la clase pueda tocar por accidente la base de datos real en este archivo.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

const { SincronizacionService } = await import('../sincronizacion.service.js');

// scopeWhere y validateParentInOrg son `private` en la clase — se accede vía
// `as any` porque son exactamente la superficie que queremos probar (el filtro
// real que impide el acceso cruzado entre organizaciones), y TypeScript no
// tiene una forma más limpia de testear un método privado en aislamiento.
const service = new SincronizacionService() as any;

describe('SincronizacionService — scoping multi-tenant (scopeWhere)', () => {
  it('ADMIN: el where de una tabla con organizacionId directo es solo esa organización', () => {
    const where = service.scopeWhere('rutas', 'org-1', 'user-1', 'ADMIN');
    expect(where).toEqual({ organizacionId: 'org-1' });
  });

  it.each(['COBRADOR', 'GERENTE', 'CAJERO'])(
    '%s: clientes queda restringido a rutas donde es responsable o colaborador',
    (rol) => {
      const where = service.scopeWhere('clientes', 'org-1', 'user-1', rol);
      expect(where.organizacionId).toBe('org-1');
      expect(where.ruta.OR).toEqual([
        { responsableId: 'user-1' },
        { colaboradores: { some: { usuarioId: 'user-1', deletedAt: null } } },
      ]);
    }
  );

  it.each(['COBRADOR', 'GERENTE', 'CAJERO'])(
    '%s: jamás puede matchear ruta_colaboradores (gestionar colaboradores es solo de ADMIN/GERENTE, y aparte del scoping por ruta)',
    (rol) => {
      const where = service.scopeWhere('ruta_colaboradores', 'org-1', 'user-1', rol);
      expect(where).toEqual({ id: '' });
    }
  );

  it('cualquier rol siempre incluye organizacionId, sin excepción, para cualquier tabla conocida', () => {
    for (const rol of ['ADMIN', 'COBRADOR', 'GERENTE', 'CAJERO']) {
      const where = service.scopeWhere('jornadas_cobranza', 'org-1', 'user-1', rol);
      expect(where.organizacionId).toBe('org-1');
    }
  });

  it.each(['COBRADOR', 'GERENTE', 'CAJERO'])(
    '%s: jornadas_cobranza queda restringido a las propias (usuarioId)',
    (rol) => {
      const where = service.scopeWhere('jornadas_cobranza', 'org-1', 'user-1', rol);
      expect(where).toEqual({ organizacionId: 'org-1', usuarioId: 'user-1' });
    }
  );

  it.each([
    ['referencias_cliente', 'COBRADOR'],
    ['referencias_cliente', 'GERENTE'],
    ['referencias_cliente', 'CAJERO'],
    ['avales', 'COBRADOR'],
    ['avales', 'GERENTE'],
    ['avales', 'CAJERO'],
    ['documentos_cliente', 'COBRADOR'],
    ['documentos_cliente', 'GERENTE'],
    ['documentos_cliente', 'CAJERO'],
  ])(
    '%s (%s): queda restringido a clientes de rutas donde es responsable o colaborador',
    (tabla, rol) => {
      const where = service.scopeWhere(tabla, 'org-1', 'user-1', rol);
      expect(where.cliente.organizacionId).toBe('org-1');
      expect(where.cliente.ruta.OR).toEqual([
        { responsableId: 'user-1' },
        { colaboradores: { some: { usuarioId: 'user-1', deletedAt: null } } },
      ]);
    }
  );

  it('GERENTE y CAJERO NO reciben el mismo where que ADMIN (no deben quedar sin restricción de ruta)', () => {
    const whereAdmin = service.scopeWhere('clientes', 'org-1', 'user-1', 'ADMIN');
    for (const rol of ['GERENTE', 'CAJERO']) {
      const where = service.scopeWhere('clientes', 'org-1', 'user-1', rol);
      expect(where).not.toEqual(whereAdmin);
    }
  });

  it.each(['referencias_cliente', 'avales', 'documentos_cliente'])(
    'ADMIN: %s solo exige que el cliente sea de la organización, sin restricción de ruta',
    (tabla) => {
      const where = service.scopeWhere(tabla, 'org-1', 'user-1', 'ADMIN');
      expect(where).toEqual({ cliente: { organizacionId: 'org-1' } });
    }
  );
});

describe('SincronizacionService — scoping multi-tenant (validateParentInOrg)', () => {
  it('rechaza un préstamo cuyo clienteId no pertenece a la organización del actor', async () => {
    const tx = { cliente: { findFirst: vi.fn().mockResolvedValue(null) } };
    const valido = await service.validateParentInOrg(
      tx,
      'prestamos',
      { clienteId: 'cliente-de-otra-org' },
      'org-1',
      'user-1',
      'ADMIN'
    );
    expect(valido).toBe(false);
    expect(tx.cliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'cliente-de-otra-org', organizacionId: 'org-1' }) })
    );
  });

  it('acepta un préstamo cuyo cliente sí pertenece a la organización', async () => {
    const tx = { cliente: { findFirst: vi.fn().mockResolvedValue({ id: 'cliente-1' }) } };
    const valido = await service.validateParentInOrg(tx, 'prestamos', { clienteId: 'cliente-1' }, 'org-1', 'user-1', 'ADMIN');
    expect(valido).toBe(true);
  });

  it.each(['COBRADOR', 'GERENTE', 'CAJERO'])(
    'un %s no puede crear una jornada a nombre de otro usuario, sin siquiera consultar la ruta',
    async (rol) => {
      const tx = { ruta: { findFirst: vi.fn() } };
      const valido = await service.validateParentInOrg(
        tx,
        'jornadas_cobranza',
        { rutaId: 'ruta-1', usuarioId: 'otro-usuario' },
        'org-1',
        'user-1',
        rol
      );
      expect(valido).toBe(false);
      expect(tx.ruta.findFirst).not.toHaveBeenCalled();
    }
  );

  it.each(['GERENTE', 'CAJERO'])(
    'un %s no puede crear un préstamo para un cliente de una ruta ajena (misma restricción que COBRADOR)',
    async (rol) => {
      const tx = { cliente: { findFirst: vi.fn().mockResolvedValue(null) } };
      const valido = await service.validateParentInOrg(
        tx,
        'prestamos',
        { clienteId: 'cliente-de-otra-ruta' },
        'org-1',
        'user-1',
        rol
      );
      expect(valido).toBe(false);
      expect(tx.cliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'cliente-de-otra-ruta',
            organizacionId: 'org-1',
            ruta: { OR: [{ responsableId: 'user-1' }, { colaboradores: { some: { usuarioId: 'user-1', deletedAt: null } } }] },
          }),
        })
      );
    }
  );

  it('sin el FK requerido (ej. rutaId ausente en un cliente nuevo), rechaza sin consultar nada', async () => {
    const tx = { ruta: { findFirst: vi.fn() } };
    const valido = await service.validateParentInOrg(tx, 'clientes', {}, 'org-1', 'user-1', 'ADMIN');
    expect(valido).toBe(false);
    expect(tx.ruta.findFirst).not.toHaveBeenCalled();
  });

  it.each(['referencias_cliente', 'avales', 'documentos_cliente'])(
    'rechaza un %s cuyo clienteId no pertenece a la organización del actor',
    async (tabla) => {
      const tx = { cliente: { findFirst: vi.fn().mockResolvedValue(null) } };
      const valido = await service.validateParentInOrg(
        tx,
        tabla,
        { clienteId: 'cliente-de-otra-org' },
        'org-1',
        'user-1',
        'ADMIN'
      );
      expect(valido).toBe(false);
    }
  );

  it.each(['referencias_cliente', 'avales', 'documentos_cliente'])(
    'sin clienteId, rechaza un %s sin siquiera consultar nada',
    async (tabla) => {
      const tx = { cliente: { findFirst: vi.fn() } };
      const valido = await service.validateParentInOrg(tx, tabla, {}, 'org-1', 'user-1', 'ADMIN');
      expect(valido).toBe(false);
      expect(tx.cliente.findFirst).not.toHaveBeenCalled();
    }
  );

  it.each(['referencias_cliente', 'avales', 'documentos_cliente'])(
    'acepta un %s cuyo cliente sí pertenece a la organización',
    async (tabla) => {
      const tx = { cliente: { findFirst: vi.fn().mockResolvedValue({ id: 'cliente-1' }) } };
      const valido = await service.validateParentInOrg(tx, tabla, { clienteId: 'cliente-1' }, 'org-1', 'user-1', 'ADMIN');
      expect(valido).toBe(true);
    }
  );
});
