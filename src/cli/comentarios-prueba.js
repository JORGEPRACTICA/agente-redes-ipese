// npm run comentarios:prueba -> pasa los 10 comentarios de ejemplo por el asistente y muestra su respuesta.
// Aquí NO hay llave de Anthropic (vive en Railway), así que se usan las respuestas de plantilla y las reglas fijas.
// Para ver cómo contesta tu asistente con tu voz, abre la página /comentarios/prueba de tu Publicador.
import { leerConfig } from '../config.js';
import { crearRegistro } from '../registro.js';
import { crearModelo } from '../comentarios/modelo.js';
import { cargarNegocio } from '../comentarios/negocio.js';
import { cargarCasos, correrPruebas } from '../comentarios/pruebas.js';

const config = leerConfig();
const registro = crearRegistro({ secretos: config.secretos, zona: config.zonaHoraria, escribir: () => {} });
const modelo = crearModelo({ config, registro });
const { negocio, avisos } = cargarNegocio(config.raiz);
const { casos, error } = cargarCasos(config.raiz);
if (error) { console.log(`❌ ${error}`); process.exit(1); }

const { resultados, correctos, total } = await correrPruebas({ casos, negocio, modelo });
console.log(`Probando ${total} comentarios de ejemplo (${modelo.disponible ? 'con tu llave de Anthropic' : 'con respuestas de plantilla: no hay llave aquí'})\n`);
for (const x of resultados) {
  console.log(`${x.bien ? '✅' : '❌'} ${x.caso.id}. ${x.caso.titulo}`);
  console.log(`     Comentario: ${x.caso.comentario}`);
  console.log(`     Tipo: ${x.resultado.tipo}${x.resultado.avisar ? ' (te lo marca para que lo revises tú)' : ''}`);
  console.log(`     Respuesta: ${x.resultado.respuesta || '(no se contesta)'}`);
  if (x.problemas.length) console.log(`     ⚠️ ${x.problemas.join('; ')}`);
}
for (const a of avisos) console.log(`\n⚠️ ${a}`);
console.log(`\n${correctos} de ${total} salieron como se esperaba.`);
process.exit(correctos === total ? 0 : 1);
