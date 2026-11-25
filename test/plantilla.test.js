// Pruebas de lo que agrega la PLANTILLA de Railway (IPESE): volumen, ficha de voz por variable,
// redactor que crece y renovación automática de la llave de Instagram. Sin internet y sin llaves reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unir } from '../src/simulador/credenciales-falsas.js';
import { leerConfig } from '../src/config.js';
import { cargarNegocio, leerNegocioDeVariable } from '../src/comentarios/negocio.js';
import { crearRegistro } from '../src/registro.js';
import { crearRenovadorIG, tokenEfectivoIG, huellaLlave, ARCHIVO_LLAVE, esRenovable } from '../src/renovacion-token.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIA = 24 * 3600 * 1000;
const LLAVE_IG = unir('IG', 'AA', 'FALSAdeInstagram1234567890abcdefghijklmnop');
const LLAVE_IG_NUEVA = unir('IG', 'AA', 'RENOVADA0987654321zyxwvutsrqponmlkjihg');
const LLAVE_FB = unir('EA', 'AFALSOpagina0987654321zyxwvutsrqponmlkjihgfedcba');

const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plantilla-'));

test('la carpeta de datos usa el volumen de Railway si no hay DATOS_DIR; DATOS_DIR manda', () => {
  const vol = carpetaTemporal();
  assert.equal(leerConfig({ RAILWAY_VOLUME_MOUNT_PATH: vol }).datosDir, path.resolve(vol));
  const propia = carpetaTemporal();
  assert.equal(leerConfig({ RAILWAY_VOLUME_MOUNT_PATH: vol, DATOS_DIR: propia }).datosDir, path.resolve(propia));
  assert.equal(leerConfig({}).datosDir, path.join(RAIZ, 'datos'));
});

test('la ficha de voz puede venir en NEGOCIO_JSON (JSON o base64) y, si está mal, se usa negocio.json con aviso', () => {
  const ficha = { nombre: 'Negocio de prueba (simulación)', giro: 'capacitación y talento' };
  const crudo = cargarNegocio(RAIZ, { NEGOCIO_JSON: JSON.stringify(ficha) });
  assert.equal(crudo.negocio.nombre, 'Negocio de prueba (simulación)');
  assert.deepEqual(crudo.avisos, []);
  const b64 = cargarNegocio(RAIZ, { NEGOCIO_JSON: Buffer.from(JSON.stringify(ficha)).toString('base64') });
  assert.equal(b64.negocio.nombre, 'Negocio de prueba (simulación)');
  const mala = cargarNegocio(RAIZ, { NEGOCIO_JSON: '{esto no es json' });
  assert.notEqual(mala.negocio.nombre, 'Negocio de prueba (simulación)');
  assert.ok(mala.avisos.some((a) => a.includes('NEGOCIO_JSON')));
  assert.equal(leerNegocioDeVariable('').crudo, null);
  assert.equal(leerNegocioDeVariable('[1,2]').crudo, null);
});

test('el registro oculta un secreto agregado después de arrancar', () => {
  const lineas = [];
  const registro = crearRegistro({ secretos: [LLAVE_IG], escribir: (l) => lineas.push(l) });
  registro.agregarSecreto(LLAVE_IG_NUEVA);
  registro.info(`viejo ${LLAVE_IG} nuevo ${LLAVE_IG_NUEVA}`);
  assert.ok(!lineas.join('\n').includes(LLAVE_IG));
  assert.ok(!lineas.join('\n').includes(LLAVE_IG_NUEVA));
});

function armar({ token = LLAVE_IG, datosDir = carpetaTemporal(), env = {} } = {}) {
  const config = leerConfig({ IG_TOKEN: token, IG_USER_ID: '17841400000000001', DATOS_DIR: datosDir, ...env });
  const lineas = [];
  const registro = crearRegistro({ secretos: config.secretos, escribir: (l) => lineas.push(l) });
  const cambios = [];
  const meta = { cambiarTokenIG: (t) => cambios.push(t) };
  return { config, registro, lineas, cambios, meta, datosDir };
}

function fetchFalso(respuestas) {
  const llamadas = [];
  const fn = async (url) => {
    llamadas.push(String(url));
    const r = respuestas.length ? respuestas.shift() : { http: 200, json: { access_token: LLAVE_IG_NUEVA, token_type: 'bearer', expires_in: 5184000 } };
    return { ok: r.http >= 200 && r.http < 300, status: r.http, json: async () => r.json };
  };
  fn.llamadas = llamadas;
  return fn;
}

test('renovación: solo aplica a llaves del inicio de sesión de Instagram', () => {
  const ig = armar();
  assert.equal(esRenovable(ig.config), true);
  const fb = armar({ token: LLAVE_FB });
  assert.equal(esRenovable(fb.config), false);
  const apagada = armar({ env: { RENOVAR_LLAVE_IG: 'no' } });
  assert.equal(crearRenovadorIG({ ...apagada, envToken: LLAVE_IG, fetchFn: fetchFalso([]) }).aplica, false);
});

test('renovación: renueva, guarda en el volumen, cambia la llave en caliente y nunca la escribe en el registro', async () => {
  let ahora = Date.UTC(2026, 11, 1);
  const a = armar();
  const fetchFn = fetchFalso([]);
  const ren = crearRenovadorIG({ ...a, envToken: LLAVE_IG, fetchFn, ahoraMs: () => ahora });
  assert.equal(ren.aplica, true);

  const r1 = await ren.tick();
  assert.equal(r1.hecho, true);
  assert.equal(fetchFn.llamadas.length, 1);
  assert.match(fetchFn.llamadas[0], /refresh_access_token\?grant_type=ig_refresh_token/);
  assert.deepEqual(a.cambios, [LLAVE_IG_NUEVA]);
  const guardada = JSON.parse(fs.readFileSync(path.join(a.datosDir, ARCHIVO_LLAVE), 'utf8'));
  assert.equal(guardada.token, LLAVE_IG_NUEVA);
  assert.equal(guardada.origen, huellaLlave(LLAVE_IG));
  assert.ok(!JSON.stringify(guardada).includes(LLAVE_IG), 'la llave original no se guarda, solo su huella');
  assert.ok(a.lineas.some((l) => l.includes('Renové la llave de Instagram')));
  assert.ok(!a.lineas.join('\n').includes(LLAVE_IG_NUEVA) && !a.lineas.join('\n').includes(LLAVE_IG));

  // A los 5 días no toca; a los 21 sí, y ya con la llave renovada.
  ahora += 5 * DIA;
  assert.equal((await ren.tick()).motivo, 'todavía no toca');
  ahora += 16 * DIA;
  assert.equal((await ren.tick()).hecho, true);
  assert.equal(fetchFn.llamadas.length, 2);
  assert.ok(fetchFn.llamadas[1].includes(encodeURIComponent(LLAVE_IG_NUEVA)) || fetchFn.llamadas[1].includes(LLAVE_IG_NUEVA));
});

test('renovación: al arrancar usa la guardada si viene de la misma llave; si pegaron otra en Railway, manda la nueva', async () => {
  const a = armar();
  await crearRenovadorIG({ ...a, envToken: LLAVE_IG, fetchFn: fetchFalso([]) }).tick();
  assert.equal(tokenEfectivoIG({ envToken: LLAVE_IG, datosDir: a.datosDir }).token, LLAVE_IG_NUEVA);
  const otra = unir('IG', 'AA', 'OTRAquePegaronEnRailway000000000000000');
  assert.equal(tokenEfectivoIG({ envToken: otra, datosDir: a.datosDir }).token, otra);
  assert.equal(tokenEfectivoIG({ envToken: LLAVE_IG, datosDir: carpetaTemporal() }).token, LLAVE_IG);
});

test('renovación: si Meta no deja (llave muy nueva o vencida) avisa sin la llave, no guarda nada y reintenta después', async () => {
  const a = armar();
  const fetchFn = fetchFalso([{ http: 400, json: { error: { message: `Invalid OAuth access token ${LLAVE_IG}`, code: 190 } } }]);
  const ren = crearRenovadorIG({ ...a, envToken: LLAVE_IG, fetchFn });
  const r = await ren.tick();
  assert.equal(r.hecho, false);
  assert.deepEqual(a.cambios, []);
  assert.ok(!fs.existsSync(path.join(a.datosDir, ARCHIVO_LLAVE)));
  assert.ok(a.lineas.some((l) => l.includes('todavía no se pudo renovar')));
  assert.ok(!a.lineas.join('\n').includes(LLAVE_IG), 'el mensaje de Meta pasa por el redactor');
  assert.equal((await ren.tick()).hecho, true, 'al siguiente intento sí renueva');
});

test('renovación: sin internet no truena y lo intenta después', async () => {
  const a = armar();
  const ren = crearRenovadorIG({ ...a, envToken: LLAVE_IG, fetchFn: async () => { throw new Error('sin red'); } });
  assert.equal((await ren.tick()).motivo, 'red');
  assert.ok(a.lineas.some((l) => l.includes('Lo intento de nuevo mañana')));
});

test('railway.json existe, es válido y revisa /salud', () => {
  const r = JSON.parse(fs.readFileSync(path.join(RAIZ, 'railway.json'), 'utf8'));
  assert.equal(r.deploy.healthcheckPath, '/salud');
  // Directo con node (no con npm): así la señal de apagado de Railway llega al servicio, se apaga limpio
  // y el despliegue anterior no aparece como «Crashed» en cada redespliegue.
  assert.equal(r.deploy.startCommand, 'node src/index.js');
});
