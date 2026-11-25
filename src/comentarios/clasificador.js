// Clasifica un comentario ANTES de contestarlo, leyendo también el texto de la publicación.
//
//   luto   -> solo empatía breve: nada de cursos, precios, enlaces ni WhatsApp.
//   queja  -> disculpa y pasar a un mensaje privado, sin vender.
//   normal -> servicio al grano; los precios solo si los preguntan (y según tu política).
//   spam   -> no se contesta.
//
// Estas son REGLAS fijas (no dependen de que un modelo acierte). El modelo puede hacer la clasificación más fina,
// pero nunca puede ser MENOS cuidadoso que las reglas: siempre gana el tipo más delicado.
//
// Cuando la señal es DÉBIL (un emoji, una palabra ambigua), el comentario se trata con cuidado (como luto) pero
// queda marcado «revísalo tú»: nunca sale solo.
import { minusculasSinAcentos } from '../util.js';

export const TIPOS = ['luto', 'queja', 'normal', 'spam'];

/** Texto comparable: sin acentos, en minúsculas, con letras de ancho completo y caracteres invisibles normalizados. */
export const norm = (t) => minusculasSinAcentos(String(t ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '')).replace(/\s+/g, ' ').trim();

// Textos ya sin acentos y en minúsculas.
const LUTO_COMENTARIO = [
  /descans\w* en paz/, /en paz descanse/, /\bq\.?e\.?p\.?d\.?\b/, /\bqdep\b/, /\brip\b/, /\bd\.e\.p\b/, /paz a su (alma|memoria)/,
  /\bpesame/, /sentido pesame/, /condolencia/, /lamento.{0,40}(perdida|fallecimiento|partida|muerte|deceso|noticia)/,
  /lamentamos.{0,40}(perdida|fallecimiento|partida|muerte|deceso|noticia)/, /triste noticia/, /falleci/, /\bmurio\b/,
  /se nos (fue|adelanto)/, /nos dejo\b/, /ya no esta con nosotros/, /en su gloria/, /luz eterna/,
  /que dios (lo|la|los|le) (tenga|reciba|cuide|de)/, /dios (los )?(bendiga|consuele).{0,30}familia/,
  /(fortaleza|fuerza) (para|a) (la |su |sus |toda )?(familia|ustedes)/, /mis oraciones/, /nuestras oraciones/, /oraciones (por|para)/,
  /un abrazo (fuerte |muy fuerte |enorme )?(a|para) (la |su |toda )?familia/, /(lo|la) recordaremos/,
  /\bfuneral/, /velorio/, /sepelio/, /entierro/, /novenario/, /misa de cuerpo presente/, /[🕊🕯⚰✝🥀]/u,
];
// Señales débiles: se trata con cuidado (luto) pero se marca para que lo veas tú.
const LUTO_COMENTARIO_DEBIL = [/hasta siempre/, /[😢😭]/u, /\bdescanse\b/];
const LUTO_PUBLICACION = [
  /descans\w* en paz/, /en paz descanse/, /\bq\.?e\.?p\.?d\.?\b/, /\bqdep\b/, /\brip\b/, /in memoriam/, /en memoria de/, /falleci/,
  /nos (dejo|ha dejado|dejaste)\b/, /ya no esta con nosotros/, /\bpostum/, /\bluto\b/, /sentido pesame/,
  /lamentamos.{0,50}(fallecimiento|perdida|partida|deceso|noticia)/, /\bdeceso\b/, /lamentable perdida/,
  /con (profundo )?dolor (informamos|comunicamos|despedimos)/, /nos despedimos de/, /ultimo adios/, /velorio/, /funeral/,
  /sepelio/, /esquela/, /obituario/, /eterno descanso/,
];
const LUTO_PUBLICACION_DEBIL = [/\bduelo\b/, /hasta siempre/, /luz eterna/, /\bpartio\b/, /\bmurio\b/, /[🕊🕯⚰✝🥀]/u];

const QUEJA_COMENTARIO = [
  /\bquej/, /pesim[oa]/, /horrible/, /terrible/, /malisim/, /mal servicio/, /mala atencion/, /mala experiencia/,
  /nunca (me )?(llego|contestaron|respondieron|respondio|contesto|atendieron)/, /no (me )?(llego|contestan|responden|respondieron|contestaron|han contestado|atendieron)/,
  /no (lo )?recomiendo/, /estaf/, /fraude/, /\bengan/, /decepcion/, /molest/, /enojad/, /inconforme/, /reclam/, /reembols/, /devolucion/,
  /me cobraron/, /cobro de mas/, /tardaron/, /llevo (\d+|una|dos|tres|varias?|muchas?) (horas?|dias?|semanas?|meses)/,
  /esperando (mi|una|respuesta|desde)/, /nadie (me )?(contesta|responde|atiende)/, /lamentable/, /verguenza/, /incumpl/, /defectuos/,
  /llego (roto|mal|danado|tarde)/, /[🤬😡👎]/u,
];
// Spam: señales fuertes (un enlace, una promesa de dinero fácil). Un correo o un nombre de sitio suelto NO es spam: puede ser una persona dejando su contacto.
const SPAM_COMENTARIO = [
  /https?:\/\//, /\bwww\./, /\bwa\.me\b|\bt\.me\/|\bbit\.ly\b/,
  /gana(r)? (dinero|\$)/, /dinero (facil|rapido)/, /trabaj[ao] desde casa/, /inversion(es)? (segura|garantizada)/, /criptomoned|bitcoin|forex|\busdt\b/,
  /\bsigueme\b|\bsiganme\b|follow (me|back|for)|\bf4f\b|\bl4l\b|\bs4s\b/, /compra(r)? (seguidores|likes)/,
  /\bcasino\b|\bapuestas?\b|viagra|\bxxx\b|onlyfans/, /check (my|out my) (profile|page)/, /\bdm me\b/,
];
const CONTACTO_EN_COMENTARIO = [/\S+@\S+\.\S+/, /\d(?:[\s().\/-]?\d){7,}/];
const INYECCION = [
  /ignora (todas )?(tus|las|todas las|todo lo|lo) (instrucciones|reglas|anterior|que te)/, /ignora (todas )?(tus|las) reglas/, /olvida(te)? (de )?(tus|las|todo|lo anterior)/,
  /ignore (all|your|previous|the)/, /system prompt|prompt del sistema|tus instrucciones (son|eran)|dime tus instrucciones|muestrame tus instrucciones/,
  /eres ahora\b|ahora eres\b|desde ahora (eres|actua|responde)|a partir de (ahora|este momento) (eres|actua|responde|ignora)/,
  /\bactua como\b|\bfinge (que|ser)\b|\bnuevo rol\b|instrucciones (anteriores|previas)/, /\bjailbreak\b/, /responde (solo |unicamente )?con (la palabra|el texto|\")/,
  /regalame|dame (un )?(descuento|gratis)|100 ?% de descuento|todo (es )?gratis/,
  /\b(di|dime|diles?|responde|contesta|escribe|publica) que (todo|todos|todas|es|son|esta|estan|no)\b/, /tus (reglas|instrucciones) (ya )?no (valen|aplican)/,
];
const PREGUNTA_PRECIO = [
  /cuanto (cuesta|cuestan|vale|valen|sale|salen|cobran|es el|seria)/, /\bprecio/, /\bcosto/, /\bcotiza/, /\btarifa/, /\bcuesta\b/, /que precio/, /a como/,
];

const coincide = (patrones, t) => patrones.find((p) => p.test(t));

/** Convierte palabras extra del negocio en expresiones (se buscan como texto, sin acentos). */
function extras(lista) {
  return (lista || []).map((x) => norm(x)).filter(Boolean).map((x) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/**
 * ¿La publicación es de luto, pérdida u homenaje póstumo? Si lo es, TODO comentario ahí se trata como luto.
 * @returns {{sensible:boolean, fuerza?:'fuerte'|'debil', motivo?:string}}
 */
export function publicacionEsSensible(textoPublicacion, negocio = {}) {
  const t = norm(textoPublicacion);
  if (!t) return { sensible: false };
  if (coincide([...LUTO_PUBLICACION, ...extras(negocio.palabrasLuto)], t)) {
    return { sensible: true, fuerza: 'fuerte', motivo: 'la publicación habla de una pérdida o un homenaje' };
  }
  if (coincide(LUTO_PUBLICACION_DEBIL, t)) {
    return { sensible: true, fuerza: 'debil', motivo: 'la publicación podría ser de luto (una palabra o un emoji ambiguo); lo trato con cuidado y te lo marco' };
  }
  return { sensible: false };
}

export function esPreguntaDePrecio(textoComentario) {
  return Boolean(coincide(PREGUNTA_PRECIO, norm(textoComentario)));
}

/**
 * Clasifica por reglas.
 * @returns {{tipo:'luto'|'queja'|'normal'|'spam', motivos:string[], sospechoso:boolean, avisar:boolean, preguntaPrecio:boolean}}
 */
export function clasificarPorReglas(textoComentario, { textoPublicacion = '', negocio = {} } = {}) {
  const t = norm(textoComentario);
  const motivos = [];
  const sensible = publicacionEsSensible(textoPublicacion, negocio);
  const sospechoso = Boolean(coincide(INYECCION, t));
  const preguntaPrecio = esPreguntaDePrecio(textoComentario);
  const esSpam = Boolean(coincide(SPAM_COMENTARIO, t));
  const lutoFuerte = Boolean(coincide([...LUTO_COMENTARIO, ...extras(negocio.palabrasLuto)], t));
  const lutoDebil = !lutoFuerte && Boolean(coincide(LUTO_COMENTARIO_DEBIL, t));
  const esQueja = Boolean(coincide([...QUEJA_COMENTARIO, ...extras(negocio.palabrasQueja)], t));
  const dejoContacto = Boolean(coincide(CONTACTO_EN_COMENTARIO, textoComentario) || coincide(CONTACTO_EN_COMENTARIO, t));

  if (sospechoso) motivos.push('intenta darle órdenes al asistente');
  if (dejoContacto) motivos.push('deja un teléfono o un correo: conviene que lo veas tú');
  if (esSpam) return { tipo: 'spam', motivos: [...motivos, 'parece publicidad o estafa'], sospechoso, avisar: false, preguntaPrecio };
  if (sensible.sensible) {
    motivos.push(sensible.motivo);
    if (esQueja) motivos.push('además trae una queja: conviene que la veas tú');
    return { tipo: 'luto', motivos, sospechoso, avisar: esQueja || sospechoso || sensible.fuerza === 'debil' || dejoContacto, preguntaPrecio };
  }
  if (lutoFuerte || lutoDebil) {
    motivos.push(lutoFuerte ? 'el comentario expresa condolencias o duelo' : 'el comentario podría ser de duelo (señal débil): lo trato con cuidado y te lo marco');
    if (esQueja) motivos.push('además trae una queja: conviene que la veas tú');
    return { tipo: 'luto', motivos, sospechoso, avisar: esQueja || sospechoso || lutoDebil || dejoContacto, preguntaPrecio };
  }
  if (esQueja) return { tipo: 'queja', motivos: [...motivos, 'el comentario es una queja o un reclamo'], sospechoso, avisar: true, preguntaPrecio };
  return { tipo: 'normal', motivos, sospechoso, avisar: sospechoso || dejoContacto, preguntaPrecio };
}

const SEVERIDAD = { normal: 0, queja: 1, luto: 2 };

/** Combina dos clasificaciones: gana la más delicada; «spam» de cualquiera de las dos significa no contestar. */
export function combinarTipos(a, b) {
  if (a === 'spam' || b === 'spam') return 'spam';
  const sa = SEVERIDAD[a] ?? 0;
  const sb = SEVERIDAD[b] ?? 0;
  return sb > sa ? b : (SEVERIDAD[a] === undefined ? 'normal' : a);
}
