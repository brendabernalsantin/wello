# Validación de la primera entrega de Wello

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
