import type { CategoriaNotificacion } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/custom.error.js';
import { NotificacionService } from '../notificacion/notificacion.service.js';

/**
 * Anuncios manuales de plataforma y diagnóstico de entregas. Solo SUPER_ADMIN
 * (lo impone `checkRole` en las rutas).
 *
 * Sin la vista de diagnóstico, "no me llegan las notificaciones" no es
 * depurable: no habría forma de distinguir entre un usuario sin dispositivo
 * registrado, un token muerto y un fallo de envío.
 */

/** Tope por anuncio. Protege de un error de dedo que genere decenas de miles de filas. */
const MAX_DESTINATARIOS = 5_000;

export interface EnviarAnuncioInput {
  /** Null = todas las organizaciones vigentes. */
  organizacionId: string | null;
  categoria: CategoriaNotificacion;
  titulo: string;
  cuerpo: string;
  /** Ruta interna de la app a la que lleva el anuncio. */
  ruta?: string;
}

export class AdminNotificacionService {
  private notificaciones = new NotificacionService();

  /**
   * Envía un anuncio.
   *
   * Crea UNA FILA POR USUARIO en vez de una sola fila con `usuarioId: null`
   * dirigida a la organización. La razón es el estado de leído: `leidaEn` vive
   * en la fila, así que una fila compartida se marcaría como leída para todos
   * en cuanto el primer usuario la abriera. Una fila por usuario cuesta más
   * espacio y es lo correcto.
   */
  async enviarAnuncio(input: EnviarAnuncioInput): Promise<{
    organizaciones: number;
    destinatarios: number;
    truncado: boolean;
  }> {
    const organizaciones = await this.resolverOrganizaciones(input.organizacionId);
    if (organizaciones.length === 0) {
      throw new NotFoundError('No hay organizaciones vigentes a las que enviar el anuncio.');
    }

    const usuarios = await prisma.usuario.findMany({
      where: {
        organizacionId: { in: organizaciones },
        deletedAt: null,
        // Un invitado que nunca aceptó no puede entrar a la app; mandarle una
        // notificación solo generaría una fila que nadie va a leer.
        //
        // OJO con la forma de este filtro: la cuenta del DUEÑO de la
        // organización se crea por registro directo, sin invitación, así que
        // tiene `invitacionAceptadaEn` nulo (ver el comentario del modelo
        // Usuario). Filtrar por `invitacionAceptadaEn: { not: null }` dejaba
        // fuera justo a los administradores fundadores — es decir, a los
        // destinatarios más importantes de un anuncio de plataforma. Lo que
        // hay que excluir es la invitación PENDIENTE: token emitido y todavía
        // sin aceptar.
        NOT: { AND: [{ invitacionToken: { not: null } }, { invitacionAceptadaEn: null }] },
      },
      select: { id: true, organizacionId: true },
      take: MAX_DESTINATARIOS + 1,
    });

    const truncado = usuarios.length > MAX_DESTINATARIOS;
    const destinatarios = truncado ? usuarios.slice(0, MAX_DESTINATARIOS) : usuarios;

    // Sello compartido por todo el envío: hace la clave de idempotencia única
    // por anuncio sin depender de que el texto sea distinto cada vez (un
    // anuncio idéntico mandado dos veces a propósito debe llegar dos veces).
    const sello = `${Date.now().toString(36)}-${organizaciones.length}`;

    let enviados = 0;
    for (const usuario of destinatarios) {
      try {
        const creada = await this.notificaciones.crearYEnviar({
          organizacionId: usuario.organizacionId!,
          usuarioId: usuario.id,
          categoria: input.categoria,
          titulo: input.titulo,
          cuerpo: input.cuerpo,
          data: input.ruta ? { ruta: input.ruta } : undefined,
          claveIdempotencia: `anuncio:${sello}:${usuario.id}`,
        });
        if (creada) enviados++;
      } catch (e) {
        // Un destinatario que falla no puede cancelar el anuncio para el resto.
        logger.error(e, `💥 Falló el anuncio para el usuario ${usuario.id}.`);
      }
    }

    if (truncado) {
      logger.warn(
        `⚠️  El anuncio superó el tope de ${MAX_DESTINATARIOS} destinatarios y se truncó.`
      );
    }

    return { organizaciones: organizaciones.length, destinatarios: enviados, truncado };
  }

  private async resolverOrganizaciones(organizacionId: string | null): Promise<string[]> {
    if (organizacionId) {
      const organizacion = await prisma.organizacion.findFirst({
        where: { id: organizacionId, deletedAt: null },
        select: { id: true },
      });
      if (!organizacion) throw new NotFoundError('La organización no existe.');
      return [organizacion.id];
    }

    const todas = await prisma.organizacion.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return todas.map((o) => o.id);
  }

  /**
   * Diagnóstico de entregas. Responde las tres preguntas que se hacen cuando
   * alguien reporta que no le llegan notificaciones: ¿hay dispositivos
   * registrados?, ¿se están enviando?, ¿qué está fallando?
   */
  async diagnostico(dias = 7): Promise<unknown> {
    if (dias < 1 || dias > 90) {
      throw new BadRequestError('El rango debe estar entre 1 y 90 días.');
    }
    const desde = new Date(Date.now() - dias * 86_400_000);

    const [
      dispositivosActivos,
      dispositivosInactivos,
      total,
      entregadas,
      conError,
      ultimosFallos,
      organizacionesSinDispositivos,
    ] = await Promise.all([
      prisma.dispositivoPush.count({ where: { activo: true } }),
      prisma.dispositivoPush.count({ where: { activo: false } }),
      prisma.notificacion.count({ where: { createdAt: { gte: desde } } }),
      prisma.notificacion.count({ where: { createdAt: { gte: desde }, enviadaEn: { not: null } } }),
      prisma.notificacion.count({ where: { createdAt: { gte: desde }, errorEnvio: { not: null } } }),
      prisma.notificacion.findMany({
        where: { createdAt: { gte: desde }, errorEnvio: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          categoria: true,
          titulo: true,
          errorEnvio: true,
          createdAt: true,
          organizacion: { select: { id: true, nombre: true } },
        },
      }),
      // Organizaciones donde NADIE tiene un dispositivo activo: el caso más
      // común de "no me llega nada" y el más fácil de pasar por alto.
      prisma.organizacion.findMany({
        where: {
          deletedAt: null,
          usuarios: { none: { dispositivosPush: { some: { activo: true } } } },
        },
        select: { id: true, nombre: true },
        take: 50,
      }),
    ]);

    return {
      rangoDias: dias,
      dispositivos: { activos: dispositivosActivos, inactivos: dispositivosInactivos },
      notificaciones: { total, entregadas, conError },
      ultimosFallos,
      organizacionesSinDispositivos,
    };
  }
}
