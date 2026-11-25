# Comentarios con contexto

## Para qué sirve

Cuando alguien comenta tus publicaciones, tu asistente prepara una respuesta con **tu voz**. Antes de contestar, lee **el texto de la publicación** y decide qué tipo de comentario es. Así evita el error más caro: vender en el momento equivocado.

**Tú decides cómo trabaja, y las dos formas están bien:** *supervisado* (tú apruebas cada respuesta) o *automático* (el asistente contesta solo lo normal, sin que dependas de ti).

**Un caso real:** en una publicación en memoria de una persona que había fallecido, un asistente automático contestó a los pésames ofreciendo un curso. Nadie lo había pensado: el asistente solo veía comentarios, no el contexto. Esta hoja existe para que a ti no te pase. Por eso, aunque lo dejes contestar solo, tu asistente lee primero la publicación, en luto solo da un agradecimiento corto y las quejas siempre te las deja a ti.

## Los cuatro tipos de comentario

| Tipo | Cuándo | Qué contesta |
|---|---|---|
| **Luto** | La publicación o el comentario hablan de una pérdida, un fallecimiento o un homenaje | Solo empatía breve. Nada de cursos, precios, enlaces, teléfonos, WhatsApp ni invitaciones a comprar. **Aunque pregunten un precio** en ese hilo. |
| **Queja** | Molestia, reclamo o mala experiencia | Una disculpa y la invitación a seguir en un mensaje privado. Sin vender y sin regalar nada. Siempre te lo marca para que lo veas tú. |
| **Normal** | Todo lo demás | Servicio al grano. Precios solo si los preguntan y según tu regla. Si no sabe algo, no inventa. |
| **Spam** | Publicidad, estafas, enlaces raros | No se contesta. |

**La etiqueta «Revísalo tú».** En `/comentarios`, algunos borradores traen esta etiqueta roja: son las quejas, lo que suena a alguien dándole órdenes al asistente y todo caso donde él no quedó seguro. Esos **nunca salen solos**, ni siquiera cuando enciendas el modo automático.

## La red de seguridad

Aunque el asistente se equivoque, o alguien le escriba «ignora tus reglas», **la última revisión no depende de él**: si en un hilo de luto la respuesta trae algo de venta, se cambia por un agradecimiento corto (*«Gracias por acompañarnos y por tus palabras. 🕊️»*). En una queja, por una disculpa. Y en cualquier comentario, nunca salen descuentos ni promesas, ni precios si tu regla es decirlos en persona.

## Tu ficha de voz (`negocio.json`)

Claude Code la llena contigo (usa el **Texto 7** de `TEXTOS-PARA-PEGAR.md`). Estas son las piezas:

1. **Tu voz.** Cómo hablas (cálido, formal, divertido), si tratas de tú o de usted, y cuántos emojis usas.
2. **Lo que nunca se dice.** Por ejemplo: «no prometer descuentos», «no discutir con quien se queja».
3. **Cinco preguntas con respuesta aprobada.** Horario, dirección, cómo apartar, tiempos de entrega… Es lo **único** que el asistente afirma sobre tu negocio. Si le preguntan algo que no está ahí, dice que lo confirma y responde pronto.
4. **Tu regla de precios.** *En persona* (nunca se dicen en un comentario) o *responder* (solo los que estén en tus respuestas aprobadas).
5. **Tu contacto permitido.** El único teléfono o enlace que puede mencionar. Si lo dejas vacío, no menciona ninguno.
6. **Palabras extra** (opcional). Las que, en tu negocio, señalan una pérdida o una queja, y las que nunca deben aparecer en un hilo de luto.

## Pruébalo antes de encenderlo

1. En Railway agrega `ANTHROPIC_API_KEY` (y `PANEL_CLAVE`) si no lo hiciste.
2. Abre `tu-dirección/comentarios/prueba` y da clic en **Correr las 10 pruebas**. Verás diez comentarios inventados: un pésame, un precio preguntado en un hilo de luto, una queja dentro de un hilo de luto, una queja por un pedido que no llegó, condolencias en una publicación normal, «¿cuánto cuesta?», un elogio, una pregunta de horario y dirección, spam con un enlace y alguien que intenta dar órdenes al asistente.
3. Revisa **cada** respuesta. Pregúntate: *¿yo diría esto? ¿Hay algo de venta donde no debe?* Si algo no te gusta, ajusta tu ficha y vuelve a correr las pruebas.
4. Meta: ✅ **10 de 10** y respuestas que sí suenan a ti.

## Elige cómo quieres que trabaje, y enciéndelo

Tienes **dos formas, y las dos están bien**. Claude Code te las explica y te pregunta cuál prefieres: elige la que te dé más tranquilidad.

- **Supervisado:** el asistente prepara cada respuesta y **no sale nada hasta que tú la apruebas**, en `tu-dirección/comentarios`.
- **Automático:** el asistente **contesta solo** los comentarios normales, y da un agradecimiento corto en los de luto, **sin que tú tengas que hacer nada**.

En las dos, **las quejas y todo lo que suene raro** (lo que trae la etiqueta *«Revísalo tú»*) **te los deja a ti**: nunca salen solos.

1. Agrega `COMENTARIOS_ACTIVO` con el valor `si` (sin acento) y da clic en *Deploy*. Así empiezas, por seguridad, en **supervisado**: en `tu-dirección/comentarios` verás los borradores. Ahí puedes editar el texto y dar clic en *Aprobar y enviar* o en *No contestar*.
2. Si prefieres el **automático**, agrega además `COMENTARIOS_MODO` con el valor `automatico` (sin acento) y da clic en *Deploy*. En la misma página verás qué contestó solo y qué espera tu aprobación. Puedes elegirlo desde el principio o pasarte a él cuando quieras; y para volver a supervisado, borra esa variable.
3. En las dos formas, una respuesta solo sale de verdad cuando el Publicador ya está en modo real (`PUBLICAR_DE_VERDAD` con el valor `si`). En modo prueba solo se ensayan: el botón te avisa que no envió nada, y eso es lo esperado.
4. Cada semana lee los comentarios que se contestaron y afina tu ficha.

## Límites que conviene saber

- **No contesta mensajes directos.** Solo comentarios de tus publicaciones.
- Se leen por consulta **cada 10 minutos**, no al instante. Meta pide un nivel de acceso aparte (y la verificación de tu negocio) para avisar de comentarios de Instagram en el momento; por eso este kit pregunta cada pocos minutos.
- Solo ve los comentarios de tus últimas publicaciones y de los últimos 3 días.
- Si Meta pide esperar, el asistente espera y lo vuelve a intentar.
