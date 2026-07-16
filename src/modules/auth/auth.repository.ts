import { prisma } from '../../config/database.js';
import type { RegisterInput } from './auth.types.js';

export class AuthRepository {
  async findByEmail(email: string) {
    return prisma.usuario.findUnique({
      where: { email, deletedAt: null },
      include: {
        rol: true,
        organizacion: true,
      },
    });
  }

  async findUserById(id: string) {
    return prisma.usuario.findUnique({
      where: { id, deletedAt: null },
      include: {
        rol: true,
        organizacion: true,
      },
    });
  }

  async updatePassword(id: string, passwordHash: string) {
    return prisma.usuario.update({
      where: { id },
      data: { password: passwordHash },
    });
  }

  async findByInvitacionToken(token: string) {
    return prisma.usuario.findUnique({
      where: { invitacionToken: token },
      include: { rol: true, organizacion: true },
    });
  }

  async aceptarInvitacion(id: string, passwordHash: string) {
    return prisma.usuario.update({
      where: { id },
      data: {
        password: passwordHash,
        invitacionToken: null,
        invitacionExpiraEn: null,
        invitacionAceptadaEn: new Date(),
      },
      include: { rol: true, organizacion: true },
    });
  }

  async findRoleByName(nombre: string) {
    return prisma.rol.findUnique({
      where: { nombre },
    });
  }

  /**
   * Cuenta cuántos ADMIN/SUPER_ADMIN activos (aparte de `excluirUsuarioId`)
   * quedarían en la organización. Se usa para impedir que el último
   * administrador se autoelimine y deje la organización sin nadie que
   * gestione el equipo.
   */
  async countOtrosAdminsActivos(organizacionId: string, excluirUsuarioId: string): Promise<number> {
    return prisma.usuario.count({
      where: {
        organizacionId,
        deletedAt: null,
        id: { not: excluirUsuarioId },
        rol: { nombre: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      },
    });
  }

  /** Borrado lógico de la propia cuenta (mismo mecanismo que usuario.eliminar). */
  async eliminarCuenta(id: string): Promise<void> {
    await prisma.usuario.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: id },
    });
  }

  async createUserWithNewOrganization(
    data: RegisterInput & { passwordHash: string; rolId: string },
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Crear Cuenta
      const cuenta = await tx.cuenta.create({
        data: {
          nombre: `Cuenta de ${data.nombre}`,
          tipo: 'PERSONAL',
        },
      });

      // 2. Crear Organización
      const orgNombre = data.organizacionNombre || `Organización de ${data.nombre}`;
      const organizacion = await tx.organizacion.create({
        data: {
          nombre: orgNombre,
          cuentaId: cuenta.id,
        },
      });

      // 3. Crear Usuario
      const usuario = await tx.usuario.create({
        data: {
          nombre: data.nombre,
          email: data.email,
          password: data.passwordHash,
          rolId: data.rolId,
          organizacionId: organizacion.id,
        },
        include: {
          rol: true,
        },
      });

      return { usuario, organizacion, cuenta };
    });
  }
}
