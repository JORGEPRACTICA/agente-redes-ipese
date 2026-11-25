# Tu Publicador de Instagram y Facebook

## ¿Qué es?

Un programa pequeño que vive en internet y publica por ti, a la hora que pongas en tu calendario, en tu **Instagram** y en tu **Página de Facebook**. También puede contestar los comentarios de tus publicaciones, con tu voz: tú decides si las apruebas una por una o si las contesta solo. Lo armas con ayuda de **Claude Code**: no necesitas saber programar.

**Lo que hace:** publica a su hora con tu imagen y tu texto · cuida que no salga dos veces lo mismo · acorta el texto solo para Instagram (2,200 caracteres y 30 hashtags; Facebook lo recibe completo) · si Meta pide calma, espera y lo intenta de nuevo · empieza en **modo prueba**: ensaya y **no publica nada** hasta que tú lo enciendas.

**Lo que NO hace:** no contesta mensajes directos, no sube historias ni videos, y no promete alcance ni ventas.

## Antes de empezar

☐ Instagram **profesional** (empresa o creador) y pública
☐ Página de Facebook (si quieres publicar ahí)
☐ Tu token de Meta y el número de tu cuenta (video «La llave de Meta»)
☐ Cuenta de **GitHub** (la básica alcanza, con verificación en dos pasos, creada con días de anticipación)
☐ Cuenta de **Railway**, con una tarjeta para el plan de paga y su tope de gasto
☐ Llave de **Anthropic** con tope de gasto (solo para comentarios)
☐ **Claude Code** instalado
☐ Tus fotos en **JPG** y tu calendario de la Clase 2
☐ Un administrador de contraseñas para guardar tus llaves

## Paso a paso

1. **Abre el kit.** Descomprime el archivo: te queda una carpeta llamada `mi-publicador`. Entra hasta que veas adentro el archivo `CLAUDE.md`, abre Claude Code **en esa carpeta** y pega el *Texto de arranque* de `TEXTOS-PARA-PEGAR.md`.
2. **Ensayo.** Claude Code revisa tu computadora y corre las pruebas. Todo es de mentira: no se publica nada.
3. **Tu negocio y tu calendario.** Claude Code te pregunta cómo hablas, qué nunca dices y qué vas a publicar, y lo guarda en `negocio.json` y `calendario.json`. Tus imágenes van en la carpeta `imagenes`, en JPG.
4. **GitHub** (video «GitHub: guarda tu código en un repositorio privado»). Pegas los Textos 1, 2 y 3. Tu repositorio queda **privado**.
5. **Railway** (videos «Railway 1 de 2: tu plan, tu tope y tu proyecto» y «Railway 2 de 2: pon tu agente en línea»). Pones el tope de gasto, conectas tu repositorio y pegas tus llaves **tú**, una por una, en *Variables*. Das clic en *Deploy*, generas la dirección pública y la agregas como `PUBLIC_URL`.
6. **Verificar.** Abres `tu-dirección/verificar`. Cada ✅ o ❌ trae su siguiente paso.
7. **Primera publicación.** Una sola, que tú escoges. Solo cuando Claude Code te lo pide y tú dices «sí», agregas la variable `PUBLICAR_DE_VERDAD` con el valor `si`.
8. **Comentarios** (opcional). Pruebas los 10 comentarios de ejemplo, enciendes la lectura y eliges cómo quieres que trabaje: **supervisado** (tú apruebas cada respuesta) o **automático** (contesta solo lo normal, sin que hagas nada). Las dos están bien y puedes cambiar cuando quieras; las quejas siempre te esperan. Solo se contestan de verdad cuando ya publicas de verdad.

## Las tres reglas de oro

1. **Las llaves van solo en Railway.** Nunca en un chat, ni en un archivo, ni en GitHub.
2. **Tu repositorio es privado.** Y nunca se sube un archivo `.env`.
3. **Nada se publica de verdad hasta que tú lo dices.** Instagram no permite borrar una publicación desde un programa: por eso existe el modo prueba.

## Tus páginas

Se abren con la dirección que te dio Railway. Las que piden contraseña aceptan cualquier usuario y, como contraseña, el valor de `PANEL_CLAVE`.

| Página | Para qué sirve |
|---|---|
| `/salud` | Dice «Publicador en línea.» (no pide contraseña). Es tu prueba de que está encendido. |
| `/estado` | Tu calendario, lo que ya salió, lo que falló y lo último que pasó. |
| `/verificar` | Revisa todo con ✅ o ❌ y te dice qué hacer. Nunca publica. |
| `/comentarios` | Las respuestas que esperan tu aprobación y lo que ya se contestó. |

## Las variables que pegas en Railway

| Nombre | Qué es |
|---|---|
| `PANEL_CLAVE` | Una contraseña nueva que inventas tú (12 caracteres o más) |
| `IG_TOKEN` · `IG_USER_ID` | El token de tu Instagram y el **número** de tu cuenta (no es el @) |
| `FB_PAGE_TOKEN` · `FB_PAGE_ID` | Lo mismo, de tu Página de Facebook (opcional) |
| `PUBLIC_URL` | La dirección pública de tu servicio, con `https://` |
| `ANTHROPIC_API_KEY` | Tu llave de Anthropic (para comentarios) |
| `ZONA_HORARIA` | Solo si no estás en hora del centro de México |
| `PUBLICAR_DE_VERDAD` | El interruptor: `si` publica de verdad. Sin ella, solo ensaya |
| `COMENTARIOS_ACTIVO` · `COMENTARIOS_MODO` | `COMENTARIOS_ACTIVO` en `si` enciende los comentarios, supervisados por ti. Si además agregas `COMENTARIOS_MODO` con el valor `automatico` (sin acento), contestan solos lo normal |

## Si algo no sale

- **`/salud` no abre:** en Railway da clic en *View logs* y busca la palabra *Error*; el servicio debe decir *Online* y, en *Deployments*, *ACTIVE*.
- **`/verificar` marca ❌:** haz lo que dice su *siguiente paso*. Si no lo entiendes, pega lo que dice la página en Claude Code (no lleva llaves).
- **Dice «Application request limit reached»:** Meta pidió esperar. No insistas: el Publicador lo intenta de nuevo solo.
- **`/estado` dice «Para revisar»:** esa publicación ya había pasado de hora cuando el servicio arrancó (por ejemplo, después de subir cambios) y no pudo comprobar si salió. Abre tu Instagram: si ya está, da clic en *Ya salió*; si no, en *Publicar ahora*. Nunca sale sola.
- **Pegaste una llave en un chat por error:** cámbiala (crea una nueva y borra la anterior) y ponla otra vez en Railway.
- **No sabes cuál es tu número de cuenta o dónde pegar algo:** pide ayuda a Claude Code y comparte una captura de pantalla **sin tokens**, o lleva tu duda a la sesión de práctica con tu instructor.
