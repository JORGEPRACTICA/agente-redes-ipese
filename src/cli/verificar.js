// npm run verificar            -> revisa todo lo que se puede revisar SIN crear nada en Instagram.
// npm run verificar -- --contenedor -> además crea un contenedor de prueba (un borrador invisible que NO se publica).
//
// Las llaves viven en Railway, no en tu computadora. Por eso lo normal es verificar desde la página /verificar de tu
// Publicador ya instalado (pide la contraseña PANEL_CLAVE). Este comando sirve cuando las variables existen en el
// entorno donde lo corres.
import { leerConfig } from '../config.js';
import { crearRegistro } from '../registro.js';
import { crearClienteMeta } from '../meta.js';
import { crearModelo } from '../comentarios/modelo.js';
import { verificarTodo, formatearTexto } from '../verificar.js';

const config = leerConfig();
const registro = crearRegistro({ secretos: config.secretos, zona: config.zonaHoraria, escribir: () => {} });

if (!config.ig.configurado && !config.fb.configurado && !config.anthropic.apiKey) {
  console.log('Aquí no hay llaves guardadas (y está bien: tus llaves viven solo en Railway).');
  console.log('Para verificar de verdad, abre en tu navegador la página /verificar de tu Publicador, por ejemplo:');
  console.log('   https://TU-DIRECCION-DE-RAILWAY/verificar   (te pide la contraseña PANEL_CLAVE)');
  console.log('Si todavía no lo has puesto en Railway, sigue los pasos de README_ALUMNO.md.');
  process.exit(0);
}

const meta = crearClienteMeta({ config, registro });
const modelo = crearModelo({ config, registro });
const informe = await verificarTodo({ config, meta, modelo, conContenedor: process.argv.includes('--contenedor') });
console.log(formatearTexto(informe));
process.exit(informe.listo ? 0 : 1);
