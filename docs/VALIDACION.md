# Validación de Wello: primera entrega y revisión v2

Fecha de ejecución: 3 de noviembre de 2026. Entorno: Ubuntu, Node 22 y Chromium automatizado con Playwright. Datos de pruebas sintéticos; las cargas privadas nunca se precargaron en el HTML.

## Resultados ejecutados

`npm ci` terminó correctamente desde el lockfile. `npm run check` pasó: sintaxis válida de módulos, scripts y pruebas. `npm test` pasó **45 pruebas, 45 correctas y 0 fallidas**. Se comprobaron plan de cuatro rutinas y 38 entradas, repeticiones variables y segundos, cero frente a vacío, mayores cargas realizadas, referencias compatibles y observaciones sin verificar excluidas, cantidades por día y semana, periodicidades y fin de mes, ámbitos, mood, importación repetida, ICS, estimación de compras, transferencia s1/s2/s1 tras serialización JSON, descuentos netos, cuidados y controladores de cuenta con Auth simulado.

`npm run test:ui` abrió `entregables/Wello.html` mediante **file://** en Chromium y pasó **12 de 12 flujos**. Comprobó inicio sin SDK Auth, una sesión Gym parcial con cero y decimales tras recarga, hábito de 2 litros con cantidad parcial de 0.75, coincidencia del color guardado, captura de cantidad desde Inicio, mood anterior editable sin duplicados visible en Mes y Agenda con filtro Hábitos, mascota/vacuna/medicamento y conservación al desactivar cuidados, ticket y estimado de súper, hogares aislados, cita con hora y descarga ICS, NFC consumido una vez, namespaces simulados y recarga offline.

La prueba adaptable recorrió Inicio, Hábitos, Mascotas, Alimentos, Calendario y Gym en **320, 390, 768, 1024 y 1440 px**: 30 combinaciones sin desbordamiento horizontal, con Gym visible en la navegación primaria. No se ocultó en «Más».

`node tests/extra-ui.mjs` pasó **6 de 6 casos**: Calendario abre la actividad original de una mascota; ubicación simulada denegada, permitida sin resultados y permitida con resultados, todas con captura manual; copia dañada sin modificar datos; importación JSON repetida sin duplicar la sesión.

`node tests/pages-ui.mjs` pasó el flujo de la variante estática: Google deshabilitado cuando no hay configuración, NFC diferido hasta elegir modo local y consumido una vez. No se fingió una sesión real.

`npm run export:html` y `npm run build:preview` generaron archivos completos. Se verificó que el HTML local no tiene scripts remotos, CSS remoto, @import, CDN ni SDK Supabase. Producción rechazó tanto configuración ausente como una clave `sb_secret_*`; no se produjo una compilación conectada falsa.

El JSON histórico privado se validó mediante el importador: conserva cinco observaciones en una sesión parcial sin distribuirlas en series, y la segunda importación añade cero registros. Se confirmó la ausencia de su fecha, procedencia y texto de las cargas en el HTML público y `dist/index.html`.

Una revisión independiente del código detectó fallos de idempotencia, escape y eventos de cierre de sesión. Se corrigieron y se añadieron regresiones. El guardado explícito, el bloqueo CAS, los namespaces y la propuesta RLS se comprobaron por código y pruebas simuladas, no en servicios reales.

## Lo que no se ha verificado

No hay Google ni Supabase real configurados. No se ejecutaron las migraciones ni las políticas contra una base Supabase, no se validó RLS con tres cuentas reales ni la sincronización entre dos teléfonos. Las funciones de hogares, mapeos e invitaciones de la capa online son preparación técnica; la gestión completa de membresías y el flujo de colaboración requieren revisión de roles, configuración y pruebas antes de utilizar datos reales. El panel online usa sincronización manual y no promete sincronización automática.

No se publicó GitHub Pages ni se modificó el repositorio externo de referencia. `dist/` es una compilación estática de vista previa sin servicios. La rama/repo de referencia deberá confirmarse antes de conectarlo o publicarlo.

No se probaron iPhone físico, Safari móvil, tarjeta NFC física ni la importación efectiva en Calendario de Apple. Se comprobó el formato ICS y los flujos en Chromium; el hardware requiere una prueba posterior.

La consulta real de Overpass, usando coordenadas públicas del centro de CDMX y no la ubicación de la usuaria, respondió **HTTP 406**. No se declara la búsqueda real como operativa. Se probaron mocks y la captura manual; las coordenadas no se guardan.

No se recibieron respaldos originales reales `forma-gym-v1`/`forma-home-v1`. Se comprobaron adaptadores con archivos sintéticos, validación aditiva y duplicados. No se garantiza la lectura de un formato histórico distinto al reconocido; se rechaza para revisión sin modificar los datos.

## Reproducir las pruebas

```bash
npm ci
npm test
npm run check
npm run export:html
npm run build:preview
npm run test:ui
node tests/extra-ui.mjs
node tests/pages-ui.mjs
```

Las pruebas de interfaz usan `/usr/bin/chromium`. Si está en otra ruta, ajusta `executablePath` en los tres archivos `.mjs` de `tests/`. El proyecto no instala Chrome en la computadora de la usuaria. Para revisar manualmente la app local basta con abrir `Wello.html`.

## Revisión v2: ajustes de Hábitos, Mascotas y Calendario

La revisión del 3 de noviembre conserva el formato v3 y añade únicamente campos opcionales a los perfiles y actividades. `npm test` pasó 69 de 69 pruebas. Las regresiones nuevas comprueban iconos visibles, filas sin semana/metas en la lista, controles de frecuencia condicionales, día mensual real y compatibilidad de hábitos mensuales anteriores, fotos raster privadas, registros de celo con fechas observadas, prácticas vinculadas, colores del calendario y filtros ICS. Los guardados fallidos de hábitos, cantidades, moods, citas y registros de mascota restauran los datos anteriores; los días no programados no reciben registros nuevos accidentales.

`tests/revision-v2-ui.mjs` pasó **13 de 13 casos** y verifica las interacciones de esta revisión desde file://: elección de los seis dibujos, edición desde detalle, cantidades parciales, días semanales, intervalo, próximo 3 de diciembre, fotos realmente decodificadas con lado máximo 640 y proporción conservada, guardado inmediato durante procesamiento, cambio y eliminación de foto, categorías y campos pertinentes, práctica desde catálogo, celo con final inválido rechazado y duraciones/intervalos observados, colores en Mes y Agenda y descargas separadas sólo Mascotas/sólo Hábitos. Incluye cancelación de un procesamiento pendiente sin guardar el perfil ni cerrar otro formulario, exportación privada con foto/celo/prácticas, recarga sin conexión y 30 hábitos a 320, 390, 768, 1024 y 1440 px.

Se identificaron y corrigieron en Chromium dos problemas reales de imagen: no se puede usar `toDataURL` en OffscreenCanvas nativo y la llamada a `createImageBitmap` necesita su receptor nativo. El editor usa canvas HTML y decodificación enlazada correctamente. Una foto original no se adjunta al código ni al ZIP: sólo se almacena, optimizada, en los registros de la persona que la carga.

El archivo .ics se comprobó por contenido y descarga. La importación física en Apple sigue pendiente; Apple asigna el color según el calendario de destino y no se promete trasladar el color de cada fila de Wello. Celo sin final registrado exporta sólo el inicio, no una duración inferida. No se configuraron cuentas, no se activaron servicios ni se publicó la revisión.

Para repetir la revisión: `npm run export:html && node tests/revision-v2-ui.mjs`. Los datos de prueba y las capturas están en `artifacts/`, excluidos del paquete publicable.

## Fase online familiar: estado más reciente

Las secciones anteriores describen el estado histórico de la primera entrega y la revisión v2; las limitaciones de configuración externa de esas fases se actualizan aquí.

Se creó el proyecto Supabase Wello `hpdefigzmgvqvgylvydh` en la organización confirmada, con cotización $0/mes aceptada. Se aplicaron las migraciones de hogares/roles/blobs/RPC/RLS y la corrección de vigencia máxima de invitaciones a siete días. El fixture `supabase/tests/production-rls.sql` ejecutó **45 aserciones en PostgreSQL real**, con tres usuarios sintéticos, dos hogares, roles authenticated/anon y rollback. Reportó success=true. Se verificó después cero usuarios y hogares de fixture persistidos. Una llamada HTTP pública a private_records y household_records fue rechazada; no se concedió lectura amplia para resolver los avisos del Advisor.

Las aserciones incluyen lectura privada sólo propia, hogar sólo miembros, RPC de hogar para miembro y rechazo a outsider, denegación de escrituras directas y ascenso de rol, CAS con revisión obsoleta, retry de operación y rechazo de payload/ámbito/revisión distintos, email confirmado y coincidente, token consumido/revocado/expirado, reemplazo de invitación vencida, owner protegido, salida y retiro. Son pruebas transaccionales de las reglas del backend, no sesiones reales de Google ni una prueba de concurrencia de dos teléfonos físicos.

El repositorio brendabernalsantin/wello se creó y conectó; se hizo público tras autorización explícita. Se comprobó que los archivos versionados no incluyen respaldos privados, fotos capturadas ni claves administrativas. Los artifacts y datos privados siguen excluidos. La configuración del build usa únicamente URL de Supabase y clave publicable.

La revisión independiente de colaboración detectó carreras de cuenta en peticiones, bootstrap personal y reapertura de hogares revocados, importación local sin confirm=true, reintento de creación y divergencia de nombres. Se prioriza corregir esos problemas antes de subir el artefacto final. Las pruebas de UI de hogares y SQL se ampliaron; no se presenta una suite simulada como autenticación real.

El manifiesto actualizado contiene 11 rutas y se comprobó GET /manus-routes.json HTTP200 JSON idéntico al archivo. El whitespace señalado en el bundle online proviene de un literal del SDK minificado; no se altera ese literal a ciegas. El código fuente y scripts pasan la comprobación de whitespace y sintaxis.

**Pendiente:** activar Google en la cuenta de la propietaria, configurar callbacks/Site URL/Redirect URLs exactos, habilitar Pages desde gh-pages y verificar HTTP del artefacto, entrar con dos familiares reales y probar sincronización. También siguen pendientes iPhone, Safari/Calendario Apple y NFC físicos. La [guía manual de Google](ACTIVAR-GOOGLE.md) no pide compartir secretos por chat.

### Resultado posterior a las correcciones de colaboración

`npm test` final pasó **92/92** y `npm run check` pasó. Se añadieron regresiones para el JWT de la cuenta que inició la escritura, guards de generación/namespace, bootstrap personal conservado, baseline tras aceptar una invitación, revocación sin resucitar hogares y nombres canónicos. La creación conserva el operation ID para reintentar una respuesta perdida. La UI confirmó importación con confirm=true y protege los diálogos de respuestas de sesiones anteriores. Se regeneraron HTML local y build production. Esto no sustituye la validación pendiente de OAuth Google y de dos familiares reales.

## Acceso obligatorio a la web · 12 de noviembre de 2026

La propietaria configuró Google OAuth y las URLs de regreso mediante los paneles oficiales. Supabase Auth respondió HTTP200 con Google habilitado y la autorización HTTP302 abrió accounts.google.com con callback correcto y sólo email/profile. La propietaria envió captura de Cuenta conectada tras completar Google en la web. Es evidencia de su acceso real, no de una colaboración ya comprobada entre familiares.

La versión production arranca bloqueada desde el HTML y CSS inicial: sólo presenta acceso, sin navegación, formularios ni entrada local. Valida la sesión con `auth.getUser` antes de preparar el namespace y habilitar los módulos. Los errores conservan el bloqueo. Cerrar sesión cambia la vista y vacía el espacio de cuenta antes de esperar la red; los formularios se cierran y los registros persistidos se conservan. El modo local sigue disponible sólo en el HTML independiente y la variante de desarrollo preview.

`npm run check` y `npm test` pasaron: **102/102 pruebas de lógica**. Incluyen cierre durante una validación pendiente, callback de cuenta B frente a una respuesta A y INITIAL_SESSION no nulo obsoleto; no pueden volver a mostrar la cuenta anterior. La revisión independiente detectó estas carreras y se añadieron regresiones a la corrección.

`node tests/auth-access-ui.mjs` pasó **8/8 grupos** con el SDK real en Chromium y endpoints Auth/REST/RPC interceptados: bloqueo antes de JavaScript, hashes directos, ausencia de local/close como bypass, ancho 320/390/768/1440 sin overflow, getUser demorado, sesiones rechazadas o servicio fallido, error de Google y cierre con red demorada conservando exactamente la copia de registros de cuenta. Ninguna prueba inició una cuenta Google real ni escribió en Supabase. `npm run test:ui` volvió a pasar **12/12 flujos** del HTML local, con 30 combinaciones de ancho/ruta y recarga offline.

Se regeneraron HTML local y production. La vista previa sirve la misma variante production y el manifiesto JSON HTTP200. La publicación de esta revisión se realiza sobre gh-pages y se confirma comparando los bytes servidos por GitHub Pages con el artefacto, no sólo por el push. Siguen pendientes la colaboración con dos familiares reales y los dispositivos Apple/NFC físicos. El código de la web sigue siendo público; los datos remotos siguen protegidos por RLS, no por el bloqueo visual.

Publicación confirmada el 12 de noviembre: https://brendabernalsantin.github.io/wello/ respondió HTTP200 y su SHA256 coincidió exactamente con publicacion/index.html. Se verificó el marcador inicial de bloqueo en el HTML público. Los criterios de esta revisión quedan completados; la prueba de hogar con dos familiares reales sigue separada y pendiente.

## Pulido de Inicio · 12 de noviembre de 2026

Se retiraron los cinco textos indicados y el bloque de saludo horario, conservando el título, la fecha y los demás contenidos. El tono verde provenía de `mix-blend-mode:multiply` sobre el fondo menta y de un filtro de saturación, además de opacidad en móvil: se eliminan esos efectos sin sustituir el JPG original. La imagen se muestra sobre su fondo blanco con esquinas redondeadas, conservando sus colores y proporción.

Inicio muestra como máximo cuatro hábitos programados para hoy, personales y del hogar activo, con los pendientes antes que los cumplidos. Al marcar uno se muestra el siguiente pendiente; no se reordenan ni borran las colecciones guardadas. El botón Ver todos mis hábitos queda debajo y navega a Hábitos. Las cantidades parciales conservan su valor y sólo bajan al cumplirse la meta, sin inventar registros.

`npm test` pasó **107/107**, incluyendo cinco casos nuevos de selección, ámbitos, prioridad y cantidades. `node tests/home-ui.mjs` pasó **6/6** grupos: textos, cuatro filas, ilustración original sin filtros en 320/390/768/1440, completados al final y fuente intacta, recarga/botón inferior y captura de 0.75→2 litros con cambio de posición. El bloqueo de Google y el HTML independiente se comprobaron con **8/8** grupos de Auth y **12/12** flujos locales; la sintaxis se verificó después de la corrección final del tipo de botón. No se modificaron los módulos Mascotas ni Calendario ni se escribieron datos de prueba en Supabase.
