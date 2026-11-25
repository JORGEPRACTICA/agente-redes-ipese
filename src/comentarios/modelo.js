// Cliente mínimo de la API de Anthropic (Claude), sin librerías. Se usa para redactar las respuestas a comentarios
// y para comprobar que tu llave funciona. La llave vive solo en las variables de Railway.

const VERSION_ANTHROPIC = '2023-06-01';

/** Qué pasó y qué hacer, en español, cuando Anthropic responde con un error. */
export function explicarErrorAnthropic(r) {
  if (r.red) return { titulo: 'No pude hablar con Anthropic (sin internet o tardó demasiado).', queHacer: 'Intenta de nuevo en unos minutos.' };
  const mensaje = String(r.mensaje || '');
  if (r.http === 401) return { titulo: 'La llave de Anthropic no es válida.', queHacer: 'En la Consola de Anthropic crea una llave nueva y pégala en Railway > Variables, en ANTHROPIC_API_KEY (nunca en un chat).' };
  if (r.http === 403) return { titulo: 'Tu llave de Anthropic no tiene permiso para esto.', queHacer: 'Crea una llave nueva desde tu cuenta de la Consola y cámbiala en Railway > Variables.' };
  if (r.http === 404) return { titulo: 'El modelo que se pidió no existe o no está disponible para tu cuenta.', queHacer: 'Quita la variable MODELO para usar el modelo por omisión, o pide a Claude Code que te diga cuáles hay.' };
  if (r.http === 429) return { titulo: 'Anthropic pide esperar: se hicieron demasiadas peticiones.', queHacer: 'No hagas nada: se vuelve a intentar solo.' };
  if (r.http === 400 && /credit balance|billing|saldo/i.test(mensaje)) return { titulo: 'Tu cuenta de Anthropic no tiene saldo.', queHacer: 'En la Consola de Anthropic, entra a Plans & Billing y agrega crédito (con un tope de gasto).' };
  if (r.http >= 500 || r.http === 529) return { titulo: 'Anthropic está saturado en este momento.', queHacer: 'No hagas nada: se vuelve a intentar solo.' };
  return { titulo: 'Anthropic rechazó la petición.', queHacer: 'Copia el mensaje (no lleva llaves) y pégalo en Claude Code para que te ayude.' };
}

/**
 * @param {{config:{anthropic:{apiKey:string, modelo:string, baseUrl:string}}, registro:{redactar:(t:string)=>string}, fetchFn?:typeof fetch, tiempoMs?:number}} opciones
 */
export function crearModelo({ config, registro, fetchFn = globalThis.fetch, tiempoMs = 30000 }) {
  const { apiKey, modelo, baseUrl } = config.anthropic;
  const redactar = registro.redactar;

  async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
    if (!apiKey) return { ok: false, http: 0, mensaje: 'Falta ANTHROPIC_API_KEY', sinLlave: true };
    let respuesta;
    let json;
    try {
      respuesta = await fetchFn(`${baseUrl}${ruta}`, {
        method: metodo,
        headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION_ANTHROPIC, 'content-type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(tiempoMs),
      });
      json = await respuesta.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, http: 0, red: true, mensaje: redactar(e && e.message ? e.message : e) };
    }
    if (!respuesta.ok) {
      return { ok: false, http: respuesta.status, tipoError: json && json.error && json.error.type, mensaje: redactar((json && json.error && json.error.message) || `HTTP ${respuesta.status}`) };
    }
    return { ok: true, http: respuesta.status, json: json || {} };
  }

  return {
    disponible: Boolean(apiKey),
    modelo,
    /** ¿La llave funciona? (listar modelos es gratis: no gasta saldo). */
    validarLlave: () => llamar('/v1/models?limit=1'),
    existeModelo: (id = modelo) => llamar(`/v1/models/${encodeURIComponent(id)}`),
    listarModelos: () => llamar('/v1/models?limit=100'),
    /** Pide una respuesta de texto. */
    async completar({ system, usuario, maxTokens = 300 }) {
      const r = await llamar('/v1/messages', { metodo: 'POST', cuerpo: { model: modelo, max_tokens: maxTokens, system, messages: [{ role: 'user', content: usuario }] } });
      if (!r.ok) return r;
      const bloques = Array.isArray(r.json.content) ? r.json.content : [];
      const texto = bloques.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
      return { ok: true, texto, uso: r.json.usage || null };
    },
  };
}
