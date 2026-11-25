// Pruebas del servidor web: páginas públicas, imágenes, contraseña, formularios y escape de HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { crearEntorno, crearJpegFalso } from '../src/simulador/entorno.js';
import { crearServidor } from '../src/web/servidor.js';
import { crearModelo } from '../src/comentarios/modelo.js';
import { crearBorradores } from '../src/comentarios/borradores.js';
import { crearCicloComentarios } from '../src/comentarios/ciclo.js';
import { normalizarNegocio } from '../src/comentarios/negocio.js';

const CLAVE = 'clave-de-prueba-muy-larga-2026';

function pedir(url, { metodo = 'GET', cuerpo, clave, encabezados = {} } = {}) {
  return new Promise((resolver, rechazar) => {
    const u = new URL(url);
    const cabeceras = { ...encabezados };
    if (clave !== undefined) cabeceras.Authorization = `Basic ${Buffer.from(`usuario:${clave}`).toString('base64')}`;
    if (cuerpo !== undefined) { cabeceras['Content-Type'] = 'application/x-www-form-urlencoded'; cabeceras['Content-Length'] = Buffer.byteLength(cuerpo); }
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: cabeceras }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => resolver({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos) }));
    });
    req.on('error', rechazar);
    if (cuerpo !== undefined) req.write(cuerpo);
    req.end();
  });
}
const texto = (r) => r.cuerpo.toString('utf8');
const form = (o) => new URLSearchParams(o).toString();

async function montar(t, opciones = {}) {
  const e = await crearEntorno({
    modoReal: false,
    publicaciones: [{ id: 'a1', fecha: '2026-12-01 10:00', texto: 'Hola <script>alert(1)</script> & "comillas"', imagen: 'foto1.jpg' }],
    ...opciones,
  });
  t.after(() => e.limpiar());
  fs.writeFileSync(path.join(e.raiz, 'imagenes', '_prueba.jpg'), crearJpegFalso(1080, 1080));
  fs.writeFileSync(path.join(e.raiz, 'imagenes', 'sin-calendario.jpg'), crearJpegFalso(1080, 1080));
  fs.writeFileSync(path.join(e.raiz, 'imagenes', 'falsa.jpg'), '<html>no soy una imagen</html>');
  fs.writeFileSync(path.join(e.raiz, '.env'), 'IG_TOKEN=secreto-que-no-debe-salir');
  const modelo = crearModelo({ config: e.config, registro: e.registro });
  const borradores = crearBorradores({ registro: e.registro, ahoraMs: e.reloj.ahora });
  const negocio = normalizarNegocio({ nombre: 'Casa Ejemplo' });
  const ciclo = crearCicloComentarios({ config: e.config, meta: e.meta, modelo, negocio, borradores, registro: e.registro, ahoraMs: e.reloj.ahora });
  let esperas = 0;
  const servidor = crearServidor({ config: e.config, registro: e.registro, planificador: e.planificador, ciclo, borradores, negocio, meta: e.meta, modelo, ahoraMs: e.reloj.ahora, dormir: async () => { esperas += 1; } });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { servidor.closeAllConnections?.(); servidor.close(r); }));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  e.config.urlPublica = url;
  return { e, url, borradores, ciclo, esperas: () => esperas };
}
const mismo = (url) => ({ 'Sec-Fetch-Site': 'same-origin', Origin: url });

test('/salud responde en texto corto, sin contraseña, también con HEAD', async (t) => {
  const { url } = await montar(t);
  const r = await pedir(`${url}/salud`);
  assert.equal(r.estado, 200);
  assert.match(r.cabeceras['content-type'], /text\/plain/);
  assert.equal(texto(r), 'Publicador en línea.\n');
  assert.equal((await pedir(`${url}/salud`, { metodo: 'HEAD' })).estado, 200);
  assert.match(texto(await pedir(`${url}/`)), /Publicador en línea/);
});

test('imágenes: se entregan solo las del calendario (y la de prueba), como JPEG', async (t) => {
  const { url } = await montar(t);
  const ok = await pedir(`${url}/imagenes/foto1.jpg`);
  assert.equal(ok.estado, 200);
  assert.equal(ok.cabeceras['content-type'], 'image/jpeg');
  assert.equal(ok.cuerpo[0], 0xff);
  assert.equal(ok.cuerpo[1], 0xd8);
  assert.equal((await pedir(`${url}/imagenes/_prueba.jpg`)).estado, 200);
  assert.equal((await pedir(`${url}/imagenes/foto1.jpg`, { metodo: 'HEAD' })).estado, 200);
  // existe en la carpeta pero NO está en el calendario
  assert.equal((await pedir(`${url}/imagenes/sin-calendario.jpg`)).estado, 404);
  // un .jpg que en realidad no es un JPEG
  assert.equal((await pedir(`${url}/imagenes/falsa.jpg`)).estado, 404);
});

test('imágenes: no se pueden pedir archivos fuera de la carpeta (ni .env)', async (t) => {
  const { url } = await montar(t);
  for (const ruta of [
    '/imagenes/..%2F.env', '/imagenes/%2e%2e%2f.env', '/imagenes/..%5C.env', '/imagenes/../.env', '/imagenes/sub/foto1.jpg',
    '/imagenes/foto1.jpg%00.png', '/imagenes/.env', '/imagenes/package.json', '/imagenes/', '/imagenes/%', '/.env', '/package.json',
    '/src/index.js', '/calendario.json', '/negocio.json',
  ]) {
    const r = await pedir(`${url}${ruta}`);
    assert.equal(r.estado, 404, ruta);
    assert.ok(!texto(r).includes('secreto-que-no-debe-salir'), ruta);
  }
});

test('el panel pide contraseña; con una equivocada espera un poco más y no entra', async (t) => {
  const { url, esperas } = await montar(t);
  for (const ruta of ['/estado', '/verificar', '/comentarios', '/comentarios/prueba']) {
    const sin = await pedir(`${url}${ruta}`);
    assert.equal(sin.estado, 401, ruta);
    assert.match(sin.cabeceras['www-authenticate'], /Basic/);
  }
  const mala = await pedir(`${url}/estado`, { clave: 'no-es-la-clave-buena' });
  assert.equal(mala.estado, 401);
  assert.ok(esperas() >= 1, 'la contraseña equivocada hace esperar');
  const buena = await pedir(`${url}/estado`, { clave: CLAVE });
  assert.equal(buena.estado, 200);
  assert.match(texto(buena), /Tu Publicador/);
});

test('sin PANEL_CLAVE o con una muy corta, el panel está apagado (y lo explica)', async (t) => {
  const a = await montar(t, { env: { PANEL_CLAVE: undefined } });
  const r1 = await pedir(`${a.url}/estado`, { clave: 'cualquiera' });
  assert.equal(r1.estado, 503);
  assert.match(texto(r1), /PANEL_CLAVE/);
  const b = await montar(t, { env: { PANEL_CLAVE: 'corta123' } });
  const r2 = await pedir(`${b.url}/estado`, { clave: 'corta123' });
  assert.equal(r2.estado, 503);
  assert.match(texto(r2), /al menos 12 caracteres/);
});

test('el panel escapa todo lo que viene de fuera (sin código ejecutable) y trae sus cabeceras de seguridad', async (t) => {
  const { url } = await montar(t);
  const r = await pedir(`${url}/estado`, { clave: CLAVE });
  const html = texto(r);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(r.cabeceras['content-security-policy'], /default-src 'none'/);
  assert.equal(r.cabeceras['x-content-type-options'], 'nosniff');
  assert.equal(r.cabeceras['cache-control'], 'no-store');
});

test('el panel nunca muestra llaves, tokens ni la contraseña', async (t) => {
  const { e, url } = await montar(t);
  await e.planificador.tick();
  for (const ruta of ['/estado', '/verificar', '/comentarios', '/comentarios/prueba']) {
    const html = texto(await pedir(`${url}${ruta}`, { clave: CLAVE }));
    for (const secreto of [e.sim.token, e.sim.pageToken, e.sim.anthropicKey, CLAVE, 'secreto-que-no-debe-salir']) {
      assert.ok(!html.includes(secreto), `${ruta} muestra un secreto`);
    }
  }
});

test('los formularios (POST) solo se aceptan si vienen de esta misma página', async (t) => {
  const { e, url } = await montar(t);
  const cuerpo = form({ clave: 'a1|instagram' });
  const sinOrigen = await pedir(`${url}/estado/reintentar`, { metodo: 'POST', cuerpo, clave: CLAVE });
  assert.equal(sinOrigen.estado, 403);
  const ajeno = await pedir(`${url}/estado/reintentar`, { metodo: 'POST', cuerpo, clave: CLAVE, encabezados: { Origin: 'https://sitio-malo.example.com' } });
  assert.equal(ajeno.estado, 403);
  const crossSite = await pedir(`${url}/estado/reintentar`, { metodo: 'POST', cuerpo, clave: CLAVE, encabezados: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.estado, 403);
  const bueno = await pedir(`${url}/estado/reintentar`, { metodo: 'POST', cuerpo, clave: CLAVE, encabezados: mismo(url) });
  assert.equal(bueno.estado, 303);
  assert.equal(bueno.cabeceras.location, '/estado');
  assert.equal(e.sim.llamadas.length, 0);
});

test('/verificar: GET revisa sin crear nada; POST prueba también el contenedor, sin publicar', async (t) => {
  const { e, url } = await montar(t);
  const a = await pedir(`${url}/verificar`, { clave: CLAVE });
  assert.equal(a.estado, 200);
  assert.match(texto(a), /Verificación/);
  assert.match(texto(a), /Siguiente paso|Lo esencial está listo/);
  assert.equal(e.sim.contar('ig_crear_contenedor'), 0);
  const b = await pedir(`${url}/verificar`, { metodo: 'POST', cuerpo: '', clave: CLAVE, encabezados: { ...mismo(url), 'Content-Length': '0' } });
  assert.equal(b.estado, 200);
  assert.equal(e.sim.contar('ig_crear_contenedor'), 1);
  assert.equal(e.sim.contar('ig_media_publish'), 0);
  assert.match(texto(b), /NO se publicó nada/);
});

test('ninguna página del panel muestra «undefined», «NaN», «null» ni «[object Object]» (ni en modo prueba ni en modo real)', async (t) => {
  for (const modoReal of [false, true]) {
    const { e, url, ciclo } = await montar(t, { modoReal, env: { COMENTARIOS_ACTIVO: 'si' } });
    const medio = e.sim.agregarMedio({ caption: 'Una publicación de ejemplo', hace: 3600000 });
    e.sim.agregarComentarioIG(medio.id, { texto: 'Qué bonito', usuario: 'ana_demo' });
    e.sim.agregarComentarioIG(medio.id, { texto: 'Pésimo servicio, nunca me contestaron', usuario: 'luis_demo' });
    await e.planificador.tick();
    await ciclo.tick();
    const paginas = [];
    for (const ruta of ['/estado', '/verificar', '/comentarios', '/comentarios/prueba']) {
      const r = await pedir(`${url}${ruta}`, { clave: CLAVE });
      assert.equal(r.estado, 200, ruta);
      paginas.push([`GET ${ruta}`, texto(r)]);
    }
    const prueba = await pedir(`${url}/comentarios/prueba`, { metodo: 'POST', cuerpo: '', clave: CLAVE, encabezados: { ...mismo(url), 'Content-Length': '0' } });
    paginas.push(['POST /comentarios/prueba', texto(prueba)]);
    const contenedor = await pedir(`${url}/verificar`, { metodo: 'POST', cuerpo: '', clave: CLAVE, encabezados: { ...mismo(url), 'Content-Length': '0' } });
    paginas.push(['POST /verificar', texto(contenedor)]);
    for (const [nombre, html] of paginas) {
      const visible = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
      assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b|\[object /.test(visible), `${nombre} (modo ${modoReal ? 'real' : 'prueba'}) muestra un valor sin resolver`);
    }
  }
});

test('/estado muestra el modo prueba, el calendario y el registro', async (t) => {
  const { e, url } = await montar(t);
  await e.planificador.tick();
  const html = texto(await pedir(`${url}/estado`, { clave: CLAVE }));
  assert.match(html, /MODO PRUEBA/);
  assert.match(html, /Ensayada \(modo prueba\)/);
  assert.match(html, /\[PRUEBA\] Instagram/);
});

test('comentarios por el panel: aprobar envía una vez; rechazar no contesta; el texto del comentario se escapa', async (t) => {
  const e0 = await montar(t, { modoReal: true, env: { COMENTARIOS_ACTIVO: 'si' } });
  const { e, url, ciclo, borradores } = e0;
  e.sim.anthropic.responder = () => JSON.stringify({ tipo: 'normal', respuesta: '¡Gracias! 😊' });
  const m = e.sim.agregarMedio({ caption: 'Hola', hace: 3600000 });
  const c1 = e.sim.agregarComentarioIG(m.id, { texto: 'Qué bonito <b>negrita</b> <img src=x onerror=alert(1)>', usuario: 'ana_demo' });
  const c2 = e.sim.agregarComentarioIG(m.id, { texto: 'Me encanta mucho todo', usuario: 'luis_demo' });
  await ciclo.tick();
  const pagina = texto(await pedir(`${url}/comentarios`, { clave: CLAVE }));
  assert.ok(!pagina.includes('<img src=x'));
  assert.ok(!pagina.includes('<b>negrita</b>'));
  assert.match(pagina, /Aprobar y enviar/);

  const aprobar = await pedir(`${url}/comentarios/accion`, { metodo: 'POST', clave: CLAVE, encabezados: mismo(url), cuerpo: form({ id: `ig:${c1.id}`, accion: 'aprobar', texto: '¡Gracias por tu cariño! 😊' }) });
  assert.equal(aprobar.estado, 200);
  assert.match(texto(aprobar), /Listo: la respuesta salió/);
  assert.equal(c1.respuestas.length, 1);
  assert.equal(c1.respuestas[0].text, '¡Gracias por tu cariño! 😊');
  const otraVez = await pedir(`${url}/comentarios/accion`, { metodo: 'POST', clave: CLAVE, encabezados: mismo(url), cuerpo: form({ id: `ig:${c1.id}`, accion: 'aprobar', texto: 'x' }) });
  assert.match(texto(otraVez), /ya se envió/);
  assert.equal(c1.respuestas.length, 1);

  const rechazar = await pedir(`${url}/comentarios/accion`, { metodo: 'POST', clave: CLAVE, encabezados: mismo(url), cuerpo: form({ id: `ig:${c2.id}`, accion: 'rechazar' }) });
  assert.match(texto(rechazar), /no se contestará/);
  assert.equal(c2.respuestas.length, 0);
  assert.equal(borradores.obtener(`ig:${c2.id}`).estado, 'rechazado');
});

test('/comentarios/prueba corre los 10 comentarios de ejemplo (con la llave del servidor) y muestra 10 de 10', async (t) => {
  const { e, url } = await montar(t);
  e.sim.anthropic.responder = (cuerpo) => {
    const tipo = (cuerpo.system.match(/Tipo mínimo detectado por las reglas para este comentario: (\w+)/) || [])[1] || 'normal';
    return JSON.stringify({ tipo, respuesta: tipo === 'luto' ? 'Nuestras condolencias. 🕊️' : (tipo === 'queja' ? 'Lamentamos lo ocurrido, ¿nos escribes por mensaje privado?' : '¡Gracias por tu comentario! 😊') });
  };
  const primero = await pedir(`${url}/comentarios/prueba`, { clave: CLAVE });
  assert.match(texto(primero), /Correr las 10 pruebas/);
  assert.equal(e.sim.anthropic.llamadas.length, 0, 'abrir la página no gasta llamadas al modelo');
  const r = await pedir(`${url}/comentarios/prueba`, { metodo: 'POST', cuerpo: '', clave: CLAVE, encabezados: { ...mismo(url), 'Content-Length': '0' } });
  assert.equal(r.estado, 200);
  assert.match(texto(r), /10 de 10 salieron como se esperaba/);
});

test('rutas que no existen: 404 sin datos', async (t) => {
  const { url } = await montar(t);
  assert.equal((await pedir(`${url}/no-existe`)).estado, 404);
  assert.equal((await pedir(`${url}/estado/otra`, { clave: CLAVE })).estado, 404);
  assert.equal((await pedir(`${url}/estado`, { metodo: 'DELETE', clave: CLAVE, encabezados: mismo(url) })).estado, 404);
});
