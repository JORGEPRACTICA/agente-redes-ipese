// Enfriamiento compartido: cuando Meta pide calma (límite de llamadas), NADA del Publicador vuelve a llamarla
// hasta que pase la espera: ni otras publicaciones de la misma revisión ni la lectura de comentarios.
export function crearEnfriamiento() {
  let hastaMs = 0;
  let motivo = '';
  return {
    /** Pide calma hasta `hastaDeNuevoMs`; nunca acorta una espera que ya estaba puesta. */
    activar(hastaDeNuevoMs, porQue = '') {
      if (hastaDeNuevoMs > hastaMs) { hastaMs = hastaDeNuevoMs; motivo = porQue; }
    },
    activo: (ahoraMs) => ahoraMs < hastaMs,
    restanteMs: (ahoraMs) => Math.max(0, hastaMs - ahoraMs),
    motivo: () => motivo,
  };
}
