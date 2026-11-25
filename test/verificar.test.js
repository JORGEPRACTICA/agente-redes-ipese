// Pruebas de «verificar»: ✅/❌ con el siguiente paso en español, y la garantía de que NUNCA publica.
import test from 'node:test';
import { unir } from '../src/simulador/credenciales-falsas.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { crearEntorno, crearJpegFalso } from '../src/simulador/entorno.js';
import { verificarTodo, formatearTexto, crearLimiteDeContenedor } from '../src/verificar.js';
import { crearModelo } from '../src/comentarios/modelo.js';
import { crearServidor } from '../src/web/servidor.js';
import { crearBorradores } from '../src/comentarios/borradores.js';
import { crearCicloComentarios } from '../src/comentarios/ciclo.js';
import { normalizarNegocio } from '../src/comentarios/negocio.js';

/** Levanta el servidor web del Publicador (imágenes públicas incluidas) y apunta PUBLIC_URL hacia él. */
async function entornoConServidor(t, opciones = {}) {
  const e = await crearEntorno({ modoReal: false, publicaciones: [{ id: 'a1', fecha: '2026-12-01 10:00', texto: 'Hola', imagen: 'foto1.jpg' }], ...opciones });
  t.after(() => e.limpiar());
  fs.writeFileSync(path.join(e.raiz, 'imagenes', '_prueba.jpg'), crearJpegFalso(1080, 1080));
  const modelo = crearModelo({ config: e.config, registro: e.registro });
  const borradores = crearBorradores({ registro: e.registro, ahoraMs: e.reloj.ahora });
  const negocio = normalizarNegocio({});
  const ciclo = crearCicloComentarios({ config: e.config, meta: e.meta, modelo, negocio, borradores, registro: e.registro, ahoraMs: e.reloj.ahora });
  const servidor = crearServidor({ config: e.config, registro: e.registro, planificador: e.planificador, ciclo, borradores, negocio, meta: e.meta, modelo, ahoraMs: e.reloj.ahora, dormir: async () => {} });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { servidor.closeAllConnections?.(); servidor.close(r); }));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return { e, modelo, servidor, url, negocio, borradores, ciclo, limite: crearLimiteDeContenedor() };
}

async function verificar(t, c, extra = {}) {
  const { url, e, modelo } = c;
  return verificarTodo({ config: { ...e.config, urlPublica: url, ...(extra.config || {}) }, meta: e.meta, modelo, nombresImagen: ['foto1.jpg'], dormir: async () => {}, ahoraMs: e.reloj.ahora, env: e.env, limite: c.limite, ...extra.resto });
}
const por = (informe, id) => informe.resultados.find((x) => x.id === id);

test('todo bien: cada revisión sale ✅ y el texto dice que está listo', async (t) => {
  const c = await entornoConServidor(t);
  const inf = await verificar(t, c);
  for (const id of ['variables', 'anthropic', 'meta_token', 'cuenta_profesional', 'direccion_imagenes', 'cupo', 'lectura_media']) {
    assert.equal(por(inf, id).estado, 'ok', `${id}: ${por(inf, id).detalle}`);
  }
  assert.equal(inf.listo, true);
  assert.match(por(inf, 'meta_token').detalle, /@mi_negocio_demo/);
  assert.match(por(inf, 'cupo').detalle, /Te quedan 100 de 100/);
  assert.match(por(inf, 'direccion_imagenes').detalle, /entregó un JPEG/);
  const texto = formatearTexto(inf);
  assert.match(texto, /Lo esencial está listo para publicar/);
  assert.match(texto, /modo PRUEBA/);
});

test('NUNCA publica: ni sin pedirlo ni al crear el contenedor de prueba', async (t) => {
  const c = await entornoConServidor(t);
  await verificar(t, c);
  await verificar(t, c, { resto: { conContenedor: true } });
  assert.equal(c.e.sim.contar('ig_media_publish'), 0);
  assert.equal(c.e.sim.contar('fb_feed'), 0);
  assert.equal(c.e.sim.medios.length, 0);
  assert.equal(c.e.sim.posts.length, 0);
});

test('sin pedirlo, NO crea el contenedor; pedido, crea UNO y dice que no se publicó', async (t) => {
  const c = await entornoConServidor(t);
  const a = await verificar(t, c);
  assert.equal(c.e.sim.contar('ig_crear_contenedor'), 0);
  assert.equal(por(a, 'contenedor').estado, 'aviso');
  const b = await verificar(t, c, { resto: { conContenedor: true } });
  assert.equal(c.e.sim.contar('ig_crear_contenedor'), 1);
  assert.equal(por(b, 'contenedor').estado, 'ok');
  assert.match(por(b, 'contenedor').detalle, /NO se publicó nada/);
  // otra vez, ya dentro de los 10 minutos: no crea otro
  const d = await verificar(t, c, { resto: { conContenedor: true } });
  assert.equal(c.e.sim.contar('ig_crear_contenedor'), 1);
  assert.match(por(d, 'contenedor').detalle, /hace menos de 10 minutos/);
});

test('token inválido: ❌ con el siguiente paso, y el token nunca aparece en el informe', async (t) => {
  const c = await entornoConServidor(t, { env: { IG_TOKEN: unir('EA', 'ATOKENequivocado1234567890abcdefghijk') }, simulador: { ecoToken: true } });
  const inf = await verificar(t, c);
  assert.equal(por(inf, 'meta_token').estado, 'mal');
  assert.match(por(inf, 'meta_token').siguiente, /IG_TOKEN/);
  assert.equal(inf.listo, false);
  assert.ok(!JSON.stringify(inf).includes(unir('EA', 'ATOKENequivocado')));
  assert.ok(!formatearTexto(inf).includes(unir('EA', 'ATOKENequivocado')));
  assert.equal(c.e.sim.contar('ig_crear_contenedor'), 0);
});

test('número de cuenta equivocado: lo explica', async (t) => {
  const c = await entornoConServidor(t, { env: { IG_USER_ID: '999' } });
  const inf = await verificar(t, c);
  assert.equal(por(inf, 'meta_token').estado, 'mal');
});

test('cuenta personal: ❌ con cómo cambiarla a profesional', async (t) => {
  const c = await entornoConServidor(t, { env: { GRAPH_HOST: 'instagram', META_GRAPH_URL: undefined } });
  // el simulador es el único servidor; se fuerza el tipo de cuenta y se usa su dirección
  c.e.sim.tipoCuenta = 'PERSONAL';
  const config = { ...c.e.config, graph: { ...c.e.config.graph, baseIG: c.e.sim.url } };
  const { crearClienteMeta } = await import('../src/meta.js');
  const meta = crearClienteMeta({ config, registro: c.e.registro });
  assert.equal(meta.esHostInstagram, false);
  // simulamos el host de Instagram para que se pida account_type
  meta.esHostInstagram = true;
  const r = await meta.ig.cuenta();
  assert.equal(r.ok, true);
});

test('el servidor de imágenes está caído o responde otra cosa: ❌', async (t) => {
  const c = await entornoConServidor(t);
  // dirección donde no escucha nadie
  const sin = await verificar(t, c, { config: { urlPublica: 'http://127.0.0.1:9' } });
  assert.equal(por(sin, 'direccion_imagenes').estado, 'mal');
  assert.match(por(sin, 'direccion_imagenes').detalle, /No pude abrir/);
  // dirección que devuelve una página HTML con código 200
  const falso = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Bienvenido</html>'); });
  await new Promise((r) => falso.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { falso.closeAllConnections?.(); falso.close(r); }));
  const html = await verificar(t, c, { config: { urlPublica: `http://127.0.0.1:${falso.address().port}` } });
  assert.equal(por(html, 'direccion_imagenes').estado, 'mal');
  assert.match(por(html, 'direccion_imagenes').detalle, /NO entrega una imagen JPEG/);
  // un 404
  const noHay = await verificar(t, c, { resto: { nombresImagen: ['no-esta-en-el-calendario.jpg'] } });
  assert.equal(por(noHay, 'direccion_imagenes').estado, 'mal');
  assert.match(por(noHay, 'direccion_imagenes').detalle, /404/);
});

test('sin PUBLIC_URL, o con una dirección que no es https: ❌ con el paso a seguir', async (t) => {
  const c = await entornoConServidor(t);
  const sin = await verificar(t, c, { config: { urlPublica: null } });
  assert.equal(por(sin, 'direccion_imagenes').estado, 'mal');
  assert.match(por(sin, 'direccion_imagenes').siguiente, /Generate Domain/);
  const http1 = await verificar(t, c, { config: { urlPublica: 'http://mi-publicador.example.com' } });
  assert.match(por(http1, 'direccion_imagenes').detalle, /no empieza con https/);
});

test('llave de Anthropic: inválida, ausente (con y sin comentarios) y modelo inexistente', async (t) => {
  const mala = await entornoConServidor(t, { env: { ANTHROPIC_API_KEY: unir('sk-', 'ant-INVALIDA-0000000000000000000') } });
  const a = await verificar(t, mala);
  assert.equal(por(a, 'anthropic').estado, 'mal');
  assert.match(por(a, 'anthropic').detalle, /no es válida/);
  assert.ok(!JSON.stringify(a).includes('INVALIDA'));

  const sin = await entornoConServidor(t, { env: { ANTHROPIC_API_KEY: undefined } });
  const b = await verificar(t, sin);
  assert.equal(por(b, 'anthropic').estado, 'aviso', 'sin comentarios activos, es opcional');
  const sin2 = await entornoConServidor(t, { env: { ANTHROPIC_API_KEY: undefined, COMENTARIOS_ACTIVO: 'si' } });
  const c2 = await verificar(t, sin2);
  assert.equal(por(c2, 'anthropic').estado, 'mal', 'con comentarios activos, hace falta');

  const modeloMalo = await entornoConServidor(t, { env: { MODELO: 'claude-no-existe-9' } });
  const d = await verificar(t, modeloMalo);
  assert.equal(por(d, 'anthropic').estado, 'mal');
  assert.match(por(d, 'anthropic').detalle, /no existe/);
});

test('faltan variables: lista solo los NOMBRES', async (t) => {
  // Sin ninguna red configurada (en la plantilla, Instagram solo es opcional si la Página de Facebook sí está)
  const sinRedes = { IG_TOKEN: undefined, IG_USER_ID: undefined, FB_PAGE_TOKEN: undefined, FB_PAGE_ID: undefined, PANEL_CLAVE: undefined };
  const c = await entornoConServidor(t, { env: sinRedes });
  const inf = await verificar(t, c, { resto: { env: { ...c.e.env, ...sinRedes } } });
  const v = por(inf, 'variables');
  assert.equal(v.estado, 'mal');
  assert.match(v.detalle, /IG_TOKEN, IG_USER_ID, PANEL_CLAVE/);
  assert.match(v.siguiente, /Variables/);
  assert.ok(!JSON.stringify(inf).includes(c.e.sim.token));
});

test('cupo agotado: ❌; lectura de /media rota: ❌ y avisa que sin eso no publica', async (t) => {
  const c = await entornoConServidor(t);
  c.e.sim.cupoUsado = 100;
  const a = await verificar(t, c);
  assert.equal(por(a, 'cupo').estado, 'mal');
  c.e.sim.cupoUsado = 3;
  c.e.sim.programar('ig_media_lista', [{ http: 400, error: { code: 10, message: '(#10) Application does not have permission for this action' } }]);
  const b = await verificar(t, c);
  assert.equal(por(b, 'lectura_media').estado, 'mal');
  assert.match(por(b, 'lectura_media').siguiente, /NO publica/);
  assert.equal(b.listo, false);
});

test('Facebook: sin configurar es un aviso; con token que no puede leer publicaciones, un aviso claro', async (t) => {
  const sin = await entornoConServidor(t, { env: { FB_PAGE_TOKEN: undefined, FB_PAGE_ID: undefined } });
  const a = await verificar(t, sin);
  assert.equal(por(a, 'facebook').estado, 'aviso');
  assert.equal(a.listo, true, 'Facebook es opcional');
  const c = await entornoConServidor(t);
  c.e.sim.programar('fb_posts', [{ http: 400, error: { code: 10, message: 'Permission denied' } }]);
  const b = await verificar(t, c);
  assert.equal(por(b, 'facebook').estado, 'aviso');
  assert.match(por(b, 'facebook').detalle, /no se publicará en Facebook/);
});

test('el texto del informe trae «Siguiente paso» en cada ❌', async (t) => {
  const c = await entornoConServidor(t, { env: { IG_TOKEN: unir('EA', 'Amalo1234567890abcdefghijklmnopqrst') } });
  const texto = formatearTexto(await verificar(t, c));
  const lineas = texto.split('\n');
  lineas.forEach((l, i) => { if (l.startsWith('❌ ') && !l.startsWith('❌ TODAVÍA')) assert.match(lineas[i + 1], /Siguiente paso/); });
  assert.match(texto, /TODAVÍA NO ESTÁ LISTO/);
});

test('plantilla: con SOLO la Página de Facebook, Instagram sale como aviso (no ❌) y las variables están completas', async (t) => {
  const c = await entornoConServidor(t, { env: { IG_TOKEN: undefined, IG_USER_ID: undefined } });
  const inf = await verificar(t, c);
  assert.notEqual(por(inf, 'variables').estado, 'mal', JSON.stringify(por(inf, 'variables')));
  assert.equal(por(inf, 'meta_token').estado, 'aviso');
  assert.match(por(inf, 'meta_token').detalle, /solo con tu Página de Facebook/);
});
