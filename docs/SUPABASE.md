# Supabase real para Wello

## Estado al 3 de noviembre de 2026

El proyecto **Wello**, ref `hpdefigzmgvqvgylvydh`, está creado y activo en **brendabernalsantin's Org**, región us-east-1, con cotización aceptada de **$0 al mes** y sin extras o planes de pago autorizados. API: https://hpdefigzmgvqvgylvydh.supabase.co . Panel: https://supabase.com/dashboard/project/hpdefigzmgvqvgylvydh .

La migración `supabase/migrations/001_wello.sql` se aplicó correctamente. El fixture `supabase/tests/production-rls.sql` ejecutó **45 comprobaciones** en la base real usando roles `authenticated` y `anon`, tres usuarios sintéticos y dos hogares, con `ROLLBACK`. Se comprobaron membresías, datos personales privados, invitaciones verificadas por correo, expiración, revocación, uso único, CAS e idempotencia. No se enviaron correos ni se dejaron registros de prueba. Esto no equivale a una sesión real de Google ni a dos teléfonos físicos conectados.

El proveedor Google todavía requiere configuración de la propietaria. Sigue [ACTIVAR-GOOGLE.md](ACTIVAR-GOOGLE.md). No se debe poner Client Secret, service-role, contraseña o token administrativo en el frontend, en este repositorio ni en Pages.

## Qué se comparte

`private_records` guarda el estado personal de la cuenta: Gym, hábitos personales, moods y citas. RLS restringe la lectura a `auth.uid()` y la escritura sólo se realiza por `upsert_private_record`, con revisión esperada y una operación idempotente.

`household_records` guarda el estado familiar: mascotas, fotos raster optimizadas, celo, cuidados y trucos; hábitos del hogar; inventario, súper, tiendas y compras. Sólo una membresía vigente permite leer o guardar ese hogar. El blob debe usar el UUID del hogar en la clave y en el contenido; no acepta estado personal en su nivel superior. La interfaz pide una confirmación antes de compartir un hogar local.

`households` y `household_members` definen los permisos reales. Quien crea el hogar se convierte en owner mediante una RPC que usa `auth.uid()`; el cliente no elige `created_by` ni asciende su rol. Owner puede renombrar, invitar, revocar enlaces y retirar miembros. Member edita los datos familiares y puede salir; no administra permisos. Las RPC de salida y retiro no eliminan al owner ni dejan el hogar sin propietario.

Las fotos de mascotas son parte del blob privado del hogar, no archivos públicos del repositorio. Exportar una copia genera un JSON privado en el dispositivo: no debe subirse a GitHub.

## Invitaciones

Owner crea un enlace dirigido a un correo concreto. Caduca a los 7 días por defecto, es de uso único y se puede revocar. El backend almacena un hash del token y verifica contra `auth.users.email` confirmado, no contra un campo del formulario. La persona entra con Google y confirma la aceptación; abrir el enlace no la acepta automáticamente.

Wello no envía correo automáticamente. La persona que invita copia y comparte el enlace por un canal privado. Un enlace revocado, vencido, consumido o dirigido a otro correo no concede acceso. `list_household_invites` muestra metadatos al owner sin exponer hashes de tokens.

## Sincronización y concurrencia

El cliente guarda una copia por cuenta en localStorage y separa mappings/baselines por usuario. Una edición agenda sincronización automática; además se refresca al volver a la app, recuperar red y cada 15 segundos mientras la página está visible. El modo local no publica nada automáticamente.

Cada escritura usa revisión CAS y un operation ID fresco. Las RPC usan locks para serializar carreras, incluido el primer insert, y un retry idéntico devuelve el resultado guardado. Reutilizar un ID con otro contenido, ámbito o revisión se rechaza. El cliente usa fusión de tres vías para cambios distintos; editar y borrar el mismo registro o modificar el mismo valor exige resolver un conflicto. No se usa last-write-wins silencioso. Antes de resolver, se conserva una copia automática por cuenta.

La compra y transferencia a inventario se empaquetan juntas en el estado de hogar, con las reglas de idempotencia de dominio. La RPC legacy `record_purchase_and_inventory` conserva una transacción atómica para sus dos claves históricas, pero la interfaz actual sincroniza el blob de hogar completo.

## Seguridad y avisos revisados

Los clientes tienen SELECT filtrado por RLS sobre hogares, membresías y blobs. No tienen INSERT/UPDATE/DELETE directos: las escrituras pasan por RPCs que validan sesión, rol, ámbito y CAS. `cloud_operations` y `household_invites` tienen RLS sin política y ningún grant de lectura directa: ese cierre es intencional.

Supabase Advisor reportó dos INFO de [RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) en esas tablas cerradas y trece WARN de [SECURITY DEFINER ejecutable por autenticados](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Las RPC públicas necesitan esa condición para aplicar transacciones sin otorgar escritura directa; sus helpers internos no están concedidos al cliente, el search_path está fijado y los permisos se comprueban dentro de cada RPC. No se eliminan esos avisos concediendo acceso amplio ni se afirma que el Advisor esté sin advertencias.

Se verificó por HTTP que visitantes con la clave publicable obtienen rechazo de acceso a `private_records` y `household_records`. La clave publicable incluida en `wello-public-config.json` es pública por diseño y no concede acceso por sí sola. No se incluyen claves administrativas.

## Repetir las pruebas

El fixture es DML transaccional sin DDL ni correos. Debe ejecutarse con una sesión administrativa autorizada capaz de `SET ROLE`, pues cambia temporalmente a los roles de cliente para probar RLS. No basta probar todo como postgres: ese rol puede saltar RLS. Termina siempre en rollback; las comprobaciones externas deben confirmar cero fixtures persistidos.

Queda pendiente probar Google real, el retorno OAuth/URLs, aceptación con dos familiares reales, sincronización entre dispositivos y el iPhone físico. Esas comprobaciones requieren que la propietaria active Google y que ambas personas entren con sus propias cuentas.
