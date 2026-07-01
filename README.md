# Suite API

API backend modular para la gestión de préstamos, diseñada bajo principios **Offline First**, limpia y mantenible con separación de responsabilidades en 3 capas (Controller, Service, Repository).

## Tecnologías Principales

- **Express** - Servidor web minimalista y robusto
- **TypeScript** - Tipado estático y robustez de código
- **Prisma ORM** - Modelado e interacción con PostgreSQL
- **Zod** - Validación estricta de esquemas (Request Body, Params, Query)
- **Biome** - Linter y formateador ultrarrápido
- **Pino** - Logging de alto rendimiento con formato bonito en desarrollo

---

## Estructura de Capas por Módulo

Cada módulo sigue el siguiente flujo de responsabilidades:
1. **Routes**: Define los endpoints e integra validación con Zod y autenticación JWT.
2. **Controller**: Maneja peticiones HTTP y formatea respuestas normalizadas.
3. **Service**: Contiene la lógica de negocio y reglas de dominio.
4. **Repository**: Única capa de comunicación con la base de datos a través de Prisma.

---

## Primeros Pasos

### Requisitos

- Node.js (v22 o superior)
- Docker y Docker Compose (para levantar la base de datos PostgreSQL local)

### 1. Instalación de Dependencias

Ejecuta el siguiente comando en la raíz del proyecto para instalar las dependencias:

```bash
npm install
```

### 2. Levantar la Base de Datos con Docker

Ejecuta Docker Compose para levantar el contenedor de PostgreSQL y Adminer:

```bash
docker compose up -d
```

- **PostgreSQL**: puerto `5432`
- **Adminer (gestor web)**: [http://localhost:8080](http://localhost:8080)

### 3. Configuración de Variables de Entorno

El archivo `.env` ya se encuentra configurado por defecto para apuntar al PostgreSQL de Docker y definir claves secretas JWT de prueba. Si deseas cambiarlas, edita el archivo `.env`.

### 4. Generar el Cliente de Prisma y Migrar

Ejecuta las migraciones iniciales para crear la estructura de las tablas en PostgreSQL y realizar la siembra (seed) de roles y el usuario administrador inicial:

```bash
# Genera el cliente de Prisma
npx prisma generate

# Aplica las migraciones (esto creará la base de datos si no existe)
npx prisma migrate dev --name init
```

### 5. Iniciar en Modo Desarrollo

Inicia el servidor en modo desarrollo con recarga automática:

```bash
npm run dev
```

El servidor estará corriendo en: [http://localhost:3000](http://localhost:3000)
La documentación Swagger interactiva estará en: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

---

## Credenciales por Defecto del Seed

- **Usuario**: `admin@suite.com`
- **Contraseña**: `AdminPassword123!`
