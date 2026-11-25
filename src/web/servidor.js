// El servidor web del Publicador.
//   Público (lo necesita Meta o Railway):  /salud  y  /imagenes/<archivo>  (solo las imágenes de tu calendario)
//   Con contraseña (PANEL_CLAVE):          /estado  /verificar  /comentarios  /comentarios/prueba
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verificarTodo } from '../verificar.js';
import { esJpeg } from '../jpeg.js';
import { cargarCasos, correrPruebas } from '../comentarios/pruebas.js';
import { paginaEstado, paginaVerificar, paginaComentarios, paginaPruebaComentarios, paginaMensaje } from './paginas.js';
import { esperar } from '../util.js';

const MAX_CUERPO = 20 * 1024;
const ENCABEZADOS_HTML = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const ENCABEZADOS_TEXTO = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest();

/**
 * @param {{config:object, registro:object, planificador:object, estado?:object, ciclo:object, borradores:object, negocio:object, avisosNegocio?:string[], meta:object, modelo:object, ahoraMs?:()=>number, fetchFn?:typeof fetch, dormir?:(ms:number)=>Promise<void>}} app
 */
export function crearServidor(app) {
  const { config, registro, planificador, ciclo, borradores, negocio, meta, modelo } = app;
  const ahoraMs = app.ahoraMs || Date.now;
  const fetchFn = app.fetchFn || globalThis.fetch;
  const dormir = app.dormir || esperar;
  const avisosNegocio = app.avisosNegocio || [];
  const fallosRecientes = [];      // marcas de tiempo de contraseñas equivocadas
  let bloqueadoHastaMs = 0;        // si alguien está adivinando la contraseña, el panel se cierra un rato
  let calendarioLeidoMs = 0;

  function calendarioReciente() {
    if (!planificador.calendario() || ahoraMs() - calendarioLeidoMs > 10000) {
      planificador.leerCalendario();
      calendarioLeidoMs = ahoraMs();
    }
    return planificador.calendario();
  }

  function enviar(res, codigo, encabezados, cuerpo) {
    res.writeHead(codigo, { ...encabezados, 'Content-Length': Buffer.byteLength(cuerpo) });
    res.end(cuerpo);
  }
  const html = (res, codigo, cuerpo) => enviar(res, codigo, ENCABEZADOS_HTML, cuerpo);
  const texto = (res, codigo, cuerpo) => enviar(res, codigo, ENCABEZADOS_TEXTO, cuerpo);

  // ---- imágenes públicas -------------------------------------------------------------------------
  function servirImagen(req, res, nombreCrudo) {
    let nombre;
    try { nombre = decodeURIComponent(nombreCrudo); } catch { return texto(res, 404, 'No encontrada.\n'); }
    if (!/^[^/\\]+\.jpe?g$/i.test(nombre) || nombre.includes('..') || nombre.includes('\0')) return texto(res, 404, 'No encontrada.\n');
    const cal = calendarioReciente();
    const permitidas = new Set(['_prueba.jpg']);
    for (const p of (cal && cal.publicaciones) || []) if (p.imagen) permitidas.add(p.imagen);
    if (!permitidas.has(nombre)) return texto(res, 404, 'No encontrada.\n');
    const ruta = path.join(config.imagenesDir, nombre);
    let datos;
    try { datos = fs.readFileSync(ruta); } catch { return texto(res, 404, 'No encontrada.\n'); }
    if (!esJpeg(datos)) return texto(res, 404, 'No encontrada.\n');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': datos.length, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : datos);
  }

  // ---- contraseña --------------------------------------------------------------------------------
  async function autenticar(req, res) {
    if (!config.panelClave) {
      html(res, 503, paginaMensaje('El panel está apagado', 'Falta la variable PANEL_CLAVE en Railway > Variables (una contraseña nueva que inventas tú, de 12 caracteres o más). Agrégala, da clic en Deploy y vuelve a entrar.'));
      return false;
    }
    if (config.panelClave.length < 12) {
      html(res, 503, paginaMensaje('La contraseña del panel es muy corta', 'PANEL_CLAVE debe tener al menos 12 caracteres. Cámbiala en Railway > Variables y da clic en Deploy.'));
      return false;
    }
    const ahoraAuth = ahoraMs();
    if (ahoraAuth < bloqueadoHastaMs) {
      res.writeHead(429, { ...ENCABEZADOS_TEXTO, 'Retry-After': String(Math.ceil((bloqueadoHastaMs - ahoraAuth) / 1000)) });
      res.end('Demasiados intentos con la contraseña equivocada. El panel se abre de nuevo en unos minutos.\n');
      return false;
    }
    const cabecera = String(req.headers.authorization || '');
    const m = cabecera.match(/^Basic\s+(.+)$/i);
    let clave = '';
    if (m) {
      const decodificado = Buffer.from(m[1], 'base64').toString('utf8');
      clave = decodificado.slice(decodificado.indexOf(':') + 1);
    }
    if (m && crypto.timingSafeEqual(sha(clave), sha(config.panelClave))) return true;
    // Contraseña equivocada o ausente: cada fallo seguido hace esperar un poco más (frena a quien adivina).
    const ahora = ahoraMs();
    while (fallosRecientes.length && ahora - fallosRecientes[0] > 10 * 60000) fallosRecientes.shift();
    if (m) {
      fallosRecientes.push(ahora);
      if (fallosRecientes.length >= 20) {
        // Veinte contraseñas equivocadas en diez minutos: alguien está adivinando. El panel se cierra cinco minutos
        // (el Publicador sigue publicando; solo se cierran las páginas con contraseña).
        bloqueadoHastaMs = ahora + 5 * 60000;
        fallosRecientes.length = 0;
        registro.error('Error de seguridad: hubo 20 contraseñas equivocadas seguidas en el panel. Se cierra durante 5 minutos. Si no fuiste tú, cambia PANEL_CLAVE en Railway.');
      }
      await dormir(Math.min(3000, 150 * fallosRecientes.length));
    }
    res.writeHead(401, { ...ENCABEZADOS_TEXTO, 'WWW-Authenticate': 'Basic realm="Publicador", charset="UTF-8"' });
    res.end('Escribe la contraseña del panel (la variable PANEL_CLAVE). El usuario puede ser cualquiera.\n');
    return false;
  }

  /** Los formularios solo se aceptan si vienen de esta misma página (frena que otro sitio engañe a tu navegador). */
  function mismoOrigen(req) {
    const sitio = req.headers['sec-fetch-site'];
    if (sitio) return sitio === 'same-origin' || sitio === 'none';
    const origen = req.headers.origin;
    if (!origen) return false;
    try { return new URL(origen).host === req.headers.host; } catch { return false; }
  }

  async function leerFormulario(req) {
    const trozos = [];
    let total = 0;
    for await (const t of req) {
      total += t.length;
      if (total > MAX_CUERPO) throw Object.assign(new Error('cuerpo demasiado grande'), { codigoHttp: 413 });
      trozos.push(t);
    }
    return new URLSearchParams(Buffer.concat(trozos).toString('utf8'));
  }

  /** Las próximas imágenes del calendario (hasta 3); si no hay ninguna, la imagen de prueba que trae el kit. */
  const nombresImagenesDePrueba = () => {
    const cal = calendarioReciente();
    const nombres = [];
    for (const p of ((cal && cal.publicaciones) || []).filter((x) => x.valida && x.imagen).sort((a, b) => a.programadoMs - b.programadoMs)) {
      if (!nombres.includes(p.imagen)) nombres.push(p.imagen);
      if (nombres.length === 3) break;
    }
    return nombres.length ? nombres : ['_prueba.jpg'];
  };

  async function informe(conContenedor) {
    return verificarTodo({ config, meta, modelo, fetchFn, nombresImagen: nombresImagenesDePrueba(), conContenedor, dormir, ahoraMs });
  }

  function datosComentarios(mensaje) {
    return {
      config,
      pendientes: borradores.listar(['pendiente', 'error', 'enviando']),
      recientes: borradores.listar(['enviado', 'rechazado', 'ignorado']).slice(0, 40),
      avisos: avisosNegocio,
      mensaje,
      ultimaLecturaMs: ciclo.ultimaLecturaMs(),
      ahoraMs: ahoraMs(),
    };
  }

  async function protegidas(req, res, url) {
    if (!(await autenticar(req, res))) return;
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    const esPost = req.method === 'POST';
    if (esPost && !mismoOrigen(req)) return html(res, 403, paginaMensaje('No se pudo', 'Ese formulario no vino de esta página. Abre el panel de nuevo y vuelve a intentarlo.'));

    if (ruta === '/estado' && req.method === 'GET') {
      const cal = calendarioReciente();
      const avisos = [...config.advertencias];
      return html(res, 200, paginaEstado({ config, filas: planificador.filas(), calendario: cal, avisos, registros: registro.ultimas(60), ahoraMs: ahoraMs() }));
    }
    if (['/estado/reintentar', '/estado/autorizar', '/estado/ya-salio'].includes(ruta) && esPost) {
      const f = await leerFormulario(req);
      const clave = String(f.get('clave') || '');
      if (ruta === '/estado/reintentar') planificador.reintentar(clave);
      else if (ruta === '/estado/autorizar') planificador.autorizar(clave);
      else planificador.marcarYaSalio(clave);
      res.writeHead(303, { Location: '/estado' });
      return res.end();
    }
    if (ruta === '/verificar' && (req.method === 'GET' || esPost)) {
      const inf = await informe(esPost);
      return html(res, 200, paginaVerificar({ config, informe: inf, conContenedorHecho: esPost }));
    }
    if (ruta === '/comentarios' && req.method === 'GET') {
      return html(res, 200, paginaComentarios(datosComentarios('')));
    }
    if (ruta === '/comentarios/accion' && esPost) {
      const f = await leerFormulario(req);
      const id = String(f.get('id') || '');
      const accion = String(f.get('accion') || '');
      let mensaje = '';
      if (accion === 'aprobar') {
        const r = await ciclo.enviar(id, String(f.get('texto') || '').slice(0, 600));
        mensaje = r.ok ? `Listo: la respuesta salió.${r.cambioPorRed ? ` (Ojo: la red de seguridad cambió el texto porque ${r.cambioPorRed}.)` : ''}` : `No se pudo enviar: ${r.motivo}`;
      } else if (accion === 'rechazar') {
        mensaje = ciclo.rechazar(id) ? 'Listo: no se contestará ese comentario.' : 'Ese borrador ya no estaba pendiente.';
      }
      return html(res, 200, paginaComentarios(datosComentarios(mensaje)));
    }
    if (ruta === '/comentarios/prueba' && (req.method === 'GET' || esPost)) {
      const { casos, error } = cargarCasos(config.raiz);
      if (req.method === 'GET' || error) return html(res, 200, paginaPruebaComentarios({ resultado: null, usaModelo: modelo.disponible, error }));
      const resultado = await correrPruebas({ casos, negocio, modelo });
      return html(res, 200, paginaPruebaComentarios({ resultado, usaModelo: modelo.disponible }));
    }
    return html(res, 404, paginaMensaje('No existe', 'Esa página no existe en tu Publicador.'));
  }

  const servidor = http.createServer((req, res) => {
    (async () => {
      let url;
      try { url = new URL(req.url, 'http://publicador.local'); } catch { return texto(res, 400, 'Dirección no válida.\n'); }
      const ruta = url.pathname;
      if ((req.method === 'GET' || req.method === 'HEAD') && (ruta === '/salud' || ruta === '/salud/')) {
        return enviar(res, 200, ENCABEZADOS_TEXTO, req.method === 'HEAD' ? '' : 'Publicador en línea.\n');
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && ruta === '/') {
        return enviar(res, 200, ENCABEZADOS_TEXTO, req.method === 'HEAD' ? '' : 'Publicador en línea. Tu panel está en /estado.\n');
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && ruta.startsWith('/imagenes/')) {
        return servirImagen(req, res, ruta.slice('/imagenes/'.length));
      }
      if (['/estado', '/verificar', '/comentarios', '/estado/reintentar', '/estado/autorizar', '/estado/ya-salio', '/comentarios/accion', '/comentarios/prueba'].some((p) => ruta === p || ruta === `${p}/`)) {
        return protegidas(req, res, url);
      }
      return texto(res, 404, 'No encontrada.\n');
    })().catch((e) => {
      if (e && e.codigoHttp === 413) {
        try { texto(res, 413, 'Esa petición es demasiado grande.\n'); } catch { /* conexión cerrada */ }
        return;
      }
      registro.error(`Error en el servidor web: ${e && e.message ? e.message : e}`);
      try {
        if (!res.headersSent) texto(res, 500, 'Algo salió mal. Revisa el registro de Railway.\n');
        else res.end();
      } catch { /* conexión cerrada */ }
    });
  });
  servidor.requestTimeout = 120000;
  servidor.headersTimeout = 20000;
  servidor.keepAliveTimeout = 65000;
  return servidor;
}
