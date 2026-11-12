# Wello · revisión por secciones

Fecha: 12 de noviembre de 2026.

**Estado: Inicio implementado, validado y publicado; Mascotas y Calendario pendientes de revisión e implementación.** La usuaria indicó después «aquí ya haz los cambios» para Inicio. Sólo se aplicaron esos ajustes: textos retirados, imagen original sin mezcla con el fondo ni filtro, cuatro hábitos con pendientes primero y botón inferior a todos. Se comprobó la recarga, el guardado y las cantidades parciales. Esta sección ya está publicada en GitHub Pages, sin implementar los demás pendientes. Seguiremos revisando cada espacio antes de aplicar sus ajustes y añadiendo las observaciones que envíe.

## Inicio · textos

Retirar de la pantalla de Inicio los siguientes textos. El saludo horario mostrado como «Buenas tardes» se retira como bloque; se conservan el título, la fecha y los demás textos no señalados:

- «Buenas tardes».
- «No tienes que hacerlo todo hoy.»
- «Solo empezar por algo que te haga bien.»
- «Aquí, cada pequeño paso cuenta.»
- «Todo lo que cuidas, aquí.»

## Inicio · imagen de meditación

Revisar y corregir la apariencia verdosa de la imagen de la chica meditando. La usuaria indica que la imagen se ve verde y desconoce la causa. El diagnóstico queda pendiente: no se atribuye todavía a la imagen original, a un filtro, a una mezcla de color o al fondo. Conservar la ilustración, salvo que se acuerde cambiarla durante la revisión.

## Inicio · Hábitos de hoy

Mostrar **como máximo cuatro hábitos** en la pantalla de Inicio, sustituyendo el límite anterior de seis. Debajo de la lista debe haber un acceso claro, por ejemplo «Ver todos mis hábitos», que lleve a la sección de Hábitos para consultar los demás. La pantalla de Inicio no debe crecer con una lista extensa.

Al marcar un hábito como realizado, enviarlo al final de la lista y subir los que aún están pendientes. El orden debe dar prioridad a los pendientes antes de limitar la vista a cuatro, de manera que entren en pantalla los siguientes hábitos sin completar cuando haya más. Se trata de cambiar su orden de presentación, no de borrar los hábitos completados ni sus registros.

## Mascotas · reutilizar trucos

Permitir agregar a una mascota trucos que ya se hayan registrado para otro perro o mascota, evitando escribir de nuevo la misma información.

La propuesta para revisar es seleccionar una mascota de origen y reutilizar sus definiciones de trucos (nombre y explicación). El historial de prácticas y las fechas realizadas deben seguir perteneciendo a cada mascota, sin copiarse como si el otro animal las hubiera realizado. Antes de implementarlo se definirá si se eligen trucos individuales, todo el catálogo o ambas opciones, y cómo se evita duplicarlos.

## Calendario · lo que sí se cumplió

Cambiar el calendario de una vista de tareas programadas a una vista de actividades efectivamente realizadas. No llenar fechas con hábitos sólo por estar programados ni presentar pendientes como cumplidos.

Los ejemplos expresamente solicitados son **hábitos marcados con check** y **registros de entrenamiento**. Deben aparecer en la fecha real de cumplimiento o registro y proceder de los datos de la sección correspondiente, sin crear registros duplicados.

Durante la revisión de Calendario se precisará cómo representar metas cuantitativas parcialmente realizadas, entrenamientos parciales, actividades de mascotas y citas. No se inventará cumplimiento ni se borrarán las programaciones o los registros existentes para hacer este cambio.

## Calendario · colores por categoría

Usar los colores definidos para cada categoría o sección, en lugar de los colores asignados manualmente a hábitos individuales. Esta observación sustituye, para Calendario, el criterio anterior que trasladaba el color individual de cada hábito a sus eventos.

Hábitos, Gym, Mascotas y Citas personales deben mantener coherencia entre filtros, leyenda, marcadores de Mes, filas de Agenda y detalles. Se revisará la referencia de color de cada categoría con la usuaria. No se cambiarán ni eliminarán los colores guardados en los hábitos: el cambio solicitado corresponde a su representación en Calendario.

## Forma de trabajar

Recopilar primero las observaciones de cada espacio, devolver un resumen claro de lo entendido y resolver las decisiones de esa sección antes de implementarla. No mezclar todos los ajustes en una revisión global ni dar por cerrada una sección sin revisarla con la usuaria. Las siguientes observaciones se incorporarán a este documento, conservando separado lo pendiente de lo implementado.

## Hábitos · revisión autorizada a las 14:16

Estado: implementado y validado; pendiente de confirmación de publicación. Retirar «Un espacio para lo que te hace bien.» y el mensaje «Te sientes feliz. Puedes cambiarlo cuando quieras.» con sus variantes; usar «estado de ánimo» en la interfaz. Las seis caritas tendrán transparencia real conservando su expresión y estilo, y una animación breve y suave que respete reducir movimiento.

El recuadro rosa mostrará el estado registrado para la fecha elegida: «Hoy estoy feliz» o la emoción correspondiente, una carita y la nota guardada, en lugar de las tres caritas iniciales. Para otra fecha no se afirmará que es hoy. Sin registro se conservará la invitación a registrar. No habrá lista inferior de historial emocional en Hábitos: los registros se conservan y se consultan/editarán desde Calendario.

El selector de fecha con icono de calendario se mueve arriba y se identifica como común para Hábitos y estado de ánimo. Crear hábito se coloca junto a Lo que cuido de mí, intercambiando las posiciones anteriores. Esta actualización no implementa todavía la reutilización de trucos de Mascotas ni los cambios de cumplimiento y colores de Calendario. En Calendario únicamente se unifica el nombre visible «estado de ánimo» para conservar una terminología coherente.
