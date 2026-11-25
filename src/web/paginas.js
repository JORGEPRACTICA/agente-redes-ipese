// Las páginas del panel (HTML sencillo, sin JavaScript). Todo lo que viene de fuera (comentarios, textos) se escapa.
import { escaparHtml as e } from '../util.js';
import { formatoFecha } from '../util.js';
import { resumenFinal } from '../verificar.js';

const ICONO = { ok: '✅', mal: '❌', aviso: '⚠️' };

const CSS = `
:root{--fondo:#f6f7f9;--tarjeta:#fff;--texto:#1f2933;--suave:#5b6773;--linea:#dde2e8;--azul:#2f5d9e;--ok:#1b7f4a;--mal:#b3261e;--aviso:#9a6700;--prueba:#8a5a00}
@media (prefers-color-scheme:dark){:root{--fondo:#14181d;--tarjeta:#1d232a;--texto:#e8ecf0;--suave:#9aa6b2;--linea:#2e3740;--azul:#7fb0f0;--ok:#4cc38a;--mal:#ff8a80;--aviso:#e3b341;--prueba:#e3b341}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--texto);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--tarjeta);border-bottom:1px solid var(--linea);padding:12px 16px}
nav{max-width:980px;margin:0 auto;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
nav b{margin-right:auto}nav a{color:var(--azul);text-decoration:none;font-weight:600}nav a:hover{text-decoration:underline}
main{max-width:980px;margin:0 auto;padding:16px}
h1{font-size:1.5rem;margin:.2em 0 .6em}h2{font-size:1.15rem;margin:1.4em 0 .5em}
.tarjeta{background:var(--tarjeta);border:1px solid var(--linea);border-radius:10px;padding:14px 16px;margin:12px 0}
.modo{font-weight:700;padding:10px 14px;border-radius:10px;margin:8px 0}
.modo.prueba{background:#fff4d6;color:#6b4a00;border:1px solid #f0d58a}.modo.real{background:#e3f6ec;color:#12643a;border:1px solid #9bd8b8}
@media (prefers-color-scheme:dark){.modo.prueba{background:#3a2f12;color:#f2d98a;border-color:#6a5522}.modo.real{background:#123324;color:#9be3bf;border-color:#2a6a4a}}
table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{border-bottom:1px solid var(--linea);padding:7px 8px;text-align:left;vertical-align:top}th{color:var(--suave);font-weight:600}
.tabla{overflow-x:auto}
.etq{display:inline-block;padding:1px 9px;border-radius:99px;font-size:.82rem;font-weight:600;border:1px solid var(--linea)}
.etq.ok{color:var(--ok);border-color:var(--ok)}.etq.problema{color:var(--mal);border-color:var(--mal)}.etq.espera{color:var(--aviso);border-color:var(--aviso)}.etq.prueba{color:var(--prueba);border-color:var(--prueba)}.etq.programada{color:var(--azul);border-color:var(--azul)}.etq.pausada{color:var(--suave)}
.etq.luto{color:#6b4aa8;border-color:#6b4aa8}.etq.queja{color:var(--mal);border-color:var(--mal)}.etq.normal{color:var(--ok);border-color:var(--ok)}.etq.spam{color:var(--suave)}
button{font:inherit;font-weight:600;padding:8px 14px;border-radius:8px;border:1px solid var(--azul);background:var(--azul);color:#fff;cursor:pointer}
button.sec{background:transparent;color:var(--azul)}button.peligro{background:transparent;color:var(--mal);border-color:var(--mal)}
textarea{width:100%;min-height:84px;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--linea);background:var(--fondo);color:var(--texto)}
pre{background:var(--tarjeta);border:1px solid var(--linea);border-radius:10px;padding:12px;overflow:auto;font-size:.82rem;white-space:pre-wrap;word-break:break-word}
.paso{color:var(--suave);margin:.2em 0 0 1.6em}.suave{color:var(--suave)}
.fila{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
form{margin:0}
`;

function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(titulo)} · Publicador</title><style>${CSS}</style></head><body>
<header><nav><b>Publicador</b><a href="/estado">Estado</a><a href="/verificar">Verificar</a><a href="/comentarios">Comentarios</a></nav></header>
<main>${cuerpo}</main></body></html>`;
}

export function paginaMensaje(titulo, texto) {
  return pagina(titulo, `<h1>${e(titulo)}</h1><div class="tarjeta"><p>${e(texto)}</p></div>`);
}

function bloqueModo(config) {
  return config.modoReal
    ? '<div class="modo real">MODO REAL: el Publicador publica de verdad lo que ya toca en tu calendario.</div>'
    : '<div class="modo prueba">MODO PRUEBA: solo ensaya y NO publica nada. Para publicar de verdad, agrega en Railway la variable PUBLICAR_DE_VERDAD con el valor: si</div>';
}

export function paginaEstado({ config, filas, calendario, avisos, registros, ahoraMs, csrf }) {
  const problemas = (calendario && calendario.problemas) || [];
  const advertencias = (calendario && calendario.advertencias) || [];
  const tabla = filas.length
    ? `<div class="tabla"><table><thead><tr><th>Fecha</th><th>Red</th><th>Texto</th><th>Estado</th><th></th></tr></thead><tbody>${filas.map((f) => `
<tr><td>${e(f.fecha)}</td><td>${e(f.red)}</td><td>${e(f.texto)}</td>
<td><span class="etq ${e(f.tipo)}">${e(f.estado)}</span>${f.detalle ? `<div class="suave">${/^https:\/\//.test(f.detalle) ? `<a href="${e(f.detalle)}" rel="noopener noreferrer">${e(f.detalle)}</a>` : e(f.detalle)}</div>` : ''}</td>
<td>${f.puedeReintentar ? `<form method="post" action="/estado/reintentar"><input type="hidden" name="clave" value="${e(f.clave)}"><button class="sec" type="submit">Reintentar</button></form>` : ''}
${f.puedeRevisar ? `<form method="post" action="/estado/ya-salio"><input type="hidden" name="clave" value="${e(f.clave)}"><button class="sec" type="submit">Ya salió</button></form><form method="post" action="/estado/autorizar"><input type="hidden" name="clave" value="${e(f.clave)}"><button type="submit">Publicar ahora</button></form>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="suave">El calendario está vacío. Pídele a Claude Code que agregue tu primera publicación.</p>';
  const cuerpo = `
<h1>Tu Publicador</h1>
${bloqueModo(config)}
${avisos.length || problemas.length || advertencias.length ? `<div class="tarjeta"><b>Avisos</b><ul>${[...avisos, ...problemas, ...advertencias].map((a) => `<li>${e(a)}</li>`).join('')}</ul></div>` : ''}
<h2>Tu calendario</h2>
${tabla}
<p class="suave">Hora del servidor: ${e(formatoFecha(ahoraMs, config.zonaHoraria))} (${e(config.zonaHoraria)}). Primero se ensaya (modo prueba) y solo después se publica de verdad.</p>
<h2>Lo último que pasó</h2>
<pre>${e(registros.join('\n') || 'Todavía no hay nada que contar.')}</pre>`;
  return pagina('Estado', cuerpo);
}

export function paginaVerificar({ config, informe, conContenedorHecho }) {
  const filas = informe.resultados.map((x) => `
<div class="tarjeta"><div><b>${ICONO[x.estado]} ${e(x.titulo)}</b></div>
<div>${e(x.detalle)}</div>
${x.siguiente ? `<div class="paso">→ <b>Siguiente paso:</b> ${e(x.siguiente)}</div>` : ''}</div>`).join('');
  const fin = resumenFinal(informe);
  const resumen = `<div class="modo ${fin.bueno ? 'real' : 'prueba'}">${e(fin.texto)}</div>`;
  return pagina('Verificar', `
<h1>Verificación</h1>
${bloqueModo(config)}
${resumen}
${filas}
<div class="fila">
<form method="get" action="/verificar"><button type="submit">Volver a verificar</button></form>
${conContenedorHecho ? '' : '<form method="post" action="/verificar"><button class="sec" type="submit">Probar también con Instagram (sin publicar)</button></form>'}
</div>
<p class="suave">Esta página nunca publica nada. La prueba con Instagram crea un borrador invisible que caduca solo a las 24 horas.</p>`);
}

const ETQ_TIPO = { luto: 'Luto', queja: 'Queja', normal: 'Normal', spam: 'Spam' };

function tarjetaBorrador(b) {
  return `
<div class="tarjeta">
<div><span class="etq ${e(b.tipo)}">${e(ETQ_TIPO[b.tipo] || b.tipo)}</span> ${b.avisar ? '<span class="etq problema">Revísalo tú</span>' : ''} <span class="suave">${e(b.plataforma === 'instagram' ? 'Instagram' : 'Facebook')} · ${e(b.usuario || '')}</span></div>
<p><b>Comentario:</b> ${e(b.comentario)}</p>
<p class="suave"><b>Publicación:</b> ${e(b.publicacionTexto || '(sin texto)')}</p>
${b.motivos && b.motivos.length ? `<p class="suave">Por qué: ${e(b.motivos.join('; '))}.</p>` : ''}
${b.error ? `<p class="suave"><b>No se pudo enviar:</b> ${e(b.error)}</p>` : ''}
<form method="post" action="/comentarios/accion">
<input type="hidden" name="id" value="${e(b.id)}">
<textarea name="texto" maxlength="600" aria-label="Respuesta propuesta">${e(b.respuesta)}</textarea>
<div class="fila"><button type="submit" name="accion" value="aprobar">Aprobar y enviar</button><button class="peligro" type="submit" name="accion" value="rechazar">No contestar</button></div>
</form></div>`;
}

export function paginaComentarios({ config, pendientes, recientes, avisos, mensaje, ultimaLecturaMs, ahoraMs }) {
  const c = config.comentarios;
  const estado = c.activo
    ? `<div class="modo ${c.modo === 'automatico' ? 'real' : 'prueba'}">${c.modo === 'automatico'
      ? 'Modo AUTOMÁTICO: salen solos los comentarios normales y los de luto (un agradecimiento corto). Las quejas y lo sospechoso siempre esperan tu aprobación.'
      : 'Modo SOLO BORRADORES: nada sale hasta que tú lo apruebas aquí.'}</div>`
    : '<div class="modo prueba">Las respuestas a comentarios están APAGADAS. Para encenderlas agrega en Railway la variable COMENTARIOS_ACTIVO con el valor: si (y la llave ANTHROPIC_API_KEY).</div>';
  return pagina('Comentarios', `
<h1>Comentarios</h1>
${estado}
${mensaje ? `<div class="tarjeta">${e(mensaje)}</div>` : ''}
${avisos.length ? `<div class="tarjeta"><ul>${avisos.map((a) => `<li>${e(a)}</li>`).join('')}</ul></div>` : ''}
<p class="suave">${ultimaLecturaMs ? `Última lectura de comentarios: ${e(formatoFecha(ultimaLecturaMs, config.zonaHoraria))}.` : 'Todavía no se ha leído ningún comentario.'} Se leen cada ${c.cadaMin} minutos (${e(formatoFecha(ahoraMs, config.zonaHoraria))} ahora). Este kit no contesta mensajes directos.</p>
<h2>Esperan tu aprobación (${pendientes.length})</h2>
${pendientes.length ? pendientes.map(tarjetaBorrador).join('') : '<p class="suave">No hay nada pendiente.</p>'}
<div class="fila"><form method="get" action="/comentarios/prueba"><button class="sec" type="submit">Probar con los 10 comentarios de ejemplo</button></form></div>
<h2>Lo último que se revisó</h2>
${recientes.length ? `<div class="tabla"><table><thead><tr><th>Tipo</th><th>Comentario</th><th>Respuesta</th><th>Estado</th></tr></thead><tbody>${recientes.map((b) => `
<tr><td><span class="etq ${e(b.tipo)}">${e(ETQ_TIPO[b.tipo] || b.tipo)}</span></td><td>${e(b.comentario)}</td><td>${e(b.respuestaEnviada || b.respuesta || '—')}</td><td>${e({ enviado: 'Enviada', rechazado: 'No se contestó', ignorado: 'Spam: ignorado', error: 'Error' }[b.estado] || b.estado)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="suave">Todavía no hay historial.</p>'}`);
}

export function paginaPruebaComentarios({ resultado, usaModelo, error }) {
  const cuerpoResultado = resultado
    ? `<div class="modo ${resultado.correctos === resultado.total ? 'real' : 'prueba'}">${resultado.correctos === resultado.total ? '✅' : '⚠️'} ${resultado.correctos} de ${resultado.total} salieron como se esperaba.${usaModelo ? '' : ' (Se usaron las respuestas de plantilla porque no hay llave de Anthropic.)'}</div>
<div class="tabla"><table><thead><tr><th>#</th><th>Caso</th><th>Comentario</th><th>Tipo</th><th>Respuesta propuesta</th><th></th></tr></thead><tbody>${resultado.resultados.map((x) => `
<tr><td>${e(x.caso.id)}</td><td>${e(x.caso.titulo)}</td><td>${e(x.caso.comentario)}</td>
<td><span class="etq ${e(x.resultado.tipo)}">${e(ETQ_TIPO[x.resultado.tipo] || x.resultado.tipo)}</span></td>
<td>${x.resultado.respuesta ? e(x.resultado.respuesta) : '<span class="suave">(no se contesta)</span>'}${x.resultado.cambiadaPorRed ? `<div class="suave">La red de seguridad cambió el texto: ${e(x.resultado.motivoRed)}.</div>` : ''}</td>
<td>${x.bien ? '✅' : `❌ ${e(x.problemas.join('; '))}`}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return pagina('Probar comentarios', `
<h1>Probar con 10 comentarios de ejemplo</h1>
<div class="tarjeta"><p>Aquí ves cómo contestaría tu asistente a diez comentarios inventados: un pésame, una queja, «¿cuánto cuesta?», spam… Nada se publica en ninguna red.</p>
<p class="suave">${usaModelo ? 'Usa tu llave de Anthropic (cada prueba cuesta una fracción de centavo).' : 'No hay llave de Anthropic: se usan las respuestas de plantilla.'}</p>
${error ? `<p><b>${e(error)}</b></p>` : ''}
<form method="post" action="/comentarios/prueba"><button type="submit">Correr las 10 pruebas</button></form></div>
${cuerpoResultado}`);
}
