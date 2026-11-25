// Los borradores de respuesta: lo que el asistente propone contestar y que tú apruebas antes de que salga.
// Se guardan en datos/borradores.json. Si el archivo se pierde (Railway lo borra en cada despliegue nuevo),
// no pasa nada grave: el asistente no vuelve a contestar un comentario que ya tiene respuesta tuya en la red social.
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const MAX_GUARDADOS = 400;
const CATORCE_DIAS = 14 * 24 * 3600 * 1000;

export function crearBorradores({ dir, registro, ahoraMs = Date.now } = {}) {
  const archivo = dir ? path.join(dir, 'borradores.json') : null;
  const mapa = new Map();
  let sucio = false;
  let recuperada = false;      // ¿había borradores guardados de antes (un archivo que sí se pudo leer)?

  if (archivo) {
    try {
      if (fs.existsSync(archivo)) {
        const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        if (datos && datos.version === VERSION && Array.isArray(datos.borradores)) {
          for (const b of datos.borradores) if (b && typeof b.id === 'string') mapa.set(b.id, b);
          recuperada = true;
        }
      }
    } catch (e) {
      if (registro) registro.aviso(`No pude leer datos/borradores.json (${String(e.message).slice(0, 80)}); empiezo sin borradores.`);
    }
  }

  function podar() {
    const ahora = ahoraMs();
    for (const [id, b] of mapa) {
      if (b.estado !== 'pendiente' && b.estado !== 'enviando' && ahora - (b.actualizadoMs || b.creadoMs || 0) > CATORCE_DIAS) mapa.delete(id);
    }
    if (mapa.size > MAX_GUARDADOS) {
      const viejos = [...mapa.values()].filter((b) => b.estado !== 'pendiente').sort((a, b) => (a.actualizadoMs || 0) - (b.actualizadoMs || 0));
      for (const b of viejos.slice(0, mapa.size - MAX_GUARDADOS)) mapa.delete(b.id);
    }
  }

  function guardar() {
    if (!archivo || !sucio) return;
    try {
      podar();
      fs.mkdirSync(dir, { recursive: true });
      const temporal = `${archivo}.${process.pid}.tmp`;
      fs.writeFileSync(temporal, JSON.stringify({ version: VERSION, borradores: [...mapa.values()] }, null, 1), 'utf8');
      fs.renameSync(temporal, archivo);
    } catch (e) {
      if (registro) registro.aviso(`No pude guardar datos/borradores.json (${String(e.message).slice(0, 80)}). El asistente sigue funcionando.`);
    }
    sucio = false;
  }

  return {
    /** Si es falso, el servicio arrancó sin recordar qué comentarios ya revisó o rechazaste (por ejemplo, tras un despliegue nuevo). */
    recuperada: () => recuperada,
    existe: (id) => mapa.has(id),
    obtener: (id) => mapa.get(id),
    crear(datos) {
      const ahora = ahoraMs();
      const b = { ...datos, creadoMs: ahora, actualizadoMs: ahora };
      mapa.set(b.id, b);
      sucio = true;
      return b;
    },
    actualizar(id, parche) {
      const b = mapa.get(id);
      if (!b) return null;
      Object.assign(b, parche, { actualizadoMs: ahoraMs() });
      sucio = true;
      return b;
    },
    listar(estados) {
      const lista = [...mapa.values()];
      return (estados ? lista.filter((b) => estados.includes(b.estado)) : lista).sort((a, b) => (b.creadoMs || 0) - (a.creadoMs || 0));
    },
    guardar,
  };
}
