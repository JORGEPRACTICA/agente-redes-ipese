// El token NUNCA aparece en un mensaje, un registro, un archivo ni una página. Pruebas adversarias:
// la Meta simulada devuelve el token DENTRO de sus mensajes de error y las llamadas fallan de todas las formas posibles.
import test from 'node:test';
import { unir } from '../src/simulador/credenciales-falsas.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crearEntorno, crearJpegFalso } from '../src/simulador/entorno.js';
import { iniciarSimulador } from '../src/simulador/meta-simulada.js';
import { verificarTodo, formatearTexto } from '../src/verificar.js';
import { crearModelo } from '../src/comentarios/modelo.js';
import { formatoFecha } from '../src/util.js';

const RAIZ_KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;

function leerTodo(dir) {
  const salida = [];
  (function recorrer(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) recorrer(p);
      else if (!/\.(jpg|jpeg)$/i.test(f.name)) salida.push(`${p}\n${fs.readFileSync(p, 'utf8')}`);
    }
  })(dir);
  return salida.join('\n');
}

test('con errores que devuelven el token dentro del mensaje, ninguna salida lo contiene', async (t) => {
  const e = await crearEntorno({
    modoReal: true,
    simulador: { ecoToken: true },
    publicaciones: [
      { id: 'a1', fecha: '2026-12-01 10:00', texto: 'Texto uno', imagen: 'foto1.jpg' },
      { id: 'a2', fecha: '2026-12-01 10:00', texto: 'Texto dos', imagen: 'foto2.jpg' },
      { id: 'a3', fecha: '2026-12-01 10:00', texto: 'Texto tres', imagen: 'foto3.jpg' },
    ],
    tiempos: { leer: 800, crear: 800, publicar: 800 },
  });
  t.after(() => e.limpiar());
  // 1) el token falla (el simulador lo repite en el mensaje); 2) respuestas que cuelgan; 3) errores 500; 4) un límite
  e.sim.programar('ig_media_lista', [
    { http: 400, error: { code: 190, message: `Invalid OAuth access token ${e.sim.token}` } },
    'colgar',
    { http: 500, error: { code: 2, message: `Boom access_token=${e.sim.token} fallo` } },
  ]);
  e.sim.programar('fb_posts', [{ http: 400, error: { code: 4, message: `Limit reached for ${e.sim.pageToken}` } }, 'ok', 'ok', 'ok']);
  for (let i = 0; i < 4; i += 1) {
    await e.planificador.tick();
    e.reloj.avanzar(130 * MIN);
  }
  const salidas = [
    e.texto(),
    JSON.stringify(e.planificador.filas()),
    JSON.stringify(e.estado.todos()),
    leerTodo(e.config.datosDir),
  ].join('\n');
  for (const secreto of [e.sim.token, e.sim.pageToken, e.sim.anthropicKey, e.env.PANEL_CLAVE]) {
    assert.ok(!salidas.includes(secreto), `apareció un secreto: ${secreto.slice(0, 12)}…`);
  }
  assert.match(salidas, /\[oculto\]|\[token\]/, 'el mensaje de error sí quedó, con el token oculto');
  // y el tráfico que sí necesita el token (hacia Meta) lo lleva en el cuerpo o en la dirección, nunca en el registro
  assert.ok(e.sim.llamadas.length > 5);
});

test('verificar y el modelo tampoco filtran llaves cuando todo falla', async (t) => {
  const e = await crearEntorno({ modoReal: false, simulador: { ecoToken: true }, env: { IG_TOKEN: unir('EA', 'Amalo-malo-malo-1234567890abcdefghij'), ANTHROPIC_API_KEY: unir('sk-', 'ant-mala-mala-mala-0000000000000') } });
  t.after(() => e.limpiar());
  const modelo = crearModelo({ config: e.config, registro: e.registro });
  const informe = await verificarTodo({ config: e.config, meta: e.meta, modelo, dormir: async () => {}, ahoraMs: e.reloj.ahora, env: e.env });
  const salida = `${JSON.stringify(informe)}\n${formatearTexto(informe)}\n${e.texto()}`;
  for (const secreto of [unir('EA', 'Amalo-malo-malo-1234567890abcdefghij'), unir('sk-', 'ant-mala-mala-mala-0000000000000'), e.env.PANEL_CLAVE]) {
    assert.ok(!salida.includes(secreto));
  }
});

test('el servicio completo (npm start) publica contra la Meta simulada y NO escribe ningún secreto en su salida', async (t) => {
  const zona = 'America/Mexico_City';
  const sim = await iniciarSimulador({ descargarImagenes: true, ecoToken: true });
  t.after(() => sim.detener());
  const puerto = await new Promise((resolver) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolver(p)); }); });

  const carpeta = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-e2e-'));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  fs.mkdirSync(path.join(carpeta, 'imagenes'));
  fs.writeFileSync(path.join(carpeta, 'imagenes', 'foto.jpg'), crearJpegFalso(1080, 1350));
  fs.writeFileSync(path.join(carpeta, 'imagenes', '_prueba.jpg'), crearJpegFalso(1080, 1080));
  // La publicación vence DENTRO de unos segundos (no antes de arrancar): un servicio sin memoria no publica sola lo que ya había vencido.
  const fecha = new Date(Date.now() + 3000).toISOString();
  fs.writeFileSync(path.join(carpeta, 'calendario.json'), JSON.stringify({ publicaciones: [{ id: 'e2e', fecha, texto: 'Publicación de la prueba completa', imagen: 'foto.jpg' }] }));

  const clave = 'clave-del-panel-prueba-e2e-123';
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    PUBLICADOR_CARPETA: carpeta, PORT: String(puerto), PUBLIC_URL: `http://127.0.0.1:${puerto}`,
    META_GRAPH_URL: sim.url, ANTHROPIC_URL: sim.url, ANTHROPIC_API_KEY: sim.anthropicKey,
    IG_TOKEN: sim.token, IG_USER_ID: sim.igUserId, FB_PAGE_TOKEN: sim.pageToken, FB_PAGE_ID: sim.pageId,
    PANEL_CLAVE: clave, PUBLICAR_DE_VERDAD: 'si', ARRANQUE_ESPERA_SEG: '0', REVISAR_CADA_SEG: '5', DATOS_DIR: path.join(carpeta, 'datos'),
  };
  const hijo = spawn(process.execPath, [path.join(RAIZ_KIT, 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  t.after(() => { try { hijo.kill(); } catch { /* ya terminó */ } });

  const esperarHasta = async (condicion, ms = 90000) => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) { if (condicion()) return true; await new Promise((r) => setTimeout(r, 150)); }
    return false;
  };
  // (el aviso de «Publicada» sale unos segundos después de la publicación: el Publicador revisa que no haya quedado repetida)
  assert.ok(await esperarHasta(() => sim.medios.length >= 1 && sim.posts.length >= 1 && /✅ Publicada en Instagram/.test(salida)), `no publicó a tiempo. Salida:\n${salida}`);

  // el servicio sigue vivo y contesta
  const salud = await fetch(`http://127.0.0.1:${puerto}/salud`);
  assert.equal(salud.status, 200);
  assert.equal(await salud.text(), 'Publicador en línea.\n');
  // Meta SIMULADA descargó la imagen del propio servicio (cadena completa: calendario -> URL pública -> JPEG)
  const contenedor = sim.llamadas.find((l) => l.clave === 'ig_crear_contenedor');
  assert.equal(contenedor.cuerpo.image_url, `http://127.0.0.1:${puerto}/imagenes/foto.jpg`);
  assert.equal(sim.medios.length, 1);
  assert.equal(sim.posts.length, 1);
  // el panel responde con la contraseña
  const panel = await fetch(`http://127.0.0.1:${puerto}/estado`, { headers: { Authorization: `Basic ${Buffer.from(`x:${clave}`).toString('base64')}` } });
  assert.equal(panel.status, 200);
  const html = await panel.text();
  assert.match(html, /MODO REAL/);
  assert.match(html, /Publicada/);

  // la salida del proceso cuenta lo que pasó y no trae ningún secreto
  assert.match(salida, /Publicador iniciado\. MODO REAL/);
  assert.match(salida, /✅ Publicada en Instagram/);
  for (const secreto of [sim.token, sim.pageToken, sim.anthropicKey, clave]) assert.ok(!salida.includes(secreto), 'un secreto salió en la bitácora');
  assert.ok(!html.includes(sim.token) && !html.includes(clave));

  // al apagarlo termina (en Windows no existe SIGTERM «amable»: basta con que termine)
  const termino = new Promise((r) => hijo.once('exit', (codigo, senal) => r({ codigo, senal })));
  hijo.kill('SIGTERM');
  const fin = await Promise.race([termino, new Promise((r) => setTimeout(() => r({ colgado: true }), 12000))]);
  assert.ok(!fin.colgado, 'el servicio no terminó al recibir SIGTERM');
  if (process.platform !== 'win32') assert.equal(fin.codigo, 0);
});

test('en modo prueba, el servicio completo arranca con los ejemplos del kit y NO llama a Meta', async (t) => {
  const sim = await iniciarSimulador();
  t.after(() => sim.detener());
  const puerto = await new Promise((resolver) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolver(p)); }); });
  const carpetaDatos = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-datos-'));
  t.after(() => fs.rmSync(carpetaDatos, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    PORT: String(puerto), META_GRAPH_URL: sim.url, IG_TOKEN: sim.token, IG_USER_ID: sim.igUserId,
    PANEL_CLAVE: 'clave-del-panel-prueba-e2e-123', ARRANQUE_ESPERA_SEG: '0', DATOS_DIR: carpetaDatos,
  };
  const hijo = spawn(process.execPath, [path.join(RAIZ_KIT, 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  t.after(() => { try { hijo.kill(); } catch { /* ya terminó */ } });
  const limite = Date.now() + 15000;
  // la tercera publicación de ejemplo es la larga: espera a que se haya ensayado completa
  while (Date.now() < limite && !/se acortó para Instagram/.test(salida)) await new Promise((r) => setTimeout(r, 150));
  assert.match(salida, /MODO PRUEBA: solo ensaya, NO publica nada/);
  assert.match(salida, /\[PRUEBA\] Instagram/);
  assert.match(salida, /se acortó para Instagram/);
  assert.equal(sim.llamadas.length, 0, 'en modo prueba no se llama a Meta');
  assert.ok(!salida.includes(sim.token));
});
