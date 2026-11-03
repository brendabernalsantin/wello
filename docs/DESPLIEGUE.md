# Despliegue de Wello en GitHub Pages + Supabase

El repositorio es https://github.com/brendabernalsantin/wello . Su código se hizo público con autorización explícita de la propietaria para poder utilizar Pages sin contratar un plan. Los registros personales y familiares no se suben al repositorio. La base real y sus pruebas están descritas en [SUPABASE.md](SUPABASE.md).

## Para la propietaria: ajustes desde tu navegador

Después de que la compilación final se haya enviado a la rama `gh-pages`, abre https://github.com/brendabernalsantin/wello/settings/pages y elige **Source → Deploy from a branch**, **Branch → gh-pages**, **Folder → / (root)**. Pulsa **Save**. No elijas `main` ni `docs`; el código fuente y la documentación no son la salida de publicación.

La dirección prevista es `https://brendabernalsantin.github.io/wello/`. Se considera publicada sólo cuando GitHub termine el despliegue y esa dirección sirva la compilación correcta con HTTP200. No se considera publicada por tener una rama o un commit.

Activa Google siguiendo [ACTIVAR-GOOGLE.md](ACTIVAR-GOOGLE.md). El callback de Google es `https://hpdefigzmgvqvgylvydh.supabase.co/auth/v1/callback`; Site URL y Redirect URL de Supabase son `https://brendabernalsantin.github.io/wello/`. No envíes Client Secret por chat ni lo subas al código.

## Desarrollo y validación

Con Node20 o compatible con el lockfile:

```bash
npm ci
npm run check
npm test
npm run export:html
npm start
```

`entregables/Wello.html` es autocontenido y local, sin SDK de Supabase ni necesidad de cuenta. La variante online se compila por separado:

```bash
npm run build:pages
```

La configuración publicable real se toma de `wello-public-config.json`; se pueden sustituir URL/clave mediante `WELLO_SUPABASE_URL` y `WELLO_SUPABASE_PUBLISHABLE_KEY`. Son valores públicos. La compilación rechaza HTTP en producción, claves administrativas y JWTs que no sean anon. `npm run build:preview` sirve para una variante online explícitamente sin servicios configurados.

## Enviar el artefacto a Pages

Después de guardar y verificar el código en main, ejecutar con autorización de publicación:

```bash
node scripts/publish-pages.mjs --repo=brendabernalsantin/wello
```

Ese script valida el destino origin, compila y envía únicamente `index.html`, `manus-routes.json` y `.nojekyll` a `gh-pages` sin force-push. Mantiene como padre la versión previa de esa rama y preserva otros archivos existentes. No cambia privacidad, plan ni ajustes de Pages. No publica respaldos, localStorage o fixtures.

Las actualizaciones futuras requieren repetir el build/push del artefacto. No hay un workflow automático instalado: se conserva una plantilla opcional en `docs/plantillas/pages-workflow.yml`, fuera de `.github/workflows`. No es necesario configurar variables de Actions para el método por rama. Tampoco se activa publicación de Manus al guardar el código.

## Verificación tras publicar

Comprobar el HTTP200 y que la configuración embebida apunte a la ref real de Supabase en modo production. Un usuario sin sesión no obtiene datos privados. Con Google real, revisar retorno a `/wello/`, cerrar sesión/cambiar cuenta, crear y compartir un hogar, invitar otra cuenta y comprobar una edición del súper desde ambos dispositivos. Los datos personales de cada cuenta no deben aparecer al otro miembro.

NFC usa `https://brendabernalsantin.github.io/wello/#super?accion=agregar`: abre un formulario, no registra una compra automáticamente. El destino de NFC o invitación se conserva a través de OAuth. El hardware NFC y Calendario Apple requieren prueba física separada.

Hasta activar Google y verificar dos cuentas reales, el código y los permisos probados no se presentan como una familia ya conectada.
