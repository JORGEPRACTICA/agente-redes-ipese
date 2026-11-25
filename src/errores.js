// Errores de la API de Meta (Instagram y Facebook): clasificación y explicación en español.
// Son funciones PURAS (sin red): se prueban aparte.
//
// Idea central: un error PASAJERO (límite de llamadas, servicio caído, medio aún no listo) no debe gastar los
// 5 intentos seguidos. El Publicador espera 10, 30, 60 y 120 minutos entre intentos. Un error DEFINITIVO
// (token inválido, cuenta restringida) no mejora esperando: se detiene y se explica.

// Códigos de error de Meta que son pasajeros o de límite de frecuencia:
//   1 desconocido · 2 servicio no disponible · 4 límite de la app · 17 límite del usuario · 32 límite de la página
//   341 límite de la aplicación · 613 límite de llamadas · 9007 el medio aún no está listo para publicar
const CODIGOS_PASAJEROS = new Set([1, 2, 4, 17, 32, 341, 613, 9007]);
// Códigos que son LÍMITE DE FRECUENCIA: si Meta rechazó la llamada por esto, seguir llamando solo alarga el bloqueo.
const CODIGOS_LIMITE = new Set([4, 17, 32, 341, 613]);
// Subcódigos de Instagram pasajeros: 2207001 error del servidor · 2207003 tiempo agotado al descargar el medio
// · 2207008 contenedor inexistente o caducado · 2207020 el contenedor caducó · 2207027 el contenedor aún no está listo
// · 2207032 falló la creación del medio, intenta otra vez · 2207053 error de subida
const SUBCODIGOS_PASAJEROS = new Set([2207001, 2207003, 2207008, 2207020, 2207027, 2207032, 2207053]);
// Subcódigos DEFINITIVOS aunque vengan con un código de límite: 2207050 cuenta restringida · 2207051 Instagram frena
// la actividad para proteger a la comunidad (Meta pide NO reintentar).
const SUBCODIGOS_DEFINITIVOS = new Set([2207050, 2207051]);
// Códigos definitivos: 190 token inválido o caducado · 10 y 200 a 299 permisos · 803 el objeto no existe
const CODIGOS_DEFINITIVOS = new Set([190, 10, 803]);

// Espera (en minutos) antes del siguiente intento, según cuántos intentos van (1 = acaba de fallar el primero).
// 10 + 30 + 60 + 120 minutos: el quinto y último intento llega unas 3 h 40 min después del primero.
export const ESPERAS_MIN = [10, 30, 60, 120];
export const MAX_INTENTOS = 5;

export function esperaReintentoMin(intentos) {
  const n = Math.max(1, Math.floor(Number(intentos) || 1));
  return ESPERAS_MIN[Math.min(ESPERAS_MIN.length, n) - 1];
}

function leerEncabezado(encabezados, nombre) {
  if (!encabezados) return null;
  try {
    if (typeof encabezados.get === 'function') return encabezados.get(nombre) || null;
    const k = Object.keys(encabezados).find((x) => x.toLowerCase() === nombre.toLowerCase());
    return k ? String(encabezados[k]) : null;
  } catch {
    return null;
  }
}

const aNumero = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Convierte la respuesta de error de Meta en un objeto uniforme.
 * @param {object} json         cuerpo JSON de la respuesta (puede venir vacío)
 * @param {number} http         código HTTP
 * @param {object} encabezados  Headers de fetch u objeto plano (opcional)
 */
export function analizarErrorMeta(json, http, encabezados, quitarSecretos = (x) => x) {
  const e = (json && json.error) || {};
  const codigo = aNumero(e.code);
  const subcodigo = aNumero(e.error_subcode);
  const h = Number(http) || 0;
  // Los secretos se quitan ANTES de recortar el mensaje: si un token cruzara el límite de 300 caracteres, quedaría a medias.
  const mensajeLimpio = e.message ? quitarSecretos(String(e.message)) : '';
  const mensajeUsuarioLimpio = e.error_user_msg ? quitarSecretos(String(e.error_user_msg)) : '';
  const porLimiteNegocio = codigo !== null && codigo >= 80000 && codigo <= 80014;   // límites por caso de negocio (80002 = Instagram)
  const subDefinitivo = subcodigo !== null && SUBCODIGOS_DEFINITIVOS.has(subcodigo);
  const transitorio = !subDefinitivo && Boolean(
    e.is_transient === true ||
    (codigo !== null && CODIGOS_PASAJEROS.has(codigo)) ||
    porLimiteNegocio ||
    (subcodigo !== null && SUBCODIGOS_PASAJEROS.has(subcodigo)) ||
    h === 429 || h >= 500
  );
  // Un rechazo de Meta (HTTP 4xx) que no está en la lista de errores pasajeros NO se arregla esperando: se detiene y se explica,
  // en vez de insistir cinco veces contra una API que ya dijo que no.
  const rechazoDeMeta = h >= 400 && h < 500 && h !== 429;
  const definitivo = !transitorio && (
    subDefinitivo ||
    (codigo !== null && (CODIGOS_DEFINITIVOS.has(codigo) || (codigo >= 200 && codigo <= 299))) ||
    rechazoDeMeta
  );
  return {
    http: h || null,
    mensaje: mensajeLimpio.slice(0, 300),
    mensajeUsuario: mensajeUsuarioLimpio.slice(0, 300),
    tipo: e.type || null,
    codigo,
    subcodigo,
    transitorio,
    definitivo,
    marcadoTransitorioPorMeta: e.is_transient === true,
    fbtrace: e.fbtrace_id || null,
    usoApp: leerEncabezado(encabezados, 'x-app-usage'),
    usoNegocio: leerEncabezado(encabezados, 'x-business-use-case-usage'),
  };
}

/** ¿Meta rechazó la llamada por límite de frecuencia? (entonces no conviene hacer más llamadas de comprobación). */
export function esLimiteMeta(m) {
  if (!m) return false;
  if (m.codigo !== null && m.codigo !== undefined) {
    if (CODIGOS_LIMITE.has(m.codigo)) return true;
    if (m.codigo >= 80000 && m.codigo <= 80014) return true;
  }
  return m.http === 429;
}

/** Saca el subcódigo 2207xxx del texto «status» de un contenedor en ERROR (p. ej. «Error: Media upload has failed with error code 2207026»). */
export function subcodigoDeEstado(texto) {
  const m = String(texto == null ? '' : texto).match(/\b(2207\d{3})\b/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------------
// Secretos: nada que parezca una llave debe llegar a un mensaje, a un registro ni a una página.
// ---------------------------------------------------------------------------------------------------

/**
 * Quita de un texto los secretos que se conocen (las variables del servicio) y todo lo que tenga forma de llave
 * (tokens de Meta y de GitHub, llaves de Anthropic, encabezados «Bearer», «access_token=…»).
 */
export function redactar(texto, secretos = []) {
  let x = String(texto == null ? '' : texto);
  for (const s of secretos) {
    if (s && String(s).length >= 6) x = x.split(String(s)).join('[oculto]');
  }
  x = x.replace(/(access_token|client_secret|app_secret|api_key|x-api-key)(["']?\s*[=:]\s*["']?)[^&\s"',}]+/gi, '$1$2[oculto]');
  x = x.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [oculto]');
  x = x.replace(/\b(E[A]{2}|IG[A]{2}|IG[Q]V)[A-Za-z0-9_-]{16,}/g, '[token]');
  x = x.replace(/\bsk-an[t]-[A-Za-z0-9_-]{8,}/g, '[llave]');
  x = x.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[token]');
  x = x.replace(/\bgithub[_]pat[_][A-Za-z0-9_]{16,}/g, '[token]');
  return x;
}

/** Crea una función que redacta con los secretos de ESTE servicio. */
export function crearRedactor(secretos = []) {
  const lista = [...new Set(secretos.filter((s) => typeof s === 'string' && s.length >= 6))]
    .sort((a, b) => b.length - a.length);
  return (texto) => redactar(texto, lista);
}

/** Una línea legible para el registro del servidor (sin datos secretos). */
export function resumirDetalle(m) {
  if (!m) return '';
  const partes = [];
  if (m.paso) partes.push(`paso=${m.paso}`);
  if (m.http) partes.push(`http=${m.http}`);
  if (m.codigo !== null && m.codigo !== undefined) partes.push(`code=${m.codigo}`);
  if (m.subcodigo !== null && m.subcodigo !== undefined) partes.push(`sub=${m.subcodigo}`);
  if (m.tipo) partes.push(`tipo=${m.tipo}`);
  partes.push(`pasajero=${m.transitorio ? 'sí' : 'no'}${m.marcadoTransitorioPorMeta ? ' (lo marca Meta)' : ''}`);
  if (m.fbtrace) partes.push(`trace=${m.fbtrace}`);
  if (m.usoApp) partes.push(`uso_app=${m.usoApp}`);
  if (m.usoNegocio) partes.push(`uso_negocio=${String(m.usoNegocio).slice(0, 160)}`);
  if (m.red) partes.push('sin_respuesta=sí');
  return partes.join(' ');
}

// ---------------------------------------------------------------------------------------------------
// Explicaciones en español claro (qué pasó y qué hacer)
// ---------------------------------------------------------------------------------------------------

/**
 * Traduce un error de Meta a algo que una persona sin conocimientos técnicos pueda actuar.
 * @returns {{titulo:string, queHacer:string, esperar:boolean}}
 */
export function explicarErrorMeta(m, { reintentaSolo = true } = {}) {
  // Las publicaciones se reintentan solas; una respuesta a un comentario NO (la persona la vuelve a aprobar).
  const SOLO = reintentaSolo ? 'No hagas nada: el Publicador lo intenta de nuevo solo.' : 'Espera unos minutos y vuelve a aprobarla.';
  const msg = String((m && (m.mensajeUsuario || m.mensaje)) || '');
  const bajo = msg.toLowerCase();
  if (!m) return { titulo: 'Meta devolvió un error que no pude leer.', queHacer: 'Copia el mensaje del registro (no lleva llaves) y pégalo en Claude Code.', esperar: false };

  if (m.red) {
    return {
      titulo: 'No pude hablar con Meta (sin internet o Meta tardó demasiado).',
      queHacer: SOLO,
      esperar: true,
    };
  }
  if (m.subcodigo === 2207050 || m.subcodigo === 2207051) {
    return {
      titulo: 'Instagram frenó o restringió la actividad de la cuenta.',
      queHacer: 'Abre la app de Instagram y revisa si te pide confirmar algo. No insistas: Meta pide no reintentar.',
      esperar: false,
    };
  }
  if (m.codigo === 190 || /access token|session has expired|token.*(expired|invalid)|invalid oauth/i.test(msg)) {
    return {
      titulo: 'El token de Meta ya no sirve (caducó, lo regeneraste o cambiaste la contraseña).',
      queHacer: 'Genera un token nuevo (video «La llave de Meta») y pégalo en Railway > Variables, en el nombre IG_TOKEN (o FB_PAGE_TOKEN). No lo pegues en ningún chat.',
      esperar: false,
    };
  }
  // El mensaje estándar de Meta para un número que no existe («Unsupported get request. Object with ID '…' does not exist, cannot be loaded due to
  // missing permissions, or does not support this operation», error 100, subcódigo 33) nombra los permisos, pero casi siempre el problema es el
  // número: se explica ANTES que la falta de permisos. El subcódigo 33 se reconoce aunque el mensaje venga en otro idioma.
  if (m.codigo === 803 || (m.codigo === 100 && m.subcodigo === 33) || /unsupported (get|post) request/i.test(msg)) {
    return {
      titulo: 'Meta no encontró esa cuenta o esa página con ese número.',
      queHacer: `Revisa en Railway > Variables que IG_USER_ID (o FB_PAGE_ID) sea el número de la cuenta de este token, no el @.${/permission|permiso/i.test(msg) || m.subcodigo === 33 ? ' Si el número está bien, genera el token otra vez aceptando todos los permisos.' : ''}`,
      esperar: false,
    };
  }
  if (m.codigo === 10 || (m.codigo !== null && m.codigo >= 200 && m.codigo <= 299) || /permission/i.test(msg)) {
    return {
      titulo: 'Tu token no tiene el permiso necesario para esto.',
      queHacer: 'Genera el token otra vez y acepta todos los permisos que pide Meta (publicar y comentarios). Luego cámbialo en Railway > Variables.',
      esperar: false,
    };
  }
  if (esLimiteMeta(m)) {
    return {
      titulo: 'Meta pide esperar: se hicieron muchas llamadas en poco tiempo.',
      queHacer: reintentaSolo ? 'No hagas nada: el Publicador espera (10, 30, 60 y 120 minutos) y lo intenta de nuevo.' : 'Espera un buen rato (Meta pidió calma) y vuelve a aprobarla.',
      esperar: true,
    };
  }
  if (m.codigo === 803 || /does not exist|unsupported (get|post) request|cannot be loaded|nonexisting/i.test(msg)) {
    return {
      titulo: 'Meta no encontró esa cuenta o esa página con ese número.',
      queHacer: 'Revisa en Railway > Variables que IG_USER_ID (o FB_PAGE_ID) sea el número de la cuenta de este token, no el @.',
      esperar: false,
    };
  }
  if (/aspect ratio/i.test(bajo)) {
    return {
      titulo: 'La forma de la imagen no es aceptada por Instagram (muy alargada o muy ancha).',
      queHacer: 'Usa una imagen cuadrada, vertical 4:5 u horizontal hasta 1.91:1. Pide a Claude Code que la recorte.',
      esperar: false,
    };
  }
  if (/(image|photo|media).*(format|type)|jpeg|jpg/.test(bajo)) {
    return {
      titulo: 'Instagram no aceptó el formato de la imagen.',
      queHacer: 'La imagen debe ser JPEG (.jpg). Pide a Claude Code que la convierta y la ponga en la carpeta imagenes.',
      esperar: false,
    };
  }
  if (/too (large|big)|size/.test(bajo)) {
    return {
      titulo: 'La imagen pesa demasiado.',
      queHacer: 'Instagram pide menos de 8 MB. Pide a Claude Code que la comprima.',
      esperar: false,
    };
  }
  if (/caption/.test(bajo) && /(long|limit|too many)/.test(bajo)) {
    return {
      titulo: 'El texto de la publicación es demasiado largo o trae demasiados hashtags.',
      queHacer: 'Instagram admite 2,200 caracteres, 30 hashtags y 20 menciones. Pide a Claude Code que acorte el texto.',
      esperar: false,
    };
  }
  if (/could not|cannot|unable|fetch|download|timeout|url/.test(bajo) && (m.subcodigo === 2207003 || /image|media|url/.test(bajo))) {
    return {
      titulo: 'Instagram no pudo descargar la imagen desde la dirección pública.',
      queHacer: 'Abre la página /verificar de tu Publicador: ahí dice si la dirección de las imágenes está bien. Revisa PUBLIC_URL.',
      esperar: m.transitorio,
    };
  }
  if (m.transitorio) {
    return {
      titulo: 'Meta tuvo un problema pasajero.',
      queHacer: SOLO,
      esperar: true,
    };
  }
  return {
    titulo: 'Meta rechazó la publicación.',
    queHacer: 'Copia la línea del registro (no lleva llaves) y pégala en Claude Code para que te ayude a entender el motivo.',
    esperar: false,
  };
}
