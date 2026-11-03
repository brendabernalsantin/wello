# Cómo usar Wello

## Abrir la app

Descarga `Wello.html`, guárdalo en una carpeta y ábrelo con Chrome en tu computadora. No necesitas instalar nada, crear una cuenta ni tener conexión. El archivo contiene sus imágenes y su código. Conserva la misma ubicación y navegador para tus registros: el almacenamiento de archivos locales depende de Chrome y de su configuración.

En el teléfono, la vía recomendada es abrir la versión HTTPS una vez publicada. La interfaz se verificó automáticamente en anchos de 320, 390, 768, 1024 y 1440 px; eso no equivale a una prueba en un iPhone físico.

## Gym

Abre **Gym**, elige fecha y una de las cuatro rutinas. Cada fila indica el objetivo del plan: no son repeticiones que ya realizaste. Escribe tu carga por serie y marca **Hecha** solo en las series realizadas. El campo vacío significa «sin peso anotado»; 0 kg es un dato válido. Se guarda al cambiar de campo o marcar una serie.

Puedes tocar **Terminar sesión** aunque queden ejercicios pendientes. No se marcan automáticamente. La pestaña **Evolución** representa la mayor carga de una serie realizada por fecha, y **Historial** conserva las series y sus marcas. En ejercicios asistidos, menos asistencia puede representar progreso. Selecciona la referencia de cada carga (peso total, discos, máquina, reportado o asistencia). En Evolución, elige la misma referencia para no mezclar valores incompatibles. Las observaciones históricas verificadas aparecen etiquetadas al seleccionar su referencia; no se convierten en series realizadas.

## Hábitos y mood

Crea un hábito con nombre, muestra de color, fecha y frecuencia. Elige **Para mí** o **Para mi hogar**. Las metas pueden ser por día o por semana, de lunes a domingo. Si eliges el día 31 y el mes no lo tiene, Wello usa el último día.

Para agua u otras cantidades, captura el total de ese día. Una nueva edición reemplaza esa cantidad, no la suma dos veces. Una meta semanal suma los registros de su semana. En Inicio, el check de un hábito con cantidad abre la captura: no inventa un volumen ni da crédito por estar programado.

En **Mi mood de hoy**, selecciona una fecha, una de las seis caritas y una nota opcional. Guardar de nuevo para la misma fecha actualiza el registro. Puedes encontrarlo en Hábitos y en Calendario con el filtro Hábitos; al abrirlo desde ahí se edita la fecha original.

## Mascotas

Crea un perfil por mascota. Registra vacunas, próxima aplicación, paseos, trucos y entrenamientos, alimentación y baños. **Necesita cuidados** muestra el formulario de medicamentos. Al desactivarlo se conserva el historial. La app solo registra lo que tú capturas; no propone tratamientos.

## Alimentos

Inventario guarda refri, congelador y despensa. Súper muestra el subtotal de pendientes con precios conocidos y separa los productos **Sin precio**. El precio viene de la última compra del mismo producto y unidad compatible. No convierte gramos a kilos ni inventa precios.

En **Compras** registra un ticket y su desglose, o una sola línea por producto. El importe de línea es el gasto efectivo de esa línea después de descuentos; el campo descuento documenta la rebaja, no vuelve a restarla. El total del ticket y la suma de líneas se mantienen separados para ver diferencias. Un ticket sin desglose no genera precios.

**Pasar a inventario** pide cantidad, ubicación y caducidad; no se hace automáticamente al marcar comprado. **Dónde compramos** solicita ubicación solo desde ese botón. Si falla o no das permiso, puedes escribir la tienda. Las coordenadas no se guardan en el ticket.

## Calendario e iPhone

Alterna **Mes** y **Agenda**, elige mes y filtra Hábitos, Gym, Mascotas o Citas personales. Los eventos proceden de los mismos registros; no son copias independientes. Crea una cita con hora o todo el día.

**Exportar al iPhone** descarga un `.ics` del mes y filtro visibles. Los moods y sus notas son opciones separadas; por defecto no se exportan. Los horarios usan `America/Mexico_City`. Abre el archivo en Calendario del iPhone; si queda en Descargas, ábrelo desde Archivos o envíalo a tu correo. Esto no es una suscripción ni sincronización bidireccional.

## Hogares y copias

Puedes crear y cambiar hogares desde **Mis hogares** o el selector superior. Mascotas, inventario, compras y hábitos familiares cambian; tus hábitos personales, Gym, mood y citas no.

En **Mis datos**, exporta Gym, el hogar activo o una copia completa. Descarga una copia antes de borrar datos del navegador. Para importar, selecciona el JSON, revisa el resumen y confirma. Los duplicados conservan el dato local; repetir la copia no duplica sesiones. Si es una copia de hogar, elige primero el hogar de destino.

Las cargas históricas privadas están en un JSON separado, no dentro de la app. Revisa las observaciones y su procedencia antes de importar, especialmente el peso en discos y la mención de la última repetición.

## Acceso rápido NFC

En Mis datos, **Probar el acceso directo** abre Agregar al súper una vez. Para una tarjeta física necesitas una URL HTTPS publicada que termine en `#super?accion=agregar`. Copia ese enlace desde la versión publicada y programa un registro URL/NDEF en la tarjeta. La web no necesita Web NFC.

## En línea

La carpeta `dist/` entregada es una vista previa estática: el botón Google está deshabilitado porque no hay servicios configurados. Puedes elegir modo local. La configuración de producción, Google, Supabase y los hogares compartidos se prepara con las instrucciones de `DESPLIEGUE.md` y `SUPABASE.md`. No se ha publicado el sitio ni se ha verificado un acceso real.
