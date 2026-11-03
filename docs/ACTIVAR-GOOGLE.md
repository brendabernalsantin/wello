# Activar Google para Wello

El repositorio de código es https://github.com/brendabernalsantin/wello y el proyecto Supabase es https://supabase.com/dashboard/project/hpdefigzmgvqvgylvydh . Se creó en el plan gratuito. El código es público por autorización de su propietaria; los registros no se guardan en el repositorio.

Esta configuración se hace desde tu navegador. No envíes contraseñas ni el Client Secret por chat. La URL de retorno prevista es `https://brendabernalsantin.github.io/wello/`; no significa que ya esté publicado. Pages se habilita después de subir la compilación final y comprobar permisos.

## 1. Crear las credenciales en Google

1. Abre https://console.cloud.google.com/ e inicia sesión con tu cuenta de Google. Selecciona un proyecto que uses para Wello o crea uno nuevo llamado Wello. No actives facturación ni servicios de pago para estos pasos.
2. Abre **Google Auth Platform**. Si aparece **Get started / Comenzar**, configura el nombre de la app **Wello**, tu correo de soporte y tu correo de contacto. No publiques direcciones de otros familiares en el repositorio.
3. En **Audience / Público**, elige **External / Externo** si usarán cuentas Gmail personales. Mantén la app en **Testing / Prueba** mientras se valida. En **Test users / Usuarios de prueba**, añade tu correo y los correos de Google de los familiares que usarán Wello. Una persona no añadida puede quedar bloqueada durante este estado.
4. En **Data Access / Acceso a datos**, usa sólo los scopes `openid`, `https://www.googleapis.com/auth/userinfo.email` y `https://www.googleapis.com/auth/userinfo.profile`. No pidas Gmail, Drive ni permisos de calendario para esta app; la exportación iPhone descarga un archivo ICS, no accede a Google Calendar.
5. En **Clients / Clientes**, pulsa **Create client / Crear cliente** y elige **Web application / Aplicación web**. Nombre: **Wello web**.
6. En **Authorized JavaScript origins / Orígenes autorizados**, agrega exactamente:

   ```text
   https://brendabernalsantin.github.io
   ```

7. En **Authorized redirect URIs / URI de redirección autorizados**, agrega exactamente:

   ```text
   https://hpdefigzmgvqvgylvydh.supabase.co/auth/v1/callback
   ```

8. Pulsa **Create / Crear**. Conserva **Client ID** y **Client Secret** de forma privada. Si Google sólo muestra el Secret una vez, guárdalo en tu administrador de contraseñas. No lo subas a GitHub.

## 2. Pegar las credenciales en Supabase

1. Abre https://supabase.com/dashboard/project/hpdefigzmgvqvgylvydh/auth/providers . Según la interfaz, puede llamarse **Authentication → Sign In / Providers**.
2. Abre **Google** y activa **Enable Sign in with Google**.
3. Pega el **Client ID** en **Client IDs** y el **Client Secret** en **Client Secret**. Esos valores se quedan únicamente en Supabase. No actives **Skip nonce checks**.
4. Guarda. Si te pide revisar callback, debe coincidir con la URI del paso anterior.

## 3. Configurar el retorno de la app

En **Authentication → URL Configuration** (https://supabase.com/dashboard/project/hpdefigzmgvqvgylvydh/auth/url-configuration):

**Site URL**:

```text
https://brendabernalsantin.github.io/wello/
```

En **Redirect URLs**, agrega esa misma URL exacta, incluida la barra final, y guarda. No agregues comodines amplios para producción ni dejes como único retorno localhost. El callback de Google es el de Supabase; el retorno de la app es el de GitHub Pages: son dos URLs diferentes.

## 4. Comprobar el acceso

Cuando Pages esté publicado y verificado, abre la app, pulsa **Continuar con Google**, selecciona un correo añadido a usuarios de prueba y comprueba que vuelves a Wello. Después crea el hogar desde **Mis hogares** y genera una invitación dirigida al correo de otro familiar. Comparte ese enlace en privado. Esa persona entra con el mismo correo al que la invitaste y confirma la aceptación.

No compartas una sola cuenta entre todos: cada familiar debe iniciar sesión con la suya. Así sus registros personales no se mezclan y puedes revocar la membresía del hogar sin acceder a su Gym o mood.

## Si aparece un error

`redirect_uri_mismatch`: revisa el callback de Supabase en Google, no la URL de Pages. `access_denied` o app en prueba: revisa que el correo esté añadido en Test users. Vuelve a localhost o a una página equivocada: revisa Site URL y Redirect URLs. Google no habilitado: revisa que el proveedor se haya activado y guardado en Supabase. Invitación email mismatch: debe entrar el correo exacto invitado.

Fuentes oficiales: https://supabase.com/docs/guides/auth/social-sign-in/auth-google y https://supabase.com/docs/guides/auth/redirect-urls .
