import { prisma } from '../../config/database.js';

export class UsuarioRepository {
  // No se filtra por deletedAt: este módulo administra el equipo y necesita
  // ver y poder reactivar también a los miembros desactivados. El filtro
  // deletedAt: null vive en auth.repository.ts, donde sí bloquea el login.
  async findManyByOrganizacion(organizacionId: string) {
    return prisma.usuario.findMany({
      where: { organizacionId },
      include: { rol: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByIdInOrganizacion(id: string, organizacionId: string) {
    return prisma.usuario.findFirst({
      where: { id, organizacionId },
      include: { rol: true },
    });
  }

  async findByEmail(email: string) {
    return prisma.usuario.findUnique({ where: { email } });
  }

  async findRoleByName(nombre: string) {
    return prisma.rol.findUnique({ where: { nombre } });
  }

  async createRole(nombre: string) {
    return prisma.rol.create({
      data: { nombre, descripcion: `Rol de ${nombre.toLowerCase()}` },
    });
  }

  async create(data: {
    nombre: string;
    email: string;
    rolId: string;
    organizacionId: string;
    invitacionToken: string;
    invitacionExpiraEn: Date;
  }) {
    return prisma.usuario.create({
      data,
      include: { rol: true },
    });
  }

  async regenerarInvitacion(id: string, invitacionToken: string, invitacionExpiraEn: Date) {
    return prisma.usuario.update({
      where: { id },
      data: { invitacionToken, invitacionExpiraEn },
      include: { rol: true },
    });
  }

  async update(id: string, data: { nombre?: string; rolId?: string; deletedAt?: Date | null; deletedBy?: string | null }) {
    return prisma.usuario.update({
      where: { id },
      data,
      include: { rol: true },
    });
  }

  async updatePassword(id: string, passwordHash: string) {
    return prisma.usuario.update({
      where: { id },
      data: { password: passwordHash },
      include: { rol: true },
    });
  }

}
