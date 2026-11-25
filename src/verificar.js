// «verificar»: revisa, con ✅ y ❌, que todo esté listo para publicar, y dice qué hacer en cada caso.
// NUNCA publica nada. Lo más que hace (y solo si se pide) es crear un contenedor de prueba en Instagram:
// un borrador invisible que caduca solo a las 24 horas y que no aparece en tu perfil.
import { explicarErrorMeta } from './errores.js';
import { explicarErrorAnthropic } from './comentarios/modelo.js';
import { esJpeg, LIMITES_IMAGEN } from './jpeg.js';
import { variablesFaltantes } from './config.js';

// Para no gastar llamadas de más, el contenedor de prueba se crea como mucho una vez cada 10 minutos.
const ESPERA_ENTRE_CONTENEDORES_MS = 10 * 60 * 1000;
const limiteGlobal = { ultimoMs: 0 };
export function crearLimiteDeContenedor() { return { ultimoMs: 0 }; }

const ok = (id, titulo, detalle, extra = {}) => ({ id, titulo, estado: 'ok', detalle, siguiente: '', ...extra });
const mal = (id, titulo, detalle, siguiente, extra = {}) => ({ id, titulo, estado: 'mal', detalle, siguiente, ...extra });
const aviso = (id, titulo, detalle, siguiente = '', extra = {}) => ({ id, titulo, estado: 'aviso', detalle, siguiente, ...extra });

const aEnteroSeguro = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function pasoRailway(nombres) {
  return `En Railway entra a tu servicio > Variables > New Variable y agrega: ${nombres.join(', ')}. Pega cada valor tú, directo en Railway (nunca en un chat). Luego da clic en Deploy.`;
}

/** Revisa que las imágenes (las próximas del calendario, hasta 3) se puedan descargar desde internet, como lo hará Meta. */
async function revisarDireccionDeImagenes({ config, fetchFn, nombres }) {
  if (!config.urlPublica) {
    return mal('direccion_imagenes', 'Dirección pública de las imágenes', 'Falta la dirección pública de tu servicio.',
      'En Railway entra a tu servicio > Settings > Networking > Generate Domain; copia la dirección (empieza con https://) y agrégala en Variables como PUBLIC_URL. Luego da clic en Deploy.');
  }
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(config.urlPublica);
  if (!/^https:\/\//i.test(config.urlPublica) && !local) {
    return mal('direccion_imagenes', 'Dirección pública de las imágenes', `La dirección ${config.urlPublica} no empieza con https://.`, 'Meta pide https. Corrige PUBLIC_URL en Railway > Variables para que empiece con https://.');
  }
  const resultados = [];
  for (const nombre of nombres) resultados.push({ nombre, r: await revisarUnaImagen({ config, fetchFn, nombreImagen: nombre }) });
  const malas = resultados.filter((x) => x.r.estado !== 'ok');
  if (malas.length) {
    const primera = malas[0].r;
    return { ...primera, detalle: `${primera.detalle}${malas.length > 1 ? ` (y ${malas.length - 1} imagen(es) más con problemas)` : ''}` };
  }
  if (resultados.length === 1) return resultados[0].r;
  return ok('direccion_imagenes', 'Dirección pública de las imágenes', `Meta podrá descargar tus imágenes: abrí ${resultados.length} de las próximas del calendario y todas entregaron un JPEG.`);
}

async function revisarUnaImagen({ config, fetchFn, nombreImagen }) {
  const url = `${config.urlPublica}/imagenes/${encodeURIComponent(nombreImagen)}`;
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    const tipo = String(r.headers.get('content-type') || '');
    if (!r.ok) {
      return mal('direccion_imagenes', 'Dirección pública de las imágenes', `Abrí ${config.urlPublica}/imagenes/${nombreImagen} y respondió ${r.status}.`,
        r.status === 404 ? 'Revisa que la imagen exista en la carpeta imagenes y que esté en el calendario. Si acabas de agregarla, sube el cambio a GitHub y espera el Deploy.' : 'Revisa que PUBLIC_URL sea la dirección que te dio Railway y que el servicio esté en estado Active.');
    }
    const cuerpo = Buffer.from(await r.arrayBuffer());
    if (/text\/html/i.test(tipo) || !esJpeg(cuerpo)) {
      return mal('direccion_imagenes', 'Dirección pública de las imágenes', 'La dirección abre, pero NO entrega una imagen JPEG (entrega otra cosa, como una página).',
        'Revisa que PUBLIC_URL sea la dirección de tu Publicador y que la imagen sea un JPEG verdadero (.jpg).');
    }
    if (cuerpo.length > LIMITES_IMAGEN.pesoMaxBytes) {
      return mal('direccion_imagenes', 'Dirección pública de las imágenes', 'La imagen de prueba pesa más de 8 MB.', 'Pide a Claude Code que comprima la imagen.');
    }
    return ok('direccion_imagenes', 'Dirección pública de las imágenes', `Meta podrá descargar tus imágenes: abrí ${config.urlPublica}/imagenes/${nombreImagen} y entregó un JPEG de ${(cuerpo.length / 1024).toFixed(0)} KB.`);
  } catch (e) {
    return mal('direccion_imagenes', 'Dirección pública de las imágenes', 'No pude abrir la dirección pública desde internet.',
      'Revisa que el servicio esté en estado Active en Railway y que PUBLIC_URL sea la dirección que te dio Settings > Networking.');
  }
}

/**
 * @param {{config:object, meta:object, modelo:object, fetchFn?:typeof fetch, nombresImagen?:string[], conContenedor?:boolean, dormir?:(ms:number)=>Promise<void>, ahoraMs?:()=>number, env?:object}} p
 * @returns {Promise<{resultados:object[], listo:boolean, modo:string}>}
 */
export async function verificarTodo({ config, meta, modelo, fetchFn = globalThis.fetch, nombresImagen = ['_prueba.jpg'], conContenedor = false, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), ahoraMs = Date.now, env = process.env, limite = limiteGlobal }) {
  const resultados = [];
  const agregar = (x) => { resultados.push(x); return x; };
  const faltan = variablesFaltantes(config, env);

  // 1. Variables (solo los NOMBRES)
  const obligatorias = [...faltan.instagram, ...faltan.panel, ...faltan.direccion];
  if (obligatorias.length) {
    agregar(mal('variables', 'Variables en Railway', `Faltan estas variables (solo los nombres): ${obligatorias.join(', ')}.`, pasoRailway(obligatorias)));
  } else {
    agregar(ok('variables', 'Variables en Railway', 'Están todas las que hacen falta para publicar en Instagram.'));
  }

  // 2. Modo
  agregar(config.modoReal
    ? aviso('modo', 'Modo de trabajo', 'MODO REAL: el Publicador publica de verdad lo que ya toca en tu calendario.', 'Si quieres volver a ensayar sin publicar, borra la variable PUBLICAR_DE_VERDAD en Railway.')
    : ok('modo', 'Modo de trabajo', 'MODO PRUEBA: el Publicador solo ensaya y NO publica nada.', {}));

  // 3. Llave de Anthropic
  if (!modelo.disponible) {
    const necesaria = config.comentarios.activo;
    agregar((necesaria ? mal : aviso)('anthropic', 'Llave de Anthropic', 'No hay llave de Anthropic (ANTHROPIC_API_KEY).',
      necesaria ? pasoRailway(['ANTHROPIC_API_KEY']) : 'La necesitas solo para las respuestas a comentarios. Si las quieres: ' + pasoRailway(['ANTHROPIC_API_KEY'])));
  } else {
    const r = await modelo.validarLlave();
    if (!r.ok) {
      const e = explicarErrorAnthropic(r);
      agregar(mal('anthropic', 'Llave de Anthropic', e.titulo, e.queHacer));
    } else {
      const m = await modelo.existeModelo();
      if (!m.ok && m.http === 404) {
        agregar(mal('anthropic', 'Llave de Anthropic', `La llave funciona, pero el modelo «${config.anthropic.modelo}» no existe para tu cuenta.`, 'Quita la variable MODELO en Railway para usar el modelo por omisión, o pide a Claude Code que te diga cuáles hay.'));
      } else {
        agregar(ok('anthropic', 'Llave de Anthropic', `La llave funciona y el modelo «${config.anthropic.modelo}» está disponible.`));
      }
    }
  }

  // 4. Token de Meta y a qué cuenta pertenece
  let cuenta = null;
  if (!config.ig.configurado) {
    agregar(mal('meta_token', 'Token de Meta y cuenta de Instagram', 'No puedo revisar el token porque faltan IG_TOKEN o IG_USER_ID.', pasoRailway(faltan.instagram.length ? faltan.instagram : ['IG_TOKEN', 'IG_USER_ID'])));
  } else {
    const r = await meta.ig.cuenta();
    if (!r.ok) {
      const e = explicarErrorMeta(r.meta);
      agregar(mal('meta_token', 'Token de Meta y cuenta de Instagram', e.titulo, e.queHacer));
    } else {
      cuenta = r.json;
      agregar(ok('meta_token', 'Token de Meta y cuenta de Instagram', `El token funciona y pertenece a la cuenta @${cuenta.username || '(sin nombre)'}. Confirma que es la que quieres: ahí se publicará.`));
    }
  }

  // 5. Cuenta profesional
  if (cuenta) {
    const tipo = String(cuenta.account_type || '').toUpperCase();
    if (tipo && tipo !== 'BUSINESS' && tipo !== 'MEDIA_CREATOR') {
      agregar(mal('cuenta_profesional', 'Cuenta profesional', `La cuenta es de tipo ${tipo}, y para publicar por API debe ser profesional (empresa o creador).`, 'En la app de Instagram: Configuración > Tipo de cuenta y herramientas > Cambiar a cuenta profesional.'));
    } else {
      agregar(ok('cuenta_profesional', 'Cuenta profesional', tipo ? `La cuenta es profesional (${tipo === 'BUSINESS' ? 'empresa' : 'creador'}).` : 'Meta entregó los datos de la cuenta, y solo lo hace con cuentas profesionales.'));
    }
  }

  // 6. Página de Facebook
  if (!config.fb.configurado) {
    agregar(aviso('facebook', 'Página de Facebook', 'Facebook no está configurado (FB_PAGE_TOKEN y FB_PAGE_ID).', `Si también quieres publicar en tu Página: ${pasoRailway(faltan.facebook.length ? faltan.facebook : ['FB_PAGE_TOKEN', 'FB_PAGE_ID'])}`));
  } else {
    const r = await meta.fb.cuenta();
    if (!r.ok) {
      const e = explicarErrorMeta(r.meta);
      agregar(mal('facebook', 'Página de Facebook', e.titulo, e.queHacer));
    } else {
      const l = await meta.fb.listarPosts(3);
      if (l.ok) agregar(ok('facebook', 'Página de Facebook', `El token funciona y pertenece a la Página «${r.json.name || r.json.id}». Puedo leer sus últimas publicaciones (el candado contra duplicados funciona).`));
      else agregar(aviso('facebook', 'Página de Facebook', `El token funciona (Página «${r.json.name || r.json.id}»), pero no puedo leer sus últimas publicaciones, y sin eso el candado contra duplicados no funciona: no se publicará en Facebook.`,
        'Genera el token de la Página otra vez aceptando todos los permisos (incluido el de leer publicaciones) y cámbialo en Railway > Variables.'));
    }
  }

  // 7. Dirección pública de las imágenes
  agregar(await revisarDireccionDeImagenes({ config, fetchFn, nombres: nombresImagen }));
  const direccionOk = resultados[resultados.length - 1].estado === 'ok';

  // 8. Contenedor de prueba (SIN publicar)
  if (!conContenedor) {
    agregar(aviso('contenedor', 'Creación de un contenedor (sin publicar)', 'No se probó todavía: crea un borrador invisible en Instagram para comprobar que acepta tu imagen.', 'Da clic en el botón «Probar también con Instagram (sin publicar)» en esta página.'));
  } else if (!cuenta || !direccionOk) {
    agregar(aviso('contenedor', 'Creación de un contenedor (sin publicar)', 'No se probó porque antes hay que arreglar el token o la dirección de las imágenes.', 'Arregla los ❌ de arriba y vuelve a probar.'));
  } else if (ahoraMs() - limite.ultimoMs < ESPERA_ENTRE_CONTENEDORES_MS) {
    agregar(aviso('contenedor', 'Creación de un contenedor (sin publicar)', 'Ya se hizo una prueba hace menos de 10 minutos; espera para no gastar llamadas de más.', 'Vuelve a probar en unos minutos.'));
  } else {
    limite.ultimoMs = ahoraMs();
    const imagenUrl = `${config.urlPublica}/imagenes/${encodeURIComponent(nombresImagen[0])}`;
    const c = await meta.ig.crearContenedor({ imageUrl: imagenUrl, caption: '[Prueba del Publicador · no se publica]' });
    if (!c.ok) {
      const e = explicarErrorMeta(c.meta);
      agregar(mal('contenedor', 'Creación de un contenedor (sin publicar)', `Instagram NO aceptó la imagen de prueba. ${e.titulo}`, e.queHacer));
    } else {
      await dormir(2000);
      const est = await meta.ig.estadoContenedor(c.json.id);
      const codigo = est.ok ? est.json.status_code : 'sin confirmar';
      agregar(ok('contenedor', 'Creación de un contenedor (sin publicar)', `Instagram aceptó la imagen y dejó el contenedor listo (estado: ${codigo}). NO se publicó nada: el contenedor caduca solo en 24 horas.`));
    }
  }

  // 9. Cupo de publicación
  if (cuenta) {
    const r = await meta.ig.cupo();
    if (!r.ok) {
      const e = explicarErrorMeta(r.meta);
      agregar(aviso('cupo', 'Cupo de publicación', `No pude leer cuántas publicaciones te quedan. ${e.titulo}`, e.queHacer));
    } else {
      const fila = Array.isArray(r.json.data) ? r.json.data[0] : null;
      const total = fila && fila.config ? aEnteroSeguro(fila.config.quota_total) : null;
      const usado = fila ? aEnteroSeguro(fila.quota_usage) : null;
      if (total !== null && usado !== null) {
        const quedan = Math.max(0, total - usado);
        agregar(quedan > 0
          ? ok('cupo', 'Cupo de publicación', `Te quedan ${quedan} de ${total} publicaciones por API en las últimas 24 horas.`)
          : mal('cupo', 'Cupo de publicación', `Ya usaste las ${total} publicaciones por API de las últimas 24 horas.`, 'Espera a que pase el día; el Publicador reintenta solo.'));
      } else {
        agregar(aviso('cupo', 'Cupo de publicación', 'Meta respondió, pero no pude leer el número de publicaciones restantes.', ''));
      }
    }
  }

  // 10. Lectura de /media (la que usa el candado contra duplicados)
  if (cuenta) {
    const r = await meta.ig.listarMedia(5);
    if (!r.ok) {
      const e = explicarErrorMeta(r.meta);
      agregar(mal('lectura_media', 'Lectura de tus publicaciones (candado contra duplicados)', `No puedo leer lo último que hay publicado en tu cuenta. ${e.titulo}`,
        `${e.queHacer} Sin esta lectura el Publicador NO publica, para no duplicar.`));
    } else {
      const n = Array.isArray(r.json.data) ? r.json.data.length : 0;
      agregar(ok('lectura_media', 'Lectura de tus publicaciones (candado contra duplicados)', n ? `Puedo leer tus últimas publicaciones (leí ${n}). El candado contra duplicados funciona.` : 'Puedo leer tus publicaciones (la cuenta todavía no tiene ninguna). El candado contra duplicados funciona.'));
    }
  }

  // 11. Comentarios (opcional)
  if (cuenta) {
    const r = await meta.ig.mediaConComentarios({ publicaciones: 1, comentarios: 1 });
    agregar(r.ok
      ? ok('comentarios', 'Lectura de comentarios (opcional)', 'Puedo leer los comentarios de tus publicaciones.')
      : aviso('comentarios', 'Lectura de comentarios (opcional)', `No pude leer los comentarios. ${explicarErrorMeta(r.meta).titulo}`,
        'Solo la necesitas para las respuestas a comentarios: genera el token otra vez aceptando el permiso de comentarios.'));
  }

  const requeridos = new Set(['variables', 'meta_token', 'cuenta_profesional', 'direccion_imagenes', 'lectura_media', 'cupo']);
  const esEsencial = (x) => requeridos.has(x.id) || x.id === 'contenedor';
  const listo = resultados.every((x) => !(x.estado === 'mal' && esEsencial(x)));
  // Lo opcional (Facebook, la llave de Anthropic) también puede estar en ❌: no impide publicar en Instagram, pero se dice.
  const opcionalesPorArreglar = resultados.some((x) => x.estado === 'mal' && !esEsencial(x));
  return { resultados, listo, opcionalesPorArreglar, modo: config.modoReal ? 'real' : 'prueba' };
}

const ICONO = { ok: '✅', mal: '❌', aviso: '⚠️' };

/** La frase final del informe (la usan la terminal y la página /verificar). */
export function resumenFinal(informe) {
  if (!informe.listo) return { bueno: false, texto: '❌ TODAVÍA NO ESTÁ LISTO: arregla los ❌ de arriba (cada uno dice cuál es el siguiente paso) y vuelve a verificar.' };
  const opcionales = informe.opcionalesPorArreglar ? ' Revisa también lo opcional que quedó en ❌ (Facebook o la llave de Anthropic).' : '';
  return informe.modo === 'real'
    ? { bueno: true, texto: `✅ Lo esencial está listo y el modo REAL ya está encendido: el Publicador publica lo que toca.${opcionales}` }
    : { bueno: true, texto: `✅ Lo esencial está listo para publicar. Cuando quieras publicar de verdad, agrega en Railway la variable PUBLICAR_DE_VERDAD con el valor: si${opcionales}` };
}

/** El informe como texto (para la terminal). */
export function formatearTexto(informe) {
  const lineas = [`VERIFICACIÓN DEL PUBLICADOR (${informe.modo === 'real' ? 'modo REAL' : 'modo PRUEBA: no publica'})`, ''];
  for (const x of informe.resultados) {
    lineas.push(`${ICONO[x.estado]} ${x.titulo}: ${x.detalle}`);
    if (x.siguiente) lineas.push(`   → Siguiente paso: ${x.siguiente}`);
  }
  lineas.push('');
  lineas.push(resumenFinal(informe).texto);
  return lineas.join('\n');
}
