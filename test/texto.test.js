import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptarParaInstagram, huellaTexto, mismoTexto, contarHashtags, contarMenciones, MAX_CAPTION } from '../src/texto.js';
import { cortarSeguro, graphemes } from '../src/util.js';

const sinMediosEmojis = (s) => !/\p{Cs}/u.test(s);   // ningún medio emoji (sustituto suelto)

function parrafos(n, largo, prefijo = 'Parte') {
  return Array.from({ length: n }, (_, i) => `${prefijo} ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(Math.ceil(largo / 28)).slice(0, largo)}`);
}

test('un texto que ya cabe no se toca', () => {
  const r = adaptarParaInstagram('Hola\n\n¡Mira nuestra novedad! 🎉\n\n#uno #dos');
  assert.equal(r.recortado, false);
  assert.equal(r.texto, 'Hola\n\n¡Mira nuestra novedad! 🎉\n\n#uno #dos');
});

test('quita secciones COMPLETAS y conserva la apertura y el cierre', () => {
  const secciones = [
    '📘 PRIMERA SECCIÓN\n\n' + 'Detalle de la primera sección. '.repeat(40),
    '📗 SEGUNDA SECCIÓN\n\n' + 'Detalle de la segunda sección, más larga todavía. '.repeat(40),
    '📙 TERCERA SECCIÓN\n\n' + 'Detalle de la tercera. '.repeat(30),
  ];
  const texto = ['¡Gran apertura de la tienda!', ...secciones, 'Escríbenos para más información.', 'Visítanos en la calle Ejemplo 123.', '#tienda #novedad #ejemplo'].join('\n\n');
  assert.ok(texto.length > MAX_CAPTION, 'el texto de prueba debe pasar de 2,200');
  const r = adaptarParaInstagram(texto);
  assert.ok(r.texto.length <= MAX_CAPTION, `largo ${r.texto.length}`);
  assert.ok(r.recortado);
  assert.ok(r.texto.startsWith('¡Gran apertura de la tienda!'));
  assert.ok(r.texto.endsWith('#tienda #novedad #ejemplo'));
  assert.ok(r.texto.includes('Visítanos en la calle Ejemplo 123.'));
  assert.ok(r.seccionesQuitadas.length >= 1);
  // los bloques que quedan están completos: cada uno aparece tal cual en el texto original
  for (const bloque of r.texto.split('\n\n')) assert.ok(texto.includes(bloque), `bloque alterado: ${bloque.slice(0, 40)}`);
  assert.ok(!r.texto.includes('…'), 'no hizo falta cortar frases');
});

test('sin encabezados: cada párrafo del centro es una sección', () => {
  const texto = ['Apertura corta.', ...parrafos(8, 380), 'Gracias por leernos.', 'Contacto: ejemplo@correo.test', '#a #b'].join('\n\n');
  const r = adaptarParaInstagram(texto);
  assert.ok(texto.length > MAX_CAPTION);
  assert.ok(r.texto.length <= MAX_CAPTION);
  assert.ok(r.texto.startsWith('Apertura corta.'));
  assert.ok(r.texto.endsWith('#a #b'));
});

test('un solo párrafo gigante se corta en una frase y con puntos suspensivos', () => {
  const texto = 'Una frase completa y bonita. '.repeat(200);
  const r = adaptarParaInstagram(texto);
  assert.ok(r.texto.length <= MAX_CAPTION);
  assert.ok(r.texto.endsWith('…'));
  assert.ok(r.texto.slice(0, -1).trimEnd().endsWith('.'), 'cortó al final de una frase');
});

test('si el último bloque son hashtags, se conservan aunque haya que cortar la última frase', () => {
  const texto = `${'Texto largo sin saltos de párrafo que sigue y sigue. '.repeat(70)}\n\n#marca #novedad`;
  const r = adaptarParaInstagram(texto);
  assert.ok(r.texto.length <= MAX_CAPTION);
  assert.ok(r.texto.endsWith('#marca #novedad'));
});

test('nunca parte un emoji (parejas, tonos de piel, banderas, secuencias con unión)', () => {
  const emojis = ['👩🏽‍💻', '🇲🇽', '👨‍👩‍👧‍👦', '❤️', '👍🏿', '🧑‍🍳'];
  let texto = '';
  let i = 0;
  while (texto.length < 3000) { texto += emojis[i % emojis.length]; i += 1; }
  for (let limite = 2190; limite <= 2210; limite += 1) {
    const corte = cortarSeguro(texto, limite);
    assert.ok(corte.length <= limite);
    assert.ok(sinMediosEmojis(corte), `medio emoji con límite ${limite}`);
    assert.ok(!corte.endsWith('\u{200D}'), 'no termina en una unión suelta');
    // lo que queda es un prefijo de emojis completos
    assert.equal(graphemes(corte).join(''), corte);
  }
  const r = adaptarParaInstagram(texto);
  assert.ok(r.texto.length <= MAX_CAPTION);
  assert.ok(sinMediosEmojis(r.texto));
});

test('un recorte entre frases con emojis tampoco deja medios emojis', () => {
  const texto = 'Mira esto 🎉🎊 qué bonito ❤️‍🔥 hoy. '.repeat(120);
  const r = adaptarParaInstagram(texto);
  assert.ok(r.texto.length <= MAX_CAPTION);
  assert.ok(sinMediosEmojis(r.texto));
});

test('límite de 30 hashtags: se recorta el bloque final', () => {
  const tags = Array.from({ length: 40 }, (_, i) => `#etiqueta${i + 1}`).join(' ');
  const r = adaptarParaInstagram(`Texto breve de la publicación.\n\n${tags}`);
  assert.equal(contarHashtags(r.texto), 30);
  assert.equal(r.hashtagsQuitados, 10);
  assert.ok(r.texto.endsWith('#etiqueta30'));
  assert.ok(!r.texto.includes('#etiqueta31'));
  assert.ok(r.recortado);
});

test('hashtags sobrantes dentro del texto pierden el «#» pero no la palabra', () => {
  const dentro = Array.from({ length: 35 }, (_, i) => `#palabra${i + 1}`).join(' ');
  const r = adaptarParaInstagram(`Escribo así: ${dentro} y listo.`);
  assert.equal(contarHashtags(r.texto), 30);
  assert.ok(r.texto.includes('palabra35'));
  assert.ok(!r.texto.includes('#palabra35'));
});

test('el límite de hashtags se puede bajar (por ejemplo a 5)', () => {
  const r = adaptarParaInstagram('Hola\n\n#a1 #b2 #c3 #d4 #e5 #f6 #g7', { hashtagsMax: 5 });
  assert.equal(contarHashtags(r.texto), 5);
});

test('límite de 20 menciones: a las que sobran se les quita el «@»', () => {
  const menciones = Array.from({ length: 25 }, (_, i) => `@usuario${i + 1}`).join(' ');
  const r = adaptarParaInstagram(`Gracias a ${menciones}`);
  assert.equal(contarMenciones(r.texto), 20);
  assert.equal(r.mencionesQuitadas, 5);
  assert.ok(r.texto.includes('usuario25'));
});

test('un correo electrónico no cuenta como mención ni un # pegado a una palabra como hashtag', () => {
  assert.equal(contarMenciones('Escríbenos a hola@ejemplo.com'), 0);
  assert.equal(contarHashtags('Somos C# y A&#38; fin'), 0);
  assert.equal(contarHashtags('#a#b#c'), 3, 'pegados cuentan uno por uno (Instagram los trata como varios)');
  assert.equal(contarHashtags('#sí y #ñandú'), 2);
});

test('huella: ignora mayúsculas, acentos de formato, @, emojis y espacios', () => {
  assert.equal(huellaTexto('Hola   @amiga!  ¡Mira 🎉 esto!'), huellaTexto('hola amiga mira esto'));
  assert.equal(huellaTexto('Texto\r\ncon  saltos'), huellaTexto('texto con saltos'));
  assert.notEqual(huellaTexto('Oferta del lunes'), huellaTexto('Oferta del martes'));
});

test('mismoTexto: Instagram quita el «@» y el selector de emoji, y sigue siendo el mismo texto', () => {
  assert.ok(mismoTexto('Gracias @mi_cuenta ❤️', 'Gracias mi_cuenta ❤'));
  assert.ok(!mismoTexto('Promoción del lunes con 10 prendas', 'Promoción del martes con 10 prendas'));
  assert.ok(!mismoTexto('', 'algo'));
});

test('mismoTexto en textos largos: mismo inicio, final y largo casi igual', () => {
  const base = 'Inicio de la publicación con mucho contenido. '.repeat(10);
  const medio = 'contenido del centro que cambia un poco. '.repeat(10);
  const fin = 'Final de la publicación y su despedida. '.repeat(10);
  assert.ok(mismoTexto(base + medio + fin, base + medio.replace('cambia', 'cambió') + fin));
  assert.ok(!mismoTexto(base + medio + fin, base + medio + fin + ' y una frase más que cambia el largo bastante'));
  assert.ok(!mismoTexto('Corto 1', 'Corto 2'));
});

test('mismoTexto: un texto de puros emojis (huella vacía) se compara tal cual', () => {
  assert.ok(mismoTexto('🎉🎉🎉', '🎉🎉🎉'));
  assert.ok(mismoTexto('❤️🔥', '❤🔥'));
  assert.ok(!mismoTexto('🎉🎉🎉', '🎉🎉'));
  assert.ok(!mismoTexto('🎉', 'hola'));
  assert.ok(!mismoTexto('', ''));
});
