/**
 * Páginas legales públicas. Las sirve el panel Next.js, no esta API.
 *
 * Esta API solo las redirige, y ese redirect no es opcional: la app móvil
 * enviaba a los usuarios a `https://<api>/privacidad`, que nunca fue una ruta
 * de la API y respondía "Cannot GET /privacidad". Aunque la app ya apunta al
 * panel, la URL vieja quedó horneada en las versiones ya instaladas (y
 * posiblemente en la ficha de Google Play, que exige una política de
 * privacidad accesible), y esas no se pueden cambiar retroactivamente.
 */
export const PAGINAS_LEGALES = ['/privacidad', '/terminos', '/eliminar-cuenta'] as const;

export type PaginaLegal = (typeof PAGINAS_LEGALES)[number];

/**
 * Arma la URL de la página legal en el panel.
 *
 * Normaliza la barra final de la base: `PANEL_WEB_URL` se configura a mano en
 * el entorno de despliegue y un `https://panel.com/` de más produciría
 * `https://panel.com//privacidad` — que algunos proxys sirven y otros
 * rechazan, justo en la página que no puede fallar.
 */
export function urlPaginaLegal(panelWebUrl: string, ruta: string): string {
  return `${panelWebUrl.replace(/\/+$/, '')}${ruta}`;
}
