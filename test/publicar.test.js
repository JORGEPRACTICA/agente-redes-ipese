// Pruebas del planificador y de los publicadores contra la Meta SIMULADA. No se publica nada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearEntorno } from '../src/simulador/entorno.js';
import { crearEstado } from '../src/estado.js';

const MIN = 60000;
const pub = (extra = {}) => ({ id: 'a1', fecha: '2026-12-01 10:00', texto: 'Texto de prueba uno', imagen: 'foto1.jpg', ...extra });
const limite = (mensaje = 'Application request limit reached') => ({ http: 400, error: { code: 4, message: mensaje } });

async function entorno(t, opciones = {}) {
  const e = await crearEntorno({ modoReal: true, ...opciones });
  t.after(() => e.limpiar());
  return e;
}
const claves = (e) => e.sim.llamadas.map((l) => l.clave);

test('MODO PRUEBA por omisión: ensaya, anota y NO llama a Meta', async (t) => {
  const e = await entorno(t, { modoReal: false, publicaciones: [pub()] });
  assert.equal(e.config.modoReal, false);
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, 0, 'ninguna llamada a Meta en modo prueba');
  assert.match(e.texto(), /\[PRUEBA\] Instagram/);
  assert.match(e.texto(), /\[PRUEBA\] Facebook/);
  assert.match(e.texto(), /No se publicó nada/);
  assert.equal(e.estado.obtener('a1|instagram').estado, 'simulada');
  const lineasAntes = e.lineas.length;
  await e.planificador.tick();
  assert.equal(e.lineas.length, lineasAntes, 'no repite el ensayo en cada revisión');
});

test('PUBLICAR_DE_VERDAD solo se activa con «si»; cualquier otro valor deja el modo prueba y avisa', async (t) => {
  for (const valor of ['no', 'quizá', '0', '', 'siempre', 'true', '1', 'yes']) {
    const e = await crearEntorno({ env: { PUBLICAR_DE_VERDAD: valor } });
    t.after(() => e.limpiar());
    assert.equal(e.config.modoReal, false, `valor «${valor}»`);
    if (valor) assert.match(e.config.advertencias.join(' '), /PUBLICAR_DE_VERDAD/);
  }
  for (const valor of ['si', 'SI', 'Sí', ' si ', '"si"']) {
    const e = await crearEntorno({ env: { PUBLICAR_DE_VERDAD: valor } });
    t.after(() => e.limpiar());
    assert.equal(e.config.modoReal, true, `valor «${valor}»`);
  }
});

test('camino feliz: publica en Facebook y en Instagram, una sola vez', async (t) => {
  const e = await entorno(t, { publicaciones: [pub()] });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.equal(e.sim.posts.length, 1);
  assert.equal(e.sim.medios[0].caption, 'Texto de prueba uno');
  assert.equal(e.sim.posts[0].message, 'Texto de prueba uno');
  assert.equal(e.estado.obtener('a1|instagram').estado, 'publicada');
  assert.equal(e.estado.obtener('a1|facebook').estado, 'publicada');
  assert.match(e.texto(), /✅ Publicada en Instagram/);
  // orden: Facebook primero, Instagram al final; el candado se consulta ANTES de crear y otra vez ANTES de publicar
  const c = claves(e);
  assert.ok(c.indexOf('fb_feed') < c.indexOf('ig_crear_contenedor'));
  const i0 = c.indexOf('ig_media_lista');
  const iCrear = c.indexOf('ig_crear_contenedor');
  const iPublicar = c.indexOf('ig_media_publish');
  assert.ok(i0 >= 0 && i0 < iCrear, 'primero el candado');
  assert.ok(c.indexOf('ig_media_lista', iCrear) > iCrear && c.indexOf('ig_media_lista', iCrear) < iPublicar, 'segunda comprobación justo antes de publicar');
  // la imagen se pide por la dirección pública del servicio
  const contenedor = e.sim.llamadas.find((l) => l.clave === 'ig_crear_contenedor');
  assert.equal(contenedor.cuerpo.image_url, 'https://publicador.ejemplo.test/imagenes/foto1.jpg');
  // y una segunda revisión no vuelve a publicar nada
  const antes = e.sim.llamadas.length;
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, antes);
  assert.equal(e.sim.medios.length, 1);
});

test('texto largo: Instagram recibe 2,200 o menos; Facebook lo recibe completo', async (t) => {
  const secciones = Array.from({ length: 6 }, (_, i) => `📌 SECCIÓN ${i + 1}\n\n${'Contenido de la sección con bastante detalle. '.repeat(14)}`);
  const largo = ['Apertura.', ...secciones, 'Escríbenos.', 'Calle Ejemplo 1.', '#uno #dos #tres'].join('\n\n');
  assert.ok(largo.length > 2600);
  const e = await entorno(t, { publicaciones: [pub({ texto: largo })] });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.ok(e.sim.medios[0].caption.length <= 2200);
  assert.ok(e.sim.medios[0].caption.endsWith('#uno #dos #tres'));
  assert.equal(e.sim.posts[0].message, largo);
  assert.match(e.texto(), /texto adaptado de/);
});

test('más de 30 hashtags: Instagram publica con 30', async (t) => {
  const tags = Array.from({ length: 36 }, (_, i) => `#h${i + 1}`).join(' ');
  const e = await entorno(t, { publicaciones: [pub({ texto: `Hola\n\n${tags}`, redes: ['instagram'] })] });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.equal((e.sim.medios[0].caption.match(/#h\d+/g) || []).length, 30);
});

test('CANDADO: si el mismo texto ya está publicado, no se vuelve a publicar', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.agregarMedio({ caption: 'Texto de prueba uno', hace: 2 * MIN });
  await e.planificador.tick();
  assert.equal(e.sim.contar('ig_crear_contenedor'), 0);
  assert.equal(e.sim.contar('ig_media_publish'), 0);
  assert.equal(e.sim.medios.length, 1);
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'publicada');
  assert.equal(job.yaExistia, true);
  assert.match(e.texto(), /ya estaba publicado/);
});

test('CANDADO: compara por letras y números (Instagram quita el «@» y el selector de emoji)', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ texto: 'Gracias @mi_cuenta ❤️ por todo', redes: ['instagram'] })] });
  e.sim.agregarMedio({ caption: 'Gracias mi_cuenta ❤ por todo', hace: 1 * MIN });
  await e.planificador.tick();
  assert.equal(e.sim.contar('ig_crear_contenedor'), 0);
  assert.equal(e.estado.obtener('a1|instagram').yaExistia, true);
});

test('CANDADO: un post idéntico de ANTES de la hora programada no cuenta', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.agregarMedio({ caption: 'Texto de prueba uno', hace: 3 * 24 * 60 * MIN });   // hace 3 días
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 2, 'se publica la de hoy aunque exista una igual de hace días');
  assert.equal(e.estado.obtener('a1|instagram').yaExistia, false);
});

test('CANDADO: no adopta el post de OTRA publicación del calendario (mismo texto, otra imagen)', async (t) => {
  const e = await entorno(t, {
    publicaciones: [pub({ id: 'x1', imagen: 'foto1.jpg', redes: ['instagram'] }), pub({ id: 'x2', imagen: 'foto2.jpg', redes: ['instagram'] })],
  });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 2, 'las dos salen: son publicaciones distintas con el mismo texto');
  assert.notEqual(e.estado.obtener('x1|instagram').externalId, e.estado.obtener('x2|instagram').externalId);
});

test('CANDADO: si no se puede comprobar, NO publica a ciegas, ni en el primer intento', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_media_lista', [{ http: 500, error: { code: 2, message: 'Service temporarily unavailable' }}]);
  await e.planificador.tick();
  assert.equal(e.sim.contar('ig_crear_contenedor'), 0, 'no creó nada');
  assert.equal(e.sim.medios.length, 0);
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'pendiente');
  assert.equal(job.proximoIntentoMs - e.reloj.ahora(), 10 * MIN);
  assert.match(e.texto(), /No pude comprobar/);
  e.reloj.avanzar(10 * MIN);
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1, 'a los 10 minutos ya pudo comprobar y publicó');
});

test('CANDADO: si la lectura falla por el token (190), el error es definitivo y se explica', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_media_lista', [{ http: 400, error: { code: 190, message: 'Error validating access token: Session has expired' } }]);
  await e.planificador.tick();
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'error');
  assert.equal(job.intentos, 1);
  assert.match(job.queHacer, /IG_TOKEN/);
  assert.equal(e.sim.contar('ig_crear_contenedor'), 0);
});

test('error pasajero («Application request limit reached»): espera 10 minutos en vez de gastar los intentos', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_crear_contenedor', [limite()]);
  await e.planificador.tick();
  let job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'pendiente');
  assert.equal(job.intentos, 1);
  assert.equal(job.proximoIntentoMs - e.reloj.ahora(), 10 * MIN);
  assert.match(e.texto(), /Error al publicar/);
  assert.match(e.texto(), /Se reintenta en 10 minutos/);
  const llamadas = e.sim.llamadas.length;
  await e.planificador.tick();                       // sigue esperando: ninguna llamada nueva
  assert.equal(e.sim.llamadas.length, llamadas);
  e.reloj.avanzar(9 * MIN);
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, llamadas, 'a los 9 minutos todavía no');
  e.reloj.avanzar(1 * MIN);
  await e.planificador.tick();
  job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'publicada');
  assert.equal(job.intentos, 2);
  assert.equal(e.sim.medios.length, 1);
});

test('esperas de 10, 30, 60 y 120 minutos; al quinto intento queda en error y se puede reintentar a mano', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })], env: { TOLERANCIA_HORAS: '24' } });
  e.sim.programar('ig_crear_contenedor', [limite(), limite(), limite(), limite(), limite()]);
  const esperas = [];
  for (let intento = 1; intento <= 5; intento += 1) {
    await e.planificador.tick();
    const job = e.estado.obtener('a1|instagram');
    assert.equal(job.intentos, intento);
    if (intento < 5) {
      assert.equal(job.estado, 'pendiente');
      esperas.push((job.proximoIntentoMs - e.reloj.ahora()) / MIN);
      e.reloj.avanzar(job.proximoIntentoMs - e.reloj.ahora());
    } else {
      assert.equal(job.estado, 'error');
      assert.equal(job.proximoIntentoMs, null);
    }
  }
  assert.deepEqual(esperas, [10, 30, 60, 120]);
  assert.match(e.texto(), /Error: no se pudo publicar/);
  assert.match(e.texto(), /Reintentar/);
  const llamadas = e.sim.llamadas.length;
  e.reloj.avanzar(10 * 60 * MIN);
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, llamadas, 'en error no vuelve a intentar sola');
  assert.equal(e.planificador.reintentar('a1|instagram'), true);
  await e.planificador.tick();
  assert.equal(e.estado.obtener('a1|instagram').estado, 'publicada');
  assert.equal(e.sim.medios.length, 1);
});

test('error DEFINITIVO (cuenta restringida): se detiene en el primer intento y explica', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_crear_contenedor', [{ http: 400, error: { code: 4, error_subcode: 2207051, message: 'Restricted' } }]);
  await e.planificador.tick();
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'error');
  assert.equal(job.intentos, 1);
  assert.match(job.titulo, /restringió|frenó/);
});

test('«publicar» pierde la respuesta pero el post SÍ salió: se da por publicado y no se duplica', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_media_publish', ['perder']);
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1, 'se publicó una sola vez');
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'publicada');
  assert.equal(job.yaExistia, true);
  assert.match(e.texto(), /figura PUBLISHED/);
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
});

test('«publicar» falla de verdad (el contenedor NO figura PUBLISHED): se reintenta y sale una sola vez', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  e.sim.programar('ig_media_publish', [{ http: 500, error: { code: 2, message: 'Service temporarily unavailable' } }]);
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 0);
  assert.equal(e.estado.obtener('a1|instagram').estado, 'pendiente');
  e.reloj.avanzar(10 * MIN);
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.equal(e.estado.obtener('a1|instagram').estado, 'publicada');
});

test('si se pierde la memoria del Publicador (reinicio), el candado evita publicar otra vez lo que ya salió', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram', 'facebook'] })] });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.equal(e.sim.posts.length, 1);
  e.estado.quitar('a1|instagram');
  e.estado.quitar('a1|facebook');
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1, 'Instagram: sin duplicado');
  assert.equal(e.sim.posts.length, 1, 'Facebook: sin duplicado');
  assert.equal(e.estado.obtener('a1|instagram').yaExistia, true);
});

test('tiempo máximo por llamada: si Meta no contesta, no se cuelga y reintenta más tarde', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })], tiempos: { leer: 1000, crear: 1000, publicar: 1000 } });
  e.sim.programar('ig_media_lista', ['colgar']);
  const inicio = Date.now();
  await e.planificador.tick();
  assert.ok(Date.now() - inicio < 5000, 'terminó rápido');
  const job = e.estado.obtener('a1|instagram');
  assert.equal(job.estado, 'pendiente');
  assert.match(e.texto(), /sin_respuesta=sí/);
  assert.match(e.texto(), /Meta tardó demasiado/);
});

test('la publicación que se pasó de su hora por más de la tolerancia NO se publica sola', async (t) => {
  const e = await entorno(t, { publicaciones: [pub()] });
  e.reloj.avanzar(7 * 60 * MIN);                       // 7 horas tarde (la tolerancia es de 6)
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, 0);
  assert.equal(e.estado.obtener('a1|instagram').estado, 'vencida');
  assert.match(e.texto(), /se pasó de su hora/);
  const filas = e.planificador.filas();
  assert.match(filas[0].estado, /Vencida/);
});

test('dentro de la tolerancia (5 horas tarde) todavía se publica', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['facebook'] })] });
  e.reloj.avanzar(5 * 60 * MIN);
  await e.planificador.tick();
  assert.equal(e.sim.posts.length, 1);
});

test('lo futuro, lo pausado y los ejemplos no se publican en modo real', async (t) => {
  const e = await entorno(t, {
    publicaciones: [
      pub({ id: 'futura', fecha: '2026-12-01 11:00' }),
      pub({ id: 'pausada', estado: 'pausada' }),
      pub({ id: 'ejemplo', estado: 'ejemplo' }),
    ],
  });
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, 0);
  assert.match(e.texto(), /EJEMPLO/);
  e.reloj.avanzar(61 * MIN);
  await e.planificador.tick();
  assert.equal(e.estado.obtener('futura|facebook').estado, 'publicada', 'a la hora programada, sí');
  assert.equal(e.estado.obtener('pausada|facebook'), undefined);
});

test('una publicación con problemas no se publica y se explica en el panel', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ imagen: 'no-existe.jpg' })] });
  fs.rmSync(path.join(e.raiz, 'imagenes', 'no-existe.jpg'));     // el entorno la crea sola; aquí queremos que falte
  await e.planificador.tick();
  assert.equal(e.sim.llamadas.length, 0);
  const filas = e.planificador.filas();
  assert.equal(filas[0].tipo, 'problema');
  assert.match(filas[0].detalle, /no encuentro la imagen/);
});

test('red sin configurar: error claro y definitivo (no se queda reintentando)', async (t) => {
  const e = await entorno(t, { publicaciones: [pub()], env: { FB_PAGE_TOKEN: undefined, FB_PAGE_ID: undefined } });
  await e.planificador.tick();
  assert.equal(e.estado.obtener('a1|facebook').estado, 'error');
  assert.match(e.estado.obtener('a1|facebook').ultimoError, /Falta configurar Facebook/);
  assert.equal(e.estado.obtener('a1|instagram').estado, 'publicada', 'Instagram no se ve afectado');
});

test('sin dirección pública (PUBLIC_URL): no intenta publicar imágenes y lo dice', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })], env: { PUBLIC_URL: undefined } });
  assert.equal(e.config.urlPublica, null);
  await e.planificador.tick();
  assert.equal(e.estado.obtener('a1|instagram').estado, 'error');
  assert.match(e.estado.obtener('a1|instagram').ultimoError, /PUBLIC_URL/);
  assert.equal(e.sim.llamadas.length, 0);
});

test('Railway pone RAILWAY_PUBLIC_DOMAIN cuando generas el dominio: se usa si no hay PUBLIC_URL', async (t) => {
  const e = await entorno(t, { env: { PUBLIC_URL: undefined, RAILWAY_PUBLIC_DOMAIN: 'mi-publicador-production.up.railway.app' } });
  assert.equal(e.config.urlPublica, 'https://mi-publicador-production.up.railway.app');
});

test('el contenedor tarda en procesarse (IN_PROGRESS): espera y publica', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })], simulador: { contenedorTardaPolls: 3 } });
  await e.planificador.tick();
  assert.equal(e.sim.medios.length, 1);
  assert.ok(e.sim.contar('ig_estado_contenedor') >= 4);
});

test('Facebook: candado propio y no publica si no puede comprobar (salvo FB_SIN_CANDADO=si)', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['facebook'] })] });
  e.sim.agregarPost({ message: 'Texto de prueba uno', hace: 1 * MIN });
  await e.planificador.tick();
  assert.equal(e.sim.contar('fb_feed'), 0);
  assert.equal(e.estado.obtener('a1|facebook').yaExistia, true);

  const e2 = await entorno(t, { publicaciones: [pub({ redes: ['facebook'] })] });
  e2.sim.programar('fb_posts', [{ http: 400, error: { code: 10, message: 'Permission denied' } }]);
  await e2.planificador.tick();
  assert.equal(e2.sim.contar('fb_feed'), 0, 'sin poder comprobar no publica');
  assert.equal(e2.estado.obtener('a1|facebook').estado, 'error', 'el permiso faltante es definitivo');

  const e3 = await entorno(t, { publicaciones: [pub({ redes: ['facebook'] })], env: { FB_SIN_CANDADO: 'si' } });
  e3.sim.programar('fb_posts', [{ http: 400, error: { code: 10, message: 'Permission denied' } }, { http: 400, error: { code: 10, message: 'Permission denied' } }]);
  await e3.planificador.tick();
  assert.equal(e3.sim.posts.length, 1, 'con FB_SIN_CANDADO=si publica de todos modos');
});

test('lote: no más de 8 trabajos por revisión', async (t) => {
  const pubs = Array.from({ length: 5 }, (_, i) => pub({ id: `lote${i}`, texto: `Texto del lote ${i}`, imagen: `foto${i}.jpg` }));
  const e = await entorno(t, { publicaciones: pubs });
  await e.planificador.tick();
  const hechos = e.estado.todos().filter((j) => j.estado === 'publicada').length;
  assert.equal(hechos, 8);
  await e.planificador.tick();
  assert.equal(e.estado.todos().filter((j) => j.estado === 'publicada').length, 10);
});

test('imágenes: Meta descarga la imagen del servicio (simulado) y la rechaza si no es JPEG', async (t) => {
  // La Meta simulada descarga image_url; aquí no hay servidor de imágenes, así que debe fallar con un error pasajero de descarga.
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })], simulador: { descargarImagenes: true }, env: { PUBLIC_URL: 'http://127.0.0.1:9' } });
  await e.planificador.tick();
  const job = e.estado.obtener('a1|instagram');
  assert.notEqual(job.estado, 'publicada');
  assert.match(job.titulo, /descargar la imagen/);
});

test('la memoria se guarda en datos/estado.json y se recupera', async (t) => {
  const e = await entorno(t, { publicaciones: [pub({ redes: ['instagram'] })] });
  await e.planificador.tick();
  const archivo = path.join(e.config.datosDir, 'estado.json');
  assert.ok(fs.existsSync(archivo));
  const otra = crearEstado({ dir: e.config.datosDir });
  assert.equal(otra.obtener('a1|instagram').estado, 'publicada');
});

test('lo ensayado en modo prueba NO cuenta como publicado cuando se pasa a modo real', async (t) => {
  const e = await entorno(t, { modoReal: false, publicaciones: [pub({ redes: ['instagram'] })] });
  await e.planificador.tick();
  assert.equal(e.estado.obtener('a1|instagram').estado, 'simulada');
  // mismo calendario y memoria, ahora en modo real
  const real = await entorno(t, { modoReal: true, publicaciones: [pub({ redes: ['instagram'] })] });
  real.estado.poner('a1|instagram', { pubId: 'a1', red: 'instagram', estado: 'simulada', intentos: 0 });
  await real.planificador.tick();
  assert.equal(real.sim.medios.length, 1);
  assert.equal(real.estado.obtener('a1|instagram').estado, 'publicada');
});
