try {
  await import('dotenv/config');
} catch (_) {}
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import {
  cuotasInicialesImplicitas,
  diagnosticarPrestamo,
  type Hallazgo,
  type PrestamoDiag,
  type Severidad,
  type TipoHallazgo,
} from './lib/diagnostico-cobros.js';

/**
 * Diagnóstico de SOLO LECTURA de préstamos descuadrados por los bugs de cobros
 * corregidos en oct 2026 (sobrepagos, cuotas pisadas por el sync, dobles
 * cobros, préstamos que nunca se liquidaron...). No escribe nada en la BD:
 * solo hace consultas y genera un CSV para revisar caso por caso. Las
 * correcciones se aplican después, una por una, con `reparar-prestamos`.
 *
 * Uso:
 *   npm run diagnosticar-cobros
 *   npm run diagnosticar-cobros -- --org <organizacionId>
 *   npm run diagnosticar-cobros -- --codigo P-000123
 *   npm run diagnosticar-cobros -- --salida reportes/mi-reporte.csv
 */

const LOTE = 200;

const ACCION: Record<TipoHallazgo, string> = {
  CUOTAS_POR_DEBAJO_DE_PAGOS: 'Reparar: reconstruir cuotas desde los pagos',
  CUOTAS_FUERA_DE_ORDEN: 'Reparar: reconstruir cuotas desde los pagos',
  PRESTAMO_TRABADO: 'Reparar: reconstruir cuotas y estado',
  LIQUIDADO_CON_PENDIENTE: 'Reparar: reconstruir cuotas y estado (y revisar si de verdad se pagó)',
  BASE_INICIAL_SOSPECHOSA: 'Revisar a mano cuántas cuotas se pagaron de inicio antes de reparar',
  SOBREPAGO: 'Revisar con el cliente: se le cobró de más (devolver o abonar al próximo préstamo)',
  POSIBLE_COBRO_DUPLICADO: 'Confirmar con el cobrador; si se cobró dos veces, borrar uno desde el panel',
  PAGO_EN_CERO: 'Borrar el pago desde el panel',
  CUOTA_PAGADA_CON_FALTANTE: 'Informativo: centavos por redondeo, no requiere acción',
};
const REPARABLE = new Set<TipoHallazgo>([
  'CUOTAS_POR_DEBAJO_DE_PAGOS',
  'CUOTAS_FUERA_DE_ORDEN',
  'PRESTAMO_TRABADO',
  'LIQUIDADO_CON_PENDIENTE',
]);
const ORDEN_SEVERIDAD: Record<Severidad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

function arg(args: string[], nombre: string): string | null {
  const i = args.indexOf(nombre);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

const csv = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const args = process.argv.slice(2);
  const orgId = arg(args, '--org');
  const codigo = arg(args, '--codigo');
  const ahora = new Date();
  const sello = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const salida = arg(args, '--salida') ?? path.join('reportes', `diagnostico-cobros-${sello}.csv`);

  console.log('============================================================');
  console.log('   🔎 DIAGNÓSTICO DE COBROS (solo lectura, no modifica la BD)');
  console.log('============================================================');
  if (orgId) console.log(`Organización: ${orgId}`);
  if (codigo) console.log(`Préstamo: ${codigo}`);

  const where: any = { deletedAt: null, estado: { not: 'CANCELADO' } };
  if (orgId) where.cliente = { organizacionId: orgId };
  if (codigo) where.codigo = codigo;

  const filas: { severidad: Severidad; impacto: number; columnas: unknown[] }[] = [];
  const conteo = new Map<TipoHallazgo, { n: number; impacto: number }>();
  let revisados = 0;
  let afectados = 0;
  let cursor: string | undefined;

  for (;;) {
    const prestamos = await prisma.prestamo.findMany({
      where,
      orderBy: { id: 'asc' },
      take: LOTE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        codigo: true,
        estado: true,
        cliente: {
          select: {
            nombres: true,
            apellidos: true,
            codigo: true,
            ruta: { select: { nombre: true } },
            organizacion: { select: { nombre: true } },
          },
        },
        cuotas: {
          where: { deletedAt: null },
          select: { numeroCuota: true, montoTotal: true, montoPagado: true, estado: true },
        },
        pagos: {
          where: { deletedAt: null },
          select: { id: true, monto: true, moraCobrada: true, fechaPago: true, jornadaId: true, detalleCuotas: true },
        },
      },
    });
    if (prestamos.length === 0) break;
    cursor = prestamos[prestamos.length - 1].id;

    for (const p of prestamos) {
      revisados++;
      const diag: PrestamoDiag = {
        estado: p.estado,
        cuotas: p.cuotas.map((c) => ({
          numeroCuota: c.numeroCuota,
          montoTotal: Number(c.montoTotal),
          montoPagado: Number(c.montoPagado),
          estado: c.estado,
        })),
        pagos: p.pagos.map((pg) => ({
          id: pg.id,
          monto: Number(pg.monto),
          moraCobrada: Number(pg.moraCobrada),
          fechaPago: pg.fechaPago,
          jornadaId: pg.jornadaId,
          detalleCuotas: pg.detalleCuotas,
        })),
      };
      const hallazgos: Hallazgo[] = diagnosticarPrestamo(diag);
      if (hallazgos.length === 0) continue;
      if (hallazgos.some((h) => h.severidad !== 'BAJA')) afectados++;

      const iniciales = cuotasInicialesImplicitas(diag);
      const cliente = `${p.cliente?.nombres ?? ''} ${p.cliente?.apellidos ?? ''}`.trim();
      for (const h of hallazgos) {
        const c = conteo.get(h.tipo) ?? { n: 0, impacto: 0 };
        conteo.set(h.tipo, { n: c.n + 1, impacto: c.impacto + h.impacto });

        const comando = REPARABLE.has(h.tipo) && iniciales !== null
          ? `npm run reparar-prestamos -- ${p.codigo ?? p.id} --cuotas-iniciales ${iniciales}`
          : '';
        filas.push({
          severidad: h.severidad,
          impacto: h.impacto,
          columnas: [
            h.severidad,
            h.tipo,
            h.impacto.toFixed(2),
            p.cliente?.organizacion?.nombre,
            p.cliente?.ruta?.nombre,
            cliente,
            p.cliente?.codigo,
            p.codigo ?? p.id,
            p.estado,
            h.detalle,
            ACCION[h.tipo],
            comando,
          ],
        });
      }
    }
    process.stdout.write(`\r   Préstamos revisados: ${revisados}`);
  }
  console.log('\n');

  filas.sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] || b.impacto - a.impacto);
  const encabezado = [
    'Severidad', 'Tipo', 'Impacto RD$', 'Organización', 'Ruta', 'Cliente', 'Código cliente',
    'Préstamo', 'Estado préstamo', 'Detalle', 'Acción sugerida', 'Comando de reparación (correr primero SIN --apply)',
  ];
  mkdirSync(path.dirname(salida), { recursive: true });
  // BOM para que Excel abra bien las tildes.
  writeFileSync(salida, `﻿${[encabezado, ...filas.map((f) => f.columnas)].map((r) => r.map(csv).join(',')).join('\n')}\n`);

  console.log('📊 RESUMEN');
  console.log(`   Préstamos revisados:             ${revisados}`);
  console.log(`   Préstamos con hallazgos (no BAJA): ${afectados}`);
  console.log('   ----------------------------------------------------------');
  const tiposOrdenados = [...conteo.entries()].sort((a, b) => b[1].impacto - a[1].impacto);
  for (const [tipo, { n, impacto }] of tiposOrdenados) {
    console.log(`   ${tipo.padEnd(28)} ${String(n).padStart(5)} caso(s)   RD$ ${impacto.toFixed(2)}`);
  }
  if (tiposOrdenados.length === 0) console.log('   ✅ No se encontró ningún préstamo descuadrado.');
  console.log('   ----------------------------------------------------------');
  console.log(`   Reporte: ${path.resolve(salida)}`);
  console.log('   (Contiene datos de clientes: no compartir fuera del equipo.)');
}

main()
  .catch((e) => {
    console.error('Error al ejecutar el diagnóstico:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
