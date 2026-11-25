// Lee las variables del servicio (Railway > Variables) y las convierte en un objeto de configuración.
// Aquí NO se imprime nunca el valor de una llave: solo se guardan para ocultarlas de los mensajes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esAfirmativo, enteroEntre, zonaValida } from './util.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MODELO_POR_OMISION = 'claude-haiku-5-5';
export const VERSION_API_POR_OMISION = 'v21.0';
export const ZONA_POR_OMISION = 'America/Mexico_City';

const limpiar = (v) => String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();

function quitarBarraFinal(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** Dirección pública del servicio: PUBLIC_URL, o la que Railway pone sola cuando generas el dominio. */
function direccionPublica(env) {
  const propia = quitarBarraFinal(limpiar(env.PUBLIC_URL));
  if (propia) return /^https?:\/\//i.test(propia) ? propia : `https://${propia}`;
  const railway = limpiar(env.RAILWAY_PUBLIC_DOMAIN);
  return railway ? `https://${railway}` : null;
}

/** Servidor de Meta al que se le habla. Los tokens del inicio de sesión de Instagram (empiezan con «IG» y dos «A») usan graph.instagram.com. */
function servidorIG(env, token) {
  const forzado = limpiar(env.META_GRAPH_URL);            // solo para pruebas automáticas
  if (forzado) return quitarBarraFinal(forzado);
  const host = limpiar(env.GRAPH_HOST).toLowerCase();
  if (host === 'instagram') return 'https://graph.instagram.com';
  if (host === 'facebook') return 'https://graph.facebook.com';
  return /^IG(A{2}|QV)/.test(token) ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
}

/**
 * @param {Record<string,string|undefined>} env  por omisión, las variables del proceso
 * @param {{raiz?:string}} opciones
 */
export function leerConfig(env = process.env, { raiz: raizPorOmision = RAIZ } = {}) {
  const advertencias = [];
  // PUBLICADOR_CARPETA solo se usa en las pruebas automáticas: permite apuntar a otra carpeta de calendario e imágenes.
  const raiz = limpiar(env.PUBLICADOR_CARPETA) ? path.resolve(limpiar(env.PUBLICADOR_CARPETA)) : raizPorOmision;

  const valorInterruptor = limpiar(env.PUBLICAR_DE_VERDAD);
  const modoReal = esAfirmativo(valorInterruptor);
  if (valorInterruptor && !modoReal) {
    advertencias.push(`PUBLICAR_DE_VERDAD tiene un valor que no entiendo («${valorInterruptor.slice(0, 20)}»). Para publicar de verdad escribe exactamente: si. Mientras tanto sigo en modo prueba.`);
  }

  let zonaHoraria = limpiar(env.ZONA_HORARIA) || ZONA_POR_OMISION;
  if (!zonaValida(zonaHoraria)) {
    advertencias.push(`ZONA_HORARIA «${zonaHoraria}» no existe. Uso ${ZONA_POR_OMISION}.`);
    zonaHoraria = ZONA_POR_OMISION;
  }

  const igToken = limpiar(env.IG_TOKEN);
  const fbToken = limpiar(env.FB_PAGE_TOKEN);
  const anthropicKey = limpiar(env.ANTHROPIC_API_KEY);
  // La contraseña del panel se toma TAL CUAL (solo se quita el salto de línea del final): una contraseña de un administrador
  // de contraseñas puede empezar o terminar con una comilla o un espacio, y «arreglarla» la dejaría sin entrar.
  const panelClave = String(env.PANEL_CLAVE ?? '').replace(/[\r\n]+$/, '');
  const version = limpiar(env.GRAPH_VERSION) || VERSION_API_POR_OMISION;
  const baseIG = servidorIG(env, igToken);
  const baseFB = limpiar(env.META_GRAPH_URL) ? quitarBarraFinal(limpiar(env.META_GRAPH_URL)) : 'https://graph.facebook.com';

  const modoComentarios = limpiar(env.COMENTARIOS_MODO).toLowerCase();
  const secretos = [igToken, fbToken, anthropicKey, panelClave].filter((s) => s.length >= 6);

  return {
    raiz,
    puerto: enteroEntre(env.PORT, 3000, 1, 65535),
    modoReal,
    zonaHoraria,
    urlPublica: direccionPublica(env),
    graph: { version, baseIG, baseFB },
    ig: { token: igToken, userId: limpiar(env.IG_USER_ID), configurado: Boolean(igToken && limpiar(env.IG_USER_ID)) },
    fb: { token: fbToken, pageId: limpiar(env.FB_PAGE_ID), configurado: Boolean(fbToken && limpiar(env.FB_PAGE_ID)) },
    fbSinCandado: esAfirmativo(env.FB_SIN_CANDADO),
    anthropic: {
      apiKey: anthropicKey,
      modelo: limpiar(env.MODELO) || MODELO_POR_OMISION,
      baseUrl: quitarBarraFinal(limpiar(env.ANTHROPIC_URL)) || 'https://api.anthropic.com',
    },
    panelClave,
    imagenesDir: path.join(raiz, 'imagenes'),
    // DATOS_DIR manda; si no está, el volumen que Railway monta (la plantilla trae uno) para no perder la memoria al redesplegar.
    datosDir: limpiar(env.DATOS_DIR) ? path.resolve(limpiar(env.DATOS_DIR))
      : limpiar(env.RAILWAY_VOLUME_MOUNT_PATH) ? path.resolve(limpiar(env.RAILWAY_VOLUME_MOUNT_PATH))
        : path.join(raiz, 'datos'),
    // Ficha de voz que trae la plantilla de cada cliente (JSON o base64). Si está vacía, se usa negocio.json.
    negocioJson: String(env.NEGOCIO_JSON ?? '').trim(),
    // Renovación automática de la llave de Instagram (las del inicio de sesión de Instagram vencen a los 60 días).
    renovacionIG: {
      activa: !/^(no|0|false|apagado)$/i.test(limpiar(env.RENOVAR_LLAVE_IG)),
      cadaDias: enteroEntre(env.RENOVAR_LLAVE_CADA_DIAS, 20, 1, 50),
    },
    toleranciaMs: enteroEntre(env.TOLERANCIA_HORAS, 6, 1, 72) * 3600 * 1000,
    revisarCadaMs: enteroEntre(env.REVISAR_CADA_SEG, 60, 5, 3600) * 1000,
    arranqueEsperaMs: enteroEntre(env.ARRANQUE_ESPERA_SEG, 45, 0, 600) * 1000,
    limites: {
      hashtags: enteroEntre(env.HASHTAGS_MAXIMO, 30, 1, 30),
      menciones: 20,
      caption: 2200,
    },
    comentarios: {
      activo: esAfirmativo(env.COMENTARIOS_ACTIVO),
      modo: modoComentarios === 'automatico' || modoComentarios === 'automático' ? 'automatico' : 'borradores',
      cadaMin: enteroEntre(env.COMENTARIOS_CADA_MIN, 2, 2, 240),   // plantilla: cada 2 min (el mínimo seguro para Meta)
      publicaciones: enteroEntre(env.COMENTARIOS_PUBLICACIONES, 10, 1, 25),
      desdeHoras: enteroEntre(env.COMENTARIOS_DESDE_HORAS, 72, 1, 720),
      maxPorCiclo: enteroEntre(env.COMENTARIOS_MAX_POR_CICLO, 10, 1, 50),
      maxPorHora: enteroEntre(env.COMENTARIOS_MAX_POR_HORA, 20, 1, 100),
    },
    secretos,
    advertencias,
  };
}

/** Nombres (no valores) de las variables que faltan para cada función. */
export function variablesFaltantes(config, env = process.env) {
  const hay = (nombre) => Boolean(limpiar(env[nombre]));
  const faltan = { instagram: [], facebook: [], panel: [], direccion: [], comentarios: [] };
  if (!hay('IG_TOKEN')) faltan.instagram.push('IG_TOKEN');
  if (!hay('IG_USER_ID')) faltan.instagram.push('IG_USER_ID');
  if (!hay('FB_PAGE_TOKEN')) faltan.facebook.push('FB_PAGE_TOKEN');
  if (!hay('FB_PAGE_ID')) faltan.facebook.push('FB_PAGE_ID');
  if (!hay('PANEL_CLAVE')) faltan.panel.push('PANEL_CLAVE');
  if (!config.urlPublica) faltan.direccion.push('PUBLIC_URL');
  if (!hay('ANTHROPIC_API_KEY')) faltan.comentarios.push('ANTHROPIC_API_KEY');
  return faltan;
}
