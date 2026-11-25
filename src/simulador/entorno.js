// Un «entorno de ensayo» completo y desechable: carpeta temporal, calendario, imágenes, Meta simulada, reloj virtual
// y un Publicador conectado a todo eso. Lo usan las pruebas automáticas y `npm run ensayo`.
// Nada de aquí toca internet ni tu carpeta de verdad.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarSimulador } from './meta-simulada.js';
import { leerConfig } from '../config.js';
import { crearRegistro } from '../registro.js';
import { crearClienteMeta } from '../meta.js';
import { crearEstado } from '../estado.js';
import { crearPlanificador } from '../planificador.js';

const RAIZ_DEL_KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Un JPEG que pasa la revisión de cabecera (no es una foto de verdad, pero tiene el tamaño que se le pide). */
export function crearJpegFalso(ancho = 1080, alto = 1080, relleno = 64) {
  const be16 = (n) => [(n >> 8) & 0xff, n & 0xff];
  const bytes = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(alto), ...be16(ancho), 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
  ];
  const cuerpo = Buffer.alloc(relleno, 0x11);
  return Buffer.concat([Buffer.from(bytes), cuerpo, Buffer.from([0xff, 0xd9])]);
}

/** Reloj virtual: avanza solo cuando se le pide (o cuando el Publicador «duerme»). */
export function crearRelojVirtual(inicioMs = Date.UTC(2026, 11, 1, 16, 0, 0)) {
  const reloj = {
    t: inicioMs,
    ahora: () => reloj.t,
    avanzar(ms) { reloj.t += ms; },
    dormir: async (ms) => { reloj.t += ms; },
  };
  return reloj;
}

/**
 * @param {object} opciones
 * @param {boolean} [opciones.modoReal]
 * @param {object[]} [opciones.publicaciones]  entradas del calendario
 * @param {Record<string,Buffer>} [opciones.imagenes]  nombre -> contenido (por omisión una imagen cuadrada para cada nombre usado)
 * @param {Record<string,string>} [opciones.env]  variables extra (o para quitar: valor undefined)
 * @param {object} [opciones.simulador]  opciones de la Meta simulada
 */
export async function crearEntorno(opciones = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'publicador-'));
  fs.mkdirSync(path.join(raiz, 'imagenes'), { recursive: true });
  const reloj = opciones.reloj || crearRelojVirtual();
  const sim = await iniciarSimulador({ reloj: reloj.ahora, ...(opciones.simulador || {}) });

  const publicaciones = opciones.publicaciones || [];
  const imagenes = { ...(opciones.imagenes || {}) };
  for (const p of publicaciones) {
    if (p && p.imagen && !imagenes[p.imagen] && /\.jpe?g$/i.test(p.imagen)) imagenes[p.imagen] = crearJpegFalso(1080, 1080);
  }
  for (const [nombre, contenido] of Object.entries(imagenes)) fs.writeFileSync(path.join(raiz, 'imagenes', nombre), contenido);
  fs.writeFileSync(path.join(raiz, 'calendario.json'), JSON.stringify({ publicaciones }, null, 2));
  // Los 10 comentarios de prueba del kit viajan con el entorno para que el panel pueda correrlos.
  const casos = path.join(RAIZ_DEL_KIT, 'comentarios', 'pruebas.json');
  if (fs.existsSync(casos)) {
    fs.mkdirSync(path.join(raiz, 'comentarios'), { recursive: true });
    fs.copyFileSync(casos, path.join(raiz, 'comentarios', 'pruebas.json'));
  }

  const env = {
    IG_TOKEN: sim.token,
    IG_USER_ID: sim.igUserId,
    FB_PAGE_TOKEN: sim.pageToken,
    FB_PAGE_ID: sim.pageId,
    PANEL_CLAVE: 'clave-de-prueba-muy-larga-2026',
    ANTHROPIC_API_KEY: sim.anthropicKey,
    PUBLIC_URL: 'https://publicador.ejemplo.test',
    META_GRAPH_URL: sim.url,
    ANTHROPIC_URL: sim.url,
    ARRANQUE_ESPERA_SEG: '0',
    DATOS_DIR: path.join(raiz, 'datos'),
    ...(opciones.modoReal ? { PUBLICAR_DE_VERDAD: 'si' } : {}),
    ...(opciones.env || {}),
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

  const config = leerConfig(env, { raiz });
  const lineas = [];
  const registro = crearRegistro({
    secretos: config.secretos,
    escribir: (linea) => lineas.push(linea),
    ahoraMs: reloj.ahora,
    zona: config.zonaHoraria,
  });
  const meta = crearClienteMeta({ config, registro, tiempos: opciones.tiempos || { leer: 3000, crear: 3000, publicar: 3000 } });
  const estado = crearEstado({ dir: config.datosDir, registro });
  const planificador = crearPlanificador({ config, meta, estado, registro, ahoraMs: reloj.ahora, dormir: reloj.dormir });

  function escribirCalendario(lista) {
    fs.writeFileSync(path.join(raiz, 'calendario.json'), JSON.stringify({ publicaciones: lista }, null, 2));
  }
  function escribirImagen(nombre, contenido) {
    fs.writeFileSync(path.join(raiz, 'imagenes', nombre), contenido);
  }

  return {
    raiz, env, sim, reloj, config, registro, meta, estado, planificador, lineas,
    escribirCalendario, escribirImagen,
    texto: () => lineas.join('\n'),
    async limpiar() {
      await sim.detener();
      fs.rmSync(raiz, { recursive: true, force: true });
    },
  };
}
