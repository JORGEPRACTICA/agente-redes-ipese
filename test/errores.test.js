import test from 'node:test';
import { unir } from '../src/simulador/credenciales-falsas.js';
import assert from 'node:assert/strict';
import {
  analizarErrorMeta, esLimiteMeta, esperaReintentoMin, subcodigoDeEstado, redactar, crearRedactor, explicarErrorMeta, ESPERAS_MIN, MAX_INTENTOS,
} from '../src/errores.js';

const err = (code, extra = {}, http = 400) => analizarErrorMeta({ error: { message: 'm', code, ...extra } }, http, null);

test('esperas: 10, 30, 60 y 120 minutos, y 5 intentos en total', () => {
  assert.deepEqual(ESPERAS_MIN, [10, 30, 60, 120]);
  assert.equal(MAX_INTENTOS, 5);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(esperaReintentoMin), [10, 30, 60, 120, 120, 120]);
  assert.equal(esperaReintentoMin(0), 10);
  assert.equal(esperaReintentoMin('x'), 10);
});

test('«Application request limit reached» (código 4) es pasajero y de límite', () => {
  const m = err(4, { message: 'Application request limit reached' });
  assert.equal(m.transitorio, true);
  assert.equal(m.definitivo, false);
  assert.equal(esLimiteMeta(m), true);
});

test('los códigos 17, 32, 341, 613 y los límites 80000 a 80014 son de límite', () => {
  for (const c of [17, 32, 341, 613, 80002]) assert.equal(esLimiteMeta(err(c)), true, `código ${c}`);
  assert.equal(esLimiteMeta(err(190)), false);
  assert.equal(esLimiteMeta(analizarErrorMeta({}, 429, null)), true);
});

test('errores pasajeros: servidor caído, medio aún no listo, marcado por Meta, HTTP 5xx', () => {
  assert.equal(err(2).transitorio, true);
  assert.equal(err(9007, { error_subcode: 2207027 }).transitorio, true);
  assert.equal(err(100, { is_transient: true }).transitorio, true);
  assert.equal(err(100, { error_subcode: 2207003 }).transitorio, true);
  assert.equal(analizarErrorMeta({}, 503, null).transitorio, true);
  assert.equal(analizarErrorMeta({}, 500, null).transitorio, true);
});

test('errores definitivos: token inválido, permisos, objeto inexistente, 401 y 403', () => {
  assert.equal(err(190).definitivo, true);
  assert.equal(err(10).definitivo, true);
  assert.equal(err(200).definitivo, true);
  assert.equal(err(299).definitivo, true);
  assert.equal(err(803).definitivo, true);
  assert.equal(analizarErrorMeta({}, 401, null).definitivo, true);
  assert.equal(analizarErrorMeta({}, 403, null).definitivo, true);
  assert.equal(err(190).transitorio, false);
});

test('cuenta restringida (2207050) o actividad frenada (2207051) son definitivos aunque traigan código de límite', () => {
  for (const sub of [2207050, 2207051]) {
    const m = err(4, { error_subcode: sub });
    assert.equal(m.transitorio, false, `sub ${sub}`);
    assert.equal(m.definitivo, true, `sub ${sub}`);
  }
});

test('un rechazo desconocido de Meta (HTTP 4xx) es definitivo: no se insiste cinco veces', () => {
  for (const [codigo, sub] of [[100, 2207010], [368, null], [102, null], [100, null]]) {
    const m = err(codigo, sub ? { message: 'Algo raro', error_subcode: sub } : { message: 'Algo raro' });
    assert.equal(m.transitorio, false, `código ${codigo}`);
    assert.equal(m.definitivo, true, `código ${codigo}`);
  }
  // sin código HTTP de rechazo (por ejemplo, el estado de un contenedor), no se sabe: se reintenta con espera
  const sinHttp = analizarErrorMeta({ error: { code: 100, message: 'Algo raro' } }, 200, null);
  assert.equal(sinHttp.transitorio, false);
  assert.equal(sinHttp.definitivo, false);
});

test('los secretos se quitan ANTES de recortar el mensaje (un token en el límite de 300 caracteres no queda a medias)', () => {
  const token = unir('EA', 'AFALSOdePrueba1234567890abcdefghijklmnopqrstuvwxyz');
  const mensaje = `${'x'.repeat(290)} ${token} fin`;
  const m = analizarErrorMeta({ error: { code: 4, message: mensaje, error_user_msg: mensaje } }, 400, null, (t) => redactar(t, [token]));
  assert.ok(!m.mensaje.includes(token.slice(0, 6)), 'quedó el comienzo del token en el mensaje');
  assert.ok(!m.mensajeUsuario.includes(token.slice(0, 6)), 'quedó el comienzo del token en el mensaje de usuario');
  assert.ok(m.mensaje.length <= 300);
});

test('lee los encabezados de uso de Meta, con Headers o con un objeto', () => {
  const h = new Headers({ 'x-app-usage': '{"call_count":5}', 'x-business-use-case-usage': '{"x":1}' });
  const m = analizarErrorMeta({ error: { code: 4 } }, 400, h);
  assert.equal(m.usoApp, '{"call_count":5}');
  const m2 = analizarErrorMeta({ error: { code: 4 } }, 400, { 'X-App-Usage': 'abc' });
  assert.equal(m2.usoApp, 'abc');
});

test('subcodigoDeEstado saca el 2207xxx del texto de un contenedor en ERROR', () => {
  assert.equal(subcodigoDeEstado('Error: Media upload has failed with error code 2207026'), 2207026);
  assert.equal(subcodigoDeEstado('sin código'), null);
});

test('redactar quita tokens de todas las formas en que podrían colarse', () => {
  const token = unir('EA', 'AFALSOdePrueba1234567890abcdefghijklmnopqrstuvwxyz');
  const llaveAnthropic = unir('sk-', 'ant-api03-ABCDEFGHIJKLMNOPQRSTUV');
  const tokenGithub = unir('gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789');
  const tokenFino = unir('github', '_pat_11ABCDEFG0123456789_abcdefghijklmnop');
  const tokenInstagram = unir('IG', 'AAabcdefghijklmnopqrstuvwxyz0123456789');
  const casos = [
    `https://graph.facebook.com/v21.0/123/media?fields=id&access_token=${token}&limit=5`,
    `{"access_token":"${token}","message":"hola"}`,
    `Authorization: Bearer ${token}`,
    `x-api-key: ${llaveAnthropic}`,
    `token ${tokenGithub} y ${tokenFino}`,
    `el token es ${token} y ya`,
    tokenInstagram,
  ];
  const restos = [llaveAnthropic, tokenGithub, tokenFino, tokenInstagram];
  for (const c of casos) {
    const limpio = redactar(c);
    assert.ok(!limpio.includes(token), `quedó el token en: ${limpio}`);
    for (const r of restos) assert.ok(!limpio.includes(r), `quedó una llave en: ${limpio}`);
  }
});

test('crearRedactor oculta los valores exactos de las variables del servicio', () => {
  const quitar = crearRedactor(['clave-secreta-del-panel', 'otro']);
  assert.equal(quitar('la contraseña es clave-secreta-del-panel ok'), 'la contraseña es [oculto] ok');
  assert.equal(quitar('otro'), 'otro', 'valores muy cortos (menos de 6 letras) no se ocultan');
});

test('explicarErrorMeta da un título y un paso siguiente en español para los casos comunes', () => {
  const casos = [
    [{ red: true, transitorio: true }, /No pude hablar con Meta/, /solo/],
    [err(190, { message: 'Error validating access token' }), /token/i, /IG_TOKEN/],
    [err(10, { message: '(#10) Application does not have permission' }), /permiso/, /token/],
    [err(4, { message: 'Application request limit reached' }), /esperar/, /espera/],
    [err(100, { message: 'Unsupported get request. Object with ID does not exist' }), /no encontró/, /IG_USER_ID/],
    [err(100, { message: 'The image has an aspect ratio that is not supported' }), /forma/, /recorte/],
    [err(4, { error_subcode: 2207051 }), /restring|frenó/, /No insistas/],
  ];
  for (const [meta, titulo, paso] of casos) {
    const e = explicarErrorMeta(meta);
    assert.match(e.titulo, titulo);
    assert.match(e.queHacer, paso);
  }
});

test('un número de cuenta que no existe se explica como «número equivocado» y no como falta de permiso (mensaje estándar de Meta: error 100, subcódigo 33)', () => {
  // Así contesta Meta cuando se le pide una cuenta o una Página por un número que no existe (y su texto nombra los permisos).
  const estandar = err(100, {
    message: "Unsupported get request. Object with ID '17841400000000001' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Please read the Graph API documentation at https://developers.facebook.com/docs/graph-api",
    type: 'GraphMethodException', error_subcode: 33,
  });
  const e = explicarErrorMeta(estandar);
  assert.match(e.titulo, /no encontró esa cuenta o esa página con ese número/);
  assert.doesNotMatch(e.titulo, /permiso/);
  assert.match(e.queHacer, /IG_USER_ID \(o FB_PAGE_ID\)/);
  assert.match(e.queHacer, /no el @/);
  assert.match(e.queHacer, /Si el número está bien, genera el token otra vez aceptando todos los permisos/, 'el texto de Meta es ambiguo: si el número está bien, queda el permiso');
  assert.equal(e.esperar, false);
  // el subcódigo 33 basta aunque Meta conteste en otro idioma
  const enEspanol = err(100, { message: "Solicitud no admitida. El objeto con el ID '1784…' no existe o no se puede cargar por falta de permisos", error_subcode: 33 });
  assert.match(explicarErrorMeta(enEspanol).titulo, /no encontró/);
  // «Unsupported get request» sin subcódigo también
  assert.match(explicarErrorMeta(err(100, { message: "Unsupported get request. Object with ID 'x' does not exist" })).titulo, /no encontró/);
  // un nombre que no existe (el @ pegado en vez del número) llega como error 803, sin la frase de los permisos
  const alias = explicarErrorMeta(err(803, { message: '(#803) Some of the aliases you requested do not exist: mi_negocio_demo' }));
  assert.match(alias.titulo, /no encontró/);
  assert.doesNotMatch(alias.queHacer, /permisos/);
});

test('una falta de permisos de verdad sigue explicándose como falta de permisos', () => {
  for (const m of [
    err(10, { message: '(#10) Application does not have permission for this action' }),
    err(200, { message: '(#200) Requires pages_manage_posts permission' }),
    err(100, { message: '(#100) Missing permissions' }),
  ]) {
    const e = explicarErrorMeta(m);
    assert.match(e.titulo, /permiso/, m.mensaje);
    assert.doesNotMatch(e.titulo, /no encontró/, m.mensaje);
  }
});
