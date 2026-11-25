// SIMULACIÓN «cliente nuevo con la plantilla de Railway» (IPESE).
// Arranca el servicio REAL (npm start) como lo haría Railway después del botón «Deploy», SOLO con las variables
// que trae la plantilla más las llaves que pegaría el cliente, contra una Meta y una Anthropic SIMULADAS
// (nada sale a internet; las llaves son falsas). Comprueba:
//   1. que el servicio arranca y /salud contesta;
//   2. que contesta SOLO un comentario normal de Instagram y uno de Facebook, con la ficha de voz de NEGOCIO_JSON;
//   3. que la queja NO sale sola (queda en /comentarios para una persona) y el spam se ignora;
//   4. que ninguna llave aparece en la salida, aunque Meta la «devuelva» en sus errores;
//   5. que después de un redespliegue (mismo volumen) NO vuelve a contestar lo ya contestado.
// Uso: npm run simular-cliente
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { iniciarSimulador } from '../src/simulador/meta-simulada.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const anotar = (ok, texto) => { resultados.push({ ok, texto }); console.log(`${ok ? '✅' : '❌'} ${texto}`); };

const puertoLibre = () => new Promise((resolver) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolver(p)); }); });

const sim = await iniciarSimulador({ ecoToken: true });
const volumen = fs.mkdtempSync(path.join(os.tmpdir(), 'volumen-railway-'));

// Lo que el cliente ya tiene publicado en sus redes (simulado)
const medio = sim.agregarMedio({ caption: 'Nuevo taller de liderazgo para supervisores. ¡Inscripciones abiertas!', hace: 3600000 });
const cNormal = sim.agregarComentarioIG(medio.id, { texto: '¿Cuándo es el siguiente taller? Me interesa para mi equipo', usuario: 'ana_rh' });
const cQueja = sim.agregarComentarioIG(medio.id, { texto: 'Pésimo servicio, les escribí tres veces y nadie me contesta. Qué decepción', usuario: 'cliente_molesto' });
const cSpam = sim.agregarComentarioIG(medio.id, { texto: 'Gana dinero rápido desde casa, entra a bit.ly/dinero-facil', usuario: 'promo_spam' });
const post = sim.agregarPost({ message: 'Conozca nuestro programa de desarrollo de talento.', hace: 3600000 });
const cFB = sim.agregarComentarioFB(post.id, { texto: 'Me interesa, ¿tienen fechas en diciembre?', nombre: 'Luis Pérez' });

// El «modelo» simulado: contesta de usted, corto, sin precios (como lo pediría la ficha de voz)
sim.anthropic.responder = async () => JSON.stringify({ tipo: 'normal', respuesta: '¡Gracias por escribirnos! Con gusto le compartimos las fechas y detalles por WhatsApp.' });

const ficha = {
  nombre: 'Negocio de prueba (simulación)',
  giro: 'capacitación y desarrollo de talento para empresas',
  voz: { tono: 'cálido, profesional y breve', trato: 'usted' },
};

async function arrancar(puerto, etiqueta) {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    // ── Lo que pone Railway solo ──
    PORT: String(puerto), RAILWAY_PUBLIC_DOMAIN: `127.0.0.1:${puerto}`, RAILWAY_VOLUME_MOUNT_PATH: volumen,
    // ── Lo que trae la plantilla de IPESE (ya configurado) ──
    NEGOCIO_JSON: Buffer.from(JSON.stringify(ficha)).toString('base64'),
    COMENTARIOS_ACTIVO: 'si', COMENTARIOS_MODO: 'automatico', PUBLICAR_DE_VERDAD: 'si',
    PANEL_CLAVE: 'clave-del-panel-de-la-simulacion-2026',
    // ── Lo único que pega el cliente ──
    IG_TOKEN: sim.token, IG_USER_ID: sim.igUserId, FB_PAGE_TOKEN: sim.pageToken, FB_PAGE_ID: sim.pageId, ANTHROPIC_API_KEY: sim.anthropicKey,
    // ── Solo para la simulación: apuntar a la Meta y la Anthropic de mentira, y no esperar 45 s al arrancar ──
    META_GRAPH_URL: sim.url, ANTHROPIC_URL: sim.url, ARRANQUE_ESPERA_SEG: '0',
  };
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'src', 'index.js')], { env, cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  const estado = { salida: '', hijo };
  hijo.stdout.on('data', (d) => { estado.salida += d; });
  hijo.stderr.on('data', (d) => { estado.salida += d; });
  console.log(`\n— ${etiqueta}: servicio arrancado en el puerto ${puerto} —`);
  return estado;
}

async function esperarHasta(condicion, ms) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) { if (await condicion()) return true; await esperar(300); }
  return false;
}

const respuestasIG = () => sim.llamadas.filter((l) => l.clave === 'responder_ig' && l.metodo === 'POST');
const respuestasFB = () => sim.llamadas.filter((l) => l.clave === 'responder_fb' && l.metodo === 'POST');

let codigo = 0;
let s1; let s2;
try {
  console.log('SIMULACIÓN: un cliente da clic en «Deploy» en la plantilla y pega solo sus llaves.\n');
  const puerto = await puertoLibre();
  s1 = await arrancar(puerto, 'Primer despliegue');

  const vivo = await esperarHasta(async () => { try { const r = await fetch(`http://127.0.0.1:${puerto}/salud`); return r.ok; } catch { return false; } }, 20000);
  anotar(vivo, 'El servicio arrancó y /salud contesta (lo que Railway revisa para dar el despliegue por bueno).');

  // El primer ciclo de comentarios corre unos 20 segundos después de arrancar.
  const contesto = await esperarHasta(() => respuestasIG().length >= 1 && respuestasFB().length >= 1, 60000);
  await esperar(3000); // margen por si intentara contestar algo más
  const ig = respuestasIG(); const fb = respuestasFB();
  anotar(contesto && ig.length === 1, `Contestó solo 1 comentario de Instagram (el normal): «${ig[0] ? ig[0].cuerpo.message : '—'}»`);
  anotar(ig.length === 1 && ig[0].ruta.includes(cNormal.id), 'La respuesta fue al comentario correcto (la pregunta por el taller).');
  anotar(fb.length === 1 && fb[0].ruta.includes(cFB.id), 'Contestó el comentario de la Página de Facebook.');
  anotar(!ig.some((l) => l.ruta.includes(cQueja.id)), 'La QUEJA no se contestó sola: espera a una persona.');
  anotar(!ig.some((l) => l.ruta.includes(cSpam.id)), 'El SPAM se ignoró.');

  const auth = 'Basic ' + Buffer.from('ipese:clave-del-panel-de-la-simulacion-2026').toString('base64');
  const panel = await fetch(`http://127.0.0.1:${puerto}/comentarios`, { headers: { authorization: auth } }).then((r) => r.text()).catch(() => '');
  anotar(/decepci|Pésimo|cliente_molesto/i.test(panel), 'La queja aparece en el panel /comentarios para que la atiendan.');
  const sinClave = await fetch(`http://127.0.0.1:${puerto}/comentarios`).then((r) => r.status).catch(() => 0);
  anotar(sinClave === 401, 'El panel pide contraseña (sin ella, no entra nadie).');

  const usoNegocio = sim.anthropic.llamadas.some((l) => JSON.stringify(l.cuerpo || {}).includes('Negocio de prueba (simulación)'));
  anotar(usoNegocio, 'El agente usó la ficha de voz que trae la plantilla (NEGOCIO_JSON).');

  s1.hijo.kill();
  await esperar(1500);

  // Redespliegue con el mismo volumen: no debe contestar de nuevo lo ya contestado.
  const puerto2 = await puertoLibre();
  s2 = await arrancar(puerto2, 'Redespliegue (mismo volumen)');
  const antesIG = respuestasIG().length; const antesFB = respuestasFB().length;
  await esperarHasta(() => /revisión de comentarios|Revisé|comentarios/i.test(s2.salida) && false, 26000); // deja correr un ciclo completo
  anotar(respuestasIG().length === antesIG && respuestasFB().length === antesFB, 'Después del redespliegue NO volvió a contestar lo que ya había contestado.');

  const todaLaSalida = s1.salida + s2.salida;
  const fugas = [sim.token, sim.pageToken, sim.anthropicKey].filter((s) => todaLaSalida.includes(s));
  anotar(fugas.length === 0, 'Ninguna llave apareció en los registros (aunque la Meta simulada las devolvía en sus errores).');
} catch (e) {
  anotar(false, `La simulación falló: ${e.message}`);
} finally {
  try { s1 && s1.hijo.kill(); } catch { /* ya terminó */ }
  try { s2 && s2.hijo.kill(); } catch { /* ya terminó */ }
  await sim.detener();
  fs.rmSync(volumen, { recursive: true, force: true });
}

const malos = resultados.filter((r) => !r.ok).length;
console.log(`\nResultado: ${resultados.length - malos} de ${resultados.length} comprobaciones bien.`);
if (malos) {
  codigo = 1;
  console.log('\nÚltimas líneas del servicio:\n' + (s2 ? s2.salida : s1 ? s1.salida : '').split('\n').slice(-25).join('\n'));
}
process.exit(codigo);
