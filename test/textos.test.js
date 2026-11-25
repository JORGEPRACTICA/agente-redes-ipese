// Los textos que el alumno pega en Claude Code: un solo renglón y menos de 800 caracteres
// (Claude Code «colapsa» lo pegado que pasa de 3 líneas o de 800 caracteres).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.join(RAIZ, 'TEXTOS-PARA-PEGAR.md'), 'utf8');
const bloques = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('hay 8 textos para pegar y cada uno es de un solo renglón y de menos de 800 caracteres', () => {
  assert.equal(bloques.length, 8);
  for (const b of bloques) {
    assert.ok(!b.includes('\n'), `trae saltos de línea: ${b.slice(0, 40)}`);
    assert.ok(b.length < 800, `mide ${b.length}: ${b.slice(0, 40)}`);
  }
});

test('los Textos 1, 2 y 3 del video de GitHub miden lo que dice su guion (401, 54 y 779) y empiezan como se espera', () => {
  const [, t1, t2, t3] = bloques;
  assert.equal(t1.length, 401);
  assert.equal(t2.length, 54);
  assert.equal(t3.length, 779);
  assert.equal(t2, '! gh auth login --web --clipboard --git-protocol https');
  assert.match(t1, /^Prepara mi computadora para subir este proyecto a GitHub\./);
  assert.match(t3, /crea el repositorio PRIVADO mi-publicador con gh repo create --private/);
  assert.match(t3, /nunca me pidas pegar una llave\.$/);
});

test('ningún texto le pide a Claude Code que lea llaves ni archivos .env', () => {
  for (const b of bloques) {
    assert.doesNotMatch(b, /pégame (la|tu|mi) (llave|token|contraseña)/i);
    assert.doesNotMatch(b, /\bcat \.env|lee el \.env|abre el \.env/i);
  }
});

test('los nombres de variables de CLAUDE.md, README y .env.example son los mismos que lee el código', () => {
  const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'config.js'), 'utf8');
  const claude = fs.readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8');
  const lectura = fs.readFileSync(path.join(RAIZ, 'README_ALUMNO.md'), 'utf8');
  const ejemplo = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
  const enCodigo = new Set([...codigo.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
  for (const nombre of ['PANEL_CLAVE', 'IG_TOKEN', 'IG_USER_ID', 'FB_PAGE_TOKEN', 'FB_PAGE_ID', 'PUBLIC_URL', 'ANTHROPIC_API_KEY', 'PUBLICAR_DE_VERDAD', 'COMENTARIOS_ACTIVO', 'COMENTARIOS_MODO', 'ZONA_HORARIA']) {
    assert.ok(enCodigo.has(nombre), `${nombre} no lo lee el código`);
    assert.ok(claude.includes(`\`${nombre}\``), `${nombre} no está en CLAUDE.md`);
    assert.ok(ejemplo.includes(`${nombre}=`), `${nombre} no está en .env.example`);
  }
  for (const nombre of ['PANEL_CLAVE', 'IG_TOKEN', 'IG_USER_ID', 'PUBLIC_URL', 'PUBLICAR_DE_VERDAD']) assert.ok(lectura.includes(nombre), `${nombre} no está en README_ALUMNO.md`);
  // todo lo que el .env.example menciona lo usa el código
  for (const m of ejemplo.matchAll(/^([A-Z][A-Z0-9_]+)=$/gm)) assert.ok(enCodigo.has(m[1]), `.env.example trae ${m[1]} y el código no la lee`);
});

test('.claude/settings.json es JSON válido y bloquea leer .env, imprimir llaves, railway up y repos públicos', () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(RAIZ, '.claude', 'settings.json'), 'utf8'));
  const negadas = ajustes.permissions.deny;
  for (const regla of ['Read(.env)', 'Read(.env.*)', 'Read(!.env.example)', 'Bash(railway up *)', 'Bash(gh auth token *)']) assert.ok(negadas.includes(regla), `falta ${regla}`);
  assert.ok(negadas.some((r) => r.startsWith('Bash(gh repo create') && r.includes('--public')));
});
