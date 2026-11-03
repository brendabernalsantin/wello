-- Wello / Supabase — contrato de producción familiar
--
-- Esta migración es deliberadamente cerrada: el cliente autenticado solo puede
-- leer registros mediante SELECT filtrado por RLS y escribir blobs mediante RPC
-- SECURITY DEFINER con CAS. No hay INSERT/UPDATE/DELETE grants sobre blobs ni
-- tablas de membresía. El rol owner solo se crea dentro de create_household().
--
-- record_purchase_and_inventory conserva las dos claves legacy de la primera
-- versión (wello:household:inventory y wello:household:purchases) porque el
-- cliente existente las usa. Ese RPC sigue siendo atómico, miembro-only, CAS e
-- idempotente; los RPC públicos de estado, en cambio, solo aceptan las claves
-- wello:state:personal y wello:state:household:<uuid> y sus blobs de dos campos.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.households (
  id uuid primary key default extensions.gen_random_uuid(),
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
  id uuid primary key default extensions.gen_random_uuid(),
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

-- La huella completa evita que un retry con el mismo operation_id devuelva el
-- resultado de otra escritura. Las columnas nuevas permiten actualizar una base
-- que ya tuviera la tabla del baseline sin perder su log.
create table if not exists public.cloud_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null check (char_length(operation_id) between 8 and 240),
  operation text not null check (char_length(operation) between 1 and 80),
  subject_key text not null default '',
  record_key text not null default '',
  payload jsonb not null default '{}'::jsonb,
  requested_version integer,
  expected_revision bigint,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.cloud_operations
  add column if not exists subject_key text not null default '';
alter table public.cloud_operations
  add column if not exists record_key text not null default '';
alter table public.cloud_operations
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.cloud_operations
  add column if not exists requested_version integer;
alter table public.cloud_operations
  add column if not exists expected_revision bigint;

-- El baseline tenía una sobrecarga de un argumento. Se elimina para que la
-- única forma publicada sea (p_name, p_operation_id default null), aunque las
-- llamadas antiguas de un solo argumento sigan siendo válidas por el default.
drop function if exists public.create_household(text);

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
     limit 1
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
     limit 1
  );
$$;

create or replace function public.create_household(
  p_name text,
  p_operation_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_household uuid;
  v_existing public.cloud_operations;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_operation_id is not null then
    if char_length(p_operation_id) not between 8 and 240 then
      raise exception 'OPERATION_ID_INVALID' using errcode = '22023';
    end if;
    -- Operation lock serializa dos primeros inserts concurrentes del mismo
    -- operation_id antes de que exista una fila en cloud_operations.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user::text || ':operation:' || p_operation_id, 0::bigint)
    );
    select * into v_existing
      from public.cloud_operations co
     where co.user_id = v_user
       and co.operation_id = p_operation_id
     limit 1;
    if found then
      if v_existing.operation <> 'create_household'
         or v_existing.subject_key <> v_user::text
         or v_existing.record_key <> ''
         or v_existing.payload <> jsonb_build_object('name', v_name)
         or v_existing.requested_version is distinct from null
         or v_existing.expected_revision is distinct from null then
        raise exception 'WELLO_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
      end if;
      return (v_existing.result #>> '{}')::uuid;
    end if;
  end if;

  if char_length(v_name) not between 1 and 120 then
    raise exception 'HOUSEHOLD_NAME_INVALID' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (v_name, v_user)
  returning id into v_household;

  -- Nunca se acepta role o created_by desde parámetros del cliente.
  insert into public.household_members (household_id, user_id, role)
  values (v_household, v_user, 'owner');

  if p_operation_id is not null then
    insert into public.cloud_operations (
      user_id, operation_id, operation, subject_key, record_key, payload,
      requested_version, expected_revision, result
    )
    values (
      v_user, p_operation_id, 'create_household', v_user::text, '',
      jsonb_build_object('name', v_name), null, null, to_jsonb(v_household)
    );
  end if;

  return v_household;
end;
$$;

create or replace function public.rename_household(
  p_household_id uuid,
  p_name text
)
returns public.households
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_household public.households;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'HOUSEHOLD_NAME_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || coalesce(p_household_id::text, ''), 0::bigint)
  );
  if not public.is_household_owner(p_household_id) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501';
  end if;

  update public.households h
     set name = v_name,
         updated_at = now()
   where h.id = p_household_id
  returning h.* into v_household;
  if not found then
    raise exception 'HOUSEHOLD_NOT_FOUND' using errcode = '22023';
  end if;
  return v_household;
end;
$$;

create or replace function public.list_household_members(p_household_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'HOUSEHOLD_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  return query
  select hm.user_id, au.email::text, hm.role, hm.joined_at
    from public.household_members hm
    join auth.users au on au.id = hm.user_id
   where hm.household_id = p_household_id
   order by hm.joined_at, hm.user_id
   limit 500;
end;
$$;

create or replace function public.remove_household_member(
  p_household_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_role text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || coalesce(p_household_id::text, ''), 0::bigint)
  );
  if not public.is_household_owner(p_household_id) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'MEMBER_ID_INVALID' using errcode = '22023';
  end if;

  select hm.role into v_role
    from public.household_members hm
   where hm.household_id = p_household_id
     and hm.user_id = p_user_id
   limit 1 for update;
  if not found then
    return false;
  end if;
  if v_role = 'owner' then
    -- El owner nunca se autoelimina ni puede ser eliminado por este RPC.
    raise exception 'CANNOT_REMOVE_OWNER' using errcode = '42501';
  end if;

  delete from public.household_members hm
   where hm.household_id = p_household_id
     and hm.user_id = p_user_id
     and hm.role = 'member';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.leave_household(p_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_count integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || coalesce(p_household_id::text, ''), 0::bigint)
  );
  select hm.role into v_role
    from public.household_members hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user
   limit 1 for update;
  if not found then
    return false;
  end if;
  if v_role = 'owner' then
    raise exception 'OWNER_CANNOT_LEAVE' using errcode = '42501';
  end if;

  delete from public.household_members hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user
     and hm.role = 'member';
  get diagnostics v_count = row_count;
  return v_count = 1;
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
  v_email_hash text;
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_email) < 3 or position('@' in v_email) < 2
     or char_length(v_email) > 320 then
    raise exception 'INVITE_EMAIL_INVALID' using errcode = '22023';
  end if;

  -- Owner, expiración y limpieza de invitaciones previas quedan serializados
  -- por hogar. Una invitación vencida se marca revoked_at para que el índice
  -- activo permita una nueva invitación al mismo correo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || coalesce(p_household_id::text, ''), 0::bigint)
  );
  if not public.is_household_owner(p_household_id) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501';
  end if;

  v_expires := least(
    coalesce(p_expires_at, now() + interval '7 days'),
    now() + interval '7 days'
  );
  if v_expires <= now() then
    raise exception 'INVITE_EXPIRY_INVALID' using errcode = '22023';
  end if;
  v_email_hash := pg_catalog.encode(extensions.digest(v_email, 'sha256'), 'hex');

  update public.household_invites hi
     set revoked_at = now()
   where hi.household_id = p_household_id
     and hi.email_hash = v_email_hash
     and hi.consumed_at is null
     and hi.revoked_at is null
     and hi.expires_at <= now();

  insert into public.household_invites (
    household_id, email, email_hash, token_hash, expires_at, created_by
  )
  values (
    p_household_id,
    v_email,
    v_email_hash,
    pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires,
    v_user
  )
  returning id into v_id;

  -- No se envía correo: el token se devuelve una única vez al proveedor/UI
  -- autorizado. Nunca se expone token_hash por una tabla o list RPC.
  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'expires_at', v_expires,
    'role', 'member'
  );
end;
$$;

create or replace function public.list_household_invites(p_household_id uuid)
returns table (
  id uuid,
  email text,
  role text,
  expires_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not public.is_household_owner(p_household_id) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501';
  end if;
  return query
  select hi.id, hi.email, hi.role, hi.expires_at, hi.consumed_at,
         hi.revoked_at, hi.created_at
    from public.household_invites hi
   where hi.household_id = p_household_id
   order by hi.created_at desc
   limit 500;
end;
$$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_household_id uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select hi.household_id into v_household_id
    from public.household_invites hi
   where hi.id = p_invite_id
   limit 1;
  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || v_household_id::text, 0::bigint)
  );
  if not public.is_household_owner(v_household_id) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED' using errcode = '42501';
  end if;

  update public.household_invites hi
     set revoked_at = now()
   where hi.id = p_invite_id
     and hi.revoked_at is null
     and hi.consumed_at is null;
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
  v_token_hash text := pg_catalog.encode(
    extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'
  );
  v_household_id uuid;
  v_invite public.household_invites;
  v_email text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Primero se descubre el hogar sin bloquear la fila; después se toma el
  -- lock del hogar y se bloquea la invitación. Así accept/revoke/create usan
  -- siempre el mismo orden y dos accept del mismo token son use-once.
  select hi.household_id into v_household_id
    from public.household_invites hi
   where hi.token_hash = v_token_hash
   limit 1;
  if not found then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || v_household_id::text, 0::bigint)
  );

  select * into v_invite
    from public.household_invites hi
   where hi.token_hash = v_token_hash
   limit 1 for update;
  if not found
     or v_invite.revoked_at is not null
     or v_invite.consumed_at is not null
     or v_invite.expires_at <= now() then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = '22023';
  end if;

  select lower(au.email)::text into v_email
    from auth.users au
   where au.id = v_user
   limit 1;
  if v_email is null or v_invite.email <> v_email then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from auth.users au
     where au.id = v_user
       and au.email_confirmed_at is not null
     limit 1
  ) then
    raise exception 'INVITE_EMAIL_UNCONFIRMED' using errcode = '42501';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_user, 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites hi
     set consumed_at = now()
   where hi.id = v_invite.id;
  return v_invite.household_id;
end;
$$;

-- Helper privado para el RPC de estado personal. No recibe grants y solo el
-- wrapper público lo puede invocar desde PostgREST.
create or replace function public._upsert_private_record(
  p_record_key text,
  p_data jsonb,
  p_version integer,
  p_expected_revision bigint,
  p_operation_id text
)
returns public.private_records
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_payload jsonb := coalesce(p_data, 'null'::jsonb);
  v_version integer := coalesce(p_version, 3);
  v_expected bigint := coalesce(p_expected_revision, 0);
  v_record_key text := coalesce(p_record_key, '');
  v_current public.private_records;
  v_existing public.cloud_operations;
  v_has_current boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_expected < 0 or v_version <= 0 then
    raise exception 'RECORD_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  if p_operation_id is not null then
    if char_length(p_operation_id) not between 8 and 240 then
      raise exception 'OPERATION_ID_INVALID' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user::text || ':operation:' || p_operation_id, 0::bigint)
    );
    select * into v_existing
      from public.cloud_operations co
     where co.user_id = v_user
       and co.operation_id = p_operation_id
     limit 1;
    if found then
      if v_existing.operation <> 'private_record'
         or v_existing.subject_key <> v_user::text
         or v_existing.record_key <> v_record_key
         or v_existing.payload <> v_payload
         or v_existing.requested_version is distinct from v_version
         or v_existing.expected_revision is distinct from v_expected then
        raise exception 'WELLO_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
      end if;
      -- Se devuelve el resultado guardado, no la fila actual después de otro
      -- cambio, para que un retry tenga exactamente la misma respuesta.
      v_current := pg_catalog.jsonb_populate_record(
        null::public.private_records, v_existing.result
      );
      return v_current;
    end if;
  end if;

  if v_record_key <> 'wello:state:personal'
     or jsonb_typeof(v_payload) <> 'object'
     or not (v_payload ? 'version')
     or not (v_payload ? 'personal')
     or (v_payload - 'version' - 'personal') <> '{}'::jsonb
     or jsonb_typeof(v_payload->'version') <> 'number'
     or (v_payload->>'version') <> v_version::text
     or jsonb_typeof(v_payload->'personal') <> 'object' then
    raise exception 'RECORD_SCOPE_INVALID' using errcode = '22023';
  end if;

  -- Advisory resource lock cubre también el primer insert, cuando SELECT FOR
  -- UPDATE aún no encuentra una fila que bloquear.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('private-record:' || v_user::text || ':' || v_record_key, 0::bigint)
  );
  select * into v_current
    from public.private_records pr
   where pr.user_id = v_user
     and pr.record_key = v_record_key
   limit 1 for update;
  v_has_current := found;

  if v_has_current and v_current.revision <> v_expected then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if not v_has_current and v_expected <> 0 then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  if not v_has_current then
    insert into public.private_records (
      user_id, record_key, data, version, revision, updated_at
    )
    values (v_user, v_record_key, v_payload, v_version, 1, now())
    returning * into v_current;
  else
    update public.private_records pr
       set data = v_payload,
           version = v_version,
           revision = v_expected + 1,
           updated_at = now()
     where pr.user_id = v_user
       and pr.record_key = v_record_key
    returning * into v_current;
  end if;

  if p_operation_id is not null then
    insert into public.cloud_operations (
      user_id, operation_id, operation, subject_key, record_key, payload,
      requested_version, expected_revision, result
    )
    values (
      v_user, p_operation_id, 'private_record', v_user::text, v_record_key,
      v_payload, v_version, v_expected, to_jsonb(v_current)
    );
  end if;
  return v_current;
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
begin
  return public._upsert_private_record(
    p_record_key, p_data, p_version, p_expected_revision, p_operation_id
  );
end;
$$;

-- p_enforce_scope=false solo se usa debajo de record_purchase_and_inventory
-- para preservar las dos claves legacy; ese helper no tiene EXECUTE público.
create or replace function public._upsert_household_record(
  p_household_id uuid,
  p_record_key text,
  p_data jsonb,
  p_version integer,
  p_expected_revision bigint,
  p_operation_id text,
  p_enforce_scope boolean
)
returns public.household_records
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_payload jsonb := coalesce(p_data, 'null'::jsonb);
  v_version integer := coalesce(p_version, 3);
  v_expected bigint := coalesce(p_expected_revision, 0);
  v_record_key text := coalesce(p_record_key, '');
  v_subject text := coalesce(p_household_id::text, '');
  v_operation_name text := case when p_enforce_scope then 'household_record' else 'legacy_household_record' end;
  v_current public.household_records;
  v_existing public.cloud_operations;
  v_has_current boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_expected < 0 or v_version <= 0 then
    raise exception 'RECORD_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  -- El lock de hogar es primero para que el RPC legacy de dos recursos y un
  -- upsert concurrente no puedan adquirir operation locks en orden cruzado.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household:' || v_subject, 0::bigint)
  );

  if p_operation_id is not null then
    if char_length(p_operation_id) not between 8 and 240 then
      raise exception 'OPERATION_ID_INVALID' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user::text || ':operation:' || p_operation_id, 0::bigint)
    );
  end if;

  -- El check queda dentro del lock de hogar: leave/remove/create invite no
  -- pueden revocar al usuario entre el check y el write.
  if not public.is_household_member(p_household_id) then
    raise exception 'HOUSEHOLD_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  if p_operation_id is not null then
    select * into v_existing
      from public.cloud_operations co
     where co.user_id = v_user
       and co.operation_id = p_operation_id
     limit 1;
    if found then
      if v_existing.operation <> v_operation_name
         or v_existing.subject_key <> v_subject
         or v_existing.record_key <> v_record_key
         or v_existing.payload <> v_payload
         or v_existing.requested_version is distinct from v_version
         or v_existing.expected_revision is distinct from v_expected then
        raise exception 'WELLO_IDEMPOTENCY_MISMATCH' using errcode = 'P0001';
      end if;
      v_current := pg_catalog.jsonb_populate_record(
        null::public.household_records, v_existing.result
      );
      return v_current;
    end if;
  end if;

  if p_enforce_scope then
    if v_record_key <> 'wello:state:household:' || v_subject
       or jsonb_typeof(v_payload) <> 'object'
       or not (v_payload ? 'version')
       or not (v_payload ? 'household')
       or (v_payload - 'version' - 'household') <> '{}'::jsonb
       or jsonb_typeof(v_payload->'version') <> 'number'
       or (v_payload->>'version') <> v_version::text
       or jsonb_typeof(v_payload->'household') <> 'object'
       or not (v_payload->'household' ? 'id')
       or coalesce(v_payload->'household'->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
            case
              when coalesce(v_payload->'household'->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (v_payload->'household'->>'id')::uuid is distinct from p_household_id
              else true
            end
          ) then
      raise exception 'RECORD_SCOPE_INVALID' using errcode = '22023';
    end if;
  else
    -- Legacy atomic purchase path: only its two historical keys are accepted;
    -- arbitrary household blobs cannot use this compatibility RPC.
    if v_record_key not in ('wello:household:inventory', 'wello:household:purchases')
       or jsonb_typeof(v_payload) <> 'object' then
      raise exception 'LEGACY_RECORD_SCOPE_INVALID' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'household-record:' || v_subject || ':' || v_record_key, 0::bigint
    )
  );
  select * into v_current
    from public.household_records hr
   where hr.household_id = p_household_id
     and hr.record_key = v_record_key
   limit 1 for update;
  v_has_current := found;

  if v_has_current and v_current.revision <> v_expected then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if not v_has_current and v_expected <> 0 then
    raise exception 'WELLO_REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  if not v_has_current then
    insert into public.household_records (
      household_id, record_key, data, version, revision, updated_by, updated_at
    )
    values (p_household_id, v_record_key, v_payload, v_version, 1, v_user, now())
    returning * into v_current;
  else
    update public.household_records hr
       set data = v_payload,
           version = v_version,
           revision = v_expected + 1,
           updated_by = v_user,
           updated_at = now()
     where hr.household_id = p_household_id
       and hr.record_key = v_record_key
    returning * into v_current;
  end if;

  if p_operation_id is not null then
    insert into public.cloud_operations (
      user_id, operation_id, operation, subject_key, record_key, payload,
      requested_version, expected_revision, result
    )
    values (
      v_user, p_operation_id, v_operation_name, v_subject, v_record_key,
      v_payload, v_version, v_expected, to_jsonb(v_current)
    );
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
begin
  return public._upsert_household_record(
    p_household_id, p_record_key, p_data, p_version,
    p_expected_revision, p_operation_id, true
  );
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
  v_operation text := coalesce(
    p_operation_id,
    pg_catalog.encode(extensions.gen_random_bytes(12), 'hex')
  );
begin
  -- Conserva la firma legacy. Las dos llamadas al helper son parte de esta
  -- misma transacción: un CAS fallido revierte también la primera escritura.
  -- Solo se permiten las claves legacy dentro del helper; no es un bypass del
  -- scope de upsert_household_record ni concede acceso directo a tablas.
  if p_operation_id is not null and char_length(p_operation_id) not between 8 and 230 then
    raise exception 'OPERATION_ID_INVALID' using errcode = '22023';
  end if;
  v_inventory := public._upsert_household_record(
    p_household_id,
    'wello:household:inventory',
    coalesce(p_inventory_data, '{}'::jsonb),
    3,
    p_expected_inventory_revision,
    v_operation || ':inventory',
    false
  );
  v_purchase := public._upsert_household_record(
    p_household_id,
    'wello:household:purchases',
    coalesce(p_purchase_data, '{}'::jsonb),
    3,
    p_expected_purchase_revision,
    v_operation || ':purchase',
    false
  );
  return jsonb_build_object(
    'inventory', to_jsonb(v_inventory),
    'purchase', to_jsonb(v_purchase),
    'atomic', true,
    'idempotent', true
  );
end;
$$;

-- RLS: todas las filas legibles se filtran por auth.uid(); las escrituras de
-- datos pasan únicamente por las funciones de arriba.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.private_records enable row level security;
alter table public.household_records enable row level security;
alter table public.cloud_operations enable row level security;

drop policy if exists households_select_member on public.households;
drop policy if exists households_update_owner on public.households;
drop policy if exists household_members_select_member on public.household_members;
drop policy if exists household_members_insert_owner on public.household_members;
drop policy if exists household_members_update_owner on public.household_members;
drop policy if exists household_members_delete_owner on public.household_members;
drop policy if exists household_invites_select_owner on public.household_invites;
drop policy if exists private_records_select_own on public.private_records;
drop policy if exists private_records_insert_own on public.private_records;
drop policy if exists private_records_update_own on public.private_records;
drop policy if exists private_records_delete_own on public.private_records;
drop policy if exists household_records_select_member on public.household_records;
drop policy if exists household_records_insert_member on public.household_records;
drop policy if exists household_records_update_member on public.household_records;
drop policy if exists household_records_delete_member on public.household_records;

create policy households_select_member on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy household_members_select_member on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

-- No se crea ninguna policy INSERT/UPDATE/DELETE para membresías, hogares o
-- blobs. Sin grants DML, un cliente tampoco puede llegar a una escalada por
-- WITH CHECK; solo los SECURITY DEFINER propietarios escriben.
create policy private_records_select_own on public.private_records
  for select to authenticated
  using (user_id = auth.uid());

create policy household_records_select_member on public.household_records
  for select to authenticated
  using (public.is_household_member(household_id));

-- El log de idempotencia y las invitaciones (incluidos hashes) no se exponen
-- como tablas; los invites se listan por list_household_invites sin token_hash.
revoke all on table public.households,
  public.household_members,
  public.household_invites,
  public.private_records,
  public.household_records,
  public.cloud_operations
from public, anon, authenticated;

grant select on table public.households,
  public.household_members,
  public.private_records,
  public.household_records
to authenticated;

-- Revoca el EXECUTE implícito de PUBLIC (y por tanto anon). Solo el helper
-- necesario para evaluar SELECT RLS y las RPC públicas reciben authenticated.
revoke all on function public.is_household_member(uuid) from public, anon, authenticated;
revoke all on function public.is_household_owner(uuid) from public, anon, authenticated;
revoke all on function public.create_household(text, text) from public, anon, authenticated;
revoke all on function public.rename_household(uuid, text) from public, anon, authenticated;
revoke all on function public.list_household_members(uuid) from public, anon, authenticated;
revoke all on function public.remove_household_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_household(uuid) from public, anon, authenticated;
revoke all on function public.create_household_invite(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_household_invites(uuid) from public, anon, authenticated;
revoke all on function public.revoke_household_invite(uuid) from public, anon, authenticated;
revoke all on function public.accept_household_invite(text) from public, anon, authenticated;
revoke all on function public._upsert_private_record(text, jsonb, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.upsert_private_record(text, jsonb, integer, bigint, text) from public, anon, authenticated;
revoke all on function public._upsert_household_record(uuid, text, jsonb, integer, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.upsert_household_record(uuid, text, jsonb, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.record_purchase_and_inventory(uuid, jsonb, jsonb, bigint, bigint, text) from public, anon, authenticated;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.rename_household(uuid, text) to authenticated;
grant execute on function public.list_household_members(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.create_household_invite(uuid, text, timestamptz) to authenticated;
grant execute on function public.list_household_invites(uuid) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.upsert_private_record(text, jsonb, integer, bigint, text) to authenticated;
grant execute on function public.upsert_household_record(uuid, text, jsonb, integer, bigint, text) to authenticated;
grant execute on function public.record_purchase_and_inventory(uuid, jsonb, jsonb, bigint, bigint, text) to authenticated;

commit;
