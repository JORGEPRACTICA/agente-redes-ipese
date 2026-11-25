// Registro del servicio: lo que se escribe en la pantalla de Railway («View logs») y en el panel.
// TODAS las líneas pasan por el redactor: una llave o un token nunca llegan a un registro.
import { crearRedactor } from './errores.js';
import { formatoFechaConSegundos } from './util.js';

/**
 * @param {{secretos?:string[], escribir?:(linea:string, nivel:string)=>void, ahoraMs?:()=>number, zona?:string, guardar?:number}} opciones
 */
export function crearRegistro({ secretos = [], escribir, ahoraMs = Date.now, zona = 'America/Mexico_City', guardar = 300 } = {}) {
  // La lista de secretos puede crecer (p. ej. cuando se renueva la llave de Instagram): redactar siempre usa la última.
  const lista = [...secretos];
  let redactarInterno = crearRedactor(lista);
  const redactar = (texto) => redactarInterno(texto);
  const historial = [];
  const salida = escribir || ((linea, nivel) => (nivel === 'error' ? console.error(linea) : console.log(linea)));

  function anotar(nivel, mensaje) {
    const texto = redactar(typeof mensaje === 'string' ? mensaje : (mensaje && mensaje.message) || String(mensaje));
    const linea = `[${formatoFechaConSegundos(ahoraMs(), zona)}] ${texto}`;
    historial.push({ nivel, linea });
    if (historial.length > guardar) historial.shift();
    try { salida(linea, nivel); } catch { /* un fallo al escribir nunca debe detener el servicio */ }
    return linea;
  }

  return {
    info: (m) => anotar('info', m),
    aviso: (m) => anotar('aviso', m),
    error: (m) => anotar('error', m),
    redactar,
    /** Agrega un secreto nuevo para que nunca aparezca en el registro. */
    agregarSecreto(s) {
      if (typeof s !== 'string' || s.length < 6 || lista.includes(s)) return;
      lista.push(s);
      redactarInterno = crearRedactor(lista);
    },
    ultimas: (n = 50) => historial.slice(-n).map((x) => x.linea),
  };
}
