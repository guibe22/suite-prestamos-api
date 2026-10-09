import { prisma } from '../../config/database.js';
import type { actualizarConfiguracionSchema } from './configuracion.schema.js';
import type { z } from 'zod';

const ID_SINGLETON = 'default';

type ActualizarConfiguracionInput = z.infer<typeof actualizarConfiguracionSchema>;

export class ConfiguracionService {
  /** Crea la fila singleton con los defaults si todavía no existe (primer arranque). */
  async obtener() {
    return prisma.configuracionSistema.upsert({
      where: { id: ID_SINGLETON },
      update: {},
      create: { id: ID_SINGLETON },
    });
  }

  async actualizar(data: ActualizarConfiguracionInput) {
    return prisma.configuracionSistema.upsert({
      where: { id: ID_SINGLETON },
      update: data,
      create: { id: ID_SINGLETON, ...data },
    });
  }

  /**
   * Usado por requireActiveSubscription() en cada request — una fila
   * indexada por PK, sin caché: el costo es despreciable frente a las demás
   * consultas que ya hace ese middleware.
   */
  async suscripcionesEnforcementEnabled(): Promise<boolean> {
    const config = await this.obtener();
    return config.suscripcionesEnforcementEnabled;
  }

  /**
   * Subconjunto público (sin auth): lo que necesitan la app y la web pública
   * antes de que haya una sesión.
   *
   * - `minVersionApp` lo consulta la app para el chequeo de versión.
   * - El contacto de soporte lo pinta la página `/contacto` de la web. Son
   *   datos de publicación —el mismo teléfono y correo que el middleware de
   *   suscripción ya le muestra a cualquier usuario bloqueado—, así que
   *   exponerlos aquí no revela nada nuevo; lo que no sale es el resto de la
   *   configuración (enforcement de suscripciones, umbrales).
   *
   * Pueden venir a `null`: la web omite la línea en vez de inventar un
   * sustituto plausible.
   */
  async obtenerPublica(): Promise<{
    minVersionApp: string | null;
    soporteTelefono: string | null;
    soporteEmail: string | null;
  }> {
    const config = await this.obtener();
    return {
      minVersionApp: config.minVersionApp,
      soporteTelefono: config.soporteTelefono,
      soporteEmail: config.soporteEmail,
    };
  }
}
