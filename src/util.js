// Utilidades pequeñas, sin dependencias. Funcionan igual en Windows, Mac y Linux.

export const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Quita acentos y diéresis: «Cámbialo» -> «Cambialo». */
export function sinAcentos(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{M}+/gu, '');
}

export function minusculasSinAcentos(texto) {
  return sinAcentos(texto).toLowerCase();
}

/** Interpreta «si» o «sí» (con o sin comillas, espacios y mayúsculas) como verdadero. Todo lo demás es falso: un interruptor se enciende a propósito. */
export function esAfirmativo(valor) {
  const v = minusculasSinAcentos(valor).trim().replace(/^["']+|["']+$/g, '');
  return v === 'si';
}

/** Número entero de una variable de entorno, con valor por omisión y límites. */
export function enteroEntre(valor, porOmision, minimo, maximo) {
  const n = Number.parseInt(String(valor ?? '').trim(), 10);
  if (!Number.isFinite(n)) return porOmision;
  return Math.min(maximo, Math.max(minimo, n));
}

/** Partes de una fecha (ms desde 1970) vistas desde una zona horaria. */
export function partesEnZona(ms, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    anio: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour), minuto: Number(p.minute), segundo: Number(p.second),
  };
}

const dos = (n) => String(n).padStart(2, '0');

/** «2026-12-01 10:00» en la zona dada. */
export function formatoFecha(ms, zona) {
  const p = partesEnZona(ms, zona);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)} ${dos(p.hora)}:${dos(p.minuto)}`;
}

/** «2026-12-01 10:00:03» en la zona dada. */
export function formatoFechaConSegundos(ms, zona) {
  const p = partesEnZona(ms, zona);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)} ${dos(p.hora)}:${dos(p.minuto)}:${dos(p.segundo)}`;
}

/** Convierte una fecha escrita en hora local de `zona` a milisegundos UTC. */
export function localAUtc(anio, mes, dia, hora, minuto, segundo, zona) {
  const referencia = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);
  const desfase = (ms) => {
    const p = partesEnZona(ms, zona);
    return Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(ms / 1000) * 1000;
  };
  let utc = referencia - desfase(referencia);
  utc = referencia - desfase(utc);
  return utc;
}

export function zonaValida(zona) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

const SEGMENTADOR = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('es', { granularity: 'grapheme' })
  : null;

/** Divide un texto en «caracteres que ve una persona»: un emoji con tono de piel o una bandera cuentan como uno. */
export function graphemes(texto) {
  const t = String(texto ?? '');
  if (SEGMENTADOR) return Array.from(SEGMENTADOR.segment(t), (x) => x.segment);
  return Array.from(t);
}

/** Corta sin partir emojis: devuelve el prefijo más largo de caracteres completos cuyo largo (en unidades de JavaScript) es <= limite. */
export function cortarSeguro(texto, limite) {
  const t = String(texto ?? '');
  if (t.length <= limite) return t;
  let salida = '';
  for (const g of graphemes(t)) {
    if (salida.length + g.length > limite) break;
    salida += g;
  }
  return salida;
}

export function resumirTexto(texto, largo = 60) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= largo) return t;
  return cortarSeguro(t, largo - 1).trimEnd() + '…';
}

/** Une frases sueltas en un solo párrafo: cada una cierra con su punto (si no lo traía) y se separan con un espacio. Las vacías se omiten. */
export function unirFrases(...frases) {
  return frases
    .map((f) => String(f ?? '').trim())
    .filter(Boolean)
    .map((f) => (/[.!?…][»"”')\]]*$/.test(f) ? f : `${f}.`))
    .join(' ');
}
