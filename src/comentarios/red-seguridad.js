// Red de seguridad: lo último que se revisa antes de que una respuesta salga (o se muestre como borrador).
//
// Aunque el modelo se equivoque, o alguien le escriba «ignora tus reglas», esta revisión NO depende del modelo:
//   - en un hilo de luto solo pasa una respuesta que PAREZCA un pésame o un agradecimiento (con señales de empatía) y que no tenga
//     números, enlaces, teléfonos, precios, ofertas, promesas ni invitaciones a comprar, visitar o escribir. Aquí no se deja pasar
//     ni el contacto del negocio. Todo lo demás se cambia por un agradecimiento corto;
//   - en una queja, cualquier venta, oferta o promesa se cambia por una disculpa y la invitación a pasar a un mensaje privado;
//   - en un comentario normal, nunca salen descuentos ni promesas, enlaces ajenos al negocio, teléfonos ajenos ni precios si tu
//     política es decirlos en persona (y, si tu política es decirlos, solo cifras que estén en tus respuestas aprobadas).
import { cortarSeguro } from '../util.js';
import { norm } from './clasificador.js';
import { PLANTILLAS_POR_OMISION } from './negocio.js';

// --- Qué se busca (textos ya sin acentos y en minúsculas) -----------------------------------------------
const ENLACE = /https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}(?:\.[a-z0-9-]{2,})*\.(?:com|net|org|io|ly|me|co|app|shop|store|site|online|xyz|mx|info|biz|us|es|tv|link|page|click|top|dev)\b|\bbit\.ly\b|\bwa\.me\b|\bt\.me\b|\b(?:link|enlace|linktree)\b|\ben (?:mi |nuestra )?bio\b/;
const WHATSAPP = /\bwhats\w*|\bwasap|\bwatsap|\bwapp\b|\bwa\b|\btelegram|\bmessenger\b/;
const DIGITOS_DE_TELEFONO = /\d(?:[\s().\/-]?\d){7,}/;
// Una racha de 8 o más dígitos pegados (con espacios, guiones, puntos o paréntesis entre ellos): así se escribe un teléfono.
// Los dígitos sueltos de un horario («de 10:00 a 19:00») o de una dirección no cuentan, aunque en total sean 8 o más.
const RACHA_DE_TELEFONO = /\+?\d(?:[\s().\/-]{0,3}\d){7,}/g;
const PRECIO = /\$ ?\d|\d[\d,.]*\s*(?:pesos|mxn|usd|dolares|dlls)\b|\b(?:pesos|dolares|dlls)\b|\b(?:precio|precios|costo|costos|cuesta|cuestan|cotizacion|cotiza\w*|tarifa\w*|mensualidad|anticipo|iva|cobramos|cobro)\b|\b(?:vale|valen|sale|salen) (?:en )?\d/;
const OFERTA = /descuento|promocion|\bpromo\b|oferta|\b2x1\b|\b3x2\b|dos por uno|tres por dos|\bgratis|gratuit\w*|sin (?:costo|cargo)|regal\w+|obsequi\w+|cupon|codigo de|rebaja|liquidacion|bonific\w+|compensa\w+|reembols\w+|devolv\w+|devolucion|garantiz\w+|te prometo|prometemos|\d+ ?%/;
const VENTA = /\b(?:compra\w*|adquiere|reserva\w*|aparta\w*|agenda\w*|cita|citas|cotiz\w*|inscrib\w*|inscripcion\w*|registrate|catalogo|curso\w*|taller\w*|membresia|paquete\w*|planes?|ordena\w*|pide ya|conoce|conozca|descubre|aprovecha|novedad\w*|coleccion\w*|disponible\w*|lanzamiento|temporada)\b/;
const CONTACTO = /\b(?:escrib\w+|contact\w+|mand\w+|llam\w+|ponte en contacto|pongase en contacto|no dudes en|no dude en|busc\w+|ubicanos|encuentranos|visit\w+|vengan|ven por|ven a|pasa por|pasa a|inbox|dm|mensaje (?:directo|privado)|por privado|al privado|al interno)\b/;
// En una queja SÍ se puede pedir que escriban por privado (es justo lo que se quiere); lo demás del contacto no.
const CONTACTO_QUE_NO_ES_PRIVADO = /\b(?:contact\w+|mand\w+|llam\w+|ponte en contacto|pongase en contacto|no dudes en|no dude en|busc\w+|ubicanos|encuentranos|visit\w+|vengan|ven por|ven a|pasa por|pasa a)\b/;
const NUMERO_EN_LETRAS = /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|millon|millones)\b/;

// Señales de que una respuesta es un pésame o un agradecimiento (obligatorias en un hilo de luto).
const EMPATIA = /gracias|condolenc|pesame|sentimos|lamentamos|lamento|acompan|abrazo|descans|\bpaz\b|oracion|fortaleza|carino|recuerd|memoria|familia|dolor|perdida|animo|solidari|respeto|luz eterna|homenaje|querid|unimos|tus palabras|sus palabras|compartimos|presentes|[🕊🙏🕯]/u;

// --- Qué se permite mencionar (solo en comentarios normales y quejas; en un hilo de luto no se permite nada de contacto) -------
const soloDigitos = (s) => String(s ?? '').replace(/\D+/g, '');

function hostsPermitidos(negocio) {
  const fuentes = [negocio.contacto, ...(negocio.enlacesPermitidos || [])].map(norm).filter(Boolean);
  const hosts = new Set();
  for (const f of fuentes) {
    for (const m of f.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) hosts.add(m[1]);
  }
  return hosts;
}

/** ¿Todos los enlaces o sitios que trae la respuesta son del propio negocio (el mismo sitio o un subdominio suyo)? */
function enlacesSonDelNegocio(textoNorm, negocio) {
  const permitidos = hostsPermitidos(negocio);
  const candidatos = [...textoNorm.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[\/?#]\S*)?/g)].map((m) => m[1]);
  if (!candidatos.length) return true;
  return candidatos.every((h) => [...permitidos].some((p) => h === p || h.endsWith(`.${p}`)));
}

/** Los teléfonos que parece traer un texto: una lista con los dígitos de cada racha de 8 o más (sin espacios ni guiones). */
function telefonosEnTexto(texto) {
  return [...String(texto ?? '').matchAll(RACHA_DE_TELEFONO)].map((m) => soloDigitos(m[0])).filter((d) => d.length >= 8);
}

/** ¿Cada teléfono que trae la respuesta es EXACTAMENTE uno de los del negocio? (sin teléfonos, no hay nada que revisar) */
function telefonoEsDelNegocio(texto, negocio) {
  const traidos = telefonosEnTexto(texto);
  if (!traidos.length) return true;
  const permitidos = new Set(telefonosEnTexto(negocio.contacto));
  const unico = soloDigitos(negocio.contacto);
  if (!permitidos.size && unico.length >= 8) permitidos.add(unico);
  return traidos.every((d) => permitidos.has(d));
}

/** Cifras que trae la respuesta y que NO aparecen en las respuestas aprobadas (solo importa si tu política es decir precios). */
function cifrasSinAprobar(texto, negocio) {
  const aprobadas = (negocio.preguntasAprobadas || []).map((p) => `${p.pregunta} ${p.respuesta}`).join(' ');
  const cifrasAprobadas = new Set([...aprobadas.matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[,.]/g, '')));
  return [...String(texto).matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[,.]/g, '')).filter((c) => c && !cifrasAprobadas.has(c));
}

/**
 * ¿Esta respuesta contiene algo que no debe ir en este tipo de hilo?
 * @returns {{venta:boolean, motivos:string[]}}
 */
export function detectarVenta(respuesta, tipo, negocio = {}) {
  const original = String(respuesta ?? '');
  const t = norm(original);
  const motivos = [];
  const extra = (negocio.palabrasVenta || []).map(norm).filter(Boolean);
  const agrega = (cond, nombre) => { if (cond) motivos.push(nombre); };

  if (tipo === 'luto') {
    // Aquí NO se permite nada: ni el contacto ni el sitio del negocio.
    agrega(ENLACE.test(t), 'enlace');
    agrega(WHATSAPP.test(t), 'WhatsApp');
    agrega(DIGITOS_DE_TELEFONO.test(t) || telefonosEnTexto(t).length > 0, 'teléfono');
    agrega(/\d/.test(t), 'número');
    agrega(NUMERO_EN_LETRAS.test(t), 'cifra en letras');
    agrega(PRECIO.test(t), 'precio');
    agrega(OFERTA.test(t), 'oferta o promesa');
    agrega(VENTA.test(t), 'venta');
    agrega(CONTACTO.test(t), 'invitación a escribir, llamar o visitar');
    agrega(/@/.test(original), 'mención');
    agrega(extra.some((x) => t.includes(x)), 'palabra de venta de tu lista');
  } else if (tipo === 'queja') {
    agrega(ENLACE.test(t) && !enlacesSonDelNegocio(t, negocio), 'enlace');
    agrega(WHATSAPP.test(t) && !norm(negocio.contacto).match(WHATSAPP), 'WhatsApp');
    agrega(!telefonoEsDelNegocio(t, negocio), 'teléfono');
    agrega(PRECIO.test(t), 'precio');
    agrega(OFERTA.test(t), 'oferta o promesa');
    agrega(VENTA.test(t), 'venta');
    agrega(CONTACTO_QUE_NO_ES_PRIVADO.test(t), 'invitación a visitar o llamar');
    agrega(extra.some((x) => t.includes(x)), 'palabra de venta de tu lista');
  } else {
    agrega(OFERTA.test(t), 'oferta o promesa');
    agrega(ENLACE.test(t) && !enlacesSonDelNegocio(t, negocio), 'enlace');
    agrega(!telefonoEsDelNegocio(t, negocio), 'teléfono');
    if (negocio.precios === 'responder') {
      agrega(cifrasSinAprobar(original, negocio).length > 0, 'una cifra que no está en tus respuestas aprobadas');
    } else {
      agrega(PRECIO.test(t) || /\d/.test(t) && /(?:cuesta|vale|sale|cobr)/.test(t), 'precio');
    }
  }
  return { venta: motivos.length > 0, motivos };
}

/** Texto limpio: sin comillas de adorno, sin «Respuesta:», sin @menciones, en una línea razonable. */
function limpiar(respuesta) {
  let t = String(respuesta ?? '').replace(/\r\n?/g, '\n').trim();
  t = t.replace(/^(respuesta|reply|comentario)\s*:\s*/i, '');
  t = t.replace(/^["“”«»']+|["“”«»']+$/g, '').trim();
  t = t.replace(/(^|\s)@[\w.]+/g, '$1').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return t;
}

/** Corta en el final de una frase para no pasar de `max` caracteres; devuelve '' si no hay dónde cortar. */
function recortarEnFrase(t, max) {
  if (t.length <= max) return t;
  const tramo = cortarSeguro(t, max);
  const m = tramo.match(/^[\s\S]*[.!?…🕊😊](?=\s|$)/u);
  return m && m[0].length >= 20 ? m[0].trim() : '';
}

export function plantillaPara(tipo, negocio = {}, { preguntaPrecio = false, sinDato = false } = {}) {
  const p = { ...PLANTILLAS_POR_OMISION, ...(negocio.plantillas || {}) };
  if (tipo === 'luto') return p.luto;
  if (tipo === 'queja') return p.queja;
  if (preguntaPrecio && negocio.precios !== 'responder') return p.preguntaPrecio;
  return sinDato ? p.sinDato : p.normal;
}

const MAXIMO = { luto: 220, queja: 400, normal: 450 };

/**
 * Aplica la red de seguridad a una respuesta.
 * @returns {{texto:string, cambiado:boolean, motivo:string|null}}
 */
export function aplicarRedDeSeguridad({ tipo, respuesta, negocio = {}, preguntaPrecio = false, sinDato = false }) {
  const fallback = plantillaPara(tipo, negocio, { preguntaPrecio, sinDato });
  let texto = limpiar(respuesta);
  if (!texto) return { texto: fallback, cambiado: true, motivo: 'la respuesta venía vacía' };

  const max = MAXIMO[tipo] ?? 450;
  if (texto.length > max) {
    const corto = recortarEnFrase(texto, max);
    if (!corto) return { texto: fallback, cambiado: true, motivo: 'la respuesta era demasiado larga' };
    texto = corto;
  }
  if (tipo === 'luto' && !EMPATIA.test(norm(texto))) {
    return { texto: fallback, cambiado: true, motivo: 'la respuesta no parecía un pésame ni un agradecimiento' };
  }
  const d = detectarVenta(texto, tipo, negocio);
  if (d.venta) {
    const donde = tipo === 'luto' ? 'un hilo de luto' : (tipo === 'queja' ? 'una queja' : 'un comentario');
    return { texto: fallback, cambiado: true, motivo: `se detectó ${d.motivos.join(', ')} en ${donde}` };
  }
  return { texto, cambiado: false, motivo: null };
}
