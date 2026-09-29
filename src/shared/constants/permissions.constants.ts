export interface PermisoDefinicion {
  id: string;
  label: string;
  descripcion: string;
}

export interface ModuloPermisos {
  id: string;
  titulo: string;
  descripcion: string;
  icono: string;
  permisos: PermisoDefinicion[];
}

export const MODULOS_PERMISOS: ModuloPermisos[] = [
  {
    id: 'clientes',
    titulo: 'Clientes',
    descripcion: 'Gestión de clientes y contactos',
    icono: 'people',
    permisos: [
      { id: 'clientes:ver', label: 'Ver clientes', descripcion: 'Consultar listado y fichas de clientes' },
      { id: 'clientes:crear', label: 'Crear clientes', descripcion: 'Registrar nuevos clientes en el sistema' },
      { id: 'clientes:editar', label: 'Editar clientes', descripcion: 'Modificar datos personales y de contacto' },
      { id: 'clientes:eliminar', label: 'Eliminar clientes', descripcion: 'Dar de baja o archivar clientes' },
    ],
  },
  {
    id: 'prestamos',
    titulo: 'Préstamos',
    descripcion: 'Desembolsos, solicitudes y condiciones',
    icono: 'document',
    permisos: [
      { id: 'prestamos:ver', label: 'Ver préstamos', descripcion: 'Consultar cartera y contratos de crédito' },
      { id: 'prestamos:crear', label: 'Crear préstamos', descripcion: 'Simular y desembolsar nuevos préstamos' },
      { id: 'prestamos:aprobar', label: 'Aprobar préstamos', descripcion: 'Autorizar solicitudes pendientes' },
      { id: 'prestamos:eliminar', label: 'Anular préstamos', descripcion: 'Cancelar o anular préstamos creados' },
    ],
  },
  {
    id: 'pagos',
    titulo: 'Cobros y Pagos',
    descripcion: 'Recaudación de cuotas y recibos',
    icono: 'card',
    permisos: [
      { id: 'pagos:crear', label: 'Registrar cobros', descripcion: 'Cobrar cuotas y emitir recibos' },
      { id: 'pagos:ver', label: 'Ver cobros', descripcion: 'Consultar historial de pagos realizados' },
      { id: 'pagos:eliminar', label: 'Anular pagos', descripcion: 'Eliminar o anular cobros ya registrados' },
    ],
  },
  {
    id: 'caja',
    titulo: 'Caja y Jornadas',
    descripcion: 'Aperturas, cierres y balance de efectivo',
    icono: 'cash',
    permisos: [
      { id: 'caja:gestionar', label: 'Control de caja', descripcion: 'Abrir y cerrar jornadas de trabajo' },
      { id: 'caja:movimientos', label: 'Movimientos de caja', descripcion: 'Registrar entradas y salidas manuales' },
    ],
  },
  {
    id: 'gastos',
    titulo: 'Gastos',
    descripcion: 'Egresos y gastos operativos',
    icono: 'wallet',
    permisos: [
      { id: 'gastos:crear', label: 'Registrar gastos', descripcion: 'Registrar egresos de ruta o generales' },
      { id: 'gastos:ver', label: 'Ver gastos', descripcion: 'Consultar listado de gastos realizados' },
      { id: 'gastos:eliminar', label: 'Anular gastos', descripcion: 'Eliminar o revertir gastos ingresados' },
    ],
  },
  {
    id: 'rutas',
    titulo: 'Rutas y Cobertura',
    descripcion: 'Ámbito operativo y asignación',
    icono: 'compass',
    permisos: [
      { id: 'rutas:multiruta', label: 'Acceso multiruta', descripcion: 'Ver y operar en todas las rutas (desactivado: solo su ruta)' },
      { id: 'rutas:gestionar', label: 'Administrar rutas', descripcion: 'Crear, editar o reasignar rutas' },
    ],
  },
  {
    id: 'reportes',
    titulo: 'Reportes y Métricas',
    descripcion: 'Finanzas, ganancias y estadísticas',
    icono: 'trending-up',
    permisos: [
      { id: 'reportes:ver', label: 'Ver reportes', descripcion: 'Acceso a balances, estadísticas y ganancias' },
    ],
  },
  {
    id: 'equipo',
    titulo: 'Equipo y Configuración',
    descripcion: 'Administración del negocio',
    icono: 'settings',
    permisos: [
      { id: 'equipo:gestionar', label: 'Gestionar equipo', descripcion: 'Invitar y configurar permisos de miembros' },
    ],
  },
];

/** Todos los identificadores de permisos válidos del sistema */
export const TODOS_LOS_PERMISOS: string[] = MODULOS_PERMISOS.flatMap((m) => m.permisos.map((p) => p.id));

/** Presets automáticos de permisos por rol para agilizar la asignación */
export const ROL_PRESETS: Record<string, string[]> = {
  COBRADOR: [
    'clientes:ver',
    'clientes:crear',
    'clientes:editar',
    'prestamos:ver',
    'prestamos:crear',
    'pagos:crear',
    'pagos:ver',
    'caja:gestionar',
    'gastos:crear',
    'gastos:ver',
  ],
  CAJERO: [
    'clientes:ver',
    'prestamos:ver',
    'pagos:crear',
    'pagos:ver',
    'caja:gestionar',
    'caja:movimientos',
    'gastos:crear',
    'gastos:ver',
  ],
  GERENTE: [
    'clientes:ver',
    'clientes:crear',
    'clientes:editar',
    'prestamos:ver',
    'prestamos:crear',
    'prestamos:aprobar',
    'pagos:crear',
    'pagos:ver',
    'pagos:eliminar',
    'caja:gestionar',
    'caja:movimientos',
    'gastos:crear',
    'gastos:ver',
    'gastos:eliminar',
    'reportes:ver',
  ],
  ADMIN: TODOS_LOS_PERMISOS,
  SUPER_ADMIN: TODOS_LOS_PERMISOS,
};

/** Obtiene los permisos por defecto si el usuario no tiene permisos explícitos */
export function resolverPermisosUsuario(rol: string, permisos?: string[] | null): string[] {
  if (rol === 'ADMIN' || rol === 'SUPER_ADMIN') {
    return TODOS_LOS_PERMISOS;
  }
  if (permisos && permisos.length > 0) {
    return permisos;
  }
  return ROL_PRESETS[rol] || [];
}
