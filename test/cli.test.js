// Los comandos que ve el alumno (npm run ensayo, validar, verificar y comentarios:prueba) se corren de verdad,
// como los corre él, y se revisa que cuenten bien lo que pasó: nada de «undefined», «NaN» ni «[object Object]».
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Un entorno casi vacío: sin llaves, sin variables del Publicador (el alumno aún no las tiene en su computadora).
const ENTORNO_LIMPIO = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };

function correr(script, env = {}) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'src', 'cli', script)], {
    cwd: RAIZ, env: { ...ENTORNO_LIMPIO, ...env }, encoding: 'utf8', timeout: 90000,
  });
  return { codigo: r.status, salida: `${r.stdout || ''}${r.stderr || ''}` };
}

function sinValoresSinResolver(salida) {
  assert.ok(!/undefined|NaN|\[object /i.test(salida), `la salida trae un valor sin resolver:\n${salida}`);
}

test('npm run ensayo: termina bien, cuenta cada paso con números reales y no toca tus redes', () => {
  const r = correr('ensayo.js');
  assert.equal(r.codigo, 0, r.salida);
  sinValoresSinResolver(r.salida);
  assert.match(r.salida, /El ensayo salió como se esperaba/);
  assert.match(r.salida, /10 de 10 salieron como se esperaba/);
  assert.match(r.salida, /NO duplica/);
  assert.match(r.salida, /antes (\d+) publicaciones, ahora \1\./, 'tras perder la memoria, no hay publicaciones nuevas');
  const largo = r.salida.match(/Texto largo: en Facebook salió completo \((\d+) caracteres\); en Instagram quedó en (\d+) /);
  assert.ok(largo, 'el ensayo cuenta el texto largo');
  assert.ok(Number(largo[1]) > 2200 && Number(largo[2]) <= 2200);
  assert.match(r.salida, /Tus redes no se tocaron/);
});

test('npm run validar: revisa el calendario del kit y dice que está bien', () => {
  const r = correr('validar.js');
  assert.equal(r.codigo, 0, r.salida);
  sinValoresSinResolver(r.salida);
  assert.match(r.salida, /El calendario está bien/);
  assert.match(r.salida, /ejemplo-1\.jpg/);
});

test('npm run verificar en tu computadora (sin llaves): no se cae y manda a la página /verificar de Railway', () => {
  const r = correr('verificar.js');
  assert.equal(r.codigo, 0, r.salida);
  sinValoresSinResolver(r.salida);
  assert.match(r.salida, /tus llaves viven solo en Railway/);
  assert.match(r.salida, /\/verificar/);
  assert.match(r.salida, /PANEL_CLAVE/);
  assert.ok(!/at .*\.js:\d+/.test(r.salida), `no debe mostrar un error técnico:\n${r.salida}`);
});

test('npm run comentarios:prueba: corre los 10 comentarios de ejemplo sin llave (con las reglas fijas)', () => {
  const r = correr('comentarios-prueba.js');
  assert.equal(r.codigo, 0, r.salida);
  sinValoresSinResolver(r.salida);
  assert.match(r.salida, /10 de 10/);
});
