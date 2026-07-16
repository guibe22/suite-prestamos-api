import { randomBytes } from 'node:crypto';
import { UsuarioRepository } from './usuario.repository.js';
import { hashPassword } from '../../utils/bcrypt.js';
import { sendEmail } from '../../shared/email/email.service.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/custom.error.js';
import { SuscripcionService } from '../suscripcion/suscripcion.service.js';
import type { ActualizarUsuarioInput, CrearUsuarioInput, MiembroEquipoResponse } from './usuario.types.js';

const ROLES_ADMINISTRABLES = ['COBRADOR', 'CAJERO'];
const INVITACION_VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;

export class UsuarioService {
  private usuarioRepository = new UsuarioRepository();
  private suscripcionService = new SuscripcionService();

  async listar(organizacionId: string): Promise<MiembroEquipoResponse[]> {
    const usuarios = await this.usuarioRepository.findManyByOrganizacion(organizacionId);
    return usuarios.map((usuario) => this.toResponse(usuario));
  }

  /**
   * Registra al miembro como invitación pendiente (sin contraseña) y le envía
   * un código por correo. El propio invitado fija su contraseña al aceptar
   * (POST /auth/aceptar-invitacion): el ADMIN nunca conoce ni asigna la
   * contraseña de otra persona.
   */
  async crear(organizacionId: string, data: CrearUsuarioInput): Promise<MiembroEquipoResponse> {
    const cleanEmail = data.email.trim().toLowerCase();

    const existente = await this.usuarioRepository.findByEmail(cleanEmail);
    if (existente) {
      throw new ConflictError('El correo electrónico ya está registrado.');
    }

    await this.suscripcionService.verificarLimite(organizacionId, 'usuarios', 1);

    const rol = await this.buscarOCrearRol(data.rol);
    const invitacionToken = this.generarCodigoInvitacion();
    const invitacionExpiraEn = new Date(Date.now() + INVITACION_VIGENCIA_MS);

    const usuario = await this.usuarioRepository.create({
      nombre: data.nombre,
      email: cleanEmail,
      rolId: rol.id,
      organizacionId,
      invitacionToken,
      invitacionExpiraEn,
    });

    await this.enviarCorreoInvitacion(cleanEmail, data.nombre, invitacionToken);

    return this.toResponse(usuario);
  }

  /**
   * Vuelve a generar el código de invitación y reenvía el correo. Solo aplica
   * mientras la invitación siga pendiente (si ya fue aceptada, se usa
   * restablecerPassword en su lugar).
   */
  async reenviarInvitacion(organizacionId: string, id: string): Promise<MiembroEquipoResponse> {
    const usuario = await this.buscarMiembroAdministrable(organizacionId, id);
    if (usuario.password) {
      throw new BadRequestError('Este miembro ya aceptó la invitación; usa "Restablecer contraseña" en su lugar.');
    }

    const invitacionToken = this.generarCodigoInvitacion();
    const invitacionExpiraEn = new Date(Date.now() + INVITACION_VIGENCIA_MS);
    const actualizado = await this.usuarioRepository.regenerarInvitacion(usuario.id, invitacionToken, invitacionExpiraEn);

    await this.enviarCorreoInvitacion(usuario.email, usuario.nombre, invitacionToken);

    return this.toResponse(actualizado);
  }

  private generarCodigoInvitacion(): string {
    return randomBytes(5).toString('hex').toUpperCase();
  }

  private async enviarCorreoInvitacion(email: string, nombre: string, codigo: string): Promise<void> {
    await sendEmail({
      to: email,
      subject: 'Te invitaron a un equipo en Suite Préstamos',
      devLogFallback: `Código de invitación para ${email}: ${codigo}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #ffffff;">
          <h2 style="color: #059669; font-size: 22px; margin-bottom: 8px;">Te invitaron a un equipo</h2>
          <p style="color: #4b5563; font-size: 15px; line-height: 24px;">Hola ${nombre}, te agregaron a un equipo en <strong>Suite Préstamos</strong>. Abre la app, elige "¿Tienes una invitación?" e ingresa este código junto con tu correo para fijar tu propia contraseña y aceptar:</p>
          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0;">
            <span style="font-size: 26px; font-weight: 700; letter-spacing: 3px; color: #059669; font-family: monospace;">${codigo}</span>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 20px;">Este código vence en <strong>7 días</strong>. Si no esperabas esta invitación, puedes ignorar este correo de forma segura.</p>
          <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 11px; text-align: center;">© ${new Date().getFullYear()} Suite Préstamos. Todos los derechos reservados.</p>
        </div>
      `,
    });
  }

  async actualizar(organizacionId: string, id: string, actorId: string, data: ActualizarUsuarioInput): Promise<MiembroEquipoResponse> {
    if (data.nombre === undefined && data.rol === undefined && data.activo === undefined) {
      throw new BadRequestError('Debes enviar al menos un campo para actualizar.');
    }

    const usuario = await this.buscarMiembroAdministrable(organizacionId, id);

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

  async restablecerPassword(organizacionId: string, id: string): Promise<{ passwordTemporal: string }> {
    const usuario = await this.buscarMiembroAdministrable(organizacionId, id);
    if (!usuario.password) {
      throw new BadRequestError('Este miembro aún no acepta su invitación; usa "Reenviar invitación" en su lugar.');
    }

    const passwordTemporal = randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(passwordTemporal);
    await this.usuarioRepository.updatePassword(usuario.id, passwordHash);

    return { passwordTemporal };
  }

  /**
   * Borrado lógico (mismo mecanismo que actualizar({activo:false})): un
   * hard-delete real arrastraría en cascada (onDelete: Cascade) todo el
   * historial de JornadaCobranza del cobrador, perdiendo el cuadre/auditoría
   * de jornadas ya cerradas.
   */
  async eliminar(organizacionId: string, id: string, actorId: string): Promise<void> {
    const usuario = await this.buscarMiembroAdministrable(organizacionId, id);
    await this.usuarioRepository.update(usuario.id, { deletedAt: new Date(), deletedBy: actorId });
  }

  private async buscarMiembroAdministrable(organizacionId: string, id: string) {
    const usuario = await this.usuarioRepository.findByIdInOrganizacion(id, organizacionId);
    if (!usuario) {
      throw new NotFoundError('El miembro del equipo no existe en tu organización.');
    }
    if (!ROLES_ADMINISTRABLES.includes(usuario.rol.nombre)) {
      throw new ForbiddenError('No puedes administrar este usuario desde aquí.');
    }
    return usuario;
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
    password: string | null;
    deletedAt: Date | null;
    createdAt: Date;
  }): MiembroEquipoResponse {
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol.nombre,
      activo: usuario.deletedAt === null,
      invitacionPendiente: usuario.password === null,
      createdAt: usuario.createdAt,
    };
  }
}
