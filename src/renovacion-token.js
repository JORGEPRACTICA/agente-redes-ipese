// Renovación automática de la llave de Instagram.
// Las llaves del «inicio de sesión de Instagram» (empiezan con «IG») vencen a los 60 días. Meta deja renovarlas
// (cuando tienen más de 24 horas y siguen vigentes) con GET graph.instagram.com/refresh_access_token.
// Este módulo la renueva cada ~20 días, la guarda en la carpeta de datos (el volumen de Railway) y la usa en caliente.
// Si la persona pega una llave NUEVA en Railway, manda esa: la guardada solo se usa si viene de la misma llave original.
// La llave nunca se escribe en el registro (se agrega al redactor antes de usarla).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ARCHIVO_LLAVE = 'llave-instagram.json';
const DIA_MS = 24 * 3600 * 1000;

/** Huella corta de una llave (para saber de qué llave original viene la guardada, sin guardar la original). */
export const huellaLlave = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex').slice(0, 16);

/** ¿Es una llave que se puede renovar por esta vía? Solo las del inicio de sesión de Instagram. */
export function esRenovable(config) {
  const token = String(config.ig.token || '');
  if (!token || !config.ig.userId) return false;
  return /^IG/.test(token) || String(config.graph.baseIG || '').includes('graph.instagram.com');
}

export function leerLlaveGuardada(datosDir) {
  try {
    const crudo = JSON.parse(fs.readFileSync(path.join(datosDir, ARCHIVO_LLAVE), 'utf8'));
    if (crudo && typeof crudo.token === 'string' && typeof crudo.origen === 'string') return crudo;
  } catch { /* no hay o está dañada: se usa la de Railway */ }
  return null;
}

function guardarLlave(datosDir, datos) {
  fs.mkdirSync(datosDir, { recursive: true });
  const destino = path.join(datosDir, ARCHIVO_LLAVE);
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos), { mode: 0o600 });
  fs.renameSync(temporal, destino);
}

/** La llave que hay que usar al arrancar: la renovada (si viene de la misma llave de Railway) o la de Railway. */
export function tokenEfectivoIG({ envToken, datosDir }) {
  const guardada = leerLlaveGuardada(datosDir);
  if (guardada && envToken && guardada.origen === huellaLlave(envToken) && guardada.token) return { token: guardada.token, guardada };
  return { token: envToken, guardada: null };
}

/**
 * @param {{config:object, meta:{cambiarTokenIG:(t:string)=>void}, registro:object, envToken:string, fetchFn?:typeof fetch, ahoraMs?:()=>number}} o
 */
export function crearRenovadorIG({ config, meta, registro, envToken, fetchFn = globalThis.fetch, ahoraMs = Date.now }) {
  const aplica = Boolean(config.renovacionIG && config.renovacionIG.activa) && esRenovable(config);
  const origen = huellaLlave(envToken);
  const inicial = tokenEfectivoIG({ envToken, datosDir: config.datosDir });
  let actual = inicial.token;
  let ultima = inicial.guardada ? inicial.guardada.renovadoMs || null : null;
  let vence = inicial.guardada ? inicial.guardada.venceMs || null : null;
  const cadaMs = (config.renovacionIG ? config.renovacionIG.cadaDias : 20) * DIA_MS;
  const fecha = (ms) => new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: config.zonaHoraria });

  async function tick() {
    if (!aplica) return { hecho: false, motivo: 'no aplica' };
    const ahora = ahoraMs();
    if (ultima && ahora - ultima < cadaMs) return { hecho: false, motivo: 'todavía no toca' };
    const url = new URL(`${String(config.graph.baseIG).replace(/\/+$/, '')}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', actual);
    let r; let json = null;
    try {
      r = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
      json = await r.json().catch(() => null);
    } catch {
      registro.aviso('No pude hablar con Meta para renovar la llave de Instagram. Lo intento de nuevo mañana; la llave actual sigue sirviendo.');
      return { hecho: false, motivo: 'red' };
    }
    if (!r.ok || !json || typeof json.access_token !== 'string' || json.access_token.length < 6) {
      const detalle = json && json.error && json.error.message ? ` (Meta dijo: ${String(json.error.message).slice(0, 160)})` : '';
      registro.aviso(`La llave de Instagram todavía no se pudo renovar${detalle}. Lo intento de nuevo mañana. Si /verificar dice que ya no sirve, pega una nueva en Railway.`);
      return { hecho: false, motivo: 'meta' };
    }
    const nuevo = json.access_token;
    registro.agregarSecreto(nuevo);               // primero al redactor: nunca debe salir en un registro
    meta.cambiarTokenIG(nuevo);
    actual = nuevo;
    ultima = ahora;
    vence = Number(json.expires_in) > 0 ? ahora + Number(json.expires_in) * 1000 : null;
    try {
      guardarLlave(config.datosDir, { origen, token: nuevo, renovadoMs: ultima, venceMs: vence });
    } catch {
      registro.aviso('Renové la llave de Instagram pero no pude guardarla en la carpeta de datos (¿falta el volumen?). Sigue sirviendo hasta el próximo reinicio.');
    }
    registro.info(`Renové la llave de Instagram.${vence ? ` La nueva vence alrededor del ${fecha(vence)}.` : ''}`);
    return { hecho: true };
  }

  return {
    aplica,
    tick,
    estado: () => ({ aplica, ultimaRenovacionMs: ultima, venceMs: vence }),
  };
}
