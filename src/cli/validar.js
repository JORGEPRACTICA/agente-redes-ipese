// npm run validar -> revisa tu calendario (fechas, textos, imágenes) y dice, en español, qué corregir. No publica nada.
import { leerConfig } from '../config.js';
import { cargarCalendario, fechaParaMostrar } from '../calendario.js';
import { resumirTexto } from '../util.js';

const config = leerConfig();
const cal = cargarCalendario({ dir: config.raiz, imagenesDir: config.imagenesDir, zona: config.zonaHoraria });

console.log(`Calendario: ${cal.archivo || '(no encontrado)'} · zona horaria ${config.zonaHoraria}\n`);
for (const p of cal.publicaciones) {
  const icono = p.valida ? '✅' : '❌';
  const estado = p.estado === 'ejemplo' ? ' [ejemplo]' : (p.estado === 'pausada' ? ' [pausada]' : '');
  console.log(`${icono} ${fechaParaMostrar(p, config.zonaHoraria)} · ${(p.redes || []).join(' + ') || '—'} · ${p.imagen || 'sin imagen'} · «${resumirTexto(p.textoInstagram || p.textoFacebook, 50)}»${estado}`);
}
if (cal.advertencias.length) {
  console.log('\nAvisos:');
  for (const a of cal.advertencias) console.log(`  ⚠️ ${a}`);
}
if (cal.problemas.length) {
  console.log('\nPara corregir:');
  for (const p of cal.problemas) console.log(`  ❌ ${p}`);
  console.log('\nPídele a Claude Code que corrija lo que dice arriba y vuelve a correr: npm run validar');
  process.exit(1);
}
console.log(`\n${cal.publicaciones.length ? '✅ El calendario está bien.' : '⚠️ El calendario está vacío.'}`);
