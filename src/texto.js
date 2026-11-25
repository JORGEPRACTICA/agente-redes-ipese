// Textos de las publicaciones: adaptación para Instagram y comparación de textos.
//
// Instagram rechaza una publicación si el texto pasa de 2,200 caracteres, trae más de 30 hashtags o más de
// 20 menciones (@). Facebook admite textos mucho más largos, así que SOLO el texto de Instagram se adapta.
// Todo aquí es puro (sin red ni archivos) y nunca parte un emoji por la mitad.
import { cortarSeguro } from './util.js';

export const MAX_CAPTION = 2200;
const OBJETIVO = 2150;          // margen: Meta puede contar los emojis distinto que JavaScript
export const MAX_HASHTAGS = 30;
export const MAX_MENCIONES = 20;

const RE_HASHTAG = /(?<!&)#([\p{L}\p{N}_]+)/gu;
const RE_MENCION = /(?<![\p{L}\p{N}_.@])@([A-Za-z0-9._]{1,30})/gu;
const RE_SOLO_HASHTAG = /^#[\p{L}\p{N}_]+$/u;
const RE_ENCABEZADO = /^\p{Extended_Pictographic}\p{Variation_Selector}?\s*\p{Lu}{2,}/u;

/** Saltos de línea normalizados y sin espacios sobrantes al final de cada línea. */
export function normalizarTexto(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Huella de un texto: solo letras y números, en minúsculas. Instagram altera el texto que devuelve (por ejemplo,
 * quita el «@» de las menciones si la cuenta no es administradora de la Página, o los selectores de emoji),
 * así que se compara únicamente lo que sobrevive a esos cambios.
 */
export function huellaTexto(s) {
  return normalizarTexto(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * ¿Es el mismo texto? Huellas idénticas; o, en textos largos (300 letras o más), mismo inicio (120), mismo final (120)
 * y largo casi igual (±3). No se usa un criterio más flojo: dar por publicado algo que NO salió sería peor que duplicar.
 */
export function mismoTexto(a, b) {
  const x = huellaTexto(a);
  const y = huellaTexto(b);
  if (!x && !y) {
    // Textos sin letras ni números (por ejemplo, solo emojis): la huella queda vacía, así que se compara el texto limpio.
    const limpio = (s) => normalizarTexto(s).normalize('NFKC').replace(/[\p{Cf}\p{Variation_Selector}\s]+/gu, '');
    const p = limpio(a);
    return p.length > 0 && p === limpio(b);
  }
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 300 || y.length < 300) return false;
  return x.slice(0, 120) === y.slice(0, 120) && x.slice(-120) === y.slice(-120) && Math.abs(x.length - y.length) <= 3;
}

export function contarHashtags(texto) {
  return [...String(texto ?? '').matchAll(RE_HASHTAG)].length;
}

export function contarMenciones(texto) {
  return [...String(texto ?? '').matchAll(RE_MENCION)].length;
}

function primeraLinea(bloque) {
  return bloque.split('\n')[0].trim();
}

function esEncabezado(bloque) {
  return RE_ENCABEZADO.test(primeraLinea(bloque));
}

function esSoloHashtags(bloque) {
  const fichas = bloque.trim().split(/\s+/);
  return fichas.length > 0 && fichas.every((w) => RE_SOLO_HASHTAG.test(w));
}

/** Corta en el último punto de una frase (o, si no hay, en la última palabra completa) y agrega «…». */
function cortarEnFrase(texto, limite) {
  if (texto.length <= limite) return texto;
  const tramo = cortarSeguro(texto, limite - 1);
  const m = tramo.match(/^[\s\S]*[.!?…](?=\s|$)/);
  let base = m && m[0].length > limite * 0.5 ? m[0] : tramo.replace(/\s+\S*$/, '');
  if (!base.trim()) base = tramo;
  return base.trimEnd() + '…';
}

/** Deja como máximo `max` hashtags: primero recorta el bloque final de hashtags; los que sobren dentro del texto pierden el «#». */
function limitarHashtags(texto, max) {
  let t = texto;
  let quitados = 0;
  const bloques = t.split(/\n[ \t]*\n/);
  const ultimo = bloques[bloques.length - 1].trim();
  if (bloques.length > 1 && esSoloHashtags(ultimo)) {
    const fichas = ultimo.split(/\s+/);
    if (fichas.length > max) {
      quitados += fichas.length - max;
      bloques[bloques.length - 1] = fichas.slice(0, max).join(' ');
      t = bloques.join('\n\n');
    }
  }
  let n = 0;
  t = t.replace(RE_HASHTAG, (completo, palabra) => {
    n += 1;
    if (n <= max) return completo;
    quitados += 1;
    return palabra;
  });
  return { texto: t, quitados };
}

/** Deja como máximo `max` menciones: a las que sobren se les quita el «@». */
function limitarMenciones(texto, max) {
  let n = 0;
  let quitadas = 0;
  const t = texto.replace(RE_MENCION, (completo, usuario) => {
    n += 1;
    if (n <= max) return completo;
    quitadas += 1;
    return usuario;
  });
  return { texto: t, quitadas };
}

/**
 * Adapta el texto a lo que admite Instagram.
 * Conserva la apertura (primer bloque), el cierre (los últimos bloques: acción, contacto y hashtags) y las secciones
 * del centro que quepan. Quita secciones COMPLETAS (nunca a media frase), las más largas primero, hasta que quepa.
 * @returns {{texto:string, recortado:boolean, original:number, final:number, seccionesQuitadas:string[], hashtagsQuitados:number, mencionesQuitadas:number}}
 */
export function adaptarParaInstagram(original, opciones = {}) {
  const max = opciones.max ?? MAX_CAPTION;
  const objetivo = Math.min(opciones.objetivo ?? OBJETIVO, max);
  const hashtagsMax = opciones.hashtagsMax ?? MAX_HASHTAGS;
  const mencionesMax = opciones.mencionesMax ?? MAX_MENCIONES;

  const base = String(original == null ? '' : original).replace(/\r\n?/g, '\n').trim();
  const salida = {
    texto: base, recortado: false, original: base.length, final: base.length,
    seccionesQuitadas: [], hashtagsQuitados: 0, mencionesQuitadas: 0,
  };

  const h = limitarHashtags(base, hashtagsMax);
  const m = limitarMenciones(h.texto, mencionesMax);
  let texto = m.texto;
  salida.hashtagsQuitados = h.quitados;
  salida.mencionesQuitadas = m.quitadas;
  if (h.quitados || m.quitadas) salida.recortado = true;

  if (texto.length <= max) {
    salida.texto = texto;
    salida.final = texto.length;
    return salida;
  }

  const bloques = texto.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  const nCola = bloques.length >= 6 ? 3 : bloques.length >= 3 ? 2 : 1;
  const cabeza = bloques[0];
  const cola = bloques.length > 1 ? bloques.slice(Math.max(1, bloques.length - nCola)) : [];
  const medio = bloques.slice(1, bloques.length - cola.length);

  // Secciones del centro: si hay encabezados (emoji + palabra en mayúsculas) cada sección empieza en uno; si no, cada bloque es una sección.
  const hayEncabezados = medio.some(esEncabezado);
  const secciones = [];
  for (const b of medio) {
    if (!hayEncabezados || esEncabezado(b) || !secciones.length) secciones.push([b]);
    else secciones[secciones.length - 1].push(b);
  }
  const largoSeccion = (s) => s.join('\n\n').length;
  const armar = () => [cabeza, ...secciones.flat(), ...cola].join('\n\n');
  while (armar().length > objetivo && secciones.length) {
    let k = 0;
    secciones.forEach((s, i) => { if (largoSeccion(s) > largoSeccion(secciones[k])) k = i; });
    const quitada = secciones.splice(k, 1)[0];
    salida.seccionesQuitadas.push(primeraLinea(quitada[0]).slice(0, 60));
  }
  let out = armar();

  if (out.length > max) {
    // Último recurso: lo protegido tampoco cabe. Se conserva el bloque final si son hashtags y lo demás se acorta en una frase.
    const ultimo = bloques[bloques.length - 1];
    const conHashtags = bloques.length > 1 && esSoloHashtags(ultimo);
    const resto = (conHashtags ? bloques.slice(0, -1) : bloques).join('\n\n');
    const presupuesto = conHashtags ? objetivo - ultimo.length - 2 : objetivo;
    out = cortarEnFrase(resto, Math.max(200, presupuesto)) + (conHashtags ? '\n\n' + ultimo : '');
    if (out.length > max) out = cortarSeguro(out, max - 1) + '…';
  }

  salida.texto = out;
  salida.final = out.length;
  salida.recortado = true;
  return salida;
}
