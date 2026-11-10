import { prisma } from '../../config/database.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/custom.error.js';
import { esRolRestringidoPorRuta, rutaAccessFilter } from '../../shared/access/ruta-scope.js';

/**
 * Tope de la foto ya decodificada. La app la manda redimensionada a ~1000 px
 * de ancho y JPEG calidad 0.5 (≈50-90 KB); el tope deja margen sin permitir
 * subir fotos de la cámara sin comprimir (2-5 MB).
 */
export const MAX_BYTES_FOTO_CEDULA = 400 * 1024;

export interface FotoCedulaDto {
  imagenBase64: string;
  mimeType: string;
  bytes: number;
  actualizadaEn: Date;
}

export class ClienteFotoService {
  /** La función la habilita el SUPER_ADMIN por organización (Organizacion.permiteFotoCedula). */
  private async assertHabilitada(organizacionId: string): Promise<void> {
    const org = await prisma.organizacion.findUnique({
      where: { id: organizacionId },
      select: { permiteFotoCedula: true },
    });
    if (!org?.permiteFotoCedula) {
      throw new ForbiddenError('La foto de la cédula no está habilitada para tu organización.');
    }
  }

  /**
   * Mismo modelo Zero-Route que el resto del API: GERENTE/CAJERO/COBRADOR
   * solo ven clientes de sus rutas; ADMIN/SUPER_ADMIN, toda la organización.
   */
  private async assertClienteAccesible(
    organizacionId: string,
    clienteId: string,
    actorId: string,
    actorRol: string
  ): Promise<void> {
    const cliente = await prisma.cliente.findFirst({
      where: {
        id: clienteId,
        organizacionId,
        deletedAt: null,
        ...(esRolRestringidoPorRuta(actorRol) ? { ruta: rutaAccessFilter(actorId) } : {}),
      },
      select: { id: true },
    });
    if (!cliente) {
      throw new NotFoundError('El cliente no existe en tu organización o todavía no se ha sincronizado.');
    }
  }

  async obtener(organizacionId: string, clienteId: string, actorId: string, actorRol: string): Promise<FotoCedulaDto> {
    await this.assertHabilitada(organizacionId);
    await this.assertClienteAccesible(organizacionId, clienteId, actorId, actorRol);

    const foto = await prisma.fotoCedulaCliente.findFirst({ where: { clienteId, organizacionId } });
    if (!foto) {
      throw new NotFoundError('Este cliente no tiene foto de cédula.');
    }
    return {
      imagenBase64: foto.imagenBase64,
      mimeType: foto.mimeType,
      bytes: foto.bytes,
      actualizadaEn: foto.updatedAt,
    };
  }

  async guardar(
    organizacionId: string,
    clienteId: string,
    imagenBase64: string,
    actorId: string,
    actorRol: string
  ): Promise<{ bytes: number; actualizadaEn: Date }> {
    await this.assertHabilitada(organizacionId);
    await this.assertClienteAccesible(organizacionId, clienteId, actorId, actorRol);

    const buffer = Buffer.from(imagenBase64, 'base64');
    // Solo JPEG (lo que produce la app): se verifica la firma real del archivo,
    // no un mimeType declarado por el cliente.
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new BadRequestError('La foto debe ser una imagen JPEG.');
    }
    if (buffer.length > MAX_BYTES_FOTO_CEDULA) {
      throw new BadRequestError(
        `La foto pesa ${Math.round(buffer.length / 1024)} KB; el máximo es ${MAX_BYTES_FOTO_CEDULA / 1024} KB.`
      );
    }

    const anterior = await prisma.fotoCedulaCliente.findUnique({
      where: { clienteId },
      select: { bytes: true },
    });

    const foto = await prisma.$transaction(async (tx) => {
      const guardada = await tx.fotoCedulaCliente.upsert({
        where: { clienteId },
        create: {
          clienteId,
          organizacionId,
          imagenBase64,
          mimeType: 'image/jpeg',
          bytes: buffer.length,
          subidaPor: actorId,
        },
        update: { imagenBase64, bytes: buffer.length, subidaPor: actorId },
      });
      // Sin la imagen en la bitácora: solo quién, cuándo y cuánto pesa.
      await tx.auditoria.create({
        data: {
          usuarioId: actorId,
          accion: anterior ? 'UPDATE' : 'CREATE',
          tabla: 'foto_cedula_cliente',
          registroId: clienteId,
          valoresAnteriores: anterior ? { bytes: anterior.bytes } : undefined,
          valoresNuevos: { bytes: buffer.length },
        },
      });
      return guardada;
    });

    return { bytes: foto.bytes, actualizadaEn: foto.updatedAt };
  }

  async eliminar(organizacionId: string, clienteId: string, actorId: string, actorRol: string): Promise<void> {
    // Borrar no exige que la función siga habilitada: si la plataforma la
    // apaga, la empresa debe poder seguir quitando fotos ya guardadas.
    await this.assertClienteAccesible(organizacionId, clienteId, actorId, actorRol);

    const foto = await prisma.fotoCedulaCliente.findFirst({
      where: { clienteId, organizacionId },
      select: { bytes: true },
    });
    if (!foto) {
      throw new NotFoundError('Este cliente no tiene foto de cédula.');
    }

    await prisma.$transaction([
      prisma.fotoCedulaCliente.delete({ where: { clienteId } }),
      prisma.auditoria.create({
        data: {
          usuarioId: actorId,
          accion: 'DELETE',
          tabla: 'foto_cedula_cliente',
          registroId: clienteId,
          valoresAnteriores: { bytes: foto.bytes },
        },
      }),
    ]);
  }
}
