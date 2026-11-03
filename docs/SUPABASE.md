# Supabase para Wello

Esta integración es la variante en línea. La variante local no importa `src/cloud.js`, no carga `@supabase/supabase-js` y no necesita una cuenta. El bundle online se agrega por separado después del bundle de la app y expone `window.WelloCloud`.

## Estado de esta entrega

Quedaron preparados el cliente oficial `@supabase/supabase-js` con Auth Google y flujo PKCE, la validación de `window.WELLO_CONFIG`, el namespace por cuenta, la migración PostgreSQL y el diseño de sincronización CAS. No se configuró un proyecto externo, no se inició sesión con Google y no se ejecutaron las políticas contra una base real en este entorno.

Los roles owner/member, la creación y revocación de invitaciones, la eliminación de cuenta, las reglas de fusión y el proveedor que enviaría invitaciones siguen siendo propuestas. Confirma esas decisiones antes de habilitar datos reales.

## 1. Crear el proyecto

1. En Supabase crea un proyecto llamado **Wello** y conserva el `Project URL` y la clave pública `publishable` (o la clave legacy `anon`).
2. En el SQL Editor ejecuta `supabase/migrations/001_wello.sql` completo. Como alternativa, aplica la migración con la herramienta de CLI que ya use el repositorio; no hace falta guardar credenciales en este proyecto.
3. No copies una `service_role`, una `sb_secret_...` ni la contraseña de la base al frontend, a Pages, a `.env`, a `window.WELLO_CONFIG` o al repositorio.

La migración usa `auth.users` como referencia, hogares UUID, membresías owner/member, invitaciones con hash y expiración, registros privados JSON y registros de hogar JSON. El cliente no puede elegir el rol `owner`: solo `create_household()` crea el hogar y su membresía owner usando `auth.uid()`.

## 2. Configurar Google OAuth

En Google Cloud Console:

1. Selecciona o crea un proyecto para Wello.
2. Configura la pantalla de consentimiento OAuth y agrega los datos de la aplicación según el estado de publicación que corresponda.
3. Crea un cliente OAuth de tipo **Web application**.
4. En **Authorized JavaScript origins** agrega el origen de Pages, por ejemplo `https://TU_USUARIO.github.io`, y el origen local que se use para una preview, por ejemplo `http://localhost:3000`.
5. En **Authorized redirect URIs** agrega exactamente el callback de Supabase:

   ```text
   https://TU-PROJECT-REF.supabase.co/auth/v1/callback
   ```

En Supabase abre **Authentication → Providers → Google**, activa Google y pega el Client ID y Client Secret de Google. El secreto queda en Supabase; no se publica ni se copia a GitHub Actions.

En **Authentication → URL Configuration** configura:

```text
Site URL:
https://TU_USUARIO.github.io/primera-app/

Additional Redirect URLs:
https://TU_USUARIO.github.io/primera-app/
http://localhost:3000/
```

Usa el puerto real de `npm start` o `npm run preview:pages` si es distinto. Mantén la barra final y el subdirectorio `/primera-app/`: el cliente conserva el retorno relativo a esa base y limpia los parámetros OAuth al terminar.

## 3. Configuración pública del build

Copia `.env.example` a un archivo de entorno local que no se publique y define:

```text
WELLO_SUPABASE_URL=https://TU-PROJECT-REF.supabase.co
WELLO_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
WELLO_DEPLOY_MODE=preview
```

El build convierte esos valores en:

```js
window.WELLO_CONFIG = {
  url: 'https://TU-PROJECT-REF.supabase.co',
  key: 'sb_publishable_TU_CLAVE_PUBLICA',
  mode: 'preview'
};
```

En producción el modo debe ser `production`, la URL debe ser HTTPS y deben existir ambas variables. Si falta configuración o la clave parece privilegiada, el botón de Google permanece deshabilitado; no aparece un botón de configuración que pueda inducir a pegar secretos. La interfaz siempre ofrece **Continuar en modo local**.

## 4. Sesión y datos

El cliente configura `flowType: 'pkce'` y usa `signInWithOAuth({ provider: 'google' })` seguido de `exchangeCodeForSession(code)`. El destino NFC permitido es únicamente `#super?accion=agregar`; se guarda temporalmente durante OAuth, se restaura al callback relativo de `/primera-app/`, se abre el formulario y se consume para que un recargo no lo repita.

Al autenticar una cuenta, Wello cambia al namespace de esa cuenta, pero no importa el namespace local ni aplica blobs remotos automáticamente. La acción **Sincronizar ahora** es manual. Si existe una revisión remota distinta, el CAS rechaza el guardado, conserva el estado local y muestra conflicto para revisión; no hay last-write-wins silencioso. Cerrar sesión elimina el cache activo, vacía el estado de la capa cloud y vuelve a mostrar login sin exponer datos de otra cuenta.

Los registros generales se modelan como:

- `private_records`: un blob JSON personal por usuario (`wello:state:personal`).
- `household_records`: blobs JSON por UUID real de hogar (`wello:state:household:<uuid>`).
- `version`: versión de modelo Wello, actualmente 3.
- `revision`: contador CAS que debe coincidir antes de cada actualización.

Un id local de hogar no autoriza una fila remota. Primero crea un hogar real con `WelloCloud.createHousehold()`, confirma el UUID y registra el mapeo explícito con `setHouseholdMapping(localId, remoteId)`. La base vuelve a comprobar membresía aunque la solicitud se construya fuera de la interfaz.

## 5. Invitaciones y compras atómicas

`create_household_invite()` genera un token con hash, expiración y uso único, pero no manda correos. Es una **propuesta**: antes de producción hay que confirmar quién puede invitar, qué ocurre al revocar y qué proveedor de correo se usará. El rol de una invitación siempre se limita a `member`.

`record_purchase_and_inventory()` actualiza los registros de inventario y compra dentro de una única función PostgreSQL. Si el segundo CAS falla, la transacción revierte ambas operaciones. El `operation_id` evita duplicados al reintentar la misma acción. La política de precios, unidades y revisión de líneas sigue siendo parte del modelo de dominio de la app y debe confirmarse con datos reales.

## 6. Probar RLS con fixtures (instrucciones, no ejecutado aquí)

La prueba debe ejecutarse en un proyecto de prueba o dentro de una transacción que se revierta. El SQL Editor conectado como propietario de la base puede saltarse RLS, por lo que hay que usar el rol `authenticated` y claims de prueba, o ejecutar el fixture desde el cliente Supabase con dos cuentas de prueba.

Esquema recomendado:

1. Crea dos usuarios de prueba en Auth: `owner`, `member`, y un tercero `outsider`; anota sus UUID.
2. Ejecuta la migración.
3. En una transacción de prueba configura claims, por ejemplo:

   ```sql
   begin;
   set local role authenticated;
   select set_config(
     'request.jwt.claims',
     '{"role":"authenticated","sub":"UUID_OWNER","email":"owner@example.test"}',
     true
   );
   select public.create_household('Casa de prueba');
   -- Guarda el UUID devuelto para las siguientes comprobaciones.
   rollback;
   ```

4. Repite con `UUID_MEMBER` y `UUID_OUTSIDER` mediante sesiones reales de prueba. Comprueba que owner/member leen los registros del hogar, que outsider obtiene cero filas y que una escritura con otro `household_id` falla.
5. Comprueba que un `insert` directo en `household_members` no puede elegir `role = 'owner'`, que cambiar `created_by` falla y que solo la RPC de creación produce el propietario.
6. Comprueba el CAS: dos sesiones leen `revision = 1`; la primera guarda con `p_expected_revision = 1`; la segunda debe recibir `WELLO_REVISION_CONFLICT` con `p_expected_revision = 1`.
7. Repite el mismo `p_operation_id` para verificar que no aumenta la revisión ni duplica el registro.
8. Llama `record_purchase_and_inventory()` con un inventario válido y una compra que fuerce conflicto: ninguna de las dos filas debe quedar actualizada.
9. Prueba una invitación con fecha pasada, token alterado, token consumido y revocación. Ninguno debe agregar una membresía.

`supabase/tests/rls.sql` contiene una lista ejecutable de aserciones y marcadores para adaptar esos UUID a un entorno de prueba. No se declara que esas pruebas hayan corrido hasta observar resultados de una base Supabase real.
