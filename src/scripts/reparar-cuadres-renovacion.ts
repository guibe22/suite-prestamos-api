/**
 * Repara los cuadres de jornada afectados por el bug de renovación.
 *
 * Al renovar, el saldo del préstamo anterior se saldaba con un Pago
 * `metodoPago = 'AJUSTE'` SIN `jornadaId`, mientras el desembolso se restaba en
 * bruto. Resultado en las jornadas ya cerradas: "Total cobrado" por debajo de lo
 * realmente recuperado y una caja esperada menor que el efectivo real, es decir
 * un sobrante fantasma por cada renovación.
 *
 * La app ya crea esos pagos con `jornadaId` (ver prestamos.tsx), pero las filas
 * históricas quedan huérfanas y las jornadas CERRADAS no se recalculan solas:
 * este script las reengancha y recalcula `efectivoCobrado`.
 *
 * A propósito NO toca `prestamos` ni `gastos` de la jornada: esos ya se
 * escribieron en bruto y con el mismo criterio que usa la app, y recalcularlos
 * exigiría adivinar la ventana de cierre de cada jornada histórica.
 *
 * Criterio de seguridad: si la jornada ya tiene efectivo contado (`saldoFinal`),
 * el pago se reengancha SOLO si al hacerlo el descuadre se acerca a cero. Así,
 * si en esa renovación el saldo no se compensó contra el desembolso (interruptor
 * "Descontar saldo anterior de la caja" apagado, dato que no quedó persistido),
 * el cuadre no se empeora. Con varias renovaciones en la misma jornada la
 * comparación es acumulativa, pago por pago.
 *
 * Uso:
 *   npx tsx src/scripts/reparar-cuadres-renovacion.ts            → previsualiza, no cambia nada
 *   npx tsx src/scripts/reparar-cuadres-renovacion.ts --apply    → aplica los reenganches y recálculos
 *   ... --org <organizacionId>                                   → limita el alcance a una organización
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  TOLERANCIA,
  descuadre as calcularDescuadre,
  finDeJornada,
  reengancheMejoraElCuadre,
} from './lib/cuadre-renovacion.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL no está definido en el archivo .env o en el entorno.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const money = (n: number) => `RD$ ${Math.round(n).toLocaleString('es-DO')}`;
const conSigno = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `-${money(Math.abs(n))}` : money(0));
const fecha = (d: Date) => d.toLocaleDateString('es-DO');

interface EstadoJornada {
  id: string;
  fecha: Date;
  /** Apertura de la jornada: piso de la ventana al recalcular sus pagos. */
  createdAt: Date;
  rutaNombre: string;
  cobradorNombre: string;
  estado: string;
  saldoInicial: number;
  saldoFinal: number | null;
  gastos: number;
  prestamos: number;
  /** Lo que hay hoy en la columna de la jornada. */
  cobradoAlmacenado: number;
  /** Suma real de los pagos ya enganchados: es lo que el --apply escribiría. */
  cobradoDeSusPagos: number;
  /** Acumulado de los pagos que este script sí reengancharía. */
  aReenganchar: number;
  pagosAceptados: number;
}

interface Reenganche {
  pagoId: string;
  jornadaId: string;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--apply');
  const orgIndex = args.indexOf('--org');
  const organizacionId = orgIndex >= 0 ? args[orgIndex + 1] : undefined;

  console.log(`🔎 Conectado a: ${new URL(connectionString!).host}`);
  if (organizacionId) console.log(`   Alcance limitado a la organización ${organizacionId}`);
  console.log(
    aplicar
      ? '   Modo: --apply (se escribirán los cambios)\n'
      : '   Modo: previsualización (no se escribe nada)\n'
  );

  // 1. Pagos de saldado huérfanos (los que generaba el flujo de renovación).
  // Se filtra solo por metodoPago: 'AJUSTE' lo produce ÚNICAMENTE el saldado al
  // renovar (prestamos.tsx), así que no hace falta acotar por el texto de la
  // referencia — hacerlo dejaría fuera cualquier redacción vieja del mensaje.
  // La referencia se imprime en el detalle para que nada se repare a ciegas.
  const scopeOrg = organizacionId ? { prestamo: { cliente: { organizacionId } } } : {};
  const [totalAjustes, yaEnganchados] = await Promise.all([
    prisma.pago.count({ where: { deletedAt: null, metodoPago: 'AJUSTE', ...scopeOrg } }),
    prisma.pago.count({
      where: { deletedAt: null, metodoPago: 'AJUSTE', jornadaId: { not: null }, ...scopeOrg },
    }),
  ]);
  console.log(
    `Pagos de saldado por renovación: ${totalAjustes} en total, ${yaEnganchados} ya con jornada asignada.`
  );

  const huerfanos = await prisma.pago.findMany({
    where: {
      deletedAt: null,
      jornadaId: null,
      metodoPago: 'AJUSTE',
      ...scopeOrg,
    },
    include: {
      prestamo: {
        select: {
          id: true,
          cliente: { select: { nombres: true, apellidos: true, rutaId: true, organizacionId: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (huerfanos.length === 0) {
    console.log('\n✅ No hay pagos de saldado huérfanos: no queda nada del bug de renovación por reparar.');
    return;
  }

  console.log(`${huerfanos.length} sin jornada asignada — candidatos a reparar.\n`);
  console.log('DETALLE POR PAGO');
  console.log('────────────────');

  const estados = new Map<string, EstadoJornada>();
  const reenganches: Reenganche[] = [];
  let ambiguos = 0;
  let sinJornada = 0;
  let descartadosPorCuadre = 0;

  /** Estado de la jornada con los totales reales de sus pagos ya enganchados. */
  async function cargarEstado(jornadaId: string): Promise<EstadoJornada> {
    const existente = estados.get(jornadaId);
    if (existente) return existente;

    const j = await prisma.jornadaCobranza.findUniqueOrThrow({
      where: { id: jornadaId },
      include: {
        ruta: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
      },
    });
    const pagos = await prisma.pago.findMany({
      where: { jornadaId, deletedAt: null, createdAt: { gte: j.createdAt } },
      select: { monto: true, moraCobrada: true },
    });

    const estado: EstadoJornada = {
      id: j.id,
      fecha: j.fecha,
      createdAt: j.createdAt,
      rutaNombre: j.ruta?.nombre || 'Sin ruta',
      cobradorNombre: j.usuario?.nombre || 'Desconocido',
      estado: j.estado,
      saldoInicial: Number(j.saldoInicial || 0),
      saldoFinal: j.saldoFinal != null ? Number(j.saldoFinal) : null,
      gastos: Number(j.gastos || 0),
      prestamos: Number(j.prestamos || 0),
      cobradoAlmacenado: Number(j.efectivoCobrado || 0),
      cobradoDeSusPagos: pagos.reduce(
        (sum, p) => sum + Number(p.monto || 0) + Number(p.moraCobrada || 0),
        0
      ),
      aReenganchar: 0,
      pagosAceptados: 0,
    };
    estados.set(jornadaId, estado);
    return estado;
  }

  /** Descuadre con el cobrado ya recalculado + lo aceptado hasta ahora. */
  function descuadre(e: EstadoJornada, extra = 0): number | null {
    return calcularDescuadre(e.saldoFinal, {
      saldoInicial: e.saldoInicial,
      cobrado: e.cobradoDeSusPagos + e.aReenganchar + extra,
      gastos: e.gastos,
      prestamos: e.prestamos,
    });
  }

  for (const pago of huerfanos) {
    const cliente = pago.prestamo?.cliente;
    const clienteNombre = cliente ? `${cliente.nombres} ${cliente.apellidos || ''}`.trim() : 'Desconocido';
    if (!cliente) {
      sinJornada++;
      console.log(`  ⏭️  ${clienteNombre} — pago ${pago.id}: sin cliente/ruta que permita ubicar la jornada.`);
      continue;
    }

    // El préstamo nuevo apunta al que saldó: es el anclaje más fiable para
    // saber qué cobrador hizo el desembolso y cuándo.
    const prestamoNuevo = await prisma.prestamo.findFirst({
      where: { renovadoDePrestamoId: pago.prestamoId, deletedAt: null },
      select: { usuarioId: true, createdAt: true, codigo: true },
      orderBy: { createdAt: 'asc' },
    });
    const momento = prestamoNuevo?.createdAt ?? pago.createdAt;

    const candidatas = await prisma.jornadaCobranza.findMany({
      where: {
        deletedAt: null,
        organizacionId: cliente.organizacionId,
        rutaId: cliente.rutaId,
        createdAt: { lte: momento },
        ...(prestamoNuevo?.usuarioId ? { usuarioId: prestamoNuevo.usuarioId } : {}),
      },
      select: { id: true, estado: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const dentroDeVentana = candidatas.filter((j) => momento <= finDeJornada(j));

    const monto = Number(pago.monto || 0) + Number(pago.moraCobrada || 0);
    const etiqueta = `${clienteNombre} — ${money(monto)} ("${pago.referencia ?? 'sin referencia'}")`;

    if (dentroDeVentana.length === 0) {
      sinJornada++;
      const cuando = momento.toISOString().slice(0, 16).replace('T', ' ');
      console.log(
        `  ⏭️  ${etiqueta}: ninguna jornada abarca el ${cuando} (renovación hecha fuera de jornada). Se deja como está.`
      );
      continue;
    }
    if (dentroDeVentana.length > 1) {
      ambiguos++;
      console.log(
        `  ⚠️  ${etiqueta}: ${dentroDeVentana.length} jornadas del mismo cobrador y ruta abarcan ese momento — ` +
          `revisión manual (pago ${pago.id}).`
      );
      continue;
    }

    const e = await cargarEstado(dentroDeVentana[0].id);
    const antes = descuadre(e);
    const despues = descuadre(e, monto);

    if (!reengancheMejoraElCuadre(antes, monto)) {
      // Solo se llega aquí con efectivo contado: sin él la función acepta.
      descartadosPorCuadre++;
      const efectoRechazado = `${conSigno(antes ?? 0)} → ${conSigno(despues ?? 0)}`;
      console.log(
        `  ⏭️  ${etiqueta} → jornada del ${fecha(e.fecha)} (${e.rutaNombre}): el descuadre empeoraría ${efectoRechazado}. Ese saldo probablemente no se compensó contra el desembolso.`
      );
      continue;
    }

    e.aReenganchar += monto;
    e.pagosAceptados++;
    reenganches.push({ pagoId: pago.id, jornadaId: e.id });

    const efecto =
      antes != null && despues != null
        ? `: descuadre ${conSigno(antes)} → ${conSigno(despues)}.`
        : ': jornada sin efectivo contado, no hay descuadre contra el que validar.';
    console.log(
      `  ✔️  ${etiqueta} → jornada del ${fecha(e.fecha)} (${e.rutaNombre}, ${e.cobradorNombre})${efecto}`
    );
  }

  // 2. Vista previa por jornada: exactamente lo que escribiría --apply.
  const afectadas = [...estados.values()].filter((e) => e.pagosAceptados > 0);

  if (afectadas.length > 0) {
    console.log();
    console.log('CAMBIOS POR JORNADA');
    console.log('───────────────────');
    for (const e of afectadas) {
      const cobradoDespues = e.cobradoDeSusPagos + e.aReenganchar;
      // `descuadre(e)` ya incluye lo aceptado: para el "antes" se descuenta.
      const antes = descuadre(e, -e.aReenganchar);
      const despues = descuadre(e);

      console.log(
        `  • ${fecha(e.fecha)} · ${e.rutaNombre} · ${e.cobradorNombre} · ${e.estado} ` +
          `(${e.pagosAceptados} pago${e.pagosAceptados === 1 ? '' : 's'})`
      );
      console.log(`      Total cobrado:  ${money(e.cobradoAlmacenado)} → ${money(cobradoDespues)}`);
      if (antes != null && despues != null) {
        const veredicto =
          Math.abs(despues) <= TOLERANCIA
            ? '✅ queda cuadrada'
            : `⚠️  sigue descuadrada por ${money(Math.abs(despues))}`;
        console.log(`      Descuadre:      ${conSigno(antes)} → ${conSigno(despues)}   ${veredicto}`);
      } else {
        console.log('      Descuadre:      — (sin efectivo contado todavía)');
      }
      // El --apply reescribe el cobrado desde los pagos: si la columna ya no
      // coincidía con ellos, ese arrastre también se corrige aquí.
      const drift = e.cobradoDeSusPagos - e.cobradoAlmacenado;
      if (Math.abs(drift) > TOLERANCIA) {
        console.log(
          `      Nota: la columna ya venía desalineada de sus pagos en ${conSigno(drift)}; el recálculo también lo corrige.`
        );
      }
    }
  }

  console.log();
  console.log('RESUMEN');
  console.log('───────');
  console.log(`  • ${reenganches.length} pago(s) a reenganchar en ${afectadas.length} jornada(s)`);
  if (descartadosPorCuadre > 0) console.log(`  • ${descartadosPorCuadre} descartado(s) porque empeoraban el cuadre`);
  if (ambiguos > 0) console.log(`  • ${ambiguos} ambiguo(s), requieren revisión manual`);
  if (sinJornada > 0) console.log(`  • ${sinJornada} sin jornada que los abarque`);
  console.log();

  if (reenganches.length === 0) {
    console.log('Nada que aplicar.');
    return;
  }

  if (!aplicar) {
    console.log('Previsualización terminada — nada se modificó. Corre con --apply para escribir estos cambios.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const r of reenganches) {
      await tx.pago.update({ where: { id: r.pagoId }, data: { jornadaId: r.jornadaId } });
    }

    // Recalcular el cobrado desde los pagos ya reenganchados, con la misma
    // fórmula de la app (monto + mora, solo pagos vivos de esta jornada).
    for (const e of afectadas) {
      const pagos = await tx.pago.findMany({
        where: { jornadaId: e.id, deletedAt: null, createdAt: { gte: e.createdAt } },
        select: { monto: true, moraCobrada: true },
      });
      const efectivoCobrado = pagos.reduce(
        (sum, p) => sum + Number(p.monto || 0) + Number(p.moraCobrada || 0),
        0
      );
      await tx.jornadaCobranza.update({ where: { id: e.id }, data: { efectivoCobrado } });
    }
  });

  console.log(
    `✅ ${reenganches.length} pago(s) reenganchados y "Total cobrado" recalculado en ${afectadas.length} jornada(s).`
  );
  console.log('   Los dispositivos recibirán los valores corregidos en el próximo pull de sincronización.');
}

main()
  .catch((e) => {
    console.error('❌ Error reparando los cuadres de renovación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
