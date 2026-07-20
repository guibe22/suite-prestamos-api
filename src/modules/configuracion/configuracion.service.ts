import { prisma } from '../../config/database.js';

const ID_SINGLETON = 'default';

export class ConfiguracionService {
  /** Crea la fila singleton con los defaults si todavía no existe (primer arranque). */
  async obtener() {
    return prisma.configuracionSistema.upsert({
      where: { id: ID_SINGLETON },
      update: {},
      create: { id: ID_SINGLETON },
    });
  }

  async actualizar(data: { suscripcionesEnforcementEnabled: boolean }) {
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
}
