import { describe, it, expect } from 'vitest';
import { PAGINAS_LEGALES, urlPaginaLegal } from '../paginas-legales.js';

describe('páginas legales (redirect de la API al panel)', () => {
  it('incluye la política de privacidad, que es la que exige Google Play', () => {
    expect(PAGINAS_LEGALES).toContain('/privacidad');
  });

  it('cubre también las páginas que la política enlaza, para no dejar enlaces muertos', () => {
    // /privacidad enlaza a /terminos y /eliminar-cuenta: si solo se redirigiera
    // la primera, sus enlaces internos seguirían cayendo en la API.
    expect(PAGINAS_LEGALES).toContain('/terminos');
    expect(PAGINAS_LEGALES).toContain('/eliminar-cuenta');
  });

  it('arma la URL del panel para cada página', () => {
    expect(urlPaginaLegal('https://panel.ejemplo.com', '/privacidad')).toBe(
      'https://panel.ejemplo.com/privacidad'
    );
  });

  it('normaliza la barra final de la base: una de más daría //privacidad', () => {
    expect(urlPaginaLegal('https://panel.ejemplo.com/', '/privacidad')).toBe(
      'https://panel.ejemplo.com/privacidad'
    );
    expect(urlPaginaLegal('https://panel.ejemplo.com///', '/terminos')).toBe(
      'https://panel.ejemplo.com/terminos'
    );
  });

  it('no produce ninguna URL con doble barra para ninguna página configurada', () => {
    for (const ruta of PAGINAS_LEGALES) {
      const url = urlPaginaLegal('https://panel.ejemplo.com/', ruta);
      expect(url.slice('https://'.length)).not.toContain('//');
    }
  });
});
