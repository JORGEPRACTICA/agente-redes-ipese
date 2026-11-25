// Revisión de imágenes JPEG sin librerías: ¿de verdad es un JPEG? ¿cuánto mide?
// Instagram solo acepta JPEG por la API (un .png o un .webp se rechaza) y exige una forma razonable.

/** ¿Los primeros bytes son los de un JPEG (FF D8 FF)? Un archivo con extensión .jpg que no lo es, no sirve. */
export function esJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

/** Ancho y alto del JPEG leyendo su cabecera (marcador SOF). Devuelve null si no se puede leer. */
export function dimensionesJpeg(buffer) {
  if (!esJpeg(buffer)) return null;
  let i = 2;
  while (i + 3 < buffer.length) {
    if (buffer[i] !== 0xff) { i += 1; continue; }
    const marcador = buffer[i + 1];
    if (marcador === 0xff) { i += 1; continue; }                         // relleno
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }   // marcadores sin largo
    if (marcador === 0xd9) return null;                                  // fin de imagen sin haber visto el tamaño
    const largo = buffer.readUInt16BE(i + 2);
    const esMarcadorDeTamano = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (esMarcadorDeTamano) {
      if (i + 9 > buffer.length) return null;
      const alto = buffer.readUInt16BE(i + 5);
      const ancho = buffer.readUInt16BE(i + 7);
      return ancho > 0 && alto > 0 ? { ancho, alto } : null;
    }
    i += 2 + largo;
  }
  return null;
}

export const LIMITES_IMAGEN = {
  pesoMaxBytes: 8 * 1024 * 1024,   // Instagram: hasta 8 MB
  anchoMinimo: 320,                // Instagram: al menos 320 px de ancho
  proporcionMin: 0.8,              // 4:5 (vertical)
  proporcionMax: 1.91,             // 1.91:1 (horizontal)
};

/**
 * Revisa que una imagen sirva para Instagram.
 * @returns {{ok:boolean, problemas:string[], ancho?:number, alto?:number}}
 */
export function revisarImagenParaInstagram(buffer) {
  const problemas = [];
  if (!esJpeg(buffer)) {
    return { ok: false, problemas: ['no es un JPEG de verdad (Instagram solo acepta JPEG; un archivo .png o .webp renombrado a .jpg tampoco sirve)'] };
  }
  if (buffer.length > LIMITES_IMAGEN.pesoMaxBytes) {
    problemas.push(`pesa ${(buffer.length / 1048576).toFixed(1)} MB y Instagram admite hasta 8 MB`);
  }
  const d = dimensionesJpeg(buffer);
  if (!d) {
    problemas.push('no pude leer su tamaño (¿el archivo está dañado?)');
    return { ok: false, problemas };
  }
  if (d.ancho < LIMITES_IMAGEN.anchoMinimo) {
    problemas.push(`mide ${d.ancho} px de ancho y Instagram pide al menos ${LIMITES_IMAGEN.anchoMinimo}`);
  }
  const proporcion = d.ancho / d.alto;
  if (proporcion < LIMITES_IMAGEN.proporcionMin - 0.005 || proporcion > LIMITES_IMAGEN.proporcionMax + 0.005) {
    problemas.push(`mide ${d.ancho}×${d.alto} px y esa forma no se acepta (usa entre vertical 4:5 y horizontal 1.91:1)`);
  }
  return { ok: problemas.length === 0, problemas, ancho: d.ancho, alto: d.alto };
}
