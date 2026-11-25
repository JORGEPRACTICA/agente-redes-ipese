// La «ficha de voz» de tu negocio: lo que el asistente necesita saber para contestar comentarios como tú.
// Se guarda en negocio.json (no lleva llaves: puede subirse a GitHub). Claude Code lo llena contigo.
import fs from 'node:fs';
import path from 'node:path';

export const PLANTILLAS_POR_OMISION = {
  luto: 'Gracias por acompañarnos y por tus palabras. 🕊️',
  queja: 'Lamentamos mucho lo que pasó y queremos ayudarte. ¿Nos escribes por mensaje privado para resolverlo?',
  normal: '¡Gracias por tu comentario! 😊',
  preguntaPrecio: '¡Gracias por tu interés! 😊 Los precios los compartimos en persona; con gusto te atendemos.',
  sinDato: '¡Gracias por tu pregunta! Lo confirmamos y te respondemos pronto. 😊',
};

export const NEGOCIO_POR_OMISION = {
  nombre: 'Mi negocio',
  giro: 'describe aquí, en una frase, a qué se dedica tu negocio',
  voz: {
    tono: 'cálido, cercano y respetuoso',
    tratamiento: 'tú',
    emojis: 'pocos',
    siempre: [],
    nunca: [],
  },
  precios: 'en_persona',          // en_persona: nunca se dicen precios en un comentario · responder: se pueden decir si están en las respuestas aprobadas
  contacto: '',                   // el único teléfono o enlace que el asistente puede mencionar, escrito tal cual
  enlacesPermitidos: [],
  preguntasAprobadas: [],         // [{ "pregunta": "...", "respuesta": "..." }]
  palabrasLuto: [],               // palabras extra que indican pérdida o duelo, en tus publicaciones o comentarios
  palabrasQueja: [],
  palabrasVenta: [],              // palabras extra que NUNCA deben aparecer en un hilo de luto
  plantillas: {},
};

const texto = (v, max, defecto = '') => (typeof v === 'string' ? v.trim().slice(0, max) : defecto);
const listaTextos = (v, maxItems, maxLargo) => (Array.isArray(v)
  ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, maxLargo)).slice(0, maxItems)
  : []);

/** Mezcla lo que escribiste en negocio.json con los valores por omisión. */
export function normalizarNegocio(crudo = {}) {
  const c = crudo && typeof crudo === 'object' ? crudo : {};
  const v = c.voz && typeof c.voz === 'object' ? c.voz : {};
  const preguntas = Array.isArray(c.preguntasAprobadas)
    ? c.preguntasAprobadas
      .filter((x) => x && typeof x.pregunta === 'string' && typeof x.respuesta === 'string' && x.pregunta.trim() && x.respuesta.trim())
      .map((x) => ({ pregunta: x.pregunta.trim().slice(0, 200), respuesta: x.respuesta.trim().slice(0, 500) }))
      .slice(0, 30)
    : [];
  const plantillas = { ...PLANTILLAS_POR_OMISION };
  if (c.plantillas && typeof c.plantillas === 'object') {
    for (const k of Object.keys(PLANTILLAS_POR_OMISION)) {
      const t = texto(c.plantillas[k], 300);
      if (t) plantillas[k] = t;
    }
  }
  return {
    nombre: texto(c.nombre, 80, NEGOCIO_POR_OMISION.nombre) || NEGOCIO_POR_OMISION.nombre,
    giro: texto(c.giro, 200, NEGOCIO_POR_OMISION.giro) || NEGOCIO_POR_OMISION.giro,
    voz: {
      tono: texto(v.tono, 200, NEGOCIO_POR_OMISION.voz.tono) || NEGOCIO_POR_OMISION.voz.tono,
      tratamiento: texto(v.tratamiento, 40, 'tú') || 'tú',
      emojis: texto(v.emojis, 100, 'pocos') || 'pocos',
      siempre: listaTextos(v.siempre, 12, 160),
      nunca: listaTextos(v.nunca, 20, 160),
    },
    precios: c.precios === 'responder' ? 'responder' : 'en_persona',
    contacto: texto(c.contacto, 200),
    enlacesPermitidos: listaTextos(c.enlacesPermitidos, 10, 200),
    preguntasAprobadas: preguntas,
    palabrasLuto: listaTextos(c.palabrasLuto, 40, 60),
    palabrasQueja: listaTextos(c.palabrasQueja, 40, 60),
    palabrasVenta: listaTextos(c.palabrasVenta, 60, 60),
    plantillas,
  };
}

/**
 * La ficha también puede venir en la variable NEGOCIO_JSON (así la trae la plantilla de Railway de cada cliente):
 * el JSON tal cual o en base64. Si la variable existe pero no se puede leer, se avisa y se usa negocio.json.
 * @returns {{crudo:object|null, aviso:string|null}}
 */
export function leerNegocioDeVariable(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return { crudo: null, aviso: null };
  const intentos = [texto];
  if (!texto.startsWith('{')) {
    try { intentos.push(Buffer.from(texto, 'base64').toString('utf8')); } catch { /* no era base64 */ }
  }
  for (const t of intentos) {
    try {
      const crudo = JSON.parse(t.replace(/^\p{Cf}+/u, ''));
      if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) return { crudo, aviso: null };
    } catch { /* probar el siguiente */ }
  }
  return { crudo: null, aviso: 'La variable NEGOCIO_JSON no se pudo leer (no es un JSON válido ni base64 de un JSON). Uso negocio.json.' };
}

/** @returns {{negocio:object, avisos:string[]}} */
export function cargarNegocio(raiz, env = {}) {
  const ruta = path.join(raiz, 'negocio.json');
  const avisos = [];
  const deVariable = leerNegocioDeVariable(env.NEGOCIO_JSON);
  if (deVariable.crudo) {
    const negocio = normalizarNegocio(deVariable.crudo);
    if (negocio.nombre === NEGOCIO_POR_OMISION.nombre) avisos.push('NEGOCIO_JSON todavía tiene el nombre de ejemplo.');
    return { negocio, avisos };
  }
  if (deVariable.aviso) avisos.push(deVariable.aviso);
  if (!fs.existsSync(ruta)) {
    avisos.push('No encuentro negocio.json: los comentarios usarán respuestas genéricas. Pide a Claude Code que lo llene contigo.');
    return { negocio: normalizarNegocio({}), avisos };
  }
  try {
    const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^\p{Cf}+/u, ''));
    const negocio = normalizarNegocio(crudo);
    if (negocio.nombre === NEGOCIO_POR_OMISION.nombre) avisos.push('negocio.json todavía tiene el nombre de ejemplo: pide a Claude Code que lo llene con los datos de tu negocio.');
    return { negocio, avisos };
  } catch (e) {
    avisos.push('negocio.json tiene un error de escritura (falta o sobra una coma o una comilla). Pide a Claude Code que lo corrija.');
    return { negocio: normalizarNegocio({}), avisos };
  }
}
