// npm run ensayo -> un ensayo completo con una Meta SIMULADA. No usa llaves, no toca internet y no publica nada en tus redes.
// Sirve para ver, en un minuto, cómo se comporta el Publicador: publicar, esperar cuando Meta pide calma, no duplicar,
// acortar un texto largo y contestar comentarios con cuidado.
import { crearEntorno, crearRelojVirtual } from '../simulador/entorno.js';
import { crearModelo } from '../comentarios/modelo.js';
import { crearBorradores } from '../comentarios/borradores.js';
import { crearCicloComentarios } from '../comentarios/ciclo.js';
import { normalizarNegocio } from '../comentarios/negocio.js';
import { cargarCasos, correrPruebas } from '../comentarios/pruebas.js';
import { leerConfig } from '../config.js';

const MIN = 60000;
const largo = ['Apertura de la publicación.', ...Array.from({ length: 6 }, (_, i) => `📌 Idea ${i + 1}\n${'Un párrafo con bastante contenido para ocupar espacio. '.repeat(11)}`), 'Escríbenos para más información.', '#negocio #ejemplo'].join('\n\n');

const e = await crearEntorno({
  modoReal: true,
  reloj: crearRelojVirtual(),
  publicaciones: [
    { id: 'normal', fecha: '2026-12-01 10:00', texto: '¡Buenos días! Hoy abrimos con muchas ganas de atenderte. #ejemplo', imagen: 'a.jpg' },
    { id: 'espera', fecha: '2026-12-01 10:00', texto: 'Esta publicación se topa con un límite de Meta.', imagen: 'b.jpg' },
    { id: 'largo', fecha: '2026-12-01 10:00', texto: largo, imagen: 'c.jpg', redes: ['instagram', 'facebook'] },
  ],
  env: { TOLERANCIA_HORAS: '24' },
});

let vistas = 0;
function mostrar(titulo) {
  console.log(`\n=== ${titulo} ===`);
  for (const l of e.lineas.slice(vistas)) console.log(`   ${l}`);
  vistas = e.lineas.length;
}

try {
  console.log('ENSAYO DEL PUBLICADOR (con una Meta simulada: no se publica nada en tus redes)');

  // Meta le pide calma a la segunda publicación de Instagram (error pasajero) y todo lo demás sale bien.
  e.sim.programar('ig_crear_contenedor', ['ok', { http: 400, error: { code: 4, message: 'Application request limit reached' } }]);
  await e.planificador.tick();
  mostrar('1. Llega la hora: se publica en Facebook e Instagram');
  console.log(`   Resultado: ${e.sim.posts.length} publicaciones en Facebook, ${e.sim.medios.length} en Instagram.`);

  const espera = e.estado.obtener('espera|instagram');
  console.log(`\n2. Meta pidió esperar con una publicación: no gasta los intentos, espera ${(espera.proximoIntentoMs - e.reloj.ahora()) / MIN} minutos.`);
  e.reloj.avanzar(10 * MIN);
  await e.planificador.tick();
  mostrar('3. Pasan 10 minutos y lo intenta de nuevo');
  console.log(`   Resultado: ahora hay ${e.sim.medios.length} publicaciones en Instagram.`);
  const largoFacebook = e.sim.posts.find((p) => p.message.startsWith('Apertura'))?.message.length;
  const largoInstagram = e.sim.medios.find((m) => m.caption.startsWith('Apertura'))?.caption.length;
  console.log(`   Texto largo: en Facebook salió completo (${largoFacebook} caracteres); en Instagram quedó en ${largoInstagram} (el máximo es 2,200).`);

  e.estado.quitar('normal|instagram');
  e.estado.quitar('normal|facebook');
  const antes = e.sim.medios.length + e.sim.posts.length;
  await e.planificador.tick();
  const despues = e.sim.medios.length + e.sim.posts.length;
  mostrar('4. Se pierde la memoria del Publicador (por ejemplo, se reinicia): NO duplica');
  console.log(`   Resultado: antes ${antes} publicaciones, ahora ${despues}. El candado leyó tu cuenta y vio que ya estaba publicada.`);

  // Comentarios: un modelo «mal portado» intenta vender en todo, y la red de seguridad lo corrige.
  console.log('\n=== 5. Comentarios con contexto (un asistente que INTENTA vender en todo; mira cómo lo frena la red de seguridad) ===');
  e.sim.anthropic.responder = (cuerpo) => {
    const tipo = (cuerpo.system.match(/Tipo mínimo detectado por las reglas para este comentario: (\w+)/) || [])[1] || 'normal';
    return JSON.stringify({ tipo, respuesta: '¡Gracias! Inscríbete a nuestro curso con 20% de descuento en https://curso.example.com 😊' });
  };
  const negocio = normalizarNegocio({ nombre: 'Mi negocio', precios: 'en_persona' });
  const config = leerConfig({ ...e.env });
  const modelo = crearModelo({ config: e.config, registro: e.registro });
  const { casos } = cargarCasos(config.raiz);
  const { resultados, correctos, total } = await correrPruebas({ casos, negocio, modelo });
  for (const x of resultados) {
    console.log(`   ${x.bien ? '✅' : '❌'} ${x.caso.titulo}`);
    console.log(`      Comentario: ${x.caso.comentario}`);
    console.log(`      Tipo: ${x.resultado.tipo}${x.resultado.avisar ? ' (te lo marca para que lo revises tú)' : ''} · Respuesta: ${x.resultado.respuesta || '(no se contesta)'}`);
    if (x.resultado.cambiadaPorRed) console.log(`      Red de seguridad: cambió el texto porque ${x.resultado.motivoRed}.`);
  }
  console.log(`   ${correctos} de ${total} salieron como se esperaba.`);

  const borradores = crearBorradores({ registro: e.registro, ahoraMs: e.reloj.ahora });
  const ciclo = crearCicloComentarios({ config: { ...e.config, comentarios: { ...e.config.comentarios, activo: true } }, meta: e.meta, modelo, negocio, borradores, registro: e.registro, ahoraMs: e.reloj.ahora });
  const medio = e.sim.agregarMedio({ caption: 'Con profundo dolor despedimos a Don Ernesto. Descanse en paz. 🕊️', hace: 2 * 3600000 });
  e.sim.agregarComentarioIG(medio.id, { texto: 'Mi más sentido pésame a su familia', usuario: 'maria_demo' });
  const r = await ciclo.tick();
  console.log(`\n6. Modo SOLO BORRADORES (el de siempre): se leyeron ${r.revisados} comentario(s), ${r.creados} esperan tu aprobación y se contestaron ${r.enviados} sin tu permiso.`);

  const cortoEnInstagram = Number.isFinite(largoInstagram) && largoInstagram <= 2200 && largoFacebook > 2200;
  const todoBien = e.sim.medios.length === 4 && antes === despues && cortoEnInstagram && correctos === total && r.enviados === 0;
  console.log(`\n${todoBien ? '✅ El ensayo salió como se esperaba.' : '❌ Algo del ensayo no salió como se esperaba.'}`);
  console.log('Recuerda: esto fue una simulación. Tus redes no se tocaron.');
  process.exitCode = todoBien ? 0 : 1;
} finally {
  await e.limpiar();
}
