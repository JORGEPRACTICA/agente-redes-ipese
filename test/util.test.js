// Pruebas de las utilidades pequeñas que no tienen un archivo de pruebas propio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unirFrases } from '../src/util.js';

test('unirFrases cierra cada frase con su punto, las separa con un espacio y omite las vacías', () => {
  assert.equal(unirFrases('Primera frase', 'Segunda frase.'), 'Primera frase. Segunda frase.');
  assert.equal(unirFrases('¿Ya salió?', 'Mira tu cuenta'), '¿Ya salió? Mira tu cuenta.');
  assert.equal(unirFrases('Lo ve (así)', '  ', null, undefined, 'Listo!'), 'Lo ve (así). Listo!');
  assert.equal(unirFrases('Termina con puntos suspensivos…', 'Sigue'), 'Termina con puntos suspensivos… Sigue.');
  assert.equal(unirFrases('Dijo «sí.»', 'Fin'), 'Dijo «sí.» Fin.');
  assert.equal(unirFrases('Una sola'), 'Una sola.');
  assert.equal(unirFrases(), '');
  assert.equal(unirFrases(null, ''), '');
});
