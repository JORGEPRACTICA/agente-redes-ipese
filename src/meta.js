// Cliente de la API de Meta (Graph API) para Instagram y Facebook, sin librerías.
//
// Reglas de este archivo:
//  - Cada llamada tiene un tiempo máximo: un servidor que no contesta no debe dejar el Publicador colgado.
//  - Ningún texto que venga de Meta o de la red llega a un mensaje sin pasar por el redactor (el token NUNCA aparece).
//  - Toda llamada devuelve { ok: true, json, ... } o { ok: false, error, meta }, donde `meta` explica si el fallo es pasajero.
import { analizarErrorMeta } from './errores.js';

export const TIEMPOS = { leer: 20000, crear: 30000, publicar: 60000 };

// Campos que se piden al leer comentarios: una sola llamada trae las últimas publicaciones con sus comentarios.
const CAMPOS_IG_COMENTARIOS = (n) => `id,caption,timestamp,permalink,comments_count,comments.limit(${n}){id,text,timestamp,username,replies.limit(10){id,username}}`;
const CAMPOS_FB_COMENTARIOS = (n) => `id,message,created_time,permalink_url,comments.limit(${n}){id,message,created_time,from{id,name},comments.limit(10){id,from{id}}}`;

/**
 * @param {{config:object, registro:{redactar:(t:string)=>string}, fetchFn?:typeof fetch, tiempos?:{leer:number,crear:number,publicar:number}}} opciones
 */
export function crearClienteMeta({ config, registro, fetchFn = globalThis.fetch, tiempos = TIEMPOS }) {
  const redactar = registro.redactar;
  const version = config.graph.version;
  const IG = { base: config.graph.baseIG, token: config.ig.token, id: config.ig.userId };
  const FB = { base: config.graph.baseFB, token: config.fb.token, id: config.fb.pageId };
  const esHostInstagram = IG.base.includes('graph.instagram.com');

  function falloMeta(paso, respuesta, json) {
    const meta = analizarErrorMeta(json, respuesta.status, respuesta.headers, redactar);
    meta.paso = paso;
    return { ok: false, error: meta.mensaje || `HTTP ${respuesta.status} en ${paso}`, meta };
  }

  /** Meta contestó «bien» (200) pero el cuerpo no se pudo leer: no se da por hecho nada, se trata como un fallo pasajero. */
  function cuerpoIlegible(paso, respuesta) {
    return {
      ok: false,
      error: `Meta respondió algo que no pude leer (${paso})`,
      meta: { paso, http: respuesta.status, transitorio: true, definitivo: false, red: true },
    };
  }

  function falloDeRed(paso, e, tiempoMs) {
    const tardo = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const causa = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
    const segundos = tiempoMs >= 10000 ? Math.round(tiempoMs / 1000) : Number((tiempoMs / 1000).toFixed(1));
    const detalle = tardo ? `Meta tardó más de ${segundos} segundos` : `${redactar(e && e.message ? e.message : e)}${causa}`;
    return { ok: false, error: `Sin respuesta de Meta (${paso}): ${detalle}`, meta: { paso, transitorio: true, definitivo: false, red: true } };
  }

  /** Una llamada a la Graph API. Los GET llevan el token en la dirección; los POST, en el cuerpo (nunca en el registro). */
  async function llamar(cuenta, { metodo = 'GET', ruta, params = {}, cuerpo = {}, paso, tiempoMs }) {
    if (!cuenta.token) return { ok: false, error: `Falta el token (${paso})`, meta: { paso, transitorio: false, definitivo: true, sinToken: true } };
    let respuesta;
    let json;
    try {
      const url = new URL(`${cuenta.base}/${version}/${ruta}`);
      const init = { method: metodo, signal: AbortSignal.timeout(tiempoMs), headers: { Accept: 'application/json' } };
      if (metodo === 'GET') {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
        url.searchParams.set('access_token', cuenta.token);
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify({ ...cuerpo, access_token: cuenta.token });
      }
      respuesta = await fetchFn(url, init);
      // El cuerpo se lee como texto DENTRO del mismo tiempo máximo: si Meta contesta las cabeceras y deja colgado el cuerpo,
      // es un fallo de red, no un éxito vacío.
      const cuerpoTexto = await respuesta.text();
      try { json = cuerpoTexto ? JSON.parse(cuerpoTexto) : {}; } catch { json = null; }
    } catch (e) {
      return falloDeRed(paso, e, tiempoMs);
    }
    if (json === null) return respuesta.ok ? cuerpoIlegible(paso, respuesta) : falloMeta(paso, respuesta, {});
    if (!respuesta.ok || (json && json.error)) return falloMeta(paso, respuesta, json || {});
    return { ok: true, json: json || {}, status: respuesta.status, headers: respuesta.headers };
  }

  return {
    tiempos,
    esHostInstagram,
    /** Cambia la llave de Instagram en caliente (la usa la renovación automática). */
    cambiarTokenIG(nuevo) { if (typeof nuevo === 'string' && nuevo.length >= 6) IG.token = nuevo; },

    ig: {
      /** Datos de la cuenta a la que pertenece el token. */
      cuenta: () => llamar(IG, {
        ruta: IG.id,
        params: { fields: esHostInstagram ? 'id,username,account_type,media_count' : 'id,username,name,media_count' },
        paso: 'leer_cuenta', tiempoMs: tiempos.leer,
      }),
      /** Cuántas publicaciones por API quedan en las últimas 24 horas. */
      cupo: () => llamar(IG, { ruta: `${IG.id}/content_publishing_limit`, params: { fields: 'config,quota_usage' }, paso: 'leer_cupo', tiempoMs: tiempos.leer }),
      /** Últimas publicaciones de la cuenta: es la lectura que usa el candado contra duplicados. */
      listarMedia: (limite = 25) => llamar(IG, { ruta: `${IG.id}/media`, params: { fields: 'id,caption,timestamp,permalink', limit: limite }, paso: 'buscar_publicado', tiempoMs: tiempos.leer }),
      crearContenedor: ({ imageUrl, caption }) => llamar(IG, { metodo: 'POST', ruta: `${IG.id}/media`, cuerpo: { image_url: imageUrl, caption }, paso: 'crear_contenedor', tiempoMs: tiempos.crear }),
      estadoContenedor: (id) => llamar(IG, { ruta: String(id), params: { fields: 'status_code,status' }, paso: 'esperar_contenedor', tiempoMs: tiempos.leer }),
      publicar: (creationId) => llamar(IG, { metodo: 'POST', ruta: `${IG.id}/media_publish`, cuerpo: { creation_id: creationId }, paso: 'publicar', tiempoMs: tiempos.publicar }),
      detalle: (mediaId) => llamar(IG, { ruta: String(mediaId), params: { fields: 'id,permalink,timestamp' }, paso: 'leer_publicacion', tiempoMs: tiempos.leer }),
      mediaConComentarios: ({ publicaciones = 10, comentarios = 25 } = {}) => llamar(IG, {
        ruta: `${IG.id}/media`, params: { fields: CAMPOS_IG_COMENTARIOS(comentarios), limit: publicaciones }, paso: 'leer_comentarios', tiempoMs: tiempos.leer,
      }),
      responderComentario: (comentarioId, mensaje) => llamar(IG, { metodo: 'POST', ruta: `${comentarioId}/replies`, cuerpo: { message: mensaje }, paso: 'responder_comentario', tiempoMs: tiempos.crear }),
      /** Respuestas que ya tiene un comentario (para no contestar dos veces). */
      respuestasDe: (comentarioId) => llamar(IG, { ruta: `${comentarioId}/replies`, params: { fields: 'id,username,text', limit: 25 }, paso: 'leer_respuestas', tiempoMs: tiempos.leer }),
    },

    fb: {
      cuenta: () => llamar(FB, { ruta: FB.id, params: { fields: 'id,name' }, paso: 'leer_pagina', tiempoMs: tiempos.leer }),
      /** Últimas publicaciones de la Página: es la lectura del candado contra duplicados en Facebook. */
      listarPosts: (limite = 25) => llamar(FB, { ruta: `${FB.id}/posts`, params: { fields: 'id,message,created_time,permalink_url', limit: limite }, paso: 'buscar_publicado', tiempoMs: tiempos.leer }),
      /** Sube una foto SIN publicarla (temporal) para adjuntarla después a la publicación. */
      subirFotoTemporal: (url) => llamar(FB, { metodo: 'POST', ruta: `${FB.id}/photos`, cuerpo: { url, published: false, temporary: true }, paso: 'subir_foto', tiempoMs: tiempos.crear }),
      publicar: ({ mensaje, fotoId }) => llamar(FB, {
        metodo: 'POST', ruta: `${FB.id}/feed`,
        cuerpo: fotoId ? { message: mensaje, attached_media: JSON.stringify([{ media_fbid: fotoId }]) } : { message: mensaje },
        paso: 'publicar', tiempoMs: tiempos.publicar,
      }),
      postsConComentarios: ({ publicaciones = 10, comentarios = 25 } = {}) => llamar(FB, {
        ruta: `${FB.id}/posts`, params: { fields: CAMPOS_FB_COMENTARIOS(comentarios), limit: publicaciones }, paso: 'leer_comentarios', tiempoMs: tiempos.leer,
      }),
      responderComentario: (comentarioId, mensaje) => llamar(FB, { metodo: 'POST', ruta: `${comentarioId}/comments`, cuerpo: { message: mensaje }, paso: 'responder_comentario', tiempoMs: tiempos.crear }),
      respuestasDe: (comentarioId) => llamar(FB, { ruta: `${comentarioId}/comments`, params: { fields: 'id,from{id},message', limit: 25 }, paso: 'leer_respuestas', tiempoMs: tiempos.leer }),
    },
  };
}
