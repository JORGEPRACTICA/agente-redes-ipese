// «Higiene» del kit: lo que NUNCA debe haber en los archivos que se entregan al alumno.
// Estas pruebas leen los archivos del propio kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unir } from '../src/simulador/credenciales-falsas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORAR = new Set(['node_modules', '.git', 'datos', '_interno']);
const BINARIOS = /\.(jpg|jpeg|png|webp|gif|pdf|zip|mp4|ico)$/i;

function archivosDeTexto(dir = RAIZ, salida = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(f.name) || f.name.startsWith('.tmp-')) continue;
    const ruta = path.join(dir, f.name);
    if (f.isDirectory()) archivosDeTexto(ruta, salida);
    else if (!BINARIOS.test(f.name)) salida.push(ruta);
  }
  return salida;
}
const relativo = (r) => path.relative(RAIZ, r).split(path.sep).join('/');
const todos = archivosDeTexto();
const esPrueba = (r) => relativo(r) === 'test/higiene.test.js';

test('ningún archivo trae algo con forma de llave (así la revisión antes de subir a GitHub no da falsas alarmas)', () => {
  const prefijos = [unir('sk-', 'ant-'), unir('gh', 'p_'), unir('github', '_pat_'), unir('E', 'AA'), unir('IG', 'AA'), unir('IG', 'QV')];
  const hallazgos = [];
  for (const ruta of todos) {
    if (esPrueba(ruta) || relativo(ruta).startsWith('TEXTOS-PARA-PEGAR.')) continue;   // ese archivo trae el Texto 3 tal cual; está en .gitignore y no se sube
    const t = fs.readFileSync(ruta, 'utf8');
    for (const p of prefijos) if (t.includes(p)) hallazgos.push(`${relativo(ruta)} contiene «${p}»`);
  }
  assert.deepEqual(hallazgos, []);
});

test('el archivo de textos para pegar (que menciona cómo empiezan las llaves) NO se sube a GitHub', () => {
  const ignore = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(ignore.includes('TEXTOS-PARA-PEGAR.md'));
  assert.ok(ignore.includes('TEXTOS-PARA-PEGAR.html'));
  assert.ok(ignore.includes('AVANCE.md'));
});

test('el código fuente no tiene caracteres invisibles escondidos', () => {
  // (la unión de emojis, U+200D, es legítima dentro de un emoji compuesto: no se cuenta)
  const invisibles = /[\u{200B}\u{200C}\u{200E}\u{200F}\u{2060}\u{FEFF}\u{00AD}\u{202A}-\u{202E}]/u;
  const hallazgos = todos.filter((r) => /\.(js|json|md)$/.test(r) && !esPrueba(r) && invisibles.test(fs.readFileSync(r, 'utf8'))).map(relativo);
  assert.deepEqual(hallazgos, []);
});

test('.gitignore protege .env y los archivos de llaves, y .env.example solo trae nombres', () => {
  const ignore = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  for (const regla of ['.env', '.env.*', '!.env.example', '*.pem', '*.key', 'datos/', 'node_modules/']) assert.ok(ignore.includes(regla), `falta «${regla}» en .gitignore`);
  const ejemplo = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.ok(ejemplo.length >= 10);
  for (const l of ejemplo) assert.match(l, /^[A-Z][A-Z0-9_]*=$/, `.env.example trae algo que no es un nombre vacío: ${l}`);
  assert.ok(!fs.existsSync(path.join(RAIZ, '.env')), 'no debe existir un .env en el kit');
});

test('el kit no depende de ninguna librería externa', () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(paquete.dependencies, undefined);
  assert.equal(paquete.devDependencies, undefined);
  assert.equal(paquete.type, 'module');
  assert.match(paquete.engines.node, />=20/);
  assert.ok(!fs.existsSync(path.join(RAIZ, 'node_modules')) || fs.readdirSync(path.join(RAIZ, 'node_modules')).length === 0);
  const importes = [];
  for (const ruta of todos.filter((r) => r.endsWith('.js'))) {
    const t = fs.readFileSync(ruta, 'utf8');
    for (const m of t.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
      if (!m[1].startsWith('.') && !m[1].startsWith('node:')) importes.push(`${relativo(ruta)} importa «${m[1]}»`);
    }
  }
  assert.deepEqual(importes, []);
});

// (Los nombres de personas y empresas que no deben aparecer NO se escriben aquí, porque este archivo sí se entrega:
//  esa revisión vive en la carpeta de trabajo, fuera del kit.)
test('lo que ve el alumno no trae avisos internos ni pendientes escritos a medias', () => {
  const prohibidas = [
    /a[uú]n no se ha (probado|comprobado)/i, /NO PROBADO/, /nota (interna|para)/i, /\/\/\s*(TODO|FIXME)/, /para uso interno/i,
  ];
  const hallazgos = [];
  for (const ruta of todos) {
    if (esPrueba(ruta)) continue;
    const t = fs.readFileSync(ruta, 'utf8');
    for (const p of prohibidas) if (p.test(t)) hallazgos.push(`${relativo(ruta)} contiene ${p}`);
  }
  assert.deepEqual(hallazgos, []);
});

// Las hojas que lee el alumno (no el calendario ni la ficha del negocio, que escribe cada alumno).
const HOJAS_DEL_ALUMNO = ['CLAUDE.md', 'README_ALUMNO.md', 'TEXTOS-PARA-PEGAR.md', 'TEXTOS-PARA-PEGAR.html', 'comentarios/HOJA-DE-COMENTARIOS.md'].map((f) => path.join(RAIZ, f));

test('lo que lee el alumno dice «da clic», nunca «pulsa» (ni pulsar, pulsó, pulse…)', () => {
  const codigo = todos.filter((r) => relativo(r).startsWith('src/') && r.endsWith('.js'));   // el código que escribe en las páginas
  const prohibida = /(?<!\p{L})puls(?:a|as|ar|arlo|arla|ando|e|es|en|ó|aste|ación|aciones)(?!\p{L})/iu;
  const hallazgos = [];
  for (const ruta of [...HOJAS_DEL_ALUMNO, ...codigo]) {
    if (!fs.existsSync(ruta)) continue;
    const m = fs.readFileSync(ruta, 'utf8').match(prohibida);
    if (m) hallazgos.push(`${relativo(ruta)} dice «${m[0]}»`);
  }
  assert.deepEqual(hallazgos, []);
});

test('las hojas del alumno no usan la palabra «gratis» ni «gratuita»', () => {
  const prohibida = /(?<!\p{L})gratis(?!\p{L})|(?<!\p{L})gratuit[oa]s?(?!\p{L})/iu;
  const hallazgos = [];
  for (const ruta of HOJAS_DEL_ALUMNO) {
    if (!fs.existsSync(ruta)) continue;
    const m = fs.readFileSync(ruta, 'utf8').match(prohibida);
    if (m) hallazgos.push(`${relativo(ruta)} dice «${m[0]}»`);
  }
  assert.deepEqual(hallazgos, []);
});

test('el código y los textos del alumno no traen direcciones de Railway ni precios', () => {
  const hallazgos = [];
  for (const ruta of todos) {
    if (esPrueba(ruta) || relativo(ruta).startsWith('test/')) continue;
    const t = fs.readFileSync(ruta, 'utf8');
    if (/railway\.app/i.test(t)) hallazgos.push(`${relativo(ruta)} trae una dirección de Railway`);
    if (/\.md$/.test(ruta) && /\$\s?\d/.test(t)) hallazgos.push(`${relativo(ruta)} trae un precio`);
  }
  assert.deepEqual(hallazgos, []);
});
