// Memoria del Publicador: qué ya salió, qué falló y cuándo se reintenta.
// Se guarda en un archivo (datos/estado.json) por si el servicio se reinicia dentro del mismo despliegue.
// En Railway los archivos se borran con cada despliegue nuevo, y no pasa nada: la fuente de la verdad contra duplicados
// es la propia cuenta de Instagram o de Facebook (el candado lee lo último que hay publicado antes de publicar).
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

/**
 * @param {{dir:string, registro?:{aviso:(m:string)=>void}}} opciones
 */
export function crearEstado({ dir, registro } = {}) {
  const archivo = dir ? path.join(dir, 'estado.json') : null;
  const trabajos = new Map();
  let sucio = false;
  let recuperada = false;      // ¿había memoria guardada de antes (un archivo que sí se pudo leer)?

  function cargar() {
    if (!archivo) return;
    try {
      if (!fs.existsSync(archivo)) return;
      const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      if (!datos || datos.version !== VERSION || typeof datos.trabajos !== 'object') return;
      for (const [clave, job] of Object.entries(datos.trabajos)) {
        if (job && typeof job === 'object' && typeof job.estado === 'string') trabajos.set(clave, { ...job, clave });
      }
      recuperada = true;
    } catch (e) {
      if (registro) registro.aviso(`No pude leer datos/estado.json (${String(e.message).slice(0, 80)}); empiezo con la memoria vacía.`);
    }
  }
  cargar();

  /** Guarda en disco si algo cambió. Nunca lanza un error: si no se puede escribir, el servicio sigue. */
  function guardar() {
    if (!archivo || !sucio) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const temporal = `${archivo}.${process.pid}.tmp`;
      const salida = { version: VERSION, trabajos: Object.fromEntries(trabajos) };
      fs.writeFileSync(temporal, JSON.stringify(salida, null, 1), 'utf8');
      fs.renameSync(temporal, archivo);
      sucio = false;
    } catch (e) {
      sucio = false;
      if (registro) registro.aviso(`No pude guardar datos/estado.json (${String(e.message).slice(0, 80)}). El Publicador sigue funcionando.`);
    }
  }

  return {
    /** Si es falso, el servicio arrancó sin recordar nada (por ejemplo, tras un despliegue nuevo en Railway). */
    recuperada: () => recuperada,
    obtener: (clave) => trabajos.get(clave),
    poner(clave, datos) {
      trabajos.set(clave, { ...datos, clave });
      sucio = true;
      return trabajos.get(clave);
    },
    quitar(clave) {
      if (trabajos.delete(clave)) sucio = true;
    },
    todos: () => [...trabajos.values()],
    /** ¿Ese post de la cuenta ya es de OTRA publicación del calendario? */
    yaEsDeOtro(idExterno, claveActual) {
      if (!idExterno) return false;
      for (const j of trabajos.values()) {
        if (j.clave !== claveActual && j.estado === 'publicada' && String(j.externalId) === String(idExterno)) return true;
      }
      return false;
    },
    guardar,
  };
}
