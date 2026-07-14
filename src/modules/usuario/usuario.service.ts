import { randomBytes } from 'node:crypto';
import { UsuarioRepository } from './usuario.repository.js';
import { hashPassword } from '../../utils/bcrypt.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/custom.error.js';
import type {
  ActualizarUsuarioInput,
  CrearUsuarioInput,
  MiembroEquipoCreadoResponse,
  MiembroEquipoResponse,
} from './usuario.types.js';

const ROLES_ADMINISTRABLES = ['COBRADOR', 'CAJERO'];

export class UsuarioService {
  private usuarioRepository = new UsuarioRepository();

  async listar(organizacionId: string): Promise<MiembroEquipoResponse[]> {
    const usuarios = await this.usuarioRepository.findManyByOrganizacion(organizacionId);
    return usuarios.map((usuario) => this.toResponse(usuario));
  }

  async crear(organizacionId: string, data: CrearUsuarioInput): Promise<MiembroEquipoCreadoResponse> {
    const cleanEmail = data.email.trim().toLowerCase();

    const existente = await this.usuarioRepository.findByEmail(cleanEmail);
    if (existente) {
      throw new ConflictError('El correo electrónico ya está registrado.');
    }

    const rol = await this.buscarOCrearRol(data.rol);

    // Si el ADMIN no fija contraseña, se genera una aleatoria fuerte y se
    // devuelve una única vez en la respuesta para que la comunique al miembro.
    let plainPassword = data.password;
    let passwordTemporal: string | undefined;
    if (!plainPassword) {
      plainPassword = randomBytes(9).toString('base64url');
      passwordTemporal = plainPassword;
    }
    const passwordHash = await hashPassword(plainPassword);

    const usuario = await this.usuarioRepository.create({
      nombre: data.nombre,
      email: cleanEmail,
      password: passwordHash,
      rolId: rol.id,
      organizacionId,
    });

    return { ...this.toResponse(usuario), passwordTemporal };
  }

  async actualizar(organizacionId: string, id: string, actorId: string, data: ActualizarUsuarioInput): Promise<MiembroEquipoResponse> {
    if (data.nombre === undefined && data.rol === undefined && data.activo === undefined) {
      throw new BadRequestError('Debes enviar al menos un campo para actualizar.');
    }

    const usuario = await this.usuarioRepository.findByIdInOrganizacion(id, organizacionId);
    if (!usuario) {
      throw new NotFoundError('El miembro del equipo no existe en tu organización.');
    }
    if (!ROLES_ADMINISTRABLES.includes(usuario.rol.nombre)) {
      throw new ForbiddenError('No puedes administrar este usuario desde aquí.');
    }

    const cambios: { nombre?: string; rolId?: string; deletedAt?: Date | null; deletedBy?: string | null } = {};

    if (data.nombre !== undefined) {
      cambios.nombre = data.nombre;
    }

    if (data.rol !== undefined) {
      const rol = await this.buscarOCrearRol(data.rol);
      cambios.rolId = rol.id;
    }

    if (data.activo !== undefined) {
      cambios.deletedAt = data.activo ? null : new Date();
      cambios.deletedBy = data.activo ? null : actorId;
    }

    const actualizado = await this.usuarioRepository.update(id, cambios);
    return this.toResponse(actualizado);
  }

  private async buscarOCrearRol(nombre: string) {
    const existente = await this.usuarioRepository.findRoleByName(nombre);
    if (existente) return existente;
    return this.usuarioRepository.createRole(nombre);
  }

  private toResponse(usuario: {
    id: string;
    nombre: string;
    email: string;
    rol: { nombre: string };
    deletedAt: Date | null;
    createdAt: Date;
  }): MiembroEquipoResponse {
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol.nombre,
      activo: usuario.deletedAt === null,
      createdAt: usuario.createdAt,
    };
  }
}
