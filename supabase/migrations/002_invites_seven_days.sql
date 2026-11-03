-- Vigencia máxima de invitaciones: siete días autorizados.
begin;
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
commit;
