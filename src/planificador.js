// El planificador: cada minuto revisa el calendario y publica lo que ya toca.
//
// - MODO PRUEBA (por omisión): solo anota en el registro lo que publicaría. No llama a Meta.
// - MODO REAL (PUBLICAR_DE_VERDAD=si): publica de verdad, con el candado contra duplicados.
// - Una publicación con error pasajero espera 10, 30, 60 y 120 minutos entre intentos (5 intentos en total).
// - Una publicación que se pasó de su hora por más de TOLERANCIA_HORAS (6 por omisión) NO se publica sola:
//   un «buenos días» a las 8 de la noche confunde más de lo que ayuda.
// - Si el servicio arranca SIN memoria (un despliegue nuevo borra los archivos) y una publicación ya estaba vencida antes
//   de arrancar, no se sabe si ya salió: se busca en la cuenta; si no aparece, NO se publica sola: queda «Para revisar»
//   y la persona decide («Publicar ahora» o «Ya salió»).
import { cargarCalendario, fechaParaMostrar } from './calendario.js';
import { publicarEnInstagram, publicarEnFacebook } from './publicar.js';
import { adaptarParaInstagram } from './texto.js';
import { esperaReintentoMin, MAX_INTENTOS, explicarErrorMeta, esLimiteMeta } from './errores.js';
import { crearEnfriamiento } from './enfriamiento.js';
import { esperar, resumirTexto, unirFrases } from './util.js';

export const NOMBRE_RED = { instagram: 'Instagram', facebook: 'Facebook' };
const LOTE_MAXIMO = 8;
const MARGEN_DE_ARRANQUE_MS = 5 * 60 * 1000;   // lo que venció hace menos de esto antes de arrancar se trata como «recién vencido»

export function crearPlanificador({
  config, meta, estado, registro, ahoraMs = Date.now, dormir = esperar, cargar = cargarCalendario, publicadores,
  enfriamiento = crearEnfriamiento(), arranqueMs, aleatorio,
}) {
  const publicar = publicadores || { instagram: publicarEnInstagram, facebook: publicarEnFacebook };
  const inicioMs = Number.isFinite(arranqueMs) ? arranqueMs : ahoraMs();
  let corriendo = false;
  let calendario = null;
  let ultimaRevisionMs = null;
  let firmaProblemas = '';
  const ejemplosAvisados = new Set();

  const contexto = () => ({
    config, meta, registro, dormir, ahoraMs, aleatorio,
    yaEsDeOtroTrabajo: (idExterno, clave) => estado.yaEsDeOtro(idExterno, clave),
  });

  function urlDeImagen(pub) {
    if (!pub.imagen || !config.urlPublica) return null;
    return `${config.urlPublica}/imagenes/${encodeURIComponent(pub.imagen)}`;
  }

  function descripcion(pub, red) {
    return `${NOMBRE_RED[red]} · ${fechaParaMostrar(pub, config.zonaHoraria)} · «${resumirTexto(red === 'facebook' ? pub.textoFacebook : pub.textoInstagram, 50)}»`;
  }

  function texto(pub, red) { return red === 'facebook' ? pub.textoFacebook : pub.textoInstagram; }

  /** Decide qué trabajos tocan ahora. */
  function reunirPendientes(ahora) {
    const pendientes = [];
    for (const pub of calendario.publicaciones) {
      if (!pub.valida || !Number.isFinite(pub.programadoMs) || pub.estado === 'pausada') continue;
      for (const red of pub.redes) {
        const clave = `${pub.id}|${red}`;
        let job = estado.obtener(clave);

        if (pub.estado === 'ejemplo') {
          if (config.modoReal) {
            if (!ejemplosAvisados.has(clave)) {
              ejemplosAvisados.add(clave);
              registro.info(`Aviso: ${descripcion(pub, red)} es un EJEMPLO y no se publica de verdad. Pide a Claude Code que lo reemplace por tu publicación.`);
            }
            continue;
          }
          if (job && job.estado === 'simulada') continue;
          pendientes.push({ pub, red, clave, ejemplo: true });
          continue;
        }

        if (job && job.estado === 'simulada' && config.modoReal) { estado.quitar(clave); job = undefined; }   // lo ensayado antes no cuenta como publicado
        // Si se cambió la fecha de algo que NO había salido (vencida, con error, esperando), es una publicación nueva: se vuelve a empezar.
        if (job && job.estado !== 'publicada' && Number.isFinite(job.programadoMs) && job.programadoMs !== pub.programadoMs) { estado.quitar(clave); job = undefined; }
        if (job && ['publicada', 'simulada', 'vencida', 'omitida', 'error', 'revisar'].includes(job.estado)) continue;
        if (pub.programadoMs > ahora) continue;                                  // todavía no es la hora
        if (job && job.proximoIntentoMs && job.proximoIntentoMs > ahora) continue;   // esperando para reintentar
        if (ahora - pub.programadoMs > config.toleranciaMs) {
          estado.poner(clave, { ...(job || {}), pubId: pub.id, red, estado: 'vencida', programadoMs: pub.programadoMs, actualizadoMs: ahora });
          registro.aviso(`Aviso: ${descripcion(pub, red)} se pasó de su hora por más de ${Math.round(config.toleranciaMs / 3600000)} horas y no se publica sola. Si todavía quieres publicarla, cambia su fecha.`);
          continue;
        }
        // Sin memoria y ya vencida antes de arrancar: puede haber salido antes del reinicio. Primero se busca en la cuenta; si no aparece, la revisa una persona.
        const dudosa = !job && !estado.recuperada() && pub.programadoMs < inicioMs - MARGEN_DE_ARRANQUE_MS;
        pendientes.push({ pub, red, clave, soloSiYaSalio: dudosa });
      }
    }
    // Facebook primero e Instagram al final: los pasos extra de Instagram no deben retrasar a Facebook.
    pendientes.sort((a, b) => (a.red === 'instagram') - (b.red === 'instagram') || a.pub.programadoMs - b.pub.programadoMs);
    return pendientes.slice(0, LOTE_MAXIMO);
  }

  function simular({ pub, red, clave }, ahora) {
    const imagen = pub.imagen ? `la imagen ${pub.imagen}` : 'sin imagen';
    let largo = '';
    if (red === 'instagram') {
      const ad = adaptarParaInstagram(pub.textoInstagram, { hashtagsMax: config.limites.hashtags });
      largo = ` con ${ad.final.toLocaleString('en-US')} de 2,200 caracteres${ad.recortado ? ' (se acortó para Instagram)' : ''}`;
    }
    const falta = (red === 'instagram' ? !config.ig.configurado : !config.fb.configurado)
      ? ` Aviso: todavía falta configurar ${NOMBRE_RED[red]} (${red === 'instagram' ? 'IG_TOKEN e IG_USER_ID' : 'FB_PAGE_TOKEN y FB_PAGE_ID'}) en Railway.` : '';
    registro.info(`[PRUEBA] ${descripcion(pub, red)} · publicaría ${imagen}${largo}. No se publicó nada.${falta}`);
    estado.poner(clave, { pubId: pub.id, red, estado: 'simulada', programadoMs: pub.programadoMs, intentos: 0, actualizadoMs: ahora });
  }

  async function procesar(trabajo, ahora) {
    const { pub, red, clave } = trabajo;
    if (!config.modoReal) { simular(trabajo, ahora); return {}; }

    const previo = estado.obtener(clave) || { pubId: pub.id, red, intentos: 0 };
    const intento = (previo.intentos || 0) + 1;
    const imagenUrl = urlDeImagen(pub);
    let resultado;

    if (pub.imagen && !config.urlPublica) {
      resultado = { ok: false, error: 'Falta la dirección pública del servicio (PUBLIC_URL) para que Meta pueda descargar la imagen', transitorio: false, definitivo: true, detalle: null };
    } else {
      try {
        resultado = await publicar[red](contexto(), {
          texto: texto(pub, red), imagenUrl, programadoMs: pub.programadoMs, trabajoId: clave, soloSiYaSalio: Boolean(trabajo.soloSiYaSalio),
        });
      } catch (e) {
        resultado = { ok: false, error: `Error inesperado al publicar: ${registro.redactar(e && e.message ? e.message : e)}`.slice(0, 300), transitorio: true, definitivo: false, detalle: null };
      }
    }

    const base = { pubId: pub.id, red, programadoMs: pub.programadoMs, intentos: intento, actualizadoMs: ahora };
    if (resultado.ok) {
      estado.poner(clave, {
        ...base, estado: 'publicada', externalId: resultado.externalId, permalink: resultado.permalink || null,
        yaExistia: Boolean(resultado.yaExistia), publicadaEnMs: ahora, advertencia: resultado.advertencia || null,
      });
      registro.info(`✅ ${resultado.yaExistia ? 'Ya estaba publicada' : 'Publicada'} en ${NOMBRE_RED[red]}: «${resumirTexto(texto(pub, red), 50)}»${resultado.permalink ? ` → ${resultado.permalink}` : ''}`);
      if (resultado.advertencia) registro.error(`Error de aviso: ⚠️ ${NOMBRE_RED[red]}: ${resultado.advertencia}`);
      return {};
    }

    if (resultado.revisar) {
      estado.poner(clave, { ...base, intentos: previo.intentos || 0, estado: 'revisar', titulo: 'Para revisar: ¿ya salió?', ultimoError: resultado.error, queHacer: 'Mira tu cuenta. Si ya salió, da clic en «Ya salió». Si no, da clic en «Publicar ahora».' });
      registro.aviso(`Aviso: ${descripcion(pub, red)} queda PARA REVISAR. ${resultado.error}. Entra a /estado: «Ya salió» o «Publicar ahora».`);
      return {};
    }

    // Si el error no vino de Meta (falta una variable, por ejemplo), el propio mensaje ya está en español y se usa tal cual.
    const explicacion = resultado.detalle
      ? explicarErrorMeta(resultado.detalle)
      : {
        titulo: resultado.error,
        queHacer: resultado.definitivo
          ? 'Revisa las variables en Railway > Variables y luego da clic en «Reintentar» en el panel.'
          : 'No hagas nada: se reintenta solo.',
      };
    const queHacer = explicacion.queHacer;
    const final = resultado.definitivo || intento >= MAX_INTENTOS;
    const limite = esLimiteMeta(resultado.detalle);
    if (final) {
      estado.poner(clave, { ...base, estado: 'error', ultimoError: resultado.error, titulo: explicacion.titulo, queHacer, proximoIntentoMs: null });
      registro.error(`Error: no se pudo publicar ${descripcion(pub, red)} (intento ${intento} de ${MAX_INTENTOS}). ${resultado.error} | ${explicacion.titulo} Qué hacer: ${queHacer} Cuando lo arregles, da clic en «Reintentar» en el panel (/estado).`);
    } else {
      const espera = esperaReintentoMin(intento);
      estado.poner(clave, { ...base, estado: 'pendiente', ultimoError: resultado.error, titulo: explicacion.titulo, queHacer, proximoIntentoMs: ahora + espera * 60000 });
      registro.error(`Error al publicar ${descripcion(pub, red)} (intento ${intento} de ${MAX_INTENTOS}). ${resultado.error} | ${explicacion.titulo} Se reintenta en ${espera} minutos.`);
    }
    // Si Meta pidió calma, no se le habla más (ni para otras publicaciones ni para comentarios) hasta que pase la espera.
    if (limite) enfriamiento.activar(ahora + esperaReintentoMin(intento) * 60000, 'límite de llamadas de Meta');
    return { limite };
  }

  /** Lee el calendario (sin publicar nada). También lo usa el panel y la entrega de imágenes. */
  function leerCalendario() {
    calendario = cargar({ dir: config.raiz, imagenesDir: config.imagenesDir, zona: config.zonaHoraria });
    ultimaRevisionMs = ahoraMs();
    return calendario;
  }

  /** Avisa en el registro UNA vez cuando el calendario tiene problemas (y otra cuando ya se arreglaron). */
  function avisarProblemasDelCalendario() {
    const firma = calendario.problemas.join('|');
    if (firma === firmaProblemas) return;
    if (firma) registro.error(`Error en el calendario: ${calendario.problemas.slice(0, 5).join(' ')}${calendario.problemas.length > 5 ? ` (y ${calendario.problemas.length - 5} más)` : ''} Las publicaciones con problemas no se publican hasta que se corrijan.`);
    else if (firmaProblemas) registro.info('El calendario ya está bien: se corrigieron los problemas.');
    firmaProblemas = firma;
  }

  async function tick() {
    if (corriendo) return { omitido: true };
    corriendo = true;
    try {
      const ahora = ahoraMs();
      leerCalendario();
      avisarProblemasDelCalendario();
      if (!calendario.publicaciones.length) return { procesados: 0 };
      if (config.modoReal && enfriamiento.activo(ahora)) return { enfriando: true };
      const pendientes = reunirPendientes(ahora);
      let procesados = 0;
      for (const trabajo of pendientes) {
        if (config.modoReal && enfriamiento.activo(ahoraMs())) break;        // Meta pidió calma: los demás esperan al próximo ciclo
        let salida = {};
        try { salida = (await procesar(trabajo, ahoraMs())) || {}; }
        catch (e) { registro.error(`Error inesperado con ${trabajo.clave}: ${e && e.message ? e.message : e}`); }
        procesados += 1;
        estado.guardar();
        if (salida.limite) break;
      }
      estado.guardar();
      return { procesados };
    } catch (e) {
      registro.error(`Error en la revisión del calendario: ${e && e.message ? e.message : e}`);
      return { error: true };
    } finally {
      corriendo = false;
    }
  }

  /** Vuelve a poner en cola una publicación que quedó en error (cuando ya arreglaste la causa). */
  function reintentar(clave) {
    const job = estado.obtener(clave);
    if (!job || job.estado !== 'error') return false;
    estado.poner(clave, { ...job, estado: 'pendiente', intentos: 0, proximoIntentoMs: null, ultimoError: null, titulo: null, queHacer: null });
    estado.guardar();
    registro.info(`Reintento manual pedido para ${clave}.`);
    return true;
  }

  /** «Publicar ahora»: la persona vio que no salió y autoriza publicarla (el candado sigue comprobando duplicados). */
  function autorizar(clave) {
    const job = estado.obtener(clave);
    if (!job || job.estado !== 'revisar') return false;
    // Queda registrada como «pendiente» con memoria propia: el siguiente ciclo la publica con el candado normal y ya no pide revisión.
    estado.poner(clave, { pubId: job.pubId, red: job.red, programadoMs: job.programadoMs, estado: 'pendiente', intentos: 0, autorizada: true, actualizadoMs: ahoraMs() });
    estado.guardar();
    registro.info(`Publicación autorizada a mano: ${clave}.`);
    return true;
  }

  /** «Ya salió»: la persona confirma que la publicación ya está en su cuenta. */
  function marcarYaSalio(clave) {
    const job = estado.obtener(clave);
    if (!job || job.estado !== 'revisar') return false;
    estado.poner(clave, { ...job, estado: 'publicada', yaExistia: true, titulo: null, queHacer: null, actualizadoMs: ahoraMs() });
    estado.guardar();
    registro.info(`Marcada como ya publicada a mano: ${clave}.`);
    return true;
  }

  /** Filas para el panel. */
  function filas() {
    if (!calendario) return [];
    const salida = [];
    for (const pub of calendario.publicaciones) {
      const redes = pub.redes && pub.redes.length ? pub.redes : [null];
      for (const red of redes) {
        const clave = red ? `${pub.id}|${red}` : null;
        const job = clave ? estado.obtener(clave) : null;
        let textoEstado; let detalle = ''; let tipo;
        if (!pub.valida) { textoEstado = 'Con problemas'; tipo = 'problema'; detalle = pub.problemas.join('; '); }
        else if (pub.estado === 'pausada') { textoEstado = 'Pausada'; tipo = 'pausada'; }
        else if (job && job.estado === 'publicada') { textoEstado = job.yaExistia ? 'Ya estaba publicada' : 'Publicada'; tipo = 'ok'; detalle = job.advertencia ? `⚠️ ${job.advertencia}` : (job.permalink || ''); }
        else if (job && job.estado === 'simulada') { textoEstado = 'Ensayada (modo prueba)'; tipo = 'prueba'; }
        else if (job && job.estado === 'vencida') { textoEstado = 'Vencida: no se publicó a tiempo'; tipo = 'problema'; detalle = 'Cambia la fecha si todavía quieres publicarla.'; }
        else if (job && job.estado === 'revisar') { textoEstado = 'Para revisar: ¿ya salió?'; tipo = 'espera'; detalle = unirFrases(job.ultimoError, job.queHacer); }
        else if (job && job.estado === 'error') { textoEstado = 'Error'; tipo = 'problema'; detalle = unirFrases(job.titulo, job.queHacer) || job.ultimoError || ''; }
        else if (job && job.proximoIntentoMs) { textoEstado = `Esperando para reintentar (intento ${job.intentos} de ${MAX_INTENTOS})`; tipo = 'espera'; detalle = job.titulo || job.ultimoError || ''; }
        else if (pub.estado === 'ejemplo') { textoEstado = 'Ejemplo (no se publica de verdad)'; tipo = 'prueba'; }
        else { textoEstado = 'Programada'; tipo = 'programada'; }
        salida.push({
          clave,
          fecha: fechaParaMostrar(pub, config.zonaHoraria),
          red: red ? NOMBRE_RED[red] : '—',
          texto: resumirTexto(pub.textoInstagram || pub.textoFacebook, 70),
          estado: textoEstado,
          tipo,
          detalle,
          puedeReintentar: Boolean(job && job.estado === 'error'),
          puedeRevisar: Boolean(job && job.estado === 'revisar'),
        });
      }
    }
    return salida;
  }

  return {
    tick,
    leerCalendario,
    reintentar,
    autorizar,
    marcarYaSalio,
    filas,
    calendario: () => calendario,
    ultimaRevisionMs: () => ultimaRevisionMs,
  };
}
