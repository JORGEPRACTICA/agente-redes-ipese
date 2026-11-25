// Lectura y revisión del calendario (calendario.json, o calendario.csv si prefieres una hoja de cálculo).
// Claude Code edita este archivo por ti. Aquí se revisa que todo esté bien ANTES de que algo se publique,
// y los errores se explican en español claro.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { localAUtc, minusculasSinAcentos, formatoFecha, zonaValida } from './util.js';
import { huellaTexto, contarHashtags, contarMenciones } from './texto.js';
import { revisarImagenParaInstagram } from './jpeg.js';

export const REDES = ['instagram', 'facebook'];
const ESTADOS = ['activa', 'pausada', 'ejemplo'];

// ---------------------------------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------------------------------

/**
 * Interpreta una fecha y hora escritas por una persona. Acepta:
 *   2026-12-01 10:00        (hora de tu zona horaria)
 *   2026-12-01T10:00:00-06:00  (con zona explícita)
 *   01/12/2026 10:00        (día/mes/año, como se escribe en México)
 * @returns {{ms:number}|{error:string}}
 */
export function interpretarFecha(valor, zona) {
  const t = String(valor ?? '').trim();
  if (!t) return { error: 'falta la fecha y la hora (por ejemplo 2026-12-01 10:00)' };
  let anio; let mes; let dia; let hora; let minuto; let segundo = 0; let zonaExplicita = null;

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    [anio, mes, dia, hora, minuto] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
    segundo = m[6] ? Number(m[6]) : 0;
    zonaExplicita = m[7] || null;
  } else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[T\s,]+(\d{1,2}):(\d{2})$/);
    if (m) {
      [dia, mes, anio, hora, minuto] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
    } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      return { error: `a «${t}» le falta la hora (por ejemplo 2026-12-01 10:00)` };
    } else {
      return { error: `no entiendo la fecha «${t.slice(0, 40)}». Escríbela así: 2026-12-01 10:00` };
    }
  }
  const prueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (mes < 1 || mes > 12 || dia < 1 || prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) {
    return { error: `la fecha «${t.slice(0, 40)}» no existe en el calendario` };
  }
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59 || segundo < 0 || segundo > 59) {
    return { error: `la hora de «${t.slice(0, 40)}» no es válida (usa de 00:00 a 23:59)` };
  }
  if (zonaExplicita) {
    if (/^z$/i.test(zonaExplicita)) return { ms: Date.UTC(anio, mes - 1, dia, hora, minuto, segundo) };
    const signo = zonaExplicita[0] === '-' ? -1 : 1;
    const digitos = zonaExplicita.slice(1).replace(':', '');
    const minutos = Number(digitos.slice(0, 2)) * 60 + Number(digitos.slice(2, 4));
    return { ms: Date.UTC(anio, mes - 1, dia, hora, minuto, segundo) - signo * minutos * 60000 };
  }
  return { ms: localAUtc(anio, mes, dia, hora, minuto, segundo, zona) };
}

// ---------------------------------------------------------------------------------------------------
// CSV (lector sencillo: comas o punto y coma, comillas, saltos de línea dentro de comillas)
// ---------------------------------------------------------------------------------------------------

export function parsearCsv(texto) {
  const t = String(texto ?? '').replace(/^\p{Cf}+/u, '');
  const primera = t.split(/\r?\n/)[0] || '';
  const cuenta = (c) => primera.split(c).length - 1;
  const delimitador = cuenta(';') > cuenta(',') && cuenta(';') >= cuenta('\t') ? ';' : (cuenta('\t') > cuenta(',') ? '\t' : ',');
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i += 1; } else entreComillas = false;
      } else campo += c;
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === delimitador) {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  if (!filas.length) return [];
  const encabezados = filas[0].map((h) => minusculasSinAcentos(h).trim().replace(/\s+/g, '_'));
  return filas.slice(1).map((f) => {
    const objeto = {};
    encabezados.forEach((h, i) => { if (h) objeto[h] = (f[i] ?? '').trim(); });
    return objeto;
  });
}

// ---------------------------------------------------------------------------------------------------
// Normalización de campos
// ---------------------------------------------------------------------------------------------------

const SINONIMOS = {
  fecha: ['fecha', 'fecha_hora', 'cuando', 'programada', 'fecha_y_hora'],
  hora: ['hora'],
  texto: ['texto', 'copy', 'caption', 'pie', 'descripcion', 'mensaje'],
  texto_instagram: ['texto_instagram', 'texto_ig', 'instagram_texto'],
  texto_facebook: ['texto_facebook', 'texto_fb', 'facebook_texto'],
  imagen: ['imagen', 'foto', 'archivo', 'imagen_jpg'],
  redes: ['redes', 'red', 'plataformas'],
  id: ['id', 'identificador'],
  estado: ['estado', 'status'],
};

const claveNormal = (k) => minusculasSinAcentos(k).trim().replace(/\s+/g, '_');
// Todo lo que se reconoce. Lo demás se señala como problema para no ignorar en silencio algo que la persona quiso decir.
const CLAVES_CONOCIDAS = new Set([...Object.values(SINONIMOS).flat(), 'pausada', 'ejemplo', 'nota', 'notas', 'ayuda']);

function campo(entrada, nombre) {
  const claves = Object.keys(entrada);
  for (const sinonimo of SINONIMOS[nombre]) {
    const k = claves.find((x) => claveNormal(x) === sinonimo);
    if (k !== undefined && entrada[k] !== undefined && entrada[k] !== null) return entrada[k];
  }
  return undefined;
}

function interpretarRedes(valor) {
  if (valor === undefined || valor === null || valor === '') return { redes: [...REDES] };
  const lista = Array.isArray(valor) ? valor : String(valor).split(/[,;|/\s]+/);
  const redes = [];
  for (const crudo of lista) {
    const r = minusculasSinAcentos(crudo).trim();
    if (!r) continue;
    if (['instagram', 'ig', 'insta'].includes(r)) redes.push('instagram');
    else if (['facebook', 'fb', 'face'].includes(r)) redes.push('facebook');
    else if (['ambas', 'todas', 'las dos'].includes(r)) redes.push(...REDES);
    else return { error: `la red «${String(crudo).slice(0, 20)}» no existe; usa instagram, facebook o las dos` };
  }
  const unicas = [...new Set(redes)];
  return unicas.length ? { redes: unicas } : { error: 'no dice en qué red publicar (instagram, facebook o las dos)' };
}

function idAutomatico(fechaTexto, imagen, texto) {
  const base = `${fechaTexto}|${imagen || ''}|${huellaTexto(texto)}`;
  return 'p' + crypto.createHash('sha256').update(base).digest('hex').slice(0, 8);
}

// Revisar una imagen es lo más lento: se recuerda el resultado mientras el archivo no cambie.
const memoriaImagenes = new Map();
function revisarArchivoDeImagen(ruta) {
  const st = fs.statSync(ruta);
  const clave = `${ruta}|${st.size}|${st.mtimeMs}`;
  if (memoriaImagenes.has(clave)) return memoriaImagenes.get(clave);
  const buffer = fs.readFileSync(ruta);
  const resultado = revisarImagenParaInstagram(buffer);
  if (memoriaImagenes.size > 200) memoriaImagenes.clear();
  memoriaImagenes.set(clave, resultado);
  return resultado;
}

// ---------------------------------------------------------------------------------------------------
// Lectura del calendario
// ---------------------------------------------------------------------------------------------------

function encontrarArchivo(dir) {
  for (const nombre of ['calendario.json', 'calendario.csv']) {
    const ruta = path.join(dir, nombre);
    if (fs.existsSync(ruta)) return { nombre, ruta };
  }
  return null;
}

function leerJson(ruta, nombre) {
  const crudo = fs.readFileSync(ruta, 'utf8').replace(/^\p{Cf}+/u, '');
  try {
    const datos = JSON.parse(crudo);
    const lista = Array.isArray(datos) ? datos : (datos && Array.isArray(datos.publicaciones) ? datos.publicaciones : null);
    if (!lista) return { error: `${nombre} debe tener una lista llamada «publicaciones».` };
    return { lista };
  } catch (e) {
    const pos = Number((String(e.message).match(/position (\d+)/) || [])[1]);
    const linea = Number.isFinite(pos) ? crudo.slice(0, pos).split('\n').length : null;
    return { error: `${nombre} tiene un error de escritura${linea ? ` cerca de la línea ${linea}` : ''} (falta o sobra una coma, una comilla o una llave). Pide a Claude Code que lo corrija.` };
  }
}

/**
 * @param {{dir:string, imagenesDir?:string, zona?:string}} opciones
 * @returns {{archivo:string|null, publicaciones:object[], problemas:string[], advertencias:string[]}}
 */
export function cargarCalendario({ dir, imagenesDir, zona = 'America/Mexico_City' }) {
  const resultado = { archivo: null, publicaciones: [], problemas: [], advertencias: [] };
  if (!zonaValida(zona)) {
    resultado.problemas.push(`La zona horaria «${zona}» no existe.`);
    return resultado;
  }
  const encontrado = encontrarArchivo(dir);
  if (!encontrado) {
    resultado.problemas.push('No encuentro calendario.json. Pide a Claude Code que lo cree.');
    return resultado;
  }
  resultado.archivo = encontrado.nombre;
  let lista;
  try {
    if (encontrado.nombre.endsWith('.csv')) {
      lista = parsearCsv(fs.readFileSync(encontrado.ruta, 'utf8'));
    } else {
      const leido = leerJson(encontrado.ruta, encontrado.nombre);
      if (leido.error) { resultado.problemas.push(leido.error); return resultado; }
      lista = leido.lista;
    }
  } catch (e) {
    resultado.problemas.push(`No pude leer ${encontrado.nombre}: ${String(e.message).slice(0, 120)}`);
    return resultado;
  }

  const idsVistos = new Map();
  const huellasVistas = new Map();
  lista.forEach((entrada, i) => {
    const numero = i + 1;
    const p = { indice: numero, problemas: [], advertencias: [] };
    const nombre = () => (p.id ? `«${p.id}»` : `n.º ${numero}`);
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      p.problemas.push('no es una publicación (debe tener fecha, texto e imagen)');
      p.valida = false; p.estado = 'activa'; p.redes = []; resultado.publicaciones.push(p);
      resultado.problemas.push(`Publicación n.º ${numero}: no es una publicación (debe tener fecha, texto e imagen).`);
      return;
    }

    // Campos que no reconozco: ignorarlos en silencio podría publicar algo que la persona quiso pausar o cambiar.
    for (const k of Object.keys(entrada)) {
      if (!CLAVES_CONOCIDAS.has(claveNormal(k))) p.problemas.push(`no reconozco el campo «${String(k).slice(0, 30)}» (los campos son: fecha, texto, imagen, redes, id, estado, texto_instagram y texto_facebook)`);
    }
    const comoTexto = (valor, nombreCampo) => {
      if (valor === undefined || valor === null) return '';
      if (typeof valor === 'string') return valor;
      p.problemas.push(`${nombreCampo} debe ser un texto entre comillas`);
      return '';
    };
    const bandera = (nombreBandera) => {
      const k = Object.keys(entrada).find((x) => claveNormal(x) === nombreBandera);
      return k !== undefined && (entrada[k] === true || ['si', 'true', '1', 'x', 'yes'].includes(minusculasSinAcentos(String(entrada[k])).trim()));
    };

    // estado (también se acepta «pausada: true» y «ejemplo: true»; si hay duda, gana lo más prudente)
    const estadoCrudo = minusculasSinAcentos(comoTexto(campo(entrada, 'estado'), 'el estado') || 'activa').trim() || 'activa';
    p.estado = ESTADOS.includes(estadoCrudo) ? estadoCrudo : 'activa';
    if (!ESTADOS.includes(estadoCrudo)) p.problemas.push(`el estado «${estadoCrudo.slice(0, 20)}» no existe; usa activa, pausada o ejemplo`);
    if (bandera('pausada')) p.estado = 'pausada';
    else if (bandera('ejemplo') && p.estado === 'activa') p.estado = 'ejemplo';

    // id
    const idCrudo = campo(entrada, 'id');
    p.id = idCrudo !== undefined && String(idCrudo).trim() ? String(idCrudo).trim() : null;
    if (p.id && !/^[A-Za-z0-9._-]{1,40}$/.test(p.id)) {
      p.problemas.push(`el id «${p.id.slice(0, 20)}» solo puede llevar letras, números, punto, guion y guion bajo (hasta 40)`);
    }

    // fecha (la hora puede venir en una columna aparte)
    let fechaCruda = comoTexto(campo(entrada, 'fecha'), 'la fecha');
    const horaCruda = comoTexto(campo(entrada, 'hora'), 'la hora');
    if (fechaCruda && horaCruda.trim() && !/\d{1,2}:\d{2}/.test(fechaCruda)) {
      fechaCruda = `${fechaCruda.trim()} ${horaCruda.trim()}`;
    }
    p.fechaTexto = String(fechaCruda ?? '').trim();
    const f = interpretarFecha(p.fechaTexto, zona);
    if (f.error) p.problemas.push(f.error); else p.programadoMs = f.ms;

    // redes
    const r = interpretarRedes(campo(entrada, 'redes'));
    if (r.error) { p.problemas.push(r.error); p.redes = []; } else p.redes = r.redes;

    // textos
    const texto = comoTexto(campo(entrada, 'texto'), 'el texto').replace(/\r\n?/g, '\n').trim();
    const textoIG = comoTexto(campo(entrada, 'texto_instagram'), 'el texto de Instagram').replace(/\r\n?/g, '\n').trim();
    const textoFB = comoTexto(campo(entrada, 'texto_facebook'), 'el texto de Facebook').replace(/\r\n?/g, '\n').trim();
    p.texto = texto;
    p.textoInstagram = textoIG || texto || textoFB;
    p.textoFacebook = textoFB || texto || textoIG;
    if (p.redes.includes('instagram') && !p.textoInstagram) p.problemas.push('falta el texto de la publicación');
    else if (p.redes.includes('facebook') && !p.textoFacebook) p.problemas.push('falta el texto de la publicación');

    // imagen
    const imagenCruda = comoTexto(campo(entrada, 'imagen'), 'la imagen').trim();
    p.imagen = imagenCruda || null;
    p.imagenRuta = null;
    if (p.redes.includes('instagram') && !imagenCruda) {
      p.problemas.push('Instagram exige una imagen (si solo quieres publicar en Facebook, escribe redes: facebook)');
    }
    if (imagenCruda) {
      if (/[\\/]/.test(imagenCruda) || imagenCruda.includes('..')) {
        p.problemas.push(`la imagen «${imagenCruda.slice(0, 40)}» debe ser solo el nombre del archivo; el archivo vive en la carpeta imagenes`);
      } else if (!/\.jpe?g$/i.test(imagenCruda)) {
        p.problemas.push(`la imagen «${imagenCruda.slice(0, 40)}» debe ser JPEG (.jpg). Instagram no acepta .png ni .webp; pide a Claude Code que la convierta`);
      } else if (!imagenesDir) {
        p.problemas.push('no sé dónde está la carpeta de imágenes');
      } else {
        const ruta = path.join(imagenesDir, imagenCruda);
        let nombresReales = [];
        try { nombresReales = fs.readdirSync(imagenesDir); } catch { /* la carpeta no existe: se dirá abajo */ }
        if (!fs.existsSync(ruta)) {
          p.problemas.push(`no encuentro la imagen «${imagenCruda.slice(0, 40)}» en la carpeta imagenes`);
        } else if (!nombresReales.includes(imagenCruda)) {
          // En Windows y Mac «Foto.JPG» y «foto.jpg» son el mismo archivo; en Railway (Linux) NO: Meta no podría descargarla.
          const real = nombresReales.find((n) => n.toLowerCase() === imagenCruda.toLowerCase());
          p.problemas.push(`la imagen se llama «${String(real || '?').slice(0, 40)}» (con esas mayúsculas y minúsculas) y en el calendario dice «${imagenCruda.slice(0, 40)}»; escríbela exactamente igual, porque en Railway importan las mayúsculas`);
        } else {
          p.imagenRuta = ruta;
          try {
            const rev = revisarArchivoDeImagen(ruta);
            if (!rev.ok) {
              const detalle = rev.problemas.join('; ');
              if (p.redes.includes('instagram')) p.problemas.push(`la imagen «${imagenCruda.slice(0, 40)}» ${detalle}`);
              else p.advertencias.push(`la imagen «${imagenCruda.slice(0, 40)}» ${detalle} (en Instagram no se aceptaría)`);
            }
          } catch (e) {
            p.problemas.push(`no pude leer la imagen «${imagenCruda.slice(0, 40)}»`);
          }
        }
      }
    }

    // límites de Instagram (se ajustan solos al publicar, pero conviene avisar)
    if (p.redes.includes('instagram') && p.textoInstagram) {
      if (p.textoInstagram.length > 2200) p.advertencias.push(`el texto mide ${p.textoInstagram.length} caracteres; para Instagram se acortará a 2,200 (Facebook lo recibe completo)`);
      if (contarHashtags(p.textoInstagram) > 30) p.advertencias.push('trae más de 30 hashtags; para Instagram se dejarán 30');
      if (contarMenciones(p.textoInstagram) > 20) p.advertencias.push('trae más de 20 menciones (@); para Instagram se dejarán 20');
    }

    // id automático y duplicados
    p.idAutomatico = !p.id;
    if (!p.id && p.fechaTexto) p.id = idAutomatico(p.fechaTexto, p.imagen, p.textoInstagram || p.textoFacebook);
    if (p.id) {
      if (idsVistos.has(p.id)) {
        p.problemas.push(`el id ${nombre()} está repetido con la publicación n.º ${idsVistos.get(p.id)}`);
      } else idsVistos.set(p.id, numero);
    } else {
      p.id = `sin-id-${numero}`;
    }
    const huella = `${p.programadoMs}|${p.imagen}|${huellaTexto(p.textoInstagram || p.textoFacebook)}`;
    if (p.programadoMs !== undefined && huellasVistas.has(huella)) {
      p.advertencias.push(`es igual a la publicación n.º ${huellasVistas.get(huella)} (misma hora, texto e imagen)`);
    } else if (p.programadoMs !== undefined) huellasVistas.set(huella, numero);

    p.valida = p.problemas.length === 0;
    resultado.publicaciones.push(p);
    for (const x of p.problemas) resultado.problemas.push(`Publicación ${nombre()}${p.fechaTexto ? ` (${p.fechaTexto})` : ''}: ${x}.`);
    for (const x of p.advertencias) resultado.advertencias.push(`Publicación ${nombre()}${p.fechaTexto ? ` (${p.fechaTexto})` : ''}: ${x}.`);
  });

  if (!resultado.publicaciones.length) resultado.advertencias.push('El calendario está vacío: todavía no hay publicaciones programadas.');
  return resultado;
}

/** Texto para mostrar la fecha de una publicación en la zona del negocio. */
export function fechaParaMostrar(pub, zona) {
  return Number.isFinite(pub.programadoMs) ? formatoFecha(pub.programadoMs, zona) : (pub.fechaTexto || 'sin fecha');
}
