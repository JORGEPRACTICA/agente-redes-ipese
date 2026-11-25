// El ciclo de comentarios: cada pocos minutos lee los comentarios nuevos de tus últimas publicaciones,
// prepara una respuesta con tu voz y, según el modo, la deja como BORRADOR (por omisión) o la envía.
//
// Se lee por consulta (no por avisos de Meta): los avisos («webhooks») de comentarios de Instagram exigen un nivel
// de acceso que Meta aprueba aparte. Este kit NO contesta mensajes directos.
//
// Reglas:
//   - Una respuesta SOLO sale si el Publicador está en modo real (PUBLICAR_DE_VERDAD=si). En modo prueba se leen los comentarios
//     y se preparan borradores, pero no se contesta nada.
//   - borradores  (por omisión) -> nada sale hasta que tú lo apruebas en el panel (/comentarios).
//   - automatico                -> salen solos los comentarios «normales» y los de luto (agradecimiento corto) que no estén
//                                  marcados «revísalo tú». Las quejas y lo sospechoso SIEMPRE esperan tu aprobación.
//   - Antes de enviar se comprueba que tu cuenta no haya contestado ya ese comentario (por ejemplo, a mano o en un envío anterior
//     cuya respuesta se perdió): nunca se contesta dos veces.
//   - Si el servicio arrancó sin memoria (un despliegue nuevo borra los archivos), los comentarios anteriores al arranque no se
//     contestan solos: quedan como borradores para que los veas tú (así no revive algo que ya habías rechazado).
import { prepararRespuesta } from './respuestas.js';
import { aplicarRedDeSeguridad } from './red-seguridad.js';
import { esperaReintentoMin, explicarErrorMeta, esLimiteMeta } from '../errores.js';
import { crearEnfriamiento } from '../enfriamiento.js';
import { resumirTexto } from '../util.js';

const HORA = 3600 * 1000;
const MARGEN_DE_ARRANQUE_MS = 10 * 60 * 1000;

function fechaMeta(valor, respaldo) {
  const t = Date.parse(String(valor ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? t : respaldo;
}

export function crearCicloComentarios({ config, meta, modelo, negocio, borradores, registro, ahoraMs = Date.now, enfriamiento = crearEnfriamiento(), arranqueMs }) {
  const cfg = config.comentarios;
  const inicioMs = Number.isFinite(arranqueMs) ? arranqueMs : ahoraMs();
  let corriendo = false;
  let pausaHastaMs = 0;
  let fallosSeguidos = 0;
  let miUsuarioIG = null;
  let ultimaLectura = null;
  const enviadosRecientes = [];      // marcas de tiempo de respuestas enviadas (tope por hora)

  async function usuarioIG() {
    if (miUsuarioIG) return miUsuarioIG;
    const r = await meta.ig.cuenta();
    if (r.ok && r.json.username) miUsuarioIG = String(r.json.username).toLowerCase();
    return miUsuarioIG;
  }

  function topePorHora(ahora) {
    while (enviadosRecientes.length && ahora - enviadosRecientes[0] > HORA) enviadosRecientes.shift();
    return enviadosRecientes.length >= cfg.maxPorHora;
  }

  /** Junta los comentarios por contestar de Instagram y de Facebook. */
  async function recolectar(ahora) {
    const candidatos = [];
    const desde = ahora - cfg.desdeHoras * HORA;
    const problemas = [];

    if (config.ig.configurado) {
      const yo = await usuarioIG();
      if (!yo) {
        // Sin saber cuál es tu usuario no se puede distinguir lo tuyo de lo ajeno: es más seguro no tocar nada.
        problemas.push({ red: 'instagram', error: 'No pude saber a qué cuenta pertenece el token', meta: { paso: 'leer_cuenta', transitorio: true } });
      } else {
        const r = await meta.ig.mediaConComentarios({ publicaciones: cfg.publicaciones });
        if (!r.ok) problemas.push({ red: 'instagram', ...r });
        else {
          for (const m of r.json.data || []) {
            for (const c of (m.comments && m.comments.data) || []) {
              const usuario = String(c.username || '').toLowerCase();
              if (!c.text || usuario === yo) continue;
              if (fechaMeta(c.timestamp, ahora) < desde) continue;
              const respuestas = (c.replies && c.replies.data) || [];
              if (respuestas.some((x) => String(x.username || '').toLowerCase() === yo)) continue;
              candidatos.push({ plataforma: 'instagram', id: `ig:${c.id}`, comentarioId: c.id, publicacionId: m.id, publicacionTexto: m.caption || '', usuario: c.username || '', texto: c.text, cuandoMs: fechaMeta(c.timestamp, ahora) });
            }
          }
        }
      }
    }
    if (config.fb.configurado) {
      const r = await meta.fb.postsConComentarios({ publicaciones: cfg.publicaciones });
      if (!r.ok) problemas.push({ red: 'facebook', ...r });
      else {
        for (const p of r.json.data || []) {
          for (const c of (p.comments && p.comments.data) || []) {
            if (!c.message || (c.from && String(c.from.id) === String(config.fb.pageId))) continue;
            if (fechaMeta(c.created_time, ahora) < desde) continue;
            const respuestas = (c.comments && c.comments.data) || [];
            if (respuestas.some((x) => x.from && String(x.from.id) === String(config.fb.pageId))) continue;
            candidatos.push({ plataforma: 'facebook', id: `fb:${c.id}`, comentarioId: c.id, publicacionId: p.id, publicacionTexto: p.message || '', usuario: (c.from && c.from.name) || '', texto: c.message, cuandoMs: fechaMeta(c.created_time, ahora) });
          }
        }
      }
    }
    return { candidatos, problemas };
  }

  /** ¿Tu cuenta ya contestó ese comentario? -> true | false | null (no se pudo comprobar) */
  async function yaContestado(b) {
    if (b.plataforma === 'instagram') {
      const yo = await usuarioIG();
      if (!yo) return null;
      const r = await meta.ig.respuestasDe(b.comentarioId);
      if (!r.ok) return null;
      return (r.json.data || []).some((x) => String(x.username || '').toLowerCase() === yo);
    }
    const r = await meta.fb.respuestasDe(b.comentarioId);
    if (!r.ok) return null;
    return (r.json.data || []).some((x) => x.from && String(x.from.id) === String(config.fb.pageId));
  }

  async function enviarRespuesta(plataforma, comentarioId, texto) {
    return plataforma === 'instagram'
      ? meta.ig.responderComentario(comentarioId, texto)
      : meta.fb.responderComentario(comentarioId, texto);
  }

  /** Aprueba y envía un borrador (desde el panel o en modo automático). `textoEditado` es opcional. */
  async function enviar(id, textoEditado) {
    const b = borradores.obtener(id);
    if (!b) return { ok: false, motivo: 'No encuentro ese borrador.' };
    if (b.estado === 'enviando') return { ok: false, motivo: 'Esa respuesta se está enviando en este momento. Espera unos segundos y recarga la página; no hace falta dar clic otra vez.' };
    if (b.estado === 'enviado') return { ok: false, motivo: 'Esa respuesta ya se envió. No se contesta dos veces.' };
    if (b.estado !== 'pendiente' && b.estado !== 'error') return { ok: false, motivo: `Ese borrador ya está «${b.estado}».` };
    if (!config.modoReal) {
      return { ok: false, motivo: 'El Publicador está en modo prueba (falta la variable PUBLICAR_DE_VERDAD con el valor si), así que NO se envió nada. Cuando enciendas el modo real, vuelve a aprobarla.' };
    }
    const anterior = b.estado;
    borradores.actualizar(id, { estado: 'enviando' });
    try {
      // Nunca se contesta dos veces: se mira si tu cuenta ya lo contestó (a mano, o en un envío anterior cuya respuesta se perdió).
      const ya = await yaContestado(b);
      if (ya === null) {
        borradores.actualizar(id, { estado: anterior });
        return { ok: false, motivo: 'No pude comprobar si ya contestaste ese comentario, así que no lo envío todavía. Inténtalo de nuevo en unos minutos.' };
      }
      if (ya) {
        borradores.actualizar(id, { estado: 'enviado', error: null, respuestaEnviada: '(ya tenía respuesta de tu cuenta)', cambioPorRed: null });
        borradores.guardar();
        registro.info(`💬 Ese comentario ya tenía respuesta de tu cuenta en ${b.plataforma}; no se contestó otra vez.`);
        return { ok: true, yaTenia: true, texto: '(ya tenía respuesta de tu cuenta)', cambioPorRed: null };
      }

      const original = String(textoEditado ?? b.respuesta ?? '').trim();
      const red = aplicarRedDeSeguridad({ tipo: b.tipo, respuesta: original, negocio, preguntaPrecio: b.preguntaPrecio });
      const final = red.texto;
      const r = await enviarRespuesta(b.plataforma, b.comentarioId, final);
      if (!r.ok) {
        const e = explicarErrorMeta(r.meta, { reintentaSolo: false });
        // Si la respuesta de Meta se perdió, pudo haber salido: al volver a aprobar se comprueba antes de enviar.
        borradores.actualizar(id, { estado: 'error', error: `${e.titulo} ${e.queHacer}`.trim(), intentos: (b.intentos || 0) + 1 });
        borradores.guardar();
        registro.error(`Error al contestar un comentario de ${b.plataforma}: ${r.error} | ${e.titulo}`);
        if (esLimiteMeta(r.meta)) enfriamiento.activar(ahoraMs() + esperaReintentoMin(1) * 60000, 'límite de llamadas de Meta');
        return { ok: false, motivo: `${e.titulo} ${e.queHacer}` };
      }
      enviadosRecientes.push(ahoraMs());
      borradores.actualizar(id, { estado: 'enviado', respuestaEnviada: final, enviadoId: r.json && r.json.id ? String(r.json.id) : null, error: null, cambioPorRed: red.cambiado ? red.motivo : null });
      borradores.guardar();
      registro.info(`💬 Respuesta enviada en ${b.plataforma} a «${resumirTexto(b.comentario, 40)}»${red.cambiado ? ` (la red de seguridad cambió el texto: ${red.motivo})` : ''}.`);
      return { ok: true, cambioPorRed: red.cambiado ? red.motivo : null, texto: final };
    } catch (e) {
      // Una falla inesperada nunca deja el borrador «enviando» para siempre.
      borradores.actualizar(id, { estado: 'error', error: 'Algo falló al enviarla. Inténtalo de nuevo en unos minutos.' });
      borradores.guardar();
      registro.error(`Error al contestar un comentario de ${b.plataforma}: ${registro.redactar(e && e.message ? e.message : e)}`);
      return { ok: false, motivo: 'Algo falló al enviarla. Inténtalo de nuevo en unos minutos.' };
    }
  }

  function rechazar(id) {
    const b = borradores.obtener(id);
    if (!b || (b.estado !== 'pendiente' && b.estado !== 'error')) return false;
    borradores.actualizar(id, { estado: 'rechazado' });
    borradores.guardar();
    return true;
  }

  async function tick() {
    if (!cfg.activo) return { inactivo: true };
    if (corriendo) return { omitido: true };
    const ahora = ahoraMs();
    if (ahora < pausaHastaMs) return { pausado: true };
    if (config.modoReal && enfriamiento.activo(ahora)) return { enfriando: true };
    corriendo = true;
    try {
      const { candidatos, problemas } = await recolectar(ahora);
      ultimaLectura = ahora;
      if (problemas.length) {
        fallosSeguidos += 1;
        const espera = esperaReintentoMin(fallosSeguidos);
        pausaHastaMs = ahora + espera * 60000;
        for (const p of problemas) {
          const e = explicarErrorMeta(p.meta);
          registro.error(`Error al leer los comentarios de ${p.red}: ${p.error} | ${e.titulo} ${e.queHacer} Se vuelve a intentar en ${espera} minutos.`);
          if (esLimiteMeta(p.meta)) enfriamiento.activar(ahora + espera * 60000, 'límite de llamadas de Meta');
        }
      } else fallosSeguidos = 0;

      const nuevos = candidatos.filter((c) => !borradores.existe(c.id)).sort((a, b) => a.cuandoMs - b.cuandoMs).slice(0, cfg.maxPorCiclo);
      let creados = 0;
      let enviados = 0;
      for (const c of nuevos) {
        let r;
        try {
          r = await prepararRespuesta({ comentario: { texto: c.texto, usuario: c.usuario }, publicacion: { texto: c.publicacionTexto }, negocio, modelo });
        } catch (e) {
          registro.error(`Error preparando la respuesta a un comentario: ${e && e.message ? e.message : e}`);
          continue;
        }
        const base = {
          id: c.id, plataforma: c.plataforma, comentarioId: c.comentarioId, publicacionId: c.publicacionId,
          publicacionTexto: resumirTexto(c.publicacionTexto, 300), usuario: c.usuario, comentario: c.texto.slice(0, 600),
          tipo: r.tipo, motivos: r.motivos, respuesta: r.respuesta, fuente: r.fuente, avisar: r.avisar, sospechoso: r.sospechoso,
          preguntaPrecio: r.preguntaPrecio, cambiadaPorRed: r.cambiadaPorRed, motivoRed: r.motivoRed, intentos: 0,
        };
        if (r.tipo === 'spam') {
          borradores.crear({ ...base, estado: 'ignorado' });
          continue;
        }
        borradores.crear({ ...base, estado: 'pendiente' });
        creados += 1;
        // Sin memoria de antes (despliegue nuevo), lo anterior al arranque nunca sale solo: pudo haber sido rechazado o contestado.
        const esDeAntes = !borradores.recuperada() && c.cuandoMs < inicioMs - MARGEN_DE_ARRANQUE_MS;
        const puedeSolo = config.modoReal && cfg.modo === 'automatico' && !r.avisar && !r.sospechoso && !esDeAntes
          && (r.tipo === 'normal' || r.tipo === 'luto') && !topePorHora(ahora) && !enfriamiento.activo(ahoraMs());
        if (puedeSolo) {
          const resultado = await enviar(c.id);
          if (resultado.ok) enviados += 1;
        }
      }
      borradores.guardar();
      if (creados) registro.info(`💬 Comentarios nuevos: ${creados} (${enviados} contestados solos, ${creados - enviados} esperan tu aprobación en /comentarios).`);
      return { revisados: candidatos.length, nuevos: nuevos.length, creados, enviados };
    } catch (e) {
      registro.error(`Error en la revisión de comentarios: ${e && e.message ? e.message : e}`);
      return { error: true };
    } finally {
      corriendo = false;
    }
  }

  return { tick, enviar, rechazar, ultimaLecturaMs: () => ultimaLectura, activo: cfg.activo };
}
