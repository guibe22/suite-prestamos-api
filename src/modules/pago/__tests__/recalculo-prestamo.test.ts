import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/database.js', () => ({ prisma: {} }));

const { PagoService } = await import('../pago.service.js');

/**
 * `tx` en memoria con lo mínimo que usan calcularBaseInicial/redistribuirCuotas/
 * recalcularPrestamo: findMany/findUnique/update sobre cuotas, pagos y préstamos.
 */
function crearTx(datos: { cuotas: any[]; pagos: any[]; prestamo: any }) {
  const filtrar = (filas: any[], where: any = {}) =>
    filas.filter((f) => Object.entries(where).every(([k, v]) => f[k] === v));
  const ordenar = (filas: any[], orderBy?: any) => {
    if (!orderBy) return filas;
    const [campo] = Object.keys(orderBy);
    return [...filas].sort((a, b) => (a[campo] > b[campo] ? 1 : a[campo] < b[campo] ? -1 : 0));
  };
  return {
    cuota: {
      findMany: async ({ where, orderBy }: any) => ordenar(filtrar(datos.cuotas, where), orderBy).map((c) => ({ ...c })),
      update: async ({ where, data }: any) => Object.assign(datos.cuotas.find((c) => c.id === where.id), data),
    },
    pago: {
      findMany: async ({ where, orderBy }: any) => ordenar(filtrar(datos.pagos, where), orderBy).map((p) => ({ ...p })),
    },
    prestamo: {
      findUnique: async () => ({ ...datos.prestamo }),
      update: async ({ data }: any) => Object.assign(datos.prestamo, data),
    },
  };
}

const cuotas = (n: number, pagadas: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    prestamoId: 'pr',
    numeroCuota: i + 1,
    montoTotal: 100,
    montoPagado: pagadas[i] ?? 0,
    estado: (pagadas[i] ?? 0) >= 100 ? 'PAGADA' : 'PENDIENTE',
    fechaPago: null,
    deletedAt: null,
  }));
const pago = (id: string, monto: number, dia: number, extra: any = {}) => ({
  id,
  prestamoId: 'pr',
  monto,
  fechaPago: new Date(2026, 9, dia),
  deletedAt: null,
  moraCobrada: 0,
  ...extra,
});
const prestamo = () => ({ id: 'pr', monto: 1000, tasaInteres: 20, estado: 'ACTIVO', moraAcumulada: 0 });

describe('recálculo de cuotas del préstamo', () => {
  const service = new PagoService();

  it('borrar un pago por sync: las cuotas del dispositivo ya no pisan el recálculo', async () => {
    // P1 cubrió c1 y P2 cubrió c2 (sin base inicial).
    const datos = { cuotas: cuotas(3, [100, 100]), pagos: [pago('P1', 100, 1), pago('P2', 100, 2)], prestamo: prestamo() };
    const tx = crearTx(datos);
    const base = await service.calcularBaseInicial(tx, 'pr'); // snapshot ANTES del push

    // El push: P1 borrado y el dispositivo pisa c1 con 0 (su reversión dirigida).
    datos.pagos[0].deletedAt = new Date();
    datos.cuotas[0].montoPagado = 0;
    datos.cuotas[0].estado = 'PENDIENTE';

    await service.redistribuirCuotas(tx, 'pr', base);

    // P2 sigue vigente: queda exactamente 100 pagado, ni más ni menos.
    expect(datos.cuotas.map((c) => c.montoPagado)).toEqual([100, 0, 0]);
  });

  it('dos dispositivos cobrando offline la misma cuota: se cubren dos cuotas', async () => {
    const datos = { cuotas: cuotas(6, [100, 100, 100, 100]), pagos: [] as any[], prestamo: prestamo() };
    datos.pagos = [1, 2, 3, 4].map((d) => pago(`P${d}`, 100, d));
    const tx = crearTx(datos);
    const base = await service.calcularBaseInicial(tx, 'pr');

    // A y B registraron 100 cada uno; ambos dispositivos escribieron c5 = 100.
    datos.pagos.push(pago('A', 100, 10), pago('B', 100, 10));
    datos.cuotas[4].montoPagado = 100;

    await service.redistribuirCuotas(tx, 'pr', base);

    expect(datos.cuotas.map((c) => c.montoPagado)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(datos.prestamo.estado).toBe('LIQUIDADO');
  });

  it('un sobrepago viejo no se come la base de cuotas pagadas de inicio', async () => {
    // 12 cuotas de 100; las 2 primeras nacieron pagadas (base 200). 8 pagos de
    // 100 y un último pago de 300 que solo aplicó 200 (sobrepago).
    const datos = { cuotas: cuotas(12, Array(12).fill(100)), pagos: [] as any[], prestamo: prestamo() };
    datos.pagos = Array.from({ length: 8 }, (_, i) => pago(`P${i}`, 100, i + 1));
    datos.pagos.push(pago('X', 300, 20, { detalleCuotas: JSON.stringify([{ numeroCuota: 11, monto: 100 }, { numeroCuota: 12, monto: 100 }]) }));
    const tx = crearTx(datos);

    expect(await service.calcularBaseInicial(tx, 'pr')).toBe(200);

    // Borrar el pago de 300: deben quedar 200 pendientes (c11 y c12), no 300.
    datos.pagos[8].deletedAt = new Date();
    await service.recalcularPrestamo(tx, 'pr', datos.pagos[8]);
    const pendiente = datos.cuotas.reduce((s, c) => s + (c.montoTotal - c.montoPagado), 0);
    expect(pendiente).toBe(200);
  });

  it('admin con cuotasIniciales: la base es explícita aunque haya pagos', async () => {
    const datos = { cuotas: cuotas(10, [100, 100, 100, 100, 100]), pagos: [pago('P1', 100, 1), pago('P2', 100, 2), pago('P3', 100, 3)], prestamo: prestamo() };
    const tx = crearTx(datos);

    await service.recalcularPrestamoAdminTx(tx, 'pr', 2);

    // 2 iniciales + 3 pagos = 5 cuotas cubiertas (antes la base quedaba en 0).
    expect(datos.cuotas.filter((c) => c.estado === 'PAGADA')).toHaveLength(5);
  });

  it('borrar un pago restituye solo su mora, sin recalcular la mora desde cero', async () => {
    const datos = { cuotas: cuotas(3, [100]), pagos: [pago('P1', 100, 1, { moraCobrada: 30 })], prestamo: { ...prestamo(), moraAcumulada: 15 } };
    const tx = crearTx(datos);
    datos.pagos[0].deletedAt = new Date();

    await service.recalcularPrestamo(tx, 'pr', datos.pagos[0]);

    expect(datos.prestamo.moraAcumulada).toBe(45);
  });
});
