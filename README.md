# Wello

Aplicación de bienestar personal y del hogar en español de México. Reconstrucción desde un proyecto limpio a partir del prompt, las capturas y los recursos aportados. No contiene cargas históricas privadas precargadas ni requiere cuentas para su variante local.

## Usar sin instalar

Abre `entregables/Wello.html` en Chrome en tu computadora. Es un único archivo autocontenido, con imágenes, estilos y JavaScript incrustados. Las funciones locales guardan en el almacenamiento del navegador y funcionan sin conexión. Exporta copias en **Mis datos**: ese almacenamiento no sustituye un respaldo. La guía paso a paso está en [docs/GUIA.md](docs/GUIA.md).

La interfaz integra Inicio, Hábitos, Mascotas, Alimentos, Calendario y Gym, más hogares locales y Mis datos. Gym contiene las cuatro rutinas y 38 entradas exactas del anexo A. Los objetivos del plan no se convierten en repeticiones realizadas ni cargas históricas.

## Desarrollo y exportación

Node 20 o posterior. La dependencia de build es esbuild; Google/Supabase solo forma parte del bundle online.

```bash
npm ci
npm test
npm run check
npm run export:html
npm start
```

`npm start` genera el HTML local y lo sirve en el puerto 3000. Si modificas la fuente, vuelve a ejecutar `npm run export:html` y recarga. La app no depende del servidor para abrir su HTML descargado.

```bash
npm run build:preview
npm run preview:pages
```

Eso genera y sirve `dist/index.html`, una compilación estática con acceso Google pendiente de configuración y un botón explícito de modo local. No presenta una sesión simulada como autenticación real.

```bash
WELLO_SUPABASE_URL=https://TU-PROJECT-REF.supabase.co \
WELLO_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA \
npm run build:pages
```

Producción rechaza configuración ausente y claves administrativas. Las rutas y assets son compatibles con `/primera-app/`. La guía [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) explica Google, Supabase y GitHub Pages. El workflow `.github/workflows/pages.yml` se ejecuta manualmente. No se ha cambiado ni publicado `brendabernalsantin/primera-app`.

## Estructura

- `src/core.js`: fechas locales, ámbitos, guardado, validación y migraciones.
- `src/app.js`: navegación, Inicio, hogares, copias y diálogos.
- `src/modules/`: Gym, Hábitos/mood, Mascotas, Alimentos y Calendario.
- `src/plan.js`: plan público de entrenamiento con IDs estables.
- `src/cloud.js` y `cloud-domain.js`: cliente Supabase oficial, PKCE, namespaces, NFC y sincronización manual por revisiones.
- `assets/`: recursos locales aportados y recortes de referencia.
- `scripts/`: build, servidor y comprobación de sintaxis.
- `tests/`: dominio y flujos de interfaz automatizados.
- `supabase/`: migración de hogares, membresías, políticas RLS y casos transaccionales.
- `entregables/Wello.html`: versión local sin SDK Auth.
- `dist/`: vista previa estática online, no publicación.

## Privacidad y compatibilidad

Gym, mood, hábitos personales y citas son personales. Mascotas, inventario, súper, compras, tiendas y hábitos familiares pertenecen al hogar activo. La nube usa caché separada por cuenta, mapeo explícito de hogares autorizados y no sube el almacenamiento local de forma automática.

Las copias `forma-gym-v1` y `forma-home-v1` tienen un adaptador estructural y migraciones aditivas. No se recibieron archivos originales reales de esos formatos: no se declara una compatibilidad histórica completa sin probarlos. Se valida toda la copia antes de escribir; los duplicados conservan el dato local. Los IDs ambiguos entre un hábito personal y del hogar se rechazan para revisión, no se reasignan silenciosamente.

El JSON privado de cargas verificadas se entrega fuera del repositorio. Importarlo exige elegirlo y revisar observaciones. No distribuyas ese JSON ni tus respaldos junto a los assets de Pages.

## Colaboración: fase preparada, no desplegada

[docs/SUPABASE.md](docs/SUPABASE.md) detalla la propuesta propietario/miembro, invitaciones expirables de un uso, pertenencia validada en SQL y guardado CAS. La interfaz local no es un hogar compartido. La capa online incluye funciones y RPCs, pero la configuración de roles, la gestión completa de membresías y la colaboración entre dispositivos requieren revisión, configuración y pruebas reales. No se configura eliminación de cuenta ni fusión destructiva.

## Pruebas y límites

`npm test` comprueba lógica y casos simulados; `npm run check` revisa sintaxis. `npm run test:ui` requiere Chrome/Chromium y Playwright; la ruta del ejecutable usada aquí es `/usr/bin/chromium`. Las pruebas abren el HTML por `file://`, verifican persistencia y recarga sin red y comprueban los anchos solicitados. El resultado final se registra en [docs/VALIDACION.md](docs/VALIDACION.md).

No se ha probado un iPhone físico, Google real, una publicación Pages, RLS en una base Supabase real ni sincronización entre teléfonos. La búsqueda real Overpass respondió HTTP 406 desde este entorno; se validaron las respuestas simuladas y la alternativa manual.

## Recursos

Iconos ilustrados de Icons8 aportados por la usuaria, con atribución dentro de Mis datos. Caritas y planta recortadas de referencias aportadas. Iconos UI Lucide bajo ISC. Las ilustraciones de referencia no aportaban comprobantes de licencia: verifica los derechos antes de una publicación comercial. Las fuentes de configuración están en [docs/FUENTES.md](docs/FUENTES.md).
