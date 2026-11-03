-- Wello RLS smoke test / instrucciones ejecutables en un proyecto de prueba.
-- No se ejecuta automáticamente y no debe correrse contra producción.
-- Sustituye UUID_* por usuarios Auth reales y ejecuta cada bloque con una
-- sesión Supabase cuyo JWT tenga el claim indicado.

-- 1) Aplicar la migración antes de comenzar.
-- \i supabase/migrations/001_wello.sql

-- 2) Sesión owner: crear el hogar asigna owner desde auth.uid(); el cliente
-- no proporciona el rol.
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"UUID_OWNER","email":"owner@example.test"}',
  true
);
select public.create_household('Fixture Wello');
-- Guarda el UUID devuelto como UUID_HOUSEHOLD para las siguientes sesiones.
rollback;

-- 3) Repite la creación en una transacción controlada y conserva UUID_HOUSEHOLD.
-- El SQL Editor puede necesitar una sesión autenticada real para que auth.uid()
-- lea el claim. El propietario de la base no es evidencia de RLS porque puede
-- omitir políticas.

-- 4) Lecturas: owner y member deben ver el hogar; outsider no debe ver filas.
-- Ejecutar cada bloque por separado con UUID_HOUSEHOLD real.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"role":"authenticated","sub":"UUID_MEMBER"}', true);
-- select id, name from public.households where id = 'UUID_HOUSEHOLD';
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"role":"authenticated","sub":"UUID_OUTSIDER"}', true);
-- select count(*) = 0 as outsider_cannot_read
--   from public.household_records where household_id = 'UUID_HOUSEHOLD';
-- rollback;

-- 5) Acceso cruzado: aunque outsider conozca el UUID, la escritura debe fallar
-- por ACL/RLS y la RPC debe devolver HOUSEHOLD_MEMBERSHIP_REQUIRED.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"role":"authenticated","sub":"UUID_OUTSIDER"}', true);
-- select public.upsert_household_record(
--   'UUID_HOUSEHOLD', 'wello:state:household:fixture', '{"secret":true}'::jsonb,
--   3, 0, 'fixture-outsider-1'
-- );
-- rollback;

-- 6) No se permite que una inserción directa elija owner. La tabla no concede
-- INSERT a authenticated y la policy WITH CHECK también limita role = member.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"role":"authenticated","sub":"UUID_OWNER"}', true);
-- insert into public.household_members(household_id, user_id, role)
-- values ('UUID_HOUSEHOLD', 'UUID_OUTSIDER', 'owner');
-- rollback;

-- 7) CAS: dos sesiones deben leer revision 1. La primera guarda con esperado 1;
-- la segunda, también con esperado 1, debe devolver WELLO_REVISION_CONFLICT.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"role":"authenticated","sub":"UUID_OWNER"}', true);
-- select public.upsert_private_record(
--   'wello:state:personal', '{"version":3,"personal":{"moods":[]}}'::jsonb,
--   3, 0, 'fixture-private-first'
-- );
-- select public.upsert_private_record(
--   'wello:state:personal', '{"version":3,"personal":{"moods":[{"id":"mood:one"}]}}'::jsonb,
--   3, 1, 'fixture-private-second'
-- );
-- -- Reintento idempotente: no debe aumentar revision.
-- select public.upsert_private_record(
--   'wello:state:personal', '{"version":3,"personal":{"moods":[{"id":"mood:one"}]}}'::jsonb,
--   3, 1, 'fixture-private-second'
-- );
-- rollback;

-- 8) Compra + inventario: fuerza un conflicto en la segunda revisión y confirma
-- en una transacción real que ninguna de las dos actualizaciones persiste.
--
-- select public.record_purchase_and_inventory(
--   'UUID_HOUSEHOLD', '{"items":[]}'::jsonb, '{"lines":[]}'::jsonb,
--   0, 99, 'fixture-atomic-conflict'
-- );
-- -- Debe fallar y no dejar una fila de inventario nueva.

-- 9) Invitaciones: crea una propuesta como owner, verifica que el token no se
-- almacena en claro, revoca/consume una sola vez y prueba expiración. El RPC no
-- manda correo y su rol siempre es member.
--
-- select public.create_household_invite('UUID_HOUSEHOLD', 'member@example.test', now() + interval '1 hour');
-- select id, email_hash, token_hash, expires_at, role, consumed_at, revoked_at
--   from public.household_invites where household_id = 'UUID_HOUSEHOLD';
