// Llaves y tokens FALSOS para las pruebas y el ensayo. Se arman con pedazos a propósito: así, cuando Claude Code
// (o tú) busca en los archivos algo con forma de llave antes de subir el proyecto a GitHub, no encuentra
// llaves de mentira que parezcan de verdad y no hay falsas alarmas.

/** Une pedazos de texto (para que ninguna búsqueda de llaves encuentre una llave completa escrita en un archivo). */
export const unir = (...partes) => partes.join('');

export const TOKEN_META_FALSO = unir('EA', 'AFALSOdePrueba1234567890abcdefghijklmnopqrstuvwxyz');
export const TOKEN_PAGINA_FALSO = unir('EA', 'AFALSOpagina0987654321zyxwvutsrqponmlkjihgfedcba');
export const LLAVE_ANTHROPIC_FALSA = unir('sk-', 'ant-FALSA-de-prueba-0000000000000000');
