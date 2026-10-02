import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findUserById: vi.fn(),
  countOtrosAdminsActivos: vi.fn(),
  eliminarCuenta: vi.fn(),
};

vi.mock('../auth.repository.js', () => ({
  AuthRepository: class {
    findUserById = mockRepo.findUserById;
    countOtrosAdminsActivos = mockRepo.countOtrosAdminsActivos;
    eliminarCuenta = mockRepo.eliminarCuenta;
  },
}));

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../shared/email/email.service.js', () => ({ sendEmail: vi.fn() }));

const comparePassword = vi.fn();
vi.mock('../../../utils/bcrypt.js', () => ({
  comparePassword: (...args: unknown[]) => comparePassword(...args),
  hashPassword: vi.fn(),
}));

const { AuthService } = await import('../auth.service.js');

/** Cuenta con contraseña (registro normal por correo). */
const usuarioConPassword = {
  id: 'u-1',
  email: 'cobrador@ejemplo.com',
  password: 'hash-bcrypt',
  rol: { nombre: 'COBRADOR' },
  organizacionId: 'org-1',
};

/** Cuenta creada con Google: googleAuth guarda passwordHash: null. */
const usuarioDeGoogle = {
  id: 'u-2',
  email: 'Dueno@Ejemplo.com',
  password: null,
  rol: { nombre: 'COBRADOR' },
  organizacionId: 'org-1',
};

describe('AuthService.eliminarCuenta', () => {
  const service = new AuthService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.countOtrosAdminsActivos.mockResolvedValue(1);
  });

  describe('cuentas con contraseña', () => {
    it('elimina la cuenta cuando la contraseña es correcta', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioConPassword);
      comparePassword.mockResolvedValue(true);

      await service.eliminarCuenta('u-1', { password: 'la-correcta' });

      expect(mockRepo.eliminarCuenta).toHaveBeenCalledWith('u-1');
    });

    it('rechaza una contraseña incorrecta', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioConPassword);
      comparePassword.mockResolvedValue(false);

      await expect(service.eliminarCuenta('u-1', { password: 'mala' })).rejects.toThrow(
        /contraseña es incorrecta/i
      );
      expect(mockRepo.eliminarCuenta).not.toHaveBeenCalled();
    });

    it('no acepta el correo como confirmación si la cuenta SÍ tiene contraseña', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioConPassword);

      await expect(
        service.eliminarCuenta('u-1', { confirmacionEmail: 'cobrador@ejemplo.com' })
      ).rejects.toThrow(/confirmar tu contraseña/i);
      expect(mockRepo.eliminarCuenta).not.toHaveBeenCalled();
    });
  });

  describe('cuentas sin contraseña (registradas con Google)', () => {
    it('elimina la cuenta al confirmar con el correo', async () => {
      // Antes de la corrección, este caso caía en `!user.password` y respondía
      // "Usuario no encontrado": esos usuarios no tenían NINGUNA forma de
      // borrar su cuenta desde la app, que es un requisito de las tiendas.
      mockRepo.findUserById.mockResolvedValue(usuarioDeGoogle);

      await service.eliminarCuenta('u-2', { confirmacionEmail: 'Dueno@Ejemplo.com' });

      expect(mockRepo.eliminarCuenta).toHaveBeenCalledWith('u-2');
    });

    it('acepta el correo sin importar mayúsculas ni espacios alrededor', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioDeGoogle);

      await service.eliminarCuenta('u-2', { confirmacionEmail: '  dueno@ejemplo.com  ' });

      expect(mockRepo.eliminarCuenta).toHaveBeenCalledWith('u-2');
    });

    it('rechaza un correo que no es el de la cuenta', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioDeGoogle);

      await expect(
        service.eliminarCuenta('u-2', { confirmacionEmail: 'otro@ejemplo.com' })
      ).rejects.toThrow(/correo de tu cuenta/i);
      expect(mockRepo.eliminarCuenta).not.toHaveBeenCalled();
    });

    it('rechaza si no se manda ninguna confirmación', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioDeGoogle);

      await expect(service.eliminarCuenta('u-2', {})).rejects.toThrow(/correo de tu cuenta/i);
      expect(mockRepo.eliminarCuenta).not.toHaveBeenCalled();
    });

    it('nunca compara contra bcrypt: no hay hash con el que comparar', async () => {
      mockRepo.findUserById.mockResolvedValue(usuarioDeGoogle);

      await service.eliminarCuenta('u-2', { confirmacionEmail: 'dueno@ejemplo.com' });

      expect(comparePassword).not.toHaveBeenCalled();
    });
  });

  describe('protección del último administrador', () => {
    it('bloquea al último ADMIN activo de la organización', async () => {
      mockRepo.findUserById.mockResolvedValue({
        ...usuarioConPassword,
        rol: { nombre: 'ADMIN' },
      });
      comparePassword.mockResolvedValue(true);
      mockRepo.countOtrosAdminsActivos.mockResolvedValue(0);

      await expect(service.eliminarCuenta('u-1', { password: 'la-correcta' })).rejects.toThrow(
        /único administrador/i
      );
      expect(mockRepo.eliminarCuenta).not.toHaveBeenCalled();
    });

    it('también protege al último admin en cuentas de Google', async () => {
      mockRepo.findUserById.mockResolvedValue({
        ...usuarioDeGoogle,
        rol: { nombre: 'ADMIN' },
      });
      mockRepo.countOtrosAdminsActivos.mockResolvedValue(0);

      await expect(
        service.eliminarCuenta('u-2', { confirmacionEmail: 'dueno@ejemplo.com' })
      ).rejects.toThrow(/único administrador/i);
    });

    it('deja eliminar a un ADMIN si queda otro', async () => {
      mockRepo.findUserById.mockResolvedValue({
        ...usuarioConPassword,
        rol: { nombre: 'ADMIN' },
      });
      comparePassword.mockResolvedValue(true);
      mockRepo.countOtrosAdminsActivos.mockResolvedValue(1);

      await service.eliminarCuenta('u-1', { password: 'la-correcta' });

      expect(mockRepo.eliminarCuenta).toHaveBeenCalledWith('u-1');
    });
  });

  it('rechaza si el usuario no existe', async () => {
    mockRepo.findUserById.mockResolvedValue(null);

    await expect(service.eliminarCuenta('u-x', { password: 'x' })).rejects.toThrow(
      /no encontrado/i
    );
  });
});
