# Despliegue de Wello

Esta guía separa el HTML local, la preview y la variante online. En el estado actual no hay un proyecto Supabase ni una publicación verificada: la configuración externa y las credenciales las debe completar la persona propietaria de esas cuentas.

## Antes de empezar

Requisitos del repositorio: Node 20 o compatible con el lockfile, npm y una cuenta de GitHub para Pages. La dependencia online es el SDK oficial `@supabase/supabase-js`; queda en el bundle cloud separado y no se carga al abrir `entregables/Wello.html` desde disco.

No pongas secretos en el frontend. `WELLO_SUPABASE_URL` y `WELLO_SUPABASE_PUBLISHABLE_KEY` son valores públicos de build. El Client Secret de Google, `service_role`, `sb_secret_...`, contraseñas y tokens administrativos solo viven en Supabase o en el proveedor de secretos correspondiente.

## Comprobación local

Desde la raíz del repositorio:

```bash
npm ci
npm test
npm run check
npm run export:html
npm start
```

Para revisar la variante estática de Pages antes de publicar:

```bash
npm run preview:pages
```

El flujo local debe funcionar sin cuenta y sin red. La entrada **Continuar en modo local** es explícita. La variante local no importa `src/cloud.js`, no crea un cliente Supabase y no simula una sesión de Google. Las simulaciones de autenticación, si se agregan a una prueba, deben llamarse con una función opt-in de test; no son una autenticación real.

## Preparar Supabase y Google

Sigue [`docs/SUPABASE.md`](SUPABASE.md): crea el proyecto Wello, aplica `supabase/migrations/001_wello.sql`, configura Google y agrega como callback de Google:

```text
https://TU-PROJECT-REF.supabase.co/auth/v1/callback
```

En Supabase Auth agrega como Site URL y Redirect URL la base publicada, por ejemplo:

```text
https://TU_USUARIO.github.io/primera-app/
```

El cliente usa OAuth PKCE, vuelve a esa base relativa, conserva `#super?accion=agregar` durante el retorno y consume el destino una sola vez. La URL NFC completa debe ser HTTPS:

```text
https://TU_USUARIO.github.io/primera-app/#super?accion=agregar
```

La web abre el formulario de **Agregar al súper**; no escribe una compra sin intervención y no necesita Web NFC.

## Build de Pages con configuración pública

Para una compilación local de producción, proporciona variables sin subir el archivo:

```bash
WELLO_SUPABASE_URL='https://TU-PROJECT-REF.supabase.co' \
WELLO_SUPABASE_PUBLISHABLE_KEY='sb_publishable_TU_CLAVE_PUBLICA' \
WELLO_DEPLOY_MODE=production \
npm run build:pages
```

La compilación de `production` debe rechazar configuración ausente, HTTP y claves privilegiadas. `preview` puede usar una URL HTTP local para desarrollo; el sitio publicado debe usar HTTPS. Confirma en el HTML generado que solo exista `window.WELLO_CONFIG={url,key,mode}` y que no haya Client Secret, `service_role` ni `sb_secret_`.

## Publicación manual con GitHub Actions

El workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) solo se ejecuta con **Run workflow**. Antes de ejecutarlo:

1. En el repositorio habilita Pages con **GitHub Actions** como fuente.
2. En **Settings → Secrets and variables → Actions → Variables** crea `WELLO_SUPABASE_URL` y `WELLO_SUPABASE_PUBLISHABLE_KEY`. Son configuración pública; no uses aquí una clave administrativa.
3. Confirma que el repositorio sea realmente el que publicará bajo `/primera-app/`, o ajusta el nombre del repositorio y las Redirect URLs en Supabase antes de publicar.
4. Ejecuta manualmente la acción. Esta correrá, en orden, `npm ci`, `npm test`, `npm run check`, `npm run build:pages`, preparará `dist/` y publicará Pages.

La acción no configura Google, no aplica migraciones y no puede crear credenciales externas. Si las variables no existen, la compilación de producción debe fallar en vez de generar una pantalla que parezca conectada.

## Revisión después del build

En el sitio publicado verifica de forma manual:

- la app local conserva su funcionamiento sin sesión;
- en línea aparece el banner de estado claro;
- con configuración ausente el botón Google está deshabilitado y existe la entrada de modo local;
- Google vuelve a `/primera-app/` y elimina los parámetros OAuth;
- cerrar sesión muestra login y no el cache de la cuenta anterior;
- una cuenta no puede leer un hogar cuyo UUID conoce pero donde no es miembro;
- **Sincronizar ahora** es manual, y un conflicto conserva el estado local para revisión;
- la URL NFC abre el formulario una sola vez.

No se ha probado aquí acceso Google real, sincronización entre dos teléfonos, RLS contra una base Supabase, una publicación de Pages ni un iPhone físico. Esas validaciones requieren las cuentas, las variables y los dispositivos de la persona propietaria.

## Comandos de producción que requieren credenciales/configuración

```bash
npm ci
npm test
npm run check
WELLO_SUPABASE_URL='https://TU-PROJECT-REF.supabase.co' \
WELLO_SUPABASE_PUBLISHABLE_KEY='sb_publishable_TU_CLAVE_PUBLICA' \
WELLO_DEPLOY_MODE=production \
npm run build:pages
```

La ejecución de esos comandos aquí no implica que el proyecto esté publicado. La acción de Pages y la configuración de Supabase se deben confirmar en sus respectivas cuentas.
