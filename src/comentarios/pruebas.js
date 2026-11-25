// Corre los 10 comentarios de prueba (comentarios/pruebas.json) por todo el proceso y dice, para cada uno,
// si el asistente lo clasificó bien y si su respuesta respeta las reglas. Sirve antes de activar el asistente.
import fs from 'node:fs';
import path from 'node:path';
import { prepararRespuesta } from './respuestas.js';
import { minusculasSinAcentos } from '../util.js';

export function cargarCasos(raiz) {
  const ruta = path.join(raiz, 'comentarios', 'pruebas.json');
  if (!fs.existsSync(ruta)) return { casos: [], error: 'No encuentro comentarios/pruebas.json.' };
  try {
    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^\p{Cf}+/u, ''));
    const casos = (datos.casos || []).map((c) => ({ ...c, textoPublicacion: (datos.publicaciones || {})[c.publicacion] || '' }));
    return { casos };
  } catch {
    return { casos: [], error: 'comentarios/pruebas.json tiene un error de escritura.' };
  }
}

/**
 * @returns {Promise<{resultados:object[], correctos:number, total:number}>}
 */
export async function correrPruebas({ casos, negocio, modelo }) {
  const resultados = [];
  for (const c of casos) {
    const r = await prepararRespuesta({
      comentario: { texto: c.comentario, usuario: c.usuario },
      publicacion: { texto: c.textoPublicacion },
      negocio,
      modelo,
    });
    const problemas = [];
    if (r.tipo !== c.esperado) problemas.push(`se esperaba «${c.esperado}» y salió «${r.tipo}»`);
    if (c.sinRespuesta && r.respuesta) problemas.push('no debía contestar');
    if (!c.sinRespuesta && !r.respuesta) problemas.push('debía tener una respuesta');
    if (c.avisar && !r.avisar) problemas.push('debía quedar marcado para que lo veas tú');
    const bajo = minusculasSinAcentos(r.respuesta || '');
    for (const palabra of c.noDebeContener || []) {
      if (bajo.includes(minusculasSinAcentos(palabra))) problemas.push(`la respuesta no debía contener «${palabra}»`);
    }
    resultados.push({ caso: c, resultado: r, problemas, bien: problemas.length === 0 });
  }
  return { resultados, correctos: resultados.filter((x) => x.bien).length, total: resultados.length };
}
