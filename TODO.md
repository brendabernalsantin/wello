# Criterios de entrega Wello

Estado de entrega: revisión v2 implementada y validada con 69 pruebas de lógica, 13 casos UI nuevos, 12 flujos UI previos, 6 adicionales y el flujo Pages sin servicios. Ver docs/VALIDACION.md.

- [x] HTML local autocontenido, navegación de seis entradas, Gym, Inicio, Hábitos/mood, Mascotas, Alimentos, Calendario, hogares y copias.
- [x] Compilación estática de vista previa, SDK oficial Auth PKCE, separación de cuentas y pruebas simuladas.
- [x] Propuesta SQL RLS/CAS, funciones de hogares e invitaciones y documentación de despliegue.
- [ ] Configuración real de Google/Supabase, publicación Pages y ejecución RLS con cuentas reales.
- [ ] Flujo completo de colaboración/membresías en producción tras confirmar roles; sincronización entre dos teléfonos.
- [ ] Validación iPhone/Calendario Apple/NFC físicos y proveedor real de tiendas.
- [ ] Compatibilidad exacta contra respaldos históricos originales no proporcionados.

# Prompt maestro para reconstruir Wello desde cero

Actúa como ingeniera o ingeniero full-stack responsable de reconstruir **Wello**, una aplicación general de bienestar personal y del hogar. Entrega software ejecutable, documentación y pruebas. Trabaja desde un proyecto limpio. Si tienes acceso a los archivos o capturas originales, úsalos para recuperar la apariencia, los identificadores y el formato de respaldos. Si no tienes ese acceso, este documento contiene los flujos finales y el plan completo de Gym. Escribe la interfaz y la guía de uso en español de México. Prioriza el iPhone y conserva una buena experiencia en computadora.

## 1. Alcance y orden de entrega

1. Reconstruye primero **Gym** y haz que se pueda probar como HTML interactivo en computadora. Agrega después Inicio, Hábitos, Mascotas, Alimentos, Calendario y Hogares en ese mismo producto. Entrega el resultado integrado como **Wello.html**, abrible directamente en Chrome desde el sistema de archivos, sin instalar dependencias ni configurar cuentas. Debe poder trabajar sin conexión para las funciones locales. Una captura ayuda a revisar el diseño, pero también debe haber una app donde se puedan probar los botones y guardar registros.
2. Prepara la versión en línea para **GitHub Pages + Supabase Auth + acceso con Google**, conservando la versión HTML local. En el punto donde quedó el trabajo anterior había una compilación estática, una pantalla de acceso y pruebas con autenticación simulada. La publicación y el OAuth real dependían de configurar los servicios. Reproduce ese estado y deja instrucciones para completar la configuración.
3. Lleva el producto al objetivo final de cuentas, invitaciones y hogares compartidos con Supabase. Separa esta fase de la paridad con el prototipo y de la configuración de acceso. Implementa y verifica lo que permita el entorno. Indica con precisión qué está listo, qué se probó con simulación y qué depende de recursos externos. El repositorio de referencia se llamaba `brendabernalsantin/primera-app`, rama `main`. Usa rutas compatibles con `/primera-app/` si se publica allí.
4. Si falta una decisión que afecte permisos reales, acceso o significado de datos históricos, haz una pregunta concreta antes de aplicar esa decisión. Puedes avanzar en paralelo con el trabajo independiente. Los requisitos más recientes de este prompt prevalecen sobre las versiones antiguas.

## 2. Identidad visual y navegación

- **Wello** es el nombre definitivo. Aplícalo en la marca, título, favicon, guía, pantalla de Google y archivo HTML. Los nombres históricos Forma Gym y Forma Bienestar se usan únicamente para reconocer respaldos o archivos previos. El módulo de cocina y compras se llama **Alimentos**.
- Recupera la personalidad del diseño colorido que la usuaria prefirió. Usa tarjetas redondeadas de colores vivos, ilustraciones grandes y simpáticas, jerarquía clara y letra más gruesa. El rediseño editorial anterior se sintió sin personalidad. Si tienes la habilidad `design-taste-frontend` que se usó en el proyecto, puedes aplicarla como ayuda de diseño. Las referencias y preferencias de la usuaria prevalecen sobre las sugerencias de esa habilidad.
- Paleta recuperada del prototipo como punto de partida: menta `#48CFAD`, aqua `#4FC1E9`, rosa `#EC87C0`, amarillo `#FFCE54`, verde `#A0D468`, lavanda `#AC92EC`, tinta `#283541` y fondo `#F5F7FA`. Usa los tonos vivos para identidad, ilustraciones y acentos. Mezcla los fondos grandes con blanco o usa tintas suaves para que el cambio entre pantallas sea agradable. Mantén texto oscuro y opaco, con encabezados y botones de peso alrededor de 700. Instrument Sans o una sans similar de buena lectura sirve como referencia. Una bienvenida menta con una ilustración floral recupera un motivo del prototipo.
- Cada módulo conserva su familia cromática desde la entrada en el menú hasta el encabezado, pestañas y controles interiores. Inicio/hogar en menta, **Gym en lavanda**, Hábitos en rosa, Mascotas en amarillo y Alimentos en aqua. En Gym todas las rutinas y vistas internas usan matices lavanda, con el seleccionado más marcado. En Calendario los marcadores distinguen cada tipo de actividad.
- En cualquier selector de color, muestra **una muestra del tono real que aparecerá en la tarjeta o elemento**. Usa borde y check para mostrar selección, foco visible y nombres accesibles para lectores de pantalla. No muestres los nombres de colores como opciones de texto. Comprueba que al recargar se mantiene el color y coincide con la muestra.
- Navegación primaria de seis entradas: **Inicio, Hábitos, Mascotas, Alimentos, Calendario y Gym**. Gym debe quedar a la vista en el menú principal, también en el menú superior de tablet y en la barra inferior móvil. Usa etiquetas cortas o dos filas si se requiere en pantallas estrechas. La entrada a Gym no debe depender de «Más», un submenú ni un desplazamiento oculto. En escritorio puedes conservar una barra lateral visible. Mantén accesibles el selector de hogar y «Mis datos».
- Usa como insumos las capturas visuales del chat, la referencia de caritas y los ZIP `Icons8.zip` e `Icons8 (1).zip`, si están disponibles. Reutiliza los iconos pertinentes con su atribución si corresponde. Usa recursos locales o embebidos para el HTML. Si faltan los originales, crea equivalentes coherentes y documenta la sustitución. Añade iconos o caritas adicionales solo cuando la usuaria los aporte o los pida.
- Verifica contraste, foco, etiquetas para controles con iconos, navegación por teclado y objetivos táctiles. Comprueba al menos anchos de 320, 390, 768, 1024 y 1440 px. Respeta el área segura del iPhone y evita desbordamiento horizontal.

## 3. Inicio

- Muestra bienvenida, acceso a las áreas principales y un vistazo a próximos cuidados o citas. El calendario completo vive en su propia sección del menú.
- **Hábitos de hoy** debe ser una lista compacta. Cada fila muestra únicamente el nombre y el check del día. Sin vista semanal, cantidades, metas, rachas ni tarjetas individuales grandes en Inicio. En el prototipo se mostraban hasta seis filas con acceso a todos en «Mis hábitos». Conserva ese criterio para evitar que la página crezca indefinidamente.
- Los checks leen y actualizan los mismos registros que usa Hábitos. Aplican la fecha local y el ámbito personal o familiar correspondiente. Al marcar un hábito con meta cuantitativa desde Inicio, usa una regla explícita de cumplimiento para no inventar cantidades. Si hace falta captura, abre el detalle correspondiente y mantén la fila compacta.

## 4. Gym

- Es personal y se divide en rutinas, grupos musculares y ejercicios. Usa el plan completo del anexo de este prompt. Las cuatro semanas sugeridas pertenecen al plan original, pero la vista de progreso **no debe mostrar contadores de días con la rutina ni de sesiones**. La prioridad es el peso cargado por ejercicio a través del tiempo.
- En cada entrenamiento permite elegir fecha y rutina, revisar series objetivo, capturar peso en kg por serie y marcar series o ejercicios completados. Admite cargas decimales y cero. Diferencia «sin peso anotado» de 0 kg. Las repeticiones programadas pueden variar por serie, y algunos ejercicios tienen segundos en lugar de repeticiones. Una meta del plan no debe convertirse en repeticiones realizadas por defecto cuando se importan registros históricos.
- Guarda el avance durante el entrenamiento. Permite **terminar la sesión con ejercicios pendientes**. Conserva los pesos anotados y las marcas efectuadas. Terminar una sesión parcial no marca los ejercicios omitidos. Al recargar se ven los mismos datos.
- Incluye vistas de entrenamiento, evolución e historial. En evolución, elige rutina y ejercicio, grafica fechas y muestra primera carga, última carga, diferencia en kg e historial con peso por serie. Usa una regla explícita y visible, como la mayor carga registrada de una serie realizada en cada sesión. Excluye series sin carga o no realizadas. Para ejercicios asistidos aclara que una menor asistencia puede ser progreso. Distingue el peso total de una barra del peso en discos cuando la fuente lo especifica.
- Mantén IDs estables. En el prototipo las sesiones usan fecha local + rutina como identidad. Conserva el historial al cambiar de versión y evita duplicarlo durante las importaciones. Si hay datos antiguos con fecha de inicio de rutina, puedes preservarlos como metadato para compatibilidad.
- En «Mis datos» permite revisar e importar las cargas verificadas del anexo histórico. La importación es personal y explícita. No metas esas cargas al historial de todos los usuarios ni las publiques en el repositorio, en los assets de GitHub Pages o en un HTML que se distribuya públicamente. Si se ofrece un JSON privado, indica cómo revisarlo e importarlo en la cuenta correcta.

## 5. Hábitos y «Mi mood de hoy»

- Permite crear, editar y gestionar hábitos dentro de la app con nombre, icono, color mediante muestras, fecha de inicio, frecuencia y ámbito personal o del hogar. Soporta periodicidad diaria, días específicos de la semana, cada cierto número de días y mensual. Resuelve los días que no existen en meses cortos con una regla documentada.
- Soporta hábitos simples de marcar y metas por cantidad con unidad, tanto diarias como semanales. Casos de prueba: beber 2 litros de agua al día o completar 3 paseos en una semana. Permite registrar cantidades parciales y ver cuánto falta. La pantalla «Mis hábitos» puede mostrar semana, metas y cantidades. Una meta semanal se evalúa con los registros de esa semana, sin dar crédito por el mero hecho de estar programada.
- Incluye en Hábitos un bloque ilustrado **Mi mood de hoy**, con seis caritas: **feliz, en calma, neutral, cansada, triste y estresada**. Cada persona puede guardar un estado por fecha local, añadir una nota opcional de hasta 1000 caracteres y cambiar la carita o la nota. Permite seleccionar fechas anteriores. Una edición actualiza el registro de ese día. El mood es personal al cambiar de hogar.
- Corrige explícitamente el problema de «el mood no se guarda en registro». Tras guardar y recargar, el mood debe aparecer en Hábitos y en **Calendario → Hábitos**, en Mes y Agenda. Muestra carita y nota en el detalle y ofrece «Editar mi mood» para abrir el día original. Deriva la entrada del mismo registro, incluidos moods de versiones anteriores. Evita duplicados. Si la exportación ICS incluye moods, haz que sean seleccionables y deja claro si se exportará el texto de la nota.

## 6. Mascotas

- Permite crear, editar y consultar perfiles por hogar. Incluye al menos nombre, tipo de mascota y cumpleaños. Muestra el cumpleaños y el historial sin mezclar registros de animales.
- Registra vacunas con nombre y fecha de aplicación, y fecha próxima si se conoce. Incluye paseos con fecha y campos útiles como duración y nota. Incluye entrenamientos con un catálogo editable de trucos que permita escribir qué truco se practicó y en qué consiste. Vincula esos trucos a sesiones de entrenamiento.
- Añade seguimiento de alimentación con fecha, alimento y cantidad cuando aplique. Incluye citas de baño, fecha y estado, con opción de marcar como realizada. Envía al calendario las actividades y fechas que correspondan.
- Muestra el flujo de medicamentos al activar **«Necesita cuidados»** para esa mascota. Permite capturar el medicamento indicado y llevar registro de administraciones con fecha, hora y anotaciones. Cuando vuelva a sentirse bien, oculta el formulario de tratamiento y conserva el historial. La aplicación se limita a registrar los datos que captura la persona.

## 7. Alimentos, súper, compras y ubicación

- **Inventario** por hogar, con refri, congelador y despensa. Registra nombre, cantidad, unidad, ubicación y caducidad opcional. Permite agregar, editar y eliminar con confirmación cuando corresponda. «Se terminó» deja el alimento en cero y permite agregarlo al súper. Evita duplicados accidentales. Se pueden consolidar renglones pendientes del mismo producto y unidad en el hogar activo.
- **Lista del súper** compartida por hogar en línea. Agrega, edita y marca productos. Permite trasladar una compra a inventario de forma explícita, eligiendo ubicación, cantidad y caducidad. Una repetición de la acción no debe duplicar inventario o compras.
- **Lo principal de Súper es cuánto gastaríamos en lo pendiente**. Toma el último precio válido guardado del mismo producto en el hogar, con unidad compatible. Calcula precio unitario a partir de cantidad e importe cuando haga falta, multiplícalo por la cantidad pendiente y muestra el estimado en MXN. Deja fuera los renglones ya comprados. Para un producto nuevo o sin referencia comparable muestra «Sin precio». Indica el subtotal conocido y que quedan renglones sin estimar. No conviertas unidades incompatibles ni supongas que falta de precio equivale a cero. Ejemplo: si el último registro de 2 piezas de leche costó $50 y faltan 3 piezas, estima $75. Si falta el precio del pan, muéstralo aparte.
- **Registra el gasto real** en un historial secundario, por producto y por ticket, ambas opciones confirmadas. Usa MXN, cantidades, unidades, importe por producto, fecha y tienda. En el ticket permite registrar el total y el desglose disponible, incluidos descuentos. Indica diferencias entre líneas y total. Un ticket sin desglose puede entrar al historial, pero no genera precios inventados. El historial puede consultarse por mes y tienda.
- Al registrar «Dónde compramos», ofrece sugerencias de establecimientos cercanos según la ubicación actual, al pedir permiso desde esa acción. Da siempre la opción de escribir una tienda, incluso si se niega el permiso, el contexto no admite geolocalización o falla el proveedor. Evita guardar las coordenadas de la persona como parte del ticket. En la versión anterior se probó el flujo simulado y la captura manual, mientras que la búsqueda real basada en OpenStreetMap quedó sin verificar por restricciones de red. Prueba las rutas simuladas y comprueba la búsqueda real si se dispone de un proveedor operativo. Distingue ambas validaciones.
- **NFC**. Implementa el enlace `#super?accion=agregar` y una opción «Probar el acceso directo» en la app local. En línea, usa una URL HTTPS del sitio con ese fragmento para abrir directamente el formulario de **Agregar al súper**. El iPhone lee una tarjeta programada con un registro URL/NDEF y abre la URL. La web no necesita leer la tarjeta con Web NFC. Si el usuario debe acceder con Google, guarda el destino y recupéralo tras el retorno OAuth. La ruta abre un formulario, no crea compras sin intervención. Consúmela para que no vuelva a abrir el formulario cada vez que se recarga. Ofrece copiar el enlace físico desde un sitio HTTPS.

## 8. Calendario e iPhone

- **Calendario** es una sección visible. Incluye vistas **Mes** y **Agenda**, navegación por mes, «Hoy», selección de fecha, detalle de la actividad y filtros por **tipo de actividad**: Todas, Hábitos, Gym, Mascotas y Citas personales. Mantén el mismo resultado filtrado en la cuadrícula, el detalle diario y la agenda.
- Deriva actividades de los hábitos programados y realizados, moods guardados, entrenamientos registrados y fechas de mascotas, junto con las citas creadas manualmente. Usa IDs estables para las entradas derivadas y abre su registro fuente para editarlas. En hogares muestra solo los eventos del ámbito correspondiente. Las citas personales son privadas salvo que la usuaria defina otro ámbito.
- Permite crear, editar y eliminar citas con título, fecha, horario o todo el día y nota. Exporta citas o agenda en **.ics** compatible con Calendario de iPhone. Usa fechas locales correctas, horarios con zona explícita, UID estable y escape de texto. Explica cómo abrir o importar el archivo en el iPhone. El objetivo original era calendarizar cosas en el iPhone. La exportación ICS cubre el flujo de llevar eventos a su calendario. Una suscripción continua o sincronización bidireccional sería una fase separada que requiere definir permisos y proveedor.

## 9. Datos, hogares y migración

| Ámbito | Registros |
| --- | --- |
| Personal | Gym, mood, hábitos marcados como personales y citas personales |
| Hogar activo | Perfiles y cuidados de mascotas, inventario, súper, tiendas, compras y hábitos marcados como familiares |

- En el HTML local permite crear, nombrar y cambiar entre espacios de hogar. Al cambiar de hogar deben cambiar las colecciones familiares. Gym y mood permanecen en el mismo espacio personal. El modo local funciona sin cuenta.
- Reconstruye el acceso a **«Mis datos»** para exportar e importar copias de Gym y del hogar. Conserva lectura compatible con `forma-gym-v1` y `forma-home-v1` y acepta archivos de versiones anteriores sin mood, compras o calendario. Respeta IDs históricos, aplica migraciones aditivas y valida antes de escribir. Informa qué se añadió, qué ya existía y qué no pudo importarse. Mantén el valor local en duplicados salvo que exista un flujo explícito de resolución. Una segunda importación del mismo archivo debe ser inocua. Si tienes acceso a copias antiguas reales, comprueba el formato exacto con ellas.
- En línea, separa el caché por usuario autenticado. Cambiar de cuenta o cerrar sesión no puede enseñar ni sobrescribir los datos de otra. Crea un flujo explícito para importar las dos copias locales en la cuenta y el hogar elegidos. Un ID local importado no concede acceso a ningún hogar en la nube. Evita subir todo el almacenamiento del navegador sin revisión.
- Para la fase de colaboración real, usa un modelo explícito de usuarios, hogares y membresías. Permite crear hogares, invitar miembros y cambiar el hogar activo. Aplica RLS de Supabase en todas las tablas privadas o compartidas. Cada usuario solo lee y escribe sus datos privados. Solo miembros autorizados acceden a objetos de su hogar. Aplica el control también a inserciones y cambios de hogar, no solo a lecturas. Valida pertenencia y permisos en la base de datos aunque la petición venga fuera de la interfaz.
- Confirma roles, facultades de invitación y revocación, eliminación de cuenta y reglas de fusión si afectan datos reales. Como propuesta de implementación para desarrollar en local, puedes separar propietario y miembro con invitación expirable de un solo uso y permitir que el propietario gestione membresías. Documenta estas decisiones como propuestas donde todavía no estén confirmadas.
- Diseña el guardado para reintentos, ediciones concurrentes y uso desde dos teléfonos. Usa IDs estables, operaciones idempotentes y una estrategia de conflictos verificable. Agrupa operaciones relacionadas, como registrar la compra y actualizar inventario, cuando deban completarse juntas. Distingue en pantalla «guardado en este dispositivo» de «sincronizado». Comprueba que un hogar ajeno queda inaccesible incluso si se conoce su ID.

## 10. Arquitectura y publicación

- Como base de paridad usa HTML, CSS y JavaScript modular, Node para el servidor de prueba y scripts, esbuild para el empaquetado estático y el SDK oficial de Supabase para la variante en línea. Separa dominio, interfaz, almacenamiento, calendario, cálculo de compras y autenticación. La versión local no debe cargar el cliente de autenticación ni depender de un CDN. Incrusta los assets que necesite el HTML.
- Incluye comandos documentados equivalentes a `npm ci`, `npm start`, `npm test`, `npm run check`, `npm run export:html`, `npm run preview:pages` y `npm run build:pages`. Entrega `entregables/Wello.html`, la compilación de Pages en `dist/`, `.env.example`, README y guía de despliegue. Añade migraciones y pruebas de políticas de base de datos para la fase compartida.
- Configura Supabase Auth con **Google**, OAuth PKCE, sesión y botón de cierre de sesión. Preserva el subdirectorio de Pages y el destino NFC durante el callback. Limpia los parámetros de OAuth al finalizar. Usa HTTPS en el sitio publicado. La configuración pública puede usar `WELLO_SUPABASE_URL` y `WELLO_SUPABASE_PUBLISHABLE_KEY`. Rechaza configuración ausente y credenciales privilegiadas en la compilación de producción. Conserva cualquier secreto de Google o clave de servicio fuera del frontend y del repositorio.
- Entrega el flujo de GitHub Actions para Pages con ejecución manual. Documenta cómo crear un proyecto Supabase llamado Wello, configurar el proveedor Google, registrar el callback de Supabase en Google y la URL de retorno de Pages en Supabase, definir variables, publicar y abrir la app en el iPhone. Distingue los pasos que yo hago en mis cuentas de lo que se puede automatizar. No solicites contraseñas ni claves secretas por chat. Si no hay proyecto configurado, entrega la vista previa y pruebas simuladas con ese estado claro.

## 11. Pruebas de aceptación

1. El HTML se abre en Chrome desde el disco, funciona sin conexión para los flujos locales y conserva registros al recargar. La app publicada compila con rutas relativas a su subdirectorio.
2. El plan tiene **4 rutinas y 38 entradas**, con repeticiones variables correctas en Prensa 45° y Extensión a dos piernas, y tiempos correctos en Plancha y Sentadilla isométrica. Guardar pesos, cerrar una sesión parcial y recargar conserva solo las marcas realizadas. El historial muestra evolución por fecha sin contadores de días o sesiones.
3. Una carga válida de 0 kg se distingue de la falta de dato. Una serie sin marcar no aparece en la gráfica. Las cargas con referencia a discos mantienen esa indicación.
4. Dos hogares en modo local aíslan mascotas, inventario y hábitos familiares. Cambiar entre ellos conserva los hábitos personales, Gym y mood. Crear muchos hábitos no convierte Inicio en una parrilla grande. El check del día persiste.
5. Se puede registrar un mood con nota, editarlo sin duplicar, recargar y encontrarlo en Mes y Agenda con el filtro Hábitos. Desde Calendario se abre la fecha correcta. Los colores elegidos coinciden con las tarjetas y se pueden elegir con teclado. Gym es visible en 320, 390, 768, 1024 y 1440 px.
6. Se puede crear una mascota, registrar una vacuna, un paseo, un truco y entrenamiento, una comida y una cita de baño. Activar cuidados permite registrar medicamentos. Desactivar cuidados mantiene el historial.
7. El subtotal de Súper usa precios anteriores ajustados por cantidad y unidad. Separa los productos sin precio. El historial mantiene los costos reales por línea y ticket. Pasar al inventario dos veces no duplica un producto comprado. Probar ubicación concedida, denegada, sin resultados y captura manual.
8. Se puede crear una cita, filtrar por categoría, abrir su detalle y generar un ICS con fechas y texto válidos para el iPhone.
9. La ruta NFC abre el formulario una vez y conserva el destino después de autenticar con Google. La prueba local funciona sin tarjeta física.
10. Una copia anterior se puede importar. Una copia dañada no modifica los datos existentes. Una copia repetida no duplica registros. Dos cuentas simuladas separan su caché. Si hay un entorno real de Supabase, comprueba acceso Google, sincronización entre dos dispositivos y políticas de hogar con al menos dos cuentas miembros y una ajena.
11. Al entregar, indica cómo probar cada variante, dónde están los artefactos, qué pruebas corriste y cuáles quedaron sujetas a servicios o hardware. Usa pasos breves que pueda seguir alguien que empieza. Evita declarar como publicada, sincronizada o probada en un iPhone físico una entrega que solo se verificó localmente.

## Anexo A. Plan de entrenamiento recuperado de ENTRENAMIENTO2.pdf

Cada fila es una entrada independiente dentro de su rutina, aunque el nombre aparezca en otros días. Los IDs se recuperaron del código original. Si una fila tiene varios valores, corresponden a las series en ese orden. Una sola cifra se repite como objetivo para todas las series. Los objetivos del plan no son evidencia de una sesión realizada.

### Día 1 · Glúteo, isquios y cuádriceps

| ID | Grupo | Ejercicio | Series | Reps o duración por serie |
| --- | --- | --- | ---: | --- |
| `d1-sentadilla` | Tren inferior | Sentadilla libre con barra | 3 | 10 |
| `d1-desplante` | Tren inferior | Desplante en reversa con mancuernas | 3 | 12 |
| `d1-peso` | Tren inferior | Peso muerto con barra | 4 | 10 |
| `d1-hip` | Tren inferior | Hip thrust con barra | 4 | 10 |
| `d1-femoral` | Tren inferior | Femoral acostada en máquina a dos piernas | 4 | 12 |
| `d1-prensa` | Tren inferior | Prensa 45° | 4 | 6, 8, 10, 12 |
| `d1-patada` | Tren inferior | Patada para glúteo en polea | 4 | 10 |
| `d1-costurera` | Pantorrilla | Costurera | 4 | 15 |

### Día 2 · Tríceps, espalda y abdomen

| ID | Grupo | Ejercicio | Series | Reps o duración por serie |
| --- | --- | --- | ---: | --- |
| `d2-extension` | Tríceps | Extensión con cuerda | 4 | 15 |
| `d2-patada` | Tríceps | Patada para tríceps con mancuerna | 4 | 10 |
| `d2-copa` | Tríceps | Copa a una mano | 4 | 12 |
| `d2-fondos` | Tríceps | Fondos en banco sin peso | 4 | 12 |
| `d2-dominadas` | Espalda | Dominadas abiertas asistidas | 3 | 12 |
| `d2-abierto` | Espalda | Jalón abierto al pecho | 3 | 12 |
| `d2-cerrado` | Espalda | Jalón cerrado al pecho | 3 | 10 |
| `d2-remo` | Espalda | Remo con mancuerna a una mano | 3 | 10 |
| `d2-crunch` | Abdomen | Abdominal crunch en colchoneta | 3 | 12 |
| `d2-plancha` | Abdomen | Plancha | 3 | 40 seg |
| `d2-lateral` | Abdomen | Crunch lateral cruzado | 3 | 12 |

### Día 3 · Isquios, glúteo y cuádriceps

| ID | Grupo | Ejercicio | Series | Reps o duración por serie |
| --- | --- | --- | ---: | --- |
| `d3-sentadilla` | Tren inferior | Sentadilla libre | 4 | 10 |
| `d3-goblet` | Tren inferior | Sentadilla goblet | 4 | 10 |
| `d3-hack` | Tren inferior | Hack squat | 4 | 10 |
| `d3-extension` | Tren inferior | Extensión a dos piernas | 4 | 12, 10, 8, 6 |
| `d3-isometrica` | Tren inferior | Sentadilla isométrica con peso | 4 | 30 seg |
| `d3-hip` | Tren inferior | Hip thrust con barra | 4 | 10 |
| `d3-patada` | Tren inferior | Patada para glúteo en polea | 4 | 10 |
| `d3-costurera` | Pantorrilla | Costurera | 4 | 15 |

### Día 4 · Bíceps, hombro y pecho

| ID | Grupo | Ejercicio | Series | Reps o duración por serie |
| --- | --- | --- | ---: | --- |
| `d4-curl` | Bíceps | Curl con barra de pie | 3 | 10 |
| `d4-martillo` | Bíceps | Curl martillo con mancuernas | 3 | 12 |
| `d4-polea` | Bíceps | Curl en polea con barra chica | 3 | 10 |
| `d4-cuerda` | Bíceps | Curl con cuerda en polea | 3 | 12 |
| `d4-militar` | Hombro | Press militar con mancuernas sentada | 3 | 10 |
| `d4-frontal` | Hombro | Elevación frontal en polea con cuerda | 3 | 10 |
| `d4-laterales` | Hombro | Elevaciones laterales con mancuernas | 3 | 15 |
| `d4-flies` | Hombro | Flies invertidos en máquina | 3 | 12 |
| `d4-inclinado` | Pecho | Press inclinado con mancuernas | 3 | 10 |
| `d4-fly` | Pecho | Pectoral fly en máquina | 3 | 12 |
| `d4-horizontal` | Pecho | Press en banco horizontal con barra | 3 | 10 |


## Revisión v2 solicitada

- [x] Icono visible en el selector de hábitos: dibujos seleccionables, no opciones sólo en texto; selección/foco accesibles y valor persistente.
- [x] Mascotas hembra: registrar y editar inicio/final del celo, notas, duración e intervalos observados para monitoreo; conservar registros y no inventar próximas fechas clínicas.
- [x] Imagen de mascota: agregar, previsualizar, guardar, cambiar y quitar foto local, con reducción proporcional y validación; persistir al recargar y exportar/importar.
- [x] Catálogo de trucos: poder registrar cuándo se practicó desde cada truco, enlazar el registro al truco correcto y conservar historial.
- [x] Agregar actividad de mascota: menú con categorías claras e iconos y formularios específicos con sólo campos relevantes y validación coherente; conservar edición de historial y medicamentos.
- [x] Calendario: colores según módulo y muestra elegida en cada hábito, aplicados en Mes, Agenda, detalles y leyenda; no todo verde.
- [x] Exportación al iPhone: seleccionar filtro dentro del diálogo (sólo mascotas, sólo hábitos, Gym, citas o todas), mes y moods/notas opcionales; ICS debe contener sólo la selección.
- [x] Frecuencia de hábito: días marcados sólo para días de la semana; intervalo sólo para cada N días; mensual abre calendario real para seleccionar día, guarda recurrencia y muestra la próxima fecha automáticamente (ejemplo 3 de diciembre).
- [x] Hábitos compactos: listar icono/nombre y check; el detalle y la edición se despliegan al presionar el hábito; no tarjetas grandes por hábito. Cantidades/semana conservadas en detalle y check cuantitativo sin inventar cantidades.

## Producción familiar aprobada
- [x] Repositorio brendabernalsantin/wello creado y conectado, público por autorización explícita para Pages gratuito, sin datos personales. Workflow conservado como plantilla fuera de GitHub Actions.
- [x] Supabase Wello gratuito en organización confirmada; tablas y RPC/RLS verificadas en rollback real. Privado sólo dueño de cuenta; hogar sólo miembros; visitante/no miembro denegado; escritura directa blobs denegada, CAS e idempotencia bajo bloqueo.
- [ ] Hogares por membresía con crear/compartir local explícito, cambiar hogar; owner renombra, invita correo-confirmado con enlace7d uso único, revoca y retira; member sale sin permiso administrativo. No transferir propietario ni borrar hogar.
- [ ] Sync automática edición/retorno/15s visible, indicador pendiente/error/conflicto y retry offline. Fusión disjunta sin perder compras ni revivir borrados; mismo valor conflicto exige decisión y respaldo. Namespace/logout/generation protege contra cuenta vieja.
- [ ] Fotos/celo/prácticas/mascotas/hábitos del hogar/inventario/súper/compras compartidos, Gym/mood/citas/hábitos personales privados. Local import explícito y no subir hogares automáticamente.
- [ ] Clave publicable y URL real, Google Auth y callback/retorno Pages exacto, publicación estática por rama sin divulgar código privado sin permiso ni pagar extras.
- [ ] Revisión independiente y pruebas afectadas; Supabase y Pages reales, Google y dos familiares verificados sólo con acceso real; límites pendientes documentados.

### Evidencia de esta fase

92 pruebas JavaScript correctas y sintaxis verificada después de los parches de cuenta, bootstrap, baseline, revocación, reintento de creación y nombres canónicos. Fixture real Supabase: 45 aserciones con rollback; invitaciones limitadas a siete días en SQL. Backend e interfaz implementados; Google real, Pages HTTP y dos familiares siguen pendientes.

## Acceso obligatorio web publicado · 12 noviembre 2026

- [x] La versión production muestra únicamente acceso con Google antes de iniciar sesión, sin destello de la app, navegación o formularios accesibles. Comprobar sesión mantiene el acceso bloqueado.
- [x] Sin sesión no hay entrada a modo local, ni por botón ni por método del cliente; errores de acceso conservan bloqueo. Cerrar sesión, perderla o cambiar de cuenta oculta la app y cierra diálogos inmediatamente. Tras entrar con Google se habilitan los módulos para la cuenta correspondiente.
- [x] NFC e invitaciones conservan sus destinos a través de Google; el HTML descargable local y las copias privadas existentes no se eliminan ni modifican.
- [x] Pruebas de bloqueo, acceso autenticado simulado, cierre, errores y rutas directas. Publicar y verificar el artefacto actualizado en Pages sin modificar permisos RLS ni credenciales.

## Revisión por espacios · pendientes recibidos el 12 noviembre 2026

Estado: Mascotas y Calendario siguen en anotación y revisión previa. Inicio sí fue autorizado después para implementación; ver su apartado al final. Detalle en docs/CAMBIOS-PENDIENTES.md.

- [ ] Mascotas / Trucos: permitir reutilizar para una mascota los trucos registrados para otro perro o mascota, sin volver a escribirlos. Revisar selección individual o catálogo completo y tratamiento de duplicados. La propuesta separa definiciones reutilizables del historial de prácticas de cada mascota.
- [ ] Calendario: mostrar lo efectivamente cumplido, no las tareas sólo programadas. Ejemplos solicitados: hábitos marcados con check y registros de entrenamiento, en sus fechas reales. Revisar metas parciales, entrenamientos parciales, mascotas y citas antes de fijar sus reglas; no inventar cumplimiento ni borrar registros.
- [ ] Calendario / Colores: respetar los colores de las categorías o secciones, no los colores manuales de cada hábito. Sustituye el criterio anterior de color individual en Calendario, sin modificar los colores guardados en los hábitos. Coherencia en filtros, leyenda, Mes, Agenda y detalles; confirmar las referencias por categoría en la revisión.
- [ ] Revisar con la usuaria sección por sección: recopilar sus siguientes observaciones, resumir lo entendido y resolver las decisiones de cada espacio antes de implementar. No iniciar estos cambios durante la recopilación.

### Inicio · observaciones recibidas a las 13:49

- [x] Retirar de Inicio exactamente estos textos: «Buenas tardes», «No tienes que hacerlo todo hoy.», «Solo empezar por algo que te haga bien.», «Aquí, cada pequeño paso cuenta.» y «Todo lo que cuidas, aquí.». No retirar otros textos no señalados.
- [x] Revisar y corregir la apariencia verdosa de la chica meditando. Diagnóstico pendiente; no asumir todavía una causa ni sustituir la ilustración sin acordarlo.
- [x] Hábitos de hoy: mostrar como máximo cuatro hábitos en Inicio (sustituye el límite anterior de seis) y debajo un acceso claro a los demás en la sección de Hábitos, evitando que Inicio se haga extenso.
- [x] Al marcar un hábito como realizado, enviarlo al final de la lista y subir los pendientes. Ordenar primero pendientes y luego realizados antes de mostrar los cuatro, para que los siguientes sin completar vayan apareciendo. No borrar hábitos ni registros de cumplimiento.

Autorización posterior: «aquí ya haz los cambios». Inicio implementado y validado con 6 grupos UI y 5 pruebas nuevas de lógica; Mascotas y Calendario siguen pendientes.

### Inicio · fondo de ilustración, corrección autorizada a las 13:59

- [x] Quitar el fondo blanco real de la imagen de la chica meditando mediante un PNG transparente, sin cuadro, borde ni fondo simulado. Conservar la misma ilustración completa y sus colores; mostrarla directamente sobre el fondo menta sin mezcla multiply, filtro ni opacidad que la vuelvan verdosa. Integrar la transparencia en la web publicada y en el HTML local, comprobarla y publicar sólo esta corrección; los demás espacios siguen pendientes.

## Hábitos · revisión autorizada el 12 noviembre, 14:16

- [x] Retirar «Un espacio para lo que te hace bien.» y «Te sientes feliz. Puedes cambiarlo cuando quieras.» y sus variantes de emoción. Usar «estado de ánimo» en los textos de interfaz, manteniendo IDs y registros internos sin migración destructiva.
- [x] Las seis imágenes de estados de ánimo deben tener transparencia real, sin fondo blanco ni tinte del fondo. Conservar sus expresiones, estilo y colores.
- [x] Tras registrar un estado de ánimo, mostrarlo dentro del recuadro rosa en lugar de las tres caritas: encabezado «Hoy estoy feliz» según la emoción, la carita correspondiente y la nota que antes aparecía debajo. Sin registro, mantener invitación para registrar y las caritas. Con otra fecha seleccionada, no llamar «hoy» a ese registro. Nota escapada, multilínea y legible.
- [x] Quitar de la página de Hábitos la lista/historial inferior de estados de ánimo. Conservar todos los registros y su acceso/edición desde Calendario; no borrar historial ni alterar las frecuencias o metas de los hábitos.
- [x] Mover el selector de fecha con el icono de calendario a la parte superior, indicando que afecta a Hábitos y estado de ánimo. Mover el botón Crear hábito junto a «Lo que cuido de mí», intercambiando las posiciones anteriores. Cambiar fecha y guardar un estado de ánimo mantiene la fecha común consistente.
- [x] Añadir animación sutil a las caritas, sin parpadeo ni movimiento intenso, y detenerla con prefers-reduced-motion. Conservar accesibilidad de controles y diseño adaptable.
- [ ] Verificar guardado, edición, recarga, fechas y presentación; publicar la sección de Hábitos sin implementar los cambios pendientes de Mascotas ni la lógica pendiente de Calendario.
