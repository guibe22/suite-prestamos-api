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

  async findRoleByName(nombre: string) {
    return prisma.rol.findUnique({
      where: { nombre },
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
