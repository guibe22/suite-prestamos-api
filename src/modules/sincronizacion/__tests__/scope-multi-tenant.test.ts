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

  it('COBRADOR: clientes queda restringido a rutas donde es responsable o colaborador', () => {
    const where = service.scopeWhere('clientes', 'org-1', 'user-1', 'COBRADOR');
    expect(where.organizacionId).toBe('org-1');
    expect(where.ruta.OR).toEqual([
      { responsableId: 'user-1' },
      { colaboradores: { some: { usuarioId: 'user-1', deletedAt: null } } },
    ]);
  });

  it('COBRADOR: jamás puede matchear ruta_colaboradores (gestionar colaboradores es solo de ADMIN)', () => {
    const where = service.scopeWhere('ruta_colaboradores', 'org-1', 'user-1', 'COBRADOR');
    expect(where).toEqual({ id: '' });
  });

  it('COBRADOR vs ADMIN: ambos siempre incluyen organizacionId, sin excepción, para cualquier tabla conocida', () => {
    for (const rol of ['ADMIN', 'COBRADOR']) {
      const where = service.scopeWhere('jornadas_cobranza', 'org-1', 'user-1', rol);
      expect(where.organizacionId).toBe('org-1');
    }
  });
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

  it('un COBRADOR no puede crear una jornada a nombre de otro usuario, sin siquiera consultar la ruta', async () => {
    const tx = { ruta: { findFirst: vi.fn() } };
    const valido = await service.validateParentInOrg(
      tx,
      'jornadas_cobranza',
      { rutaId: 'ruta-1', usuarioId: 'otro-usuario' },
      'org-1',
      'user-1',
      'COBRADOR'
    );
    expect(valido).toBe(false);
    expect(tx.ruta.findFirst).not.toHaveBeenCalled();
  });

  it('sin el FK requerido (ej. rutaId ausente en un cliente nuevo), rechaza sin consultar nada', async () => {
    const tx = { ruta: { findFirst: vi.fn() } };
    const valido = await service.validateParentInOrg(tx, 'clientes', {}, 'org-1', 'user-1', 'ADMIN');
    expect(valido).toBe(false);
    expect(tx.ruta.findFirst).not.toHaveBeenCalled();
  });
});
