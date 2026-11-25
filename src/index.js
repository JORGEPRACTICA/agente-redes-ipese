// Punto de entrada del Publicador: lo que arranca Railway con «npm start».
import { leerConfig, variablesFaltantes } from './config.js';
import { crearRegistro } from './registro.js';
import { crearClienteMeta } from './meta.js';
import { crearEstado } from './estado.js';
import { crearPlanificador } from './planificador.js';
import { crearEnfriamiento } from './enfriamiento.js';
import { crearModelo } from './comentarios/modelo.js';
import { crearBorradores } from './comentarios/borradores.js';
import { crearCicloComentarios } from './comentarios/ciclo.js';
import { cargarNegocio } from './comentarios/negocio.js';
import { crearServidor } from './web/servidor.js';
import { esperar } from './util.js';
import { tokenEfectivoIG, crearRenovadorIG } from './renovacion-token.js';

const config = leerConfig();
// Si la llave de Instagram ya se renovó antes (y viene de la misma llave pegada en Railway), se usa la renovada.
const tokenDeRailway = config.ig.token;
const efectivo = tokenEfectivoIG({ envToken: tokenDeRailway, datosDir: config.datosDir });
if (efectivo.token && efectivo.token !== config.ig.token) {
  config.ig.token = efectivo.token;
  config.secretos.push(efectivo.token);
}
const registro = crearRegistro({ secretos: config.secretos, zona: config.zonaHoraria });
for (const a of config.advertencias) registro.aviso(`Aviso: ${a}`);

const meta = crearClienteMeta({ config, registro });
const estado = crearEstado({ dir: config.datosDir, registro });
const enfriamiento = crearEnfriamiento();          // si Meta pide calma, ni las publicaciones ni los comentarios le hablan
const planificador = crearPlanificador({ config, meta, estado, registro, enfriamiento });
const { negocio, avisos: avisosNegocio } = cargarNegocio(config.raiz, { NEGOCIO_JSON: config.negocioJson });
const modelo = crearModelo({ config, registro });
const borradores = crearBorradores({ dir: config.datosDir, registro });
const ciclo = crearCicloComentarios({ config, meta, modelo, negocio, borradores, registro, enfriamiento });
const servidor = crearServidor({ config, registro, planificador, ciclo, borradores, negocio, avisosNegocio, meta, modelo });

const enCurso = new Set();           // tareas que están corriendo ahora mismo (para esperarlas al apagar)
let apagando = false;
const temporizadores = [];

function resumenDeArranque() {
  const faltan = variablesFaltantes(config);
  registro.info(`Publicador iniciado. ${config.modoReal ? 'MODO REAL: publica de verdad lo que toca.' : 'MODO PRUEBA: solo ensaya, NO publica nada (para publicar de verdad, agrega la variable PUBLICAR_DE_VERDAD con el valor: si).'}`);
  registro.info(`Instagram: ${config.ig.configurado ? 'configurado' : `falta ${faltan.instagram.join(' y ')}`} · Facebook: ${config.fb.configurado ? 'configurado' : 'sin configurar'} · Panel: ${config.panelClave.length >= 12 ? 'protegido con contraseña' : 'APAGADO (falta PANEL_CLAVE de 12 caracteres o más)'} · Comentarios: ${config.comentarios.activo ? (config.comentarios.modo === 'automatico' ? 'automático' : 'solo borradores') : 'apagados'}`);
  registro.info(`Dirección pública: ${config.urlPublica || 'sin definir (falta PUBLIC_URL)'} · Zona horaria: ${config.zonaHoraria}`);
  if (!estado.recuperada()) registro.info('Arranqué sin memoria de antes (es lo normal tras un despliegue nuevo): las publicaciones que ya habían vencido las busco en tu cuenta antes de decidir si publicarlas.');
}

servidor.listen(config.puerto, '0.0.0.0', () => {
  resumenDeArranque();
  registro.info(`Escuchando en el puerto ${config.puerto}. Tu panel está en /estado.`);
});

function programar(nombre, cadaMs, primeraVezMs, tarea) {
  const correr = () => {
    if (apagando) return;
    const trabajo = Promise.resolve(tarea())
      .catch((e) => registro.error(`Error en ${nombre}: ${e && e.message ? e.message : e}`))
      .finally(() => enCurso.delete(trabajo));
    enCurso.add(trabajo);
  };
  temporizadores.push(setTimeout(() => { correr(); temporizadores.push(setInterval(correr, cadaMs)); }, primeraVezMs));
}

// La primera revisión espera unos segundos: durante un despliegue nuevo, el servicio anterior puede seguir encendido un momento
// y no deben revisar el calendario los dos a la vez.
programar('la revisión del calendario', config.revisarCadaMs, config.arranqueEsperaMs, () => planificador.tick());
const renovador = crearRenovadorIG({ config, meta, registro, envToken: tokenDeRailway });
if (renovador.aplica) {
  // Una vez al día revisa si ya toca renovar (cada ~20 días). La primera, un minuto después del arranque.
  programar('la renovación de la llave de Instagram', 24 * 3600 * 1000, config.arranqueEsperaMs + 60000, () => renovador.tick());
}
if (config.comentarios.activo) {
  programar('la revisión de comentarios', config.comentarios.cadaMin * 60000, config.arranqueEsperaMs + 20000, () => ciclo.tick());
}

async function apagar(senal) {
  if (apagando) return;
  apagando = true;
  registro.info(`Recibí ${senal}: termino lo que estoy haciendo y me apago.`);
  for (const t of temporizadores) { clearTimeout(t); clearInterval(t); }
  servidor.close();
  await Promise.race([Promise.allSettled([...enCurso]), esperar(8000)]);
  estado.guardar();
  borradores.guardar();
  process.exit(0);
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
process.on('unhandledRejection', (e) => registro.error(`Error inesperado: ${e && e.message ? e.message : e}`));
process.on('uncaughtException', (e) => {
  registro.error(`Error grave: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
