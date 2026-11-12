# Cómo usar Wello

## Abrir la app

Descarga `Wello.html`, guárdalo en una carpeta y ábrelo con Chrome en tu computadora. No necesitas instalar nada, crear una cuenta ni tener conexión. El archivo contiene sus imágenes y su código. Conserva la misma ubicación y navegador para tus registros: el almacenamiento de archivos locales depende de Chrome y de su configuración.

En el teléfono, abre https://brendabernalsantin.github.io/wello/ . La versión publicada exige iniciar sesión con Google antes de mostrar los módulos; no tiene entrada en modo local. El HTML descargable es una versión separada. La interfaz se verificó automáticamente en anchos de 320, 390, 768, 1024 y 1440 px; eso no equivale a una prueba en un iPhone físico.

## Gym

Abre **Gym**, elige fecha y una de las cuatro rutinas. Cada fila indica el objetivo del plan: no son repeticiones que ya realizaste. Escribe tu carga por serie y marca **Hecha** solo en las series realizadas. El campo vacío significa «sin peso anotado»; 0 kg es un dato válido. Se guarda al cambiar de campo o marcar una serie.

Puedes tocar **Terminar sesión** aunque queden ejercicios pendientes. No se marcan automáticamente. La pestaña **Evolución** representa la mayor carga de una serie realizada por fecha, y **Historial** conserva las series y sus marcas. En ejercicios asistidos, menos asistencia puede representar progreso. Selecciona la referencia de cada carga (peso total, discos, máquina, reportado o asistencia). En Evolución, elige la misma referencia para no mezclar valores incompatibles. Las observaciones históricas verificadas aparecen etiquetadas al seleccionar su referencia; no se convierten en series realizadas.

## Hábitos y mood

Crea un hábito con nombre, icono visible y muestra de color. Elige **Para mí** o **Para mi hogar**. En Mis hábitos cada fila muestra el icono, el nombre y el check; al tocar el nombre se abre el detalle con frecuencia, semana, metas y edición. No necesitas abrir el detalle para marcar un hábito simple. En días no programados, el check no se activa; los registros antiguos fuera de programación se conservan y pueden corregirse.

La frecuencia muestra sólo los controles que necesitas: **Todos los días** usa la fecha de inicio; **Días de la semana** muestra los días circulares para marcar; **Cada cierto número de días** muestra el intervalo; **Una vez al mes** permite elegir una fecha en el calendario. Esa fecha fija el día mensual y el comienzo, y se muestra la siguiente ocurrencia automáticamente. Por ejemplo, el día 3 se repite el 3 de diciembre después del 3 de noviembre. Si un mes no tiene el día elegido, Wello usa el último día.

Los campos de meta y unidad aparecen sólo con **Registrar una cantidad**. Las metas pueden ser por día o por semana, de lunes a domingo. El detalle conserva los registros semanales sin ocupar una tarjeta grande en la lista.

Para agua u otras cantidades, captura el total de ese día. Una nueva edición reemplaza esa cantidad, no la suma dos veces. Una meta semanal suma los registros de su semana. En Inicio, el check de un hábito con cantidad abre la captura: no inventa un volumen ni da crédito por estar programado.

En **Mi mood de hoy**, selecciona una fecha, una de las seis caritas y una nota opcional. Guardar de nuevo para la misma fecha actualiza el registro. Puedes encontrarlo en Hábitos y en Calendario con el filtro Hábitos; al abrirlo desde ahí se edita la fecha original.

## Mascotas

Crea un perfil por mascota con nombre, tipo, cumpleaños y sexo. Puedes agregar una foto JPEG, PNG o WebP, previsualizarla, cambiarla o quitarla al editar el perfil. Se reduce proporcionalmente y se guarda dentro de los datos: en el HTML independiente queda local; en un hogar compartido online se sincroniza de forma privada en Supabase para los miembros, sin subirse al repositorio público. Si la imagen no se puede leer o es demasiado grande, se pide otra; HEIC necesita convertirse primero. La foto también forma parte de tus copias privadas.

**Agregar actividad** abre un menú de categorías con iconos. Después de elegir vacuna, paseo, entrenamiento, alimentación o baño, sólo se muestran los campos de esa actividad; ya no hay un formulario con campos de todas las categorías a la vez. Los medicamentos aparecen al activar **Necesita cuidados**. Desactivar cuidados conserva las administraciones y permite editar el historial.

En el catálogo de **Trucos**, usa **Registrar práctica** junto al truco: el formulario ya lleva el truco elegido. Al guardar se añade una actividad con fecha y anotaciones. Las prácticas se ven en el historial y el catálogo mantiene la referencia del truco que se trabajó.

Para una mascota **hembra**, usa el seguimiento de **Celo** para registrar inicio, final opcional y anotaciones. El final debe ser igual o posterior al inicio. El historial muestra duración e intervalos observados cuando hay registros suficientes; no calcula un próximo celo ni da indicaciones clínicas. Puedes cerrar o corregir un registro al editarlo. En Calendario se muestran los días registrados; un registro sin final muestra sólo el inicio, sin inventar una duración ni una fecha de finalización. Cambiar el sexo del perfil no borra el historial previo.

## Alimentos

Inventario guarda refri, congelador y despensa. Súper muestra el subtotal de pendientes con precios conocidos y separa los productos **Sin precio**. El precio viene de la última compra del mismo producto y unidad compatible. No convierte gramos a kilos ni inventa precios.

En **Compras** registra un ticket y su desglose, o una sola línea por producto. El importe de línea es el gasto efectivo de esa línea después de descuentos; el campo descuento documenta la rebaja, no vuelve a restarla. El total del ticket y la suma de líneas se mantienen separados para ver diferencias. Un ticket sin desglose no genera precios.

**Pasar a inventario** pide cantidad, ubicación y caducidad; no se hace automáticamente al marcar comprado. **Dónde compramos** solicita ubicación solo desde ese botón. Si falla o no das permiso, puedes escribir la tienda. Las coordenadas no se guardan en el ticket.

## Calendario e iPhone

Alterna **Mes** y **Agenda**, elige mes y filtra Hábitos, Gym, Mascotas o Citas personales. Los eventos proceden de los mismos registros; no son copias independientes. Crea una cita con hora o todo el día.

Las actividades conservan el color de su sección: Mascotas amarillo, Gym lavanda y citas menta. Cada hábito utiliza la muestra de color que le asignaste; mood usa el rosa de Hábitos. Los colores aparecen en marcadores de Mes, filas de Agenda, detalles y leyenda.

**Exportar al iPhone** abre un diálogo donde eliges **Sólo mascotas**, **Sólo hábitos**, **Sólo Gym**, **Sólo citas personales** o **Todas las actividades**, además del mes. No necesitas cambiar el filtro que estás consultando en pantalla. Los moods y sus notas son opciones separadas dentro de Hábitos o Todas; por defecto no se exportan. Los horarios usan `America/Mexico_City`. Abre el archivo `.ics` en Calendario del iPhone; si queda en Descargas, ábrelo desde Archivos o envíalo a tu correo. Elige el calendario de destino en Apple: el color allí depende de ese calendario, no de los marcadores de Wello. Esto no es una suscripción ni sincronización bidireccional.

## Hogares y copias

Puedes crear y cambiar hogares desde **Mis hogares** o el selector superior. Mascotas, inventario, compras y hábitos familiares cambian; tus hábitos personales, Gym, mood y citas no.

En **Mis datos**, exporta Gym, el hogar activo o una copia completa. Descarga una copia antes de borrar datos del navegador. Para importar, selecciona el JSON, revisa el resumen y confirma. Los duplicados conservan el dato local; repetir la copia no duplica sesiones. Si es una copia de hogar, elige primero el hogar de destino.

Las cargas históricas privadas están en un JSON separado, no dentro de la app. Revisa las observaciones y su procedencia antes de importar, especialmente el peso en discos y la mención de la última repetición.

## Acceso rápido NFC

En Mis datos, **Probar el acceso directo** abre Agregar al súper una vez. Para una tarjeta física necesitas una URL HTTPS publicada que termine en `#super?accion=agregar`. Copia ese enlace desde la versión publicada y programa un registro URL/NDEF en la tarjeta. La web no necesita Web NFC.

## En línea

El sitio de GitHub Pages está publicado con Supabase y Google configurados. La propietaria confirmó un acceso real el 12 de noviembre. Antes de entrar, la web muestra sólo la pantalla de acceso; al cerrar sesión o perderla vuelve a esa pantalla y cierra los formularios abiertos. El código estático permanece público; los datos remotos se protegen mediante permisos de cuenta y membresía en Supabase, no sólo por ocultar la interfaz.

La sincronización sube los datos personales a la cuenta y los hogares compartidos a sus miembros. Una casa que aún no compartes permanece local dentro de la copia de tu cuenta en este navegador. Para usarla con tu familia, entra en Mis hogares, comparte o crea un hogar, invita por correo y envía el enlace en privado. Cada persona entra con su propia cuenta. Falta comprobar el flujo familiar con dos cuentas reales; la captura de cuenta conectada no demuestra por sí sola una sincronización familiar completa.

Las variantes de desarrollo `build:preview` y el HTML descargable conservan sus flujos locales. La configuración y pruebas están documentadas en `DESPLIEGUE.md`, `SUPABASE.md` y `VALIDACION.md`.
