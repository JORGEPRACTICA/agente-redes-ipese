// Meta SIMULADA: un servidor local que imita (en lo que el Publicador usa) la Graph API de Instagram y Facebook
// y la API de Anthropic. Sirve para las pruebas automáticas y para el ensayo (`npm run ensayo`):
// así se prueba todo sin llaves reales y sin publicar nada en ninguna red social.
//
// Los tokens y llaves de aquí son FALSOS. Nada de este archivo habla con internet.
import http from 'node:http';
import { TOKEN_META_FALSO, TOKEN_PAGINA_FALSO, LLAVE_ANTHROPIC_FALSA } from './credenciales-falsas.js';

const PREFIJO_VERSION = /^\/v\d+\.\d+(?=\/)/;

const aIsoMeta = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');

/**
 * @param {{reloj?:()=>number, descargarImagenes?:boolean, contenedorTardaPolls?:number, ecoToken?:boolean, modelos?:string[]}} opciones
 */
export async function iniciarSimulador(opciones = {}) {
  const sim = {
    token: TOKEN_META_FALSO,
    pageToken: TOKEN_PAGINA_FALSO,
    anthropicKey: LLAVE_ANTHROPIC_FALSA,
    igUserId: '17841400000000001',
    pageId: '100000000000001',
    igUsuario: 'mi_negocio_demo',
    reloj: opciones.reloj || Date.now,
    medios: [],            // publicaciones de Instagram
    posts: [],             // publicaciones de la Página de Facebook
    contenedores: new Map(),
    fotos: new Map(),
    llamadas: [],
    cupoUsado: 0,
    cupoTotal: 100,
    descargarImagenes: Boolean(opciones.descargarImagenes),
    contenedorTardaPolls: opciones.contenedorTardaPolls || 0,
    ecoToken: Boolean(opciones.ecoToken),
    modelos: opciones.modelos || ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    tipoCuenta: 'BUSINESS',
    guiones: new Map(),    // clave de ruta -> lista de comportamientos que se van consumiendo
    anthropic: { llamadas: [], responder: null },
  };
  let contador = 1000;
  const siguiente = (prefijo) => `${prefijo}${++contador}`;
  const pendientes = new Set();

  /** Programa los próximos comportamientos de una ruta: 'ok', 'colgar', 'perder' o un objeto { http, error }. */
  sim.programar = (clave, lista) => { sim.guiones.set(clave, [...lista]); };
  sim.contar = (clave) => sim.llamadas.filter((l) => l.clave === clave).length;
  sim.escrituras = () => sim.llamadas.filter((l) => l.metodo === 'POST' && ['ig_crear_contenedor', 'ig_media_publish', 'fb_foto', 'fb_feed', 'responder_ig', 'responder_fb'].includes(l.clave));

  sim.agregarMedio = ({ caption, hace = 0, comentarios = [] }) => {
    const m = { id: siguiente('igm_'), caption, timestamp: aIsoMeta(sim.reloj() - hace), permalink: `https://www.instagram.com/p/DEMO${contador}/`, comentarios: [...comentarios] };
    sim.medios.unshift(m);
    return m;
  };
  sim.agregarPost = ({ message, hace = 0, comentarios = [] }) => {
    const p = { id: `${sim.pageId}_${siguiente('')}`, message, created_time: aIsoMeta(sim.reloj() - hace), permalink_url: `https://www.facebook.com/demo/posts/${contador}`, comentarios: [...comentarios] };
    sim.posts.unshift(p);
    return p;
  };
  sim.agregarComentarioIG = (medioId, { texto, usuario = 'persona_demo', hace = 60000 }) => {
    const m = sim.medios.find((x) => x.id === medioId);
    const c = { id: siguiente('igc_'), text: texto, timestamp: aIsoMeta(sim.reloj() - hace), username: usuario, respuestas: [] };
    m.comentarios.push(c);
    return c;
  };
  sim.agregarComentarioFB = (postId, { texto, nombre = 'Persona Demo', hace = 60000 }) => {
    const p = sim.posts.find((x) => x.id === postId);
    const c = { id: siguiente('fbc_'), message: texto, created_time: aIsoMeta(sim.reloj() - hace), from: { id: siguiente('u'), name: nombre }, respuestas: [] };
    p.comentarios.push(c);
    return c;
  };

  function errorMeta(res, http, error) {
    const cuerpo = { error: { message: 'Error simulado', type: 'OAuthException', code: 1, fbtrace_id: 'SIMULADO', ...error } };
    res.writeHead(http, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  }
  const ok = (res, json) => { res.writeHead(200, { 'Content-Type': 'application/json', 'x-app-usage': '{"call_count":1,"total_cputime":1,"total_time":1}' }); res.end(JSON.stringify(json)); };

  function tokenInvalido(res, recibido) {
    const mensaje = sim.ecoToken ? `Invalid OAuth access token - Cannot parse access token ${recibido}` : 'Invalid OAuth access token - Cannot parse access token';
    errorMeta(res, 400, { message: mensaje, type: 'OAuthException', code: 190, error_subcode: 467 });
  }

  async function leerCuerpo(req) {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const crudo = Buffer.concat(trozos).toString('utf8');
    try { return crudo ? JSON.parse(crudo) : {}; } catch { return {}; }
  }

  async function descargable(imageUrl) {
    try {
      const r = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return `HTTP ${r.status}`;
      const b = Buffer.from(await r.arrayBuffer());
      if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return 'no es un JPEG';
      return null;
    } catch (e) {
      return `no se pudo descargar (${e.message})`;
    }
  }

  async function manejar(req, res) {
    const url = new URL(req.url, 'http://simulada');
    const ruta = url.pathname.replace(PREFIJO_VERSION, '');
    const partes = ruta.split('/').filter(Boolean);
    const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
    const q = (n) => (req.method === 'POST' ? cuerpo[n] : url.searchParams.get(n));
    const recibido = String(q('access_token') || '');
    const campos = String(url.searchParams.get('fields') || '');

    // ¿qué ruta es?
    let clave = 'desconocida';
    const [a, b] = partes;
    if (a === sim.igUserId) {
      if (!b) clave = 'ig_cuenta';
      else if (b === 'content_publishing_limit') clave = 'ig_cupo';
      else if (b === 'media' && req.method === 'POST') clave = 'ig_crear_contenedor';
      else if (b === 'media') clave = campos.includes('comments') ? 'comentarios_ig' : 'ig_media_lista';
      else if (b === 'media_publish') clave = 'ig_media_publish';
    } else if (a === sim.pageId) {
      if (!b) clave = 'fb_cuenta';
      else if (b === 'posts') clave = campos.includes('comments') ? 'comentarios_fb' : 'fb_posts';
      else if (b === 'photos') clave = 'fb_foto';
      else if (b === 'feed') clave = 'fb_feed';
    } else if (a && a.startsWith('cont_')) clave = 'ig_estado_contenedor';
    else if (a && a.startsWith('igm_')) clave = 'ig_detalle';
    else if (a && a.startsWith('igc_') && b === 'replies') clave = req.method === 'GET' ? 'respuestas_ig' : 'responder_ig';
    else if (a && a.startsWith('fbc_') && b === 'comments') clave = req.method === 'GET' ? 'respuestas_fb' : 'responder_fb';

    const copia = { ...cuerpo };
    delete copia.access_token;
    sim.llamadas.push({ clave, metodo: req.method, ruta, query: Object.fromEntries(url.searchParams), cuerpo: copia, cuando: sim.reloj() });

    // comportamiento programado
    const guion = sim.guiones.get(clave);
    const paso = guion && guion.length ? guion.shift() : 'ok';
    if (paso === 'colgar') { pendientes.add(res); return; }
    if (paso === 'vacio') return ok(res, {});                      // contesta «bien» pero sin hacer nada ni devolver datos
    if (paso === 'cuerpocolgado') {                                // contesta las cabeceras y deja el cuerpo a medias
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"id":');
      pendientes.add(res);
      return;
    }
    if (paso && typeof paso === 'object') return errorMeta(res, paso.http || 400, paso.error || {});

    // autenticación
    const esFB = ['fb_cuenta', 'fb_posts', 'fb_foto', 'fb_feed', 'comentarios_fb', 'responder_fb', 'respuestas_fb'].includes(clave);
    const tokenBueno = esFB ? sim.pageToken : sim.token;
    if (clave !== 'desconocida' && recibido !== tokenBueno) return tokenInvalido(res, recibido);

    const perderRespuesta = paso === 'perder';
    // 'sinid': hace la acción pero contesta {} (sin el número de la publicación)
    const responder = (json) => (perderRespuesta ? req.socket.destroy() : ok(res, paso === 'sinid' ? {} : json));

    switch (clave) {
      case 'ig_cuenta':
        return ok(res, { id: sim.igUserId, username: sim.igUsuario, name: 'Mi Negocio Demo', media_count: sim.medios.length, ...(campos.includes('account_type') ? { account_type: sim.tipoCuenta } : {}) });
      case 'ig_cupo':
        return ok(res, { data: [{ config: { quota_total: sim.cupoTotal, quota_duration: 86400 }, quota_usage: sim.cupoUsado }] });
      case 'ig_media_lista':
        return ok(res, { data: sim.medios.slice(0, Number(url.searchParams.get('limit')) || 25).map(({ id, caption, timestamp, permalink }) => ({ id, caption, timestamp, permalink })) });
      case 'comentarios_ig':
        return ok(res, {
          data: sim.medios.slice(0, Number(url.searchParams.get('limit')) || 25).map((m) => ({
            id: m.id, caption: m.caption, timestamp: m.timestamp, permalink: m.permalink, comments_count: m.comentarios.length,
            comments: { data: m.comentarios.map((c) => ({ id: c.id, text: c.text, timestamp: c.timestamp, username: c.username, replies: { data: c.respuestas.map((r) => ({ id: r.id, username: r.username })) } })) },
          })),
        });
      case 'ig_crear_contenedor': {
        const caption = String(cuerpo.caption || '');
        if (!cuerpo.image_url) return errorMeta(res, 400, { message: 'Param image_url is required', code: 100 });
        if (caption.length > 2200) return errorMeta(res, 400, { message: 'The caption was too long', code: 100, error_subcode: 2207010 });
        if ((caption.match(/(^|[^\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu) || []).length > 30) return errorMeta(res, 400, { message: 'Too many hashtags in the caption', code: 100, error_subcode: 2207040 });
        if (sim.descargarImagenes) {
          const problema = await descargable(cuerpo.image_url);
          if (problema) return errorMeta(res, 400, { message: `The media could not be fetched from this uri: ${problema}`, code: 9004, error_subcode: 2207052 });
        }
        const id = siguiente('cont_');
        sim.contenedores.set(id, { estado: 'IN_PROGRESS', polls: 0, caption, imageUrl: cuerpo.image_url });
        return responder({ id });
      }
      case 'ig_estado_contenedor': {
        const c = sim.contenedores.get(a);
        if (!c) return errorMeta(res, 400, { message: 'Unsupported get request. Object with ID does not exist', code: 100 });
        c.polls += 1;
        if (c.estado === 'IN_PROGRESS' && c.polls > sim.contenedorTardaPolls) c.estado = 'FINISHED';
        return ok(res, { id: a, status_code: c.estado, status: c.estado === 'ERROR' ? 'Error: Media upload has failed with error code 2207026' : c.estado });
      }
      case 'ig_media_publish': {
        const c = sim.contenedores.get(String(cuerpo.creation_id));
        if (!c) return errorMeta(res, 400, { message: 'Media ID is not available', code: 9007, error_subcode: 2207027 });
        if (c.estado !== 'FINISHED') return errorMeta(res, 400, { message: 'Media is not ready to be published. Please wait a moment', code: 9007, error_subcode: 2207027 });
        if (sim.cupoUsado >= sim.cupoTotal) return errorMeta(res, 400, { message: 'The maximum number of posts per day has been reached', code: 4, error_subcode: 2207042 });
        const m = sim.agregarMedio({ caption: c.caption });
        c.estado = 'PUBLISHED';
        sim.cupoUsado += 1;
        if (sim.alPublicar) sim.alPublicar(m);          // gancho de las pruebas (por ejemplo, para simular una segunda copia)
        return responder({ id: m.id });
      }
      case 'ig_detalle': {
        const m = sim.medios.find((x) => x.id === a);
        return m ? ok(res, { id: m.id, permalink: m.permalink, timestamp: m.timestamp }) : errorMeta(res, 400, { message: 'Object does not exist', code: 100 });
      }
      case 'respuestas_ig': {
        let encontrado = null;
        for (const m of sim.medios) for (const c of m.comentarios) if (c.id === a) encontrado = c;
        if (!encontrado) return errorMeta(res, 400, { message: 'Comment does not exist', code: 100 });
        return ok(res, { data: encontrado.respuestas.map((r) => ({ id: r.id, username: r.username, text: r.text })) });
      }
      case 'respuestas_fb': {
        let encontrado = null;
        for (const p of sim.posts) for (const c of p.comentarios) if (c.id === a) encontrado = c;
        if (!encontrado) return errorMeta(res, 400, { message: 'Comment does not exist', code: 100 });
        return ok(res, { data: encontrado.respuestas.map((r) => ({ id: r.id, from: r.from, message: r.message })) });
      }
      case 'responder_ig': {
        let encontrado = null;
        for (const m of sim.medios) for (const c of m.comentarios) if (c.id === a) encontrado = c;
        if (!encontrado) return errorMeta(res, 400, { message: 'Comment does not exist', code: 100 });
        const r = { id: siguiente('igr_'), username: sim.igUsuario, text: cuerpo.message };
        encontrado.respuestas.push(r);
        return responder({ id: r.id });
      }
      case 'fb_cuenta':
        return ok(res, { id: sim.pageId, name: 'Mi Negocio Demo (Página)' });
      case 'fb_posts':
        return ok(res, { data: sim.posts.slice(0, Number(url.searchParams.get('limit')) || 25).map(({ id, message, created_time, permalink_url }) => ({ id, message, created_time, permalink_url })) });
      case 'comentarios_fb':
        return ok(res, {
          data: sim.posts.slice(0, Number(url.searchParams.get('limit')) || 25).map((p) => ({
            id: p.id, message: p.message, created_time: p.created_time, permalink_url: p.permalink_url,
            comments: { data: p.comentarios.map((c) => ({ id: c.id, message: c.message, created_time: c.created_time, from: c.from, comments: { data: c.respuestas.map((r) => ({ id: r.id, from: r.from })) } })) },
          })),
        });
      case 'fb_foto': {
        if (sim.descargarImagenes) {
          const problema = await descargable(cuerpo.url);
          if (problema) return errorMeta(res, 400, { message: `Missing or invalid image file: ${problema}`, code: 324 });
        }
        const id = siguiente('fbph_');
        sim.fotos.set(id, { url: cuerpo.url });
        return responder({ id });
      }
      case 'fb_feed': {
        if (!cuerpo.message && !cuerpo.attached_media) return errorMeta(res, 400, { message: 'The message is required', code: 100 });
        const p = sim.agregarPost({ message: String(cuerpo.message || '') });
        return responder({ id: p.id });
      }
      case 'responder_fb': {
        let encontrado = null;
        for (const p of sim.posts) for (const c of p.comentarios) if (c.id === a) encontrado = c;
        if (!encontrado) return errorMeta(res, 400, { message: 'Comment does not exist', code: 100 });
        const r = { id: siguiente('fbr_'), from: { id: sim.pageId, name: 'Mi Negocio Demo (Página)' }, message: cuerpo.message };
        encontrado.respuestas.push(r);
        return responder({ id: r.id });
      }
      default:
        return errorMeta(res, 404, { message: `Ruta simulada desconocida: ${req.method} ${ruta}`, code: 100 });
    }
  }

  async function manejarAnthropic(req, res) {
    const url = new URL(req.url, 'http://simulada');
    const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
    const llave = req.headers['x-api-key'];
    sim.anthropic.llamadas.push({ metodo: req.method, ruta: url.pathname, cuerpo, llave: llave ? '(recibida)' : '(ninguna)' });
    const json = (http, datos) => { res.writeHead(http, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
    if (llave !== sim.anthropicKey) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const guion = sim.guiones.get('anthropic');
    const paso = guion && guion.length ? guion.shift() : 'ok';
    if (paso === 'colgar') { pendientes.add(res); return; }
    if (paso && typeof paso === 'object') return json(paso.http || 500, paso.json || { type: 'error', error: { type: 'api_error', message: 'Error simulado' } });
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      return json(200, { data: sim.modelos.map((id) => ({ type: 'model', id, display_name: id })), has_more: false });
    }
    const m = url.pathname.match(/^\/v1\/models\/(.+)$/);
    if (m && req.method === 'GET') {
      return sim.modelos.includes(m[1])
        ? json(200, { type: 'model', id: m[1], display_name: m[1] })
        : json(404, { type: 'error', error: { type: 'not_found_error', message: `model: ${m[1]}` } });
    }
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      if (!sim.modelos.includes(cuerpo.model)) return json(404, { type: 'error', error: { type: 'not_found_error', message: `model: ${cuerpo.model}` } });
      const texto = sim.anthropic.responder ? await sim.anthropic.responder(cuerpo) : '{"tipo":"normal","respuesta":"¡Gracias por tu comentario! 😊"}';
      return json(200, { id: 'msg_simulado', type: 'message', role: 'assistant', model: cuerpo.model, content: [{ type: 'text', text: String(texto) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
    }
    return json(404, { type: 'error', error: { type: 'not_found_error', message: 'ruta no encontrada' } });
  }

  const servidor = http.createServer((req, res) => {
    const alAtender = req.url.startsWith('/v1/') ? manejarAnthropic : manejar;
    alAtender(req, res).catch((e) => {
      try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: `fallo del simulador: ${e.message}`, code: 1 } })); } catch { /* conexión cerrada */ }
    });
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  sim.url = `http://127.0.0.1:${servidor.address().port}`;
  sim.detener = async () => {
    for (const r of pendientes) { try { r.destroy(); } catch { /* ya cerrada */ } }
    servidor.closeAllConnections?.();
    await new Promise((resolver) => servidor.close(resolver));
  };
  return sim;
}
