// Publicar de verdad en Instagram y en Facebook, con las protecciones aprendidas en la práctica:
//  1. Candado contra duplicados: antes de publicar se lee lo último que hay en la cuenta; si el MISMO texto ya salió
//     (se compara por letras y números, desde la hora programada), no se vuelve a publicar.
//  2. Si no se puede comprobar, NO se publica a ciegas: se espera y se reintenta (un duplicado en Instagram no se puede borrar por API).
//  3. Si «publicar» falla pero el contenedor figura PUBLISHED, la publicación SÍ salió: se da por publicada.
//  4. Un error pasajero de Meta (límite de llamadas, servicio caído) no gasta los intentos: el planificador espera.
//  5. Tiempo máximo por llamada y el token nunca aparece en un mensaje (lo garantiza meta.js).
//  6. Una respuesta de Meta sin el número de la publicación NO se toma por éxito: se comprueba en la cuenta.
//  7. Si dos copias del Publicador estuvieran encendidas a la vez, una pausa al azar antes de la segunda comprobación las
//     desfasa, y una revisión posterior avisa si apareció una publicación repetida.
import { adaptarParaInstagram, mismoTexto } from './texto.js';
import { esLimiteMeta, resumirDetalle, subcodigoDeEstado, analizarErrorMeta } from './errores.js';

const VENTANA_ANTES_MS = 15 * 60 * 1000;   // el candado mira desde 15 min antes de la hora programada
const PAUSA_AL_AZAR_MAX_MS = 5000;
const ESPERA_ANTES_DE_REVISAR_MS = 8000;

const fallo = (x) => ({
  ok: false,
  error: x.error,
  transitorio: Boolean(x.meta && x.meta.transitorio),
  definitivo: Boolean(x.meta && x.meta.definitivo),
  detalle: x.meta || null,
});

/**
 * La comprobación contra duplicados no se pudo hacer. Si el motivo es definitivo (token inválido, falta un permiso) se dice tal cual
 * para que se arregle YA; si es pasajero, se espera y se reintenta (nunca se publica a ciegas).
 */
function falloDeVerificacion(red, previo, vez) {
  const meta = previo.meta || { paso: 'buscar_publicado' };
  const definitivo = Boolean(meta.definitivo);
  const nombre = red === 'instagram' ? 'Instagram' : 'Facebook';
  const error = definitivo
    ? `No pude leer lo último que hay publicado en ${nombre} (${meta.mensaje || 'Meta rechazó la lectura'}); sin eso no publico, para no duplicar`
    : (vez === 2
      ? 'No pude comprobar por segunda vez si ya estaba publicada; la dejo para más tarde'
      : `No pude comprobar si esta publicación ya estaba en ${nombre}, así que no la publico todavía; se reintenta más tarde`);
  return fallo({ error, meta: { ...meta, transitorio: !definitivo, definitivo } });
}

/** El servicio se reinició después de la hora de esta publicación y no se encontró en la cuenta: no se publica sola, la revisa una persona. */
function aRevisar(red) {
  const nombre = red === 'instagram' ? 'Instagram' : 'Facebook';
  return {
    ok: false,
    revisar: true,
    error: `El servicio se reinició después de la hora de esta publicación y no la encuentro en ${nombre}. No sé si ya salió (por ejemplo, si cambiaste su texto o la borraste a mano), así que no la publico sola`,
    transitorio: false,
    definitivo: false,
    detalle: null,
  };
}

/** Meta escribe las fechas como 2026-12-01T16:00:03+0000 (sin dos puntos en la zona). */
function fechaDeMeta(valor, respaldoMs) {
  const t = Date.parse(String(valor ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? t : respaldoMs;
}

function ventanaDesde(programadoMs, ahoraMs) {
  return Number.isFinite(programadoMs) ? programadoMs - VENTANA_ANTES_MS : ahoraMs - 6 * 3600 * 1000;
}

async function pausaAlAzar(ctx) {
  const azar = typeof ctx.aleatorio === 'function' ? ctx.aleatorio() : Math.random();
  await ctx.dormir(Math.floor(azar * PAUSA_AL_AZAR_MAX_MS));
}

// ---------------------------------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------------------------------

/** ¿Ya salió este texto en la cuenta desde `desdeMs`? -> { post } | { nada: true } | { noVerificado: true, meta } */
async function buscarPublicadoIG(ctx, texto, desdeMs, trabajoId) {
  const r = await ctx.meta.ig.listarMedia(25);
  if (!r.ok || !Array.isArray(r.json.data)) {
    const meta = r.meta || { paso: 'buscar_publicado', transitorio: true };
    ctx.registro.aviso(`Instagram: no pude comprobar si el texto ya estaba publicado (${resumirDetalle(meta)}).`);
    return { noVerificado: true, meta };
  }
  for (const m of r.json.data) {
    const cuando = fechaDeMeta(m.timestamp, ctx.ahoraMs());
    if (!(cuando >= desdeMs && mismoTexto(m.caption, texto))) continue;
    if (ctx.yaEsDeOtroTrabajo && ctx.yaEsDeOtroTrabajo(m.id, trabajoId)) continue;     // ese post ya pertenece a OTRA publicación del calendario
    return { post: m };
  }
  return { nada: true };
}

/** Después de publicar: ¿apareció otra publicación igual? (solo pasaría si hubiera dos copias del Publicador encendidas). */
async function auditarRepetidaIG(ctx, texto, desdeMs, idPropio, trabajoId) {
  await ctx.dormir(ESPERA_ANTES_DE_REVISAR_MS);
  const r = await ctx.meta.ig.listarMedia(25);
  if (!r.ok || !Array.isArray(r.json.data)) return null;
  return r.json.data.find((m) => String(m.id) !== String(idPropio)
    && fechaDeMeta(m.timestamp, ctx.ahoraMs()) >= desdeMs
    && mismoTexto(m.caption, texto)
    && !(ctx.yaEsDeOtroTrabajo && ctx.yaEsDeOtroTrabajo(m.id, trabajoId))) || null;
}

const AVISO_REPETIDA = (enlace) => `Apareció otra publicación con el MISMO texto${enlace ? ` (${enlace})` : ''}. Si no la querías, bórrala a mano desde la app. Revisa que tengas una sola copia del Publicador encendida en Railway.`;

/** Espera a que Meta termine de procesar el contenedor (FINISHED). Ante un límite o un servicio caído deja de preguntar. */
async function esperarContenedorIG(ctx, id, { intentosMax = 10, cadaMs = 3000, tolerante = true } = {}) {
  let vioEnProceso = false;
  let ultimo = null;
  for (let i = 0; i < intentosMax; i += 1) {
    await ctx.dormir(cadaMs);
    const r = await ctx.meta.ig.estadoContenedor(id);
    if (!r.ok) {
      if (r.meta && r.meta.red) continue;                        // un fallo de red al preguntar no cancela la espera
      if (r.meta && r.meta.transitorio) return fallo(r);         // límite o servicio caído: NO seguir preguntando
      ultimo = r;
      continue;
    }
    const estado = r.json.status_code;
    if (estado === 'FINISHED') return { ok: true };
    if (estado === 'ERROR' || estado === 'EXPIRED') {
      const detalle = ctx.registro.redactar(String(r.json.status || ''));
      const meta = analizarErrorMeta({ error: { message: detalle, error_subcode: subcodigoDeEstado(detalle) } }, 200, r.headers, ctx.registro.redactar);
      meta.paso = 'esperar_contenedor';
      // Un contenedor en ERROR no se arregla esperando (una imagen que Instagram no pudo procesar); uno vencido (EXPIRED) sí se vuelve a crear.
      if (estado === 'ERROR' && !meta.transitorio) meta.definitivo = true;
      if (estado === 'EXPIRED') meta.transitorio = true;
      return fallo({ error: `La imagen no se pudo procesar (${estado}): ${detalle}`.trim(), meta });
    }
    if (estado === 'IN_PROGRESS') vioEnProceso = true;
  }
  if (tolerante && !vioEnProceso) return { ok: true, sinConfirmar: true };    // Meta nunca dijo «en proceso»: se intenta publicar
  if (ultimo) return fallo(ultimo);
  return fallo({
    error: `La imagen seguía procesándose en Instagram tras ${Math.round((intentosMax * cadaMs) / 1000)} segundos; se reintentará`,
    meta: { paso: 'esperar_contenedor', transitorio: true },
  });
}

/**
 * Publica una imagen con su texto en Instagram.
 * @param {object} ctx  { config, meta, registro, dormir, ahoraMs, aleatorio?, yaEsDeOtroTrabajo }
 * @param {{texto:string, imagenUrl:string, programadoMs?:number, trabajoId?:string, soloSiYaSalio?:boolean}} pub
 *        `soloSiYaSalio`: solo comprobar si ya está publicada; si no se encuentra, NO publicar (devuelve { revisar: true }).
 * @returns {Promise<{ok:true, externalId:string, permalink?:string, yaExistia?:boolean, advertencia?:string}|{ok:false, error:string, transitorio:boolean, definitivo:boolean, detalle:object|null, revisar?:boolean}>}
 */
export async function publicarEnInstagram(ctx, pub) {
  const { config, meta, registro } = ctx;
  if (!config.ig.configurado) return { ok: false, error: 'Falta configurar Instagram (IG_TOKEN e IG_USER_ID)', transitorio: false, definitivo: true, detalle: null };
  if (!pub.imagenUrl) return { ok: false, error: 'Instagram exige una imagen; no admite publicaciones de puro texto', transitorio: false, definitivo: true, detalle: null };

  const ad = adaptarParaInstagram(pub.texto, { hashtagsMax: config.limites.hashtags });
  if (ad.recortado) {
    registro.info(`Instagram: texto adaptado de ${ad.original} a ${ad.final} caracteres (se quitó: ${[...ad.seccionesQuitadas, ad.hashtagsQuitados ? `${ad.hashtagsQuitados} hashtags` : '', ad.mencionesQuitadas ? `${ad.mencionesQuitadas} menciones` : ''].filter(Boolean).join(' | ') || 'lo que sobraba'}).`);
  }
  const texto = ad.texto;
  const desdeMs = ventanaDesde(pub.programadoMs, ctx.ahoraMs());

  try {
    // 1. Candado: si este texto ya está publicado, se marca como publicado sin volver a publicar.
    const previo = await buscarPublicadoIG(ctx, texto, desdeMs, pub.trabajoId);
    if (previo.post) {
      registro.info(`Instagram: ese texto ya estaba publicado (${previo.post.permalink || previo.post.id}); se marca como publicado sin volver a publicar.`);
      return { ok: true, externalId: previo.post.id, permalink: previo.post.permalink, yaExistia: true };
    }
    // 2. Si no se pudo comprobar, NO se publica a ciegas.
    if (previo.noVerificado) return falloDeVerificacion('instagram', previo, 1);
    // 2b. El servicio perdió la memoria y esta publicación es anterior a su arranque: no se sabe si salió; la revisa una persona.
    if (pub.soloSiYaSalio) return aRevisar('instagram');

    const cont = await meta.ig.crearContenedor({ imageUrl: pub.imagenUrl, caption: texto });
    if (!cont.ok) return fallo(cont);
    const idContenedor = cont.json.id;
    if (!idContenedor) return fallo({ error: 'Instagram no devolvió el número del contenedor', meta: { paso: 'crear_contenedor', transitorio: true } });

    const listo = await esperarContenedorIG(ctx, idContenedor);
    if (!listo.ok) return listo;

    // 3. Segunda comprobación justo antes de publicar (otro proceso pudo publicarlo mientras esperábamos), con una pausa al azar.
    await pausaAlAzar(ctx);
    const otra = await buscarPublicadoIG(ctx, texto, desdeMs, pub.trabajoId);
    if (otra.post) {
      registro.info('Instagram: mientras se preparaba apareció la misma publicación; no se publica otra vez.');
      return { ok: true, externalId: otra.post.id, permalink: otra.post.permalink, yaExistia: true };
    }
    if (otra.noVerificado) return falloDeVerificacion('instagram', otra, 2);

    const pubd = await meta.ig.publicar(idContenedor);
    if (!pubd.ok) {
      // Si Meta no rechazó la llamada por límite, el post pudo haber salido aunque se perdiera la respuesta: se pregunta al contenedor.
      if (!esLimiteMeta(pubd.meta)) {
        const est = await meta.ig.estadoContenedor(idContenedor);
        if (est.ok && est.json.status_code === 'PUBLISHED') {
          const luego = await buscarPublicadoIG(ctx, texto, desdeMs, pub.trabajoId);
          registro.info('Instagram: «publicar» respondió error pero el contenedor figura PUBLISHED; se da por publicada.');
          return { ok: true, externalId: (luego.post && luego.post.id) || String(idContenedor), permalink: luego.post && luego.post.permalink, yaExistia: true };
        }
      }
      return fallo(pubd);
    }
    const idPublicacion = pubd.json.id;
    if (!idPublicacion) {
      // Meta contestó «bien» pero sin el número de la publicación: no se da por publicada. Si el contenedor figura PUBLISHED, sí salió.
      const est = await meta.ig.estadoContenedor(idContenedor);
      if (est.ok && est.json.status_code === 'PUBLISHED') {
        const luego = await buscarPublicadoIG(ctx, texto, desdeMs, pub.trabajoId);
        return { ok: true, externalId: (luego.post && luego.post.id) || String(idContenedor), permalink: luego.post && luego.post.permalink, yaExistia: true };
      }
      return fallo({ error: 'Instagram respondió sin el número de la publicación; en el siguiente intento compruebo en tu cuenta si salió', meta: { paso: 'publicar', transitorio: true, definitivo: false } });
    }
    let permalink;
    const d = await meta.ig.detalle(idPublicacion);              // solo para mostrar el enlace; si falla no importa
    if (d.ok) permalink = d.json.permalink;
    const resultado = { ok: true, externalId: String(idPublicacion), permalink };
    // 4. Revisión posterior: si apareció una copia, se avisa (nunca debería pasar con una sola copia del Publicador).
    const repetida = await auditarRepetidaIG(ctx, texto, desdeMs, idPublicacion, pub.trabajoId);
    if (repetida) resultado.advertencia = AVISO_REPETIDA(repetida.permalink);
    return resultado;
  } catch (e) {
    return { ok: false, error: registro.redactar(e && e.message ? e.message : e), transitorio: true, definitivo: false, detalle: { paso: 'publicar_instagram', transitorio: true, red: true } };
  }
}

// ---------------------------------------------------------------------------------------------------
// Facebook (Página)
// ---------------------------------------------------------------------------------------------------

async function buscarPublicadoFB(ctx, texto, desdeMs, trabajoId) {
  const r = await ctx.meta.fb.listarPosts(25);
  if (!r.ok || !Array.isArray(r.json.data)) {
    const meta = r.meta || { paso: 'buscar_publicado', transitorio: true };
    ctx.registro.aviso(`Facebook: no pude comprobar si el texto ya estaba publicado (${resumirDetalle(meta)}).`);
    return { noVerificado: true, meta };
  }
  for (const m of r.json.data) {
    const cuando = fechaDeMeta(m.created_time, ctx.ahoraMs());
    if (!(cuando >= desdeMs && mismoTexto(m.message, texto))) continue;
    if (ctx.yaEsDeOtroTrabajo && ctx.yaEsDeOtroTrabajo(m.id, trabajoId)) continue;
    return { post: m };
  }
  return { nada: true };
}

async function auditarRepetidaFB(ctx, texto, desdeMs, idPropio, trabajoId) {
  await ctx.dormir(ESPERA_ANTES_DE_REVISAR_MS);
  const r = await ctx.meta.fb.listarPosts(25);
  if (!r.ok || !Array.isArray(r.json.data)) return null;
  return r.json.data.find((m) => String(m.id) !== String(idPropio)
    && fechaDeMeta(m.created_time, ctx.ahoraMs()) >= desdeMs
    && mismoTexto(m.message, texto)
    && !(ctx.yaEsDeOtroTrabajo && ctx.yaEsDeOtroTrabajo(m.id, trabajoId))) || null;
}

/**
 * Publica en la Página de Facebook (con imagen si hay). Facebook recibe el texto completo.
 * Con FB_SIN_CANDADO=si se publica aunque no se pueda leer lo último de la Página (queda bajo tu responsabilidad).
 */
export async function publicarEnFacebook(ctx, pub) {
  const { config, meta, registro } = ctx;
  if (!config.fb.configurado) return { ok: false, error: 'Falta configurar Facebook (FB_PAGE_TOKEN y FB_PAGE_ID)', transitorio: false, definitivo: true, detalle: null };
  const texto = String(pub.texto || '').trim();
  const desdeMs = ventanaDesde(pub.programadoMs, ctx.ahoraMs());

  try {
    const previo = await buscarPublicadoFB(ctx, texto, desdeMs, pub.trabajoId);
    if (previo.post) {
      registro.info(`Facebook: ese texto ya estaba publicado (${previo.post.permalink_url || previo.post.id}); se marca como publicado sin volver a publicar.`);
      return { ok: true, externalId: previo.post.id, permalink: previo.post.permalink_url, yaExistia: true };
    }
    if (previo.noVerificado && !config.fbSinCandado) return falloDeVerificacion('facebook', previo, 1);
    if (pub.soloSiYaSalio && !previo.noVerificado) return aRevisar('facebook');

    let fotoId = null;
    if (pub.imagenUrl) {
      const foto = await meta.fb.subirFotoTemporal(pub.imagenUrl);
      if (!foto.ok) return fallo(foto);
      fotoId = foto.json.id;
      if (!fotoId) return fallo({ error: 'Facebook no devolvió el número de la foto', meta: { paso: 'subir_foto', transitorio: true } });
    }

    await pausaAlAzar(ctx);
    const otra = await buscarPublicadoFB(ctx, texto, desdeMs, pub.trabajoId);
    if (otra.post) {
      registro.info('Facebook: mientras se preparaba apareció la misma publicación; no se publica otra vez.');
      return { ok: true, externalId: otra.post.id, permalink: otra.post.permalink_url, yaExistia: true };
    }
    if (otra.noVerificado && !config.fbSinCandado) return falloDeVerificacion('facebook', otra, 2);

    const r = await meta.fb.publicar({ mensaje: texto, fotoId });
    if (!r.ok) return fallo(r);
    const id = r.json.id;
    if (!id) {
      return fallo({ error: 'Facebook respondió sin el número de la publicación; en el siguiente intento compruebo en tu Página si salió', meta: { paso: 'publicar', transitorio: true, definitivo: false } });
    }
    const resultado = { ok: true, externalId: String(id), permalink: `https://www.facebook.com/${id}` };
    const repetida = await auditarRepetidaFB(ctx, texto, desdeMs, id, pub.trabajoId);
    if (repetida) resultado.advertencia = AVISO_REPETIDA(repetida.permalink_url);
    return resultado;
  } catch (e) {
    return { ok: false, error: registro.redactar(e && e.message ? e.message : e), transitorio: true, definitivo: false, detalle: { paso: 'publicar_facebook', transitorio: true, red: true } };
  }
}
