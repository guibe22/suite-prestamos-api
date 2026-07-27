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
   * Subconjunto público (sin auth) para que la app pueda comprobar la
   * versión mínima incluso antes de iniciar sesión — el resto de esta
   * configuración (enforcement de suscripciones) no se expone aquí.
   */
  async obtenerPublica(): Promise<{ minVersionApp: string | null }> {
    const config = await this.obtener();
    return { minVersionApp: config.minVersionApp };
  }
}
