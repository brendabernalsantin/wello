-- Wello / Supabase
-- Diseño propuesto para revisión antes de producción. No asigna propietarios
-- desde el cliente: create_household inserta el owner con auth.uid().
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check (char_length(trim(email)) between 3 and 320),
  email_hash text not null,
  token_hash text not null unique,
  role text not null default 'member' check (role = 'member'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists household_invites_active_email
  on public.household_invites (household_id, email_hash)
  where consumed_at is null and revoked_at is null;

create table if not exists public.private_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null check (char_length(record_key) between 1 and 160),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 3 check (version > 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_key)
);

create table if not exists public.household_records (
  household_id uuid not null references public.households(id) on delete cascade,
  record_key text not null check (char_length(record_key) between 1 and 160),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 3 check (version > 0),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (household_id, record_key)
);

-- La tabla evita duplicados al reintentar una operación desde dos teléfonos.
create table if not exists public.cloud_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null check (char_length(operation_id) between 8 and 240),
  operation text not null check (char_length(operation) between 1 and 80),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'member')
  );
$$;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role = 'owner'
  );
$$;

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_name text := trim(coalesce(p_name, ''));
 begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'HOUSEHOLD_NAME_INVALID' using errcode = '22023'; end if;
  insert into public.households (name, created_by)
  values (v_name, v_user)
  returning id into v_household;
  -- El rol owner solo se asigna aquí, nunca desde un parámetro del cliente.
  insert into public.household_members (household_id, user_id, role)
  values (v_household, v_user, 'owner');
  return v_household;
 end;
$$;

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_email text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz := least(coalesce(p_expires_at, now() + interval '7 days'), now() + interval '30 days');
 begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if not public.is_household_owner(p_household_id) then raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501'; end if;
  if char_length(v_email) < 3 or position('@' in v_email) < 2 then raise exception 'INVITE_EMAIL_INVALID' using errcode = '22023'; end if;
  if v_expires <= now() then raise exception 'INVITE_EXPIRY_INVALID' using errcode = '22023'; end if;
  insert into public.household_invites (household_id, email, email_hash, token_hash, expires_at, created_by)
  values (
    p_household_id,
    v_email,
    encode(digest(v_email, 'sha256'), 'hex'),
    encode(digest(v_token, 'sha256'), 'hex'),
    v_expires,
    v_user
  )
  returning id into v_id;
  -- No se envía correo. El token se muestra una vez para que un proveedor
  -- externo, aún no decidido, pueda entregar la propuesta.
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires, 'role', 'member');
 end;
$$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_count integer;
 begin
  update public.household_invites hi
     set revoked_at = now()
   where hi.id = p_invite_id
     and hi.revoked_at is null
     and public.is_household_owner(hi.household_id);
  get diagnostics v_count = row_count;
  return v_count = 1;
 end;
$$;

create or replace function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_user uuid := auth.uid();
  v_invite public.household_invites;
  v_email text;
 begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_invite
    from public.household_invites
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if not found or v_invite.revoked_at is not null or v_invite.consumed_at is not null or v_invite.expires_at <= now() then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = '22023';
  end if;
  select lower(email) into v_email from auth.users where id = v_user;
  if v_email is null or v_email <> v_invite.email then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = '42501';
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_user, 'member')
  on conflict (household_id, user_id) do nothing;
  update public.household_invites set consumed_at = now() where id = v_invite.id;
  return v_invite.household_id;
 end;
$$;

create or replace function public.upsert_private_record(
  p_record_key text,
  p_data jsonb,
  p_version integer default 3,
  p_expected_revision bigint default 0,
  p_operation_id text default null
)
returns public.private_records
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_user uuid := auth.uid();
  v_current public.private_records;
  v_operation jsonb;
 begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_operation_id is not null then
    select result into v_operation from public.cloud_operations where user_id = v_user and operation_id = p_operation_id and operation = 'private_record';
    if v_operation is not null then
      select * into v_current from public.private_records where user_id = v_user and record_key = p_record_key;
      return v_current;
    end if;
  end if;
  select * into v_current from public.private_records where user_id = v_user and record_key = p_record_key for update;
  if v_current is not null and v_current.revision <> p_expected_revision then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_current is null and p_expected_revision <> 0 then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_current is null then
    insert into public.private_records (user_id, record_key, data, version, revision)
    values (v_user, p_record_key, coalesce(p_data, '{}'::jsonb), coalesce(p_version, 3), 1)
    returning * into v_current;
  else
    update public.private_records
       set data = coalesce(p_data, '{}'::jsonb), version = coalesce(p_version, 3), revision = p_expected_revision + 1, updated_at = now()
     where user_id = v_user and record_key = p_record_key
    returning * into v_current;
  end if;
  if p_operation_id is not null then
    insert into public.cloud_operations (user_id, operation_id, operation, result)
    values (v_user, p_operation_id, 'private_record', jsonb_build_object('row', to_jsonb(v_current)))
    on conflict (user_id, operation_id) do nothing;
  end if;
  return v_current;
 end;
$$;

create or replace function public.upsert_household_record(
  p_household_id uuid,
  p_record_key text,
  p_data jsonb,
  p_version integer default 3,
  p_expected_revision bigint default 0,
  p_operation_id text default null
)
returns public.household_records
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_user uuid := auth.uid();
  v_current public.household_records;
  v_operation jsonb;
 begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if not public.is_household_member(p_household_id) then raise exception 'HOUSEHOLD_MEMBERSHIP_REQUIRED' using errcode = '42501'; end if;
  if p_operation_id is not null then
    select result into v_operation from public.cloud_operations where user_id = v_user and operation_id = p_operation_id and operation = 'household_record';
    if v_operation is not null then
      select * into v_current from public.household_records where household_id = p_household_id and record_key = p_record_key;
      return v_current;
    end if;
  end if;
  select * into v_current from public.household_records where household_id = p_household_id and record_key = p_record_key for update;
  if v_current is not null and v_current.revision <> p_expected_revision then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_current is null and p_expected_revision <> 0 then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_current is null then
    insert into public.household_records (household_id, record_key, data, version, revision, updated_by)
    values (p_household_id, p_record_key, coalesce(p_data, '{}'::jsonb), coalesce(p_version, 3), 1, v_user)
    returning * into v_current;
  else
    update public.household_records
       set data = coalesce(p_data, '{}'::jsonb), version = coalesce(p_version, 3), revision = p_expected_revision + 1, updated_by = v_user, updated_at = now()
     where household_id = p_household_id and record_key = p_record_key
    returning * into v_current;
  end if;
  if p_operation_id is not null then
    insert into public.cloud_operations (user_id, operation_id, operation, result)
    values (v_user, p_operation_id, 'household_record', jsonb_build_object('row', to_jsonb(v_current)))
    on conflict (user_id, operation_id) do nothing;
  end if;
  return v_current;
 end;
$$;

create or replace function public.record_purchase_and_inventory(
  p_household_id uuid,
  p_inventory_data jsonb,
  p_purchase_data jsonb,
  p_expected_inventory_revision bigint default 0,
  p_expected_purchase_revision bigint default 0,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
 declare
  v_inventory public.household_records;
  v_purchase public.household_records;
  v_operation text := coalesce(p_operation_id, encode(gen_random_bytes(12), 'hex'));
 begin
  -- Ambas llamadas están dentro de la misma función/trasacción: si la segunda
  -- falla por CAS o membresía, la primera también se revierte.
  v_inventory := public.upsert_household_record(
    p_household_id, 'wello:household:inventory', coalesce(p_inventory_data, '{}'::jsonb), 3,
    p_expected_inventory_revision, v_operation || ':inventory'
  );
  v_purchase := public.upsert_household_record(
    p_household_id, 'wello:household:purchases', coalesce(p_purchase_data, '{}'::jsonb), 3,
    p_expected_purchase_revision, v_operation || ':purchase'
  );
  return jsonb_build_object('inventory', to_jsonb(v_inventory), 'purchase', to_jsonb(v_purchase), 'atomic', true, 'idempotent', true);
 end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.private_records enable row level security;
alter table public.household_records enable row level security;
alter table public.cloud_operations enable row level security;

-- Lecturas privadas y de hogares. Todas las escrituras importantes pasan por
-- las funciones CAS anteriores; las políticas WITH CHECK siguen cubriendo
-- cualquier acceso directo que se habilite durante una prueba.
create policy households_select_member on public.households
  for select to authenticated using (public.is_household_member(id));
create policy households_update_owner on public.households
  for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id) and created_by = auth.uid());

create policy household_members_select_member on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy household_members_insert_owner on public.household_members
  for insert to authenticated
  with check (public.is_household_owner(household_id) and role = 'member');
create policy household_members_update_owner on public.household_members
  for update to authenticated
  using (public.is_household_owner(household_id) and role = 'member')
  with check (public.is_household_owner(household_id) and role = 'member');
create policy household_members_delete_owner on public.household_members
  for delete to authenticated
  using (public.is_household_owner(household_id) and role = 'member');

create policy household_invites_select_owner on public.household_invites
  for select to authenticated using (public.is_household_owner(household_id));

create policy private_records_select_own on public.private_records
  for select to authenticated using (user_id = auth.uid());
create policy private_records_insert_own on public.private_records
  for insert to authenticated with check (user_id = auth.uid());
create policy private_records_update_own on public.private_records
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy private_records_delete_own on public.private_records
  for delete to authenticated using (user_id = auth.uid());

create policy household_records_select_member on public.household_records
  for select to authenticated using (public.is_household_member(household_id));
create policy household_records_insert_member on public.household_records
  for insert to authenticated
  with check (public.is_household_member(household_id) and updated_by = auth.uid());
create policy household_records_update_member on public.household_records
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and updated_by = auth.uid());
create policy household_records_delete_member on public.household_records
  for delete to authenticated using (public.is_household_member(household_id));

-- El rol anon no recibe acceso. Membresías/propietarios no se escriben desde
-- PostgREST: solo las funciones anteriores, con SECURITY DEFINER, lo hacen.
revoke all on public.households, public.household_members, public.household_invites, public.private_records, public.household_records, public.cloud_operations from anon;
revoke all on public.households, public.household_members, public.household_invites, public.cloud_operations from authenticated;
grant select on public.households, public.household_members, public.household_invites to authenticated;
grant select, insert, update, delete on public.private_records, public.household_records to authenticated;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
revoke all on function public.create_household(text) from public;
revoke all on function public.create_household_invite(uuid, text, timestamptz) from public;
revoke all on function public.revoke_household_invite(uuid) from public;
revoke all on function public.accept_household_invite(text) from public;
revoke all on function public.upsert_private_record(text, jsonb, integer, bigint, text) from public;
revoke all on function public.upsert_household_record(uuid, text, jsonb, integer, bigint, text) from public;
revoke all on function public.record_purchase_and_inventory(uuid, jsonb, jsonb, bigint, bigint, text) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household_invite(uuid, text, timestamptz) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.upsert_private_record(text, jsonb, integer, bigint, text) to authenticated;
grant execute on function public.upsert_household_record(uuid, text, jsonb, integer, bigint, text) to authenticated;
grant execute on function public.record_purchase_and_inventory(uuid, jsonb, jsonb, bigint, bigint, text) to authenticated;

commit;
