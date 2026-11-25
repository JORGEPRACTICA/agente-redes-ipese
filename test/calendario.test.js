import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cargarCalendario, interpretarFecha, parsearCsv } from '../src/calendario.js';
import { crearJpegFalso } from '../src/simulador/entorno.js';
import { revisarImagenParaInstagram, dimensionesJpeg, esJpeg } from '../src/jpeg.js';
import { localAUtc, formatoFecha } from '../src/util.js';

function carpeta(archivos = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  fs.mkdirSync(path.join(dir, 'imagenes'));
  for (const [nombre, contenido] of Object.entries(archivos)) {
    fs.writeFileSync(nombre.startsWith('imagenes/') ? path.join(dir, nombre) : path.join(dir, nombre), contenido);
  }
  return dir;
}
const cargar = (dir) => cargarCalendario({ dir, imagenesDir: path.join(dir, 'imagenes'), zona: 'America/Mexico_City' });
const base = { fecha: '2026-12-01 10:00', texto: 'Hola mundo', imagen: 'foto.jpg' };

test('zonas horarias: 10:00 en Ciudad de México es 16:00 UTC (sin horario de verano)', () => {
  assert.equal(new Date(localAUtc(2026, 12, 1, 10, 0, 0, 'America/Mexico_City')).toISOString(), '2026-12-01T16:00:00.000Z');
  assert.equal(new Date(localAUtc(2026, 7, 1, 10, 0, 0, 'America/Mexico_City')).toISOString(), '2026-07-01T16:00:00.000Z');
  // con horario de verano: Nueva York en julio es UTC-4 y en diciembre UTC-5
  assert.equal(new Date(localAUtc(2026, 7, 1, 10, 0, 0, 'America/New_York')).toISOString(), '2026-07-01T14:00:00.000Z');
  assert.equal(new Date(localAUtc(2026, 12, 1, 10, 0, 0, 'America/New_York')).toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(formatoFecha(Date.UTC(2026, 11, 1, 16, 0, 0), 'America/Mexico_City'), '2026-12-01 10:00');
});

test('interpretarFecha acepta los formatos comunes y rechaza lo que no existe', () => {
  const z = 'America/Mexico_City';
  const iso = (t) => new Date(interpretarFecha(t, z).ms).toISOString();
  assert.equal(iso('2026-12-01 10:00'), '2026-12-01T16:00:00.000Z');
  assert.equal(iso('2026-12-01T10:00'), '2026-12-01T16:00:00.000Z');
  assert.equal(iso('2026-12-01T10:00:00-06:00'), '2026-12-01T16:00:00.000Z');
  assert.equal(iso('2026-12-01T16:00:00Z'), '2026-12-01T16:00:00.000Z');
  assert.equal(iso('01/12/2026 10:00'), '2026-12-01T16:00:00.000Z');       // día/mes/año
  assert.ok(interpretarFecha('2026-02-30 10:00', z).error, 'el 30 de febrero no existe');
  assert.ok(interpretarFecha('2026-13-01 10:00', z).error);
  assert.ok(interpretarFecha('2026-12-01 25:00', z).error);
  assert.match(interpretarFecha('2026-12-01', z).error, /falta la hora/);
  assert.match(interpretarFecha('mañana', z).error, /no entiendo/);
  assert.match(interpretarFecha('', z).error, /falta la fecha/);
});

test('un calendario válido se lee, con id automático y estable', () => {
  const dir = carpeta({ 'imagenes/foto.jpg': crearJpegFalso(1080, 1350), 'calendario.json': JSON.stringify({ publicaciones: [base] }) });
  const a = cargar(dir);
  assert.deepEqual(a.problemas, []);
  assert.equal(a.publicaciones.length, 1);
  const p = a.publicaciones[0];
  assert.equal(p.valida, true);
  assert.deepEqual(p.redes, ['instagram', 'facebook']);
  assert.equal(new Date(p.programadoMs).toISOString(), '2026-12-01T16:00:00.000Z');
  assert.match(p.id, /^p[0-9a-f]{8}$/);
  assert.equal(cargar(dir).publicaciones[0].id, p.id, 'el id automático no cambia entre lecturas');
});

test('acepta una lista suelta, sinónimos de columnas y nombres de red cortos', () => {
  const dir = carpeta({
    'imagenes/foto.jpg': crearJpegFalso(),
    'calendario.json': JSON.stringify([{ Fecha: '2026-12-01 10:00', Copy: 'Hola', Foto: 'foto.jpg', Redes: 'IG, fb', id: 'navidad-1' }]),
  });
  const r = cargar(dir);
  assert.deepEqual(r.problemas, []);
  assert.deepEqual(r.publicaciones[0].redes, ['instagram', 'facebook']);
  assert.equal(r.publicaciones[0].id, 'navidad-1');
});

test('errores explicados en español: sin imagen para Instagram, formato, archivo faltante, fecha, red', () => {
  const dir = carpeta({
    'imagenes/foto.jpg': crearJpegFalso(),
    'imagenes/logo.png': Buffer.from('no importa'),
    'calendario.json': JSON.stringify({ publicaciones: [
      { fecha: '2026-12-01 10:00', texto: 'sin imagen' },
      { fecha: '2026-12-02 10:00', texto: 'png', imagen: 'logo.png' },
      { fecha: '2026-12-03 10:00', texto: 'falta', imagen: 'no-existe.jpg' },
      { fecha: 'pronto', texto: 'fecha mala', imagen: 'foto.jpg' },
      { fecha: '2026-12-05 10:00', texto: 'red mala', imagen: 'foto.jpg', redes: 'tiktok' },
      { fecha: '2026-12-06 10:00', imagen: 'foto.jpg' },
    ] }),
  });
  const r = cargar(dir);
  assert.equal(r.publicaciones.every((p) => !p.valida), true);
  const todo = r.problemas.join('\n');
  assert.match(todo, /Instagram exige una imagen/);
  assert.match(todo, /debe ser JPEG/);
  assert.match(todo, /no encuentro la imagen/);
  assert.match(todo, /no entiendo la fecha/);
  assert.match(todo, /tiktok/);
  assert.match(todo, /falta el texto/);
});

test('una imagen .jpg que en realidad no es JPEG, o muy alargada, o muy chica, se rechaza para Instagram', () => {
  const dir = carpeta({
    'imagenes/falsa.jpg': Buffer.from('<html>no soy imagen</html>'),
    'imagenes/larga.jpg': crearJpegFalso(2000, 500),
    'imagenes/chica.jpg': crearJpegFalso(200, 200),
    'imagenes/vertical.jpg': crearJpegFalso(1080, 1350),
    'imagenes/horizontal.jpg': crearJpegFalso(1910, 1000),
    'calendario.json': JSON.stringify({ publicaciones: [
      { ...base, imagen: 'falsa.jpg' }, { ...base, imagen: 'larga.jpg' }, { ...base, imagen: 'chica.jpg' },
      { ...base, imagen: 'vertical.jpg' }, { ...base, imagen: 'horizontal.jpg' },
    ] }),
  });
  const r = cargar(dir);
  assert.deepEqual(r.publicaciones.map((p) => p.valida), [false, false, false, true, true]);
  assert.match(r.problemas[0], /no es un JPEG de verdad/);
});

test('solo Facebook no exige imagen', () => {
  const dir = carpeta({ 'calendario.json': JSON.stringify({ publicaciones: [{ fecha: '2026-12-01 10:00', texto: 'Solo texto', redes: ['facebook'] }] }) });
  assert.deepEqual(cargar(dir).problemas, []);
});

test('el nombre de la imagen no puede salirse de la carpeta imagenes', () => {
  const dir = carpeta({ 'calendario.json': JSON.stringify({ publicaciones: [{ ...base, imagen: '../.env' }, { ...base, imagen: 'sub/foto.jpg' }, { ...base, imagen: '..\\x.jpg' }] }) });
  const r = cargar(dir);
  assert.equal(r.publicaciones.every((p) => !p.valida), true);
  assert.match(r.problemas.join('\n'), /solo el nombre del archivo/);
});

test('id repetido es un problema; dos publicaciones idénticas, una advertencia', () => {
  const dir = carpeta({
    'imagenes/foto.jpg': crearJpegFalso(),
    'calendario.json': JSON.stringify({ publicaciones: [{ ...base, id: 'uno' }, { ...base, id: 'uno', fecha: '2026-12-02 10:00' }, { ...base, id: 'tres' }] }),
  });
  const r = cargar(dir);
  assert.match(r.problemas.join('\n'), /repetido/);
  assert.match(r.advertencias.join('\n'), /es igual a la publicación/);
});

test('JSON roto: el mensaje dice en qué línea y no pide nada técnico', () => {
  const dir = carpeta({ 'calendario.json': '{\n "publicaciones": [\n  { "fecha": "2026-12-01 10:00" "texto": "x" }\n ]\n}' });
  const r = cargar(dir);
  assert.equal(r.publicaciones.length, 0);
  assert.match(r.problemas[0], /error de escritura/);
  assert.match(r.problemas[0], /línea/);
  assert.match(r.problemas[0], /Claude Code/);
});

test('sin calendario: lo dice claro', () => {
  const dir = carpeta();
  assert.match(cargar(dir).problemas[0], /No encuentro calendario\.json/);
});

test('avisos: texto de más de 2,200 caracteres o con más de 30 hashtags', () => {
  const dir = carpeta({
    'imagenes/foto.jpg': crearJpegFalso(),
    'calendario.json': JSON.stringify({ publicaciones: [{ ...base, texto: 'x'.repeat(2300) + '\n\n' + Array.from({ length: 33 }, (_, i) => `#t${i}`).join(' ') }] }),
  });
  const r = cargar(dir);
  assert.deepEqual(r.problemas, []);
  assert.match(r.advertencias.join('\n'), /2,200/);
  assert.match(r.advertencias.join('\n'), /30 hashtags/);
});

test('CSV: comas o punto y coma, comillas, saltos de línea dentro de un texto y columna de hora aparte', () => {
  const csv = String.fromCharCode(0xFEFF) + 'fecha;hora;texto;imagen;redes\n2026-12-01;10:00;"Línea uno\nlínea ""dos""";foto.jpg;instagram\n';
  const filas = parsearCsv(csv);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].texto, 'Línea uno\nlínea "dos"');
  const dir = carpeta({ 'imagenes/foto.jpg': crearJpegFalso(), 'calendario.csv': csv });
  const r = cargar(dir);
  assert.deepEqual(r.problemas, []);
  assert.equal(r.archivo, 'calendario.csv');
  assert.equal(new Date(r.publicaciones[0].programadoMs).toISOString(), '2026-12-01T16:00:00.000Z');
  assert.deepEqual(r.publicaciones[0].redes, ['instagram']);
});

test('JPEG: dimensiones y revisión', () => {
  const j = crearJpegFalso(1080, 1350);
  assert.ok(esJpeg(j));
  assert.deepEqual(dimensionesJpeg(j), { ancho: 1080, alto: 1350 });
  assert.equal(revisarImagenParaInstagram(j).ok, true);
  assert.equal(revisarImagenParaInstagram(crearJpegFalso(1080, 566)).ok, true);          // 1.91:1
  assert.equal(revisarImagenParaInstagram(crearJpegFalso(1080, 1500)).ok, false);        // más vertical que 4:5
  assert.equal(esJpeg(Buffer.from('PNG')), false);
  assert.equal(dimensionesJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});
