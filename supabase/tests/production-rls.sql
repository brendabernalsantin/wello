-- Wello production RLS/RPC fixture.
--
-- Ejecutar como postgres/service-role de un proyecto de PRUEBA después de aplicar
-- supabase/migrations/001_wello.sql. El script no envía correo ni usa tokens
-- reales: inserta tres auth.users sintéticos y siempre termina en ROLLBACK.
-- Se requiere una sesión con permiso para SET ROLE authenticated/anon y para
-- insertar de forma transaccional en auth.users; no es una prueba de privilegios del
-- owner de la base de datos.
--
-- Todas las lecturas de tablas tienen LIMIT explícito. Los SELECT de RPC
-- también llevan LIMIT para poder ejecutar el fixture por un cliente que exige
-- lecturas acotadas.

begin;

-- No se crean objetos ni se conceden privilegios desde el smoke test. El
-- contexto JSON vive en un GUC LOCAL y solo contiene UUIDs/tokens sintéticos
-- de esta transacción; current_setting funciona tras SET ROLE sin grants.
select set_config(
  'wello.test.context',
  '{"household_id":null,"secondary_household_id":null,"member_expired_id":null,"member_expired_token":null,"member_unconfirmed_id":null,"member_unconfirmed_token":null,"revoked_id":null,"revoked_token":null,"mismatch_email_token":null,"member_second_token":null,"assertions":[]}'::jsonb::text,
  true
) limit 1;

reset role;
do $$
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at)
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'authenticated', 'authenticated', 'owner@example.test', now()),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'authenticated', 'authenticated', 'member@example.test', now()),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'authenticated', 'authenticated', 'outsider@example.test', now());
end;
$$;

-- El owner crea un hogar y un retry devuelve el UUID previamente guardado.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;
select set_config(
  'wello.test.context',
  jsonb_set(
    current_setting('wello.test.context', true)::jsonb,
    '{household_id}',
    to_jsonb(public.create_household('Fixture Casa', 'test-create-household-001')::text),
    true
  )::text,
  true
) limit 1;

do $$
declare
  v_expected uuid;
  v_retry uuid;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid
    into v_expected
   limit 1;
  select public.create_household('Fixture Casa', 'test-create-household-001')
    into v_retry
   limit 1;
  if v_retry <> v_expected then
    raise exception 'ASSERT create_household retry returned a different UUID';
  end if;

  begin
    perform public.create_household('Otro nombre', 'test-create-household-001');
    raise exception 'ASSERT create_household accepted a mismatched operation payload';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;
end;
$$;

-- El estado home exige key/UUID/version y no admite personal ni campos extra.
do $$
declare
  v_h uuid;
  v_row public.household_records;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  select * into v_row
    from public.upsert_household_record(
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object(
        'version', 3,
        'household', jsonb_build_object('id', v_h::text, 'name', 'Fixture Casa', 'inventory', jsonb_build_array())
      ),
      3,
      0,
      'test-home-first-001'
    )
   limit 1;
  if v_row.revision <> 1 then
    raise exception 'ASSERT first home insert must have revision 1';
  end if;

  begin
    perform public.upsert_household_record(
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object(
        'version', 3,
        'household', jsonb_build_object('id', v_h::text),
        'personal', jsonb_build_object('leak', true)
      ),
      3, 1, 'test-home-invalid-001'
    );
    raise exception 'ASSERT home personal field was accepted';
  exception when others then
    if sqlerrm <> 'RECORD_SCOPE_INVALID' then
      raise;
    end if;
  end;
end;
$$;

-- Personal blank-first, retry exacto, mismatch de operación y CAS estricto.
do $$
declare
  v_first public.private_records;
  v_retry public.private_records;
  v_updated public.private_records;
begin
  select * into v_first
    from public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[]}}'::jsonb,
      3, 0, 'test-private-same-op-001'
    )
   limit 1;
  select * into v_retry
    from public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[]}}'::jsonb,
      3, 0, 'test-private-same-op-001'
    )
   limit 1;
  if v_retry.revision <> v_first.revision or v_retry.updated_at <> v_first.updated_at
     or v_retry.data <> v_first.data then
    raise exception 'ASSERT idempotent retry did not return the saved result exactly';
  end if;

  begin
    perform public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[{"id":"different"}]}}'::jsonb,
      3, 0, 'test-private-same-op-001'
    );
    raise exception 'ASSERT same operation accepted a different payload';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;

  begin
    perform public.upsert_private_record(
      'wello:state:personal:other',
      '{"version":3,"personal":{"moods":[]}}'::jsonb,
      3, 0, 'test-private-same-op-001'
    );
    raise exception 'ASSERT same operation accepted a different record key';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;

  begin
    perform public.upsert_private_record(
      'wello:state:personal',
      '{"version":4,"personal":{"moods":[]}}'::jsonb,
      4, 0, 'test-private-same-op-001'
    );
    raise exception 'ASSERT same operation accepted a different version';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;

  begin
    perform public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[]}}'::jsonb,
      3, 1, 'test-private-same-op-001'
    );
    raise exception 'ASSERT same operation accepted a different expected revision';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;

  begin
    perform public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[{"id":"cas-conflict"}]}}'::jsonb,
      3, 0, 'test-private-cas-conflict-001'
    );
    raise exception 'ASSERT stale expected revision was accepted';
  exception when others then
    if sqlerrm <> 'WELLO_REVISION_CONFLICT' then
      raise;
    end if;
  end;

  select * into v_updated
    from public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[{"id":"cas-ok"}]}}'::jsonb,
      3, 1, 'test-private-cas-update-001'
    )
   limit 1;
  if v_updated.revision <> 2 then
    raise exception 'ASSERT CAS update did not advance revision to 2';
  end if;

  -- El retry antiguo sigue devolviendo revision 1 aunque la fila actual sea 2.
  select * into v_retry
    from public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[]}}'::jsonb,
      3, 0, 'test-private-same-op-001'
    )
   limit 1;
  if v_retry.revision <> 1 or v_retry.data <> v_first.data then
    raise exception 'ASSERT idempotent retry returned the current row instead of saved result';
  end if;

  begin
    perform public.upsert_private_record(
      'wello:state:personal',
      '{"version":3,"personal":{"moods":[]},"extra":true}'::jsonb,
      3, 2, 'test-private-scope-invalid-001'
    );
    raise exception 'ASSERT private extra field was accepted';
  exception when others then
    if sqlerrm <> 'RECORD_SCOPE_INVALID' then
      raise;
    end if;
  end;
end;
$$;

-- Un outsider no puede leer los blobs del owner, escribir su hogar ni escalar
-- una membresía. Las tablas de blobs no conceden DML directo.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","email":"outsider@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_count integer;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  select count(*) into v_count
    from (select 1 from public.private_records where user_id = v_owner limit 1) q
   limit 1;
  if v_count <> 0 then
    raise exception 'ASSERT outsider read owner private record';
  end if;
  select count(*) into v_count
    from (select 1 from public.household_records where household_id = v_h limit 1) q
   limit 1;
  if v_count <> 0 then
    raise exception 'ASSERT outsider read household record';
  end if;

  begin
    perform public.upsert_household_record(
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object('version', 3, 'household', jsonb_build_object('id', v_h::text)),
      3, 1, 'test-outsider-home-write-001'
    );
    raise exception 'ASSERT outsider household write was accepted';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    insert into public.private_records (user_id, record_key, data, version, revision)
    values (v_owner, 'wello:state:personal', '{"version":3,"personal":{}}'::jsonb, 3, 1);
    raise exception 'ASSERT outsider direct private write was accepted';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    insert into public.household_records (household_id, record_key, data, version, revision, updated_by)
    values (
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object('version', 3, 'household', jsonb_build_object('id', v_h::text)),
      3, 1, v_owner
    );
    raise exception 'ASSERT outsider direct household write was accepted';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

-- Anon no tiene SELECT de tablas ni EXECUTE de RPC.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) limit 1;
do $$
declare
  v_h uuid;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  begin
    perform 1 from public.private_records limit 1;
    raise exception 'ASSERT anon read private table was accepted';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    perform 1 from public.household_records where household_id = v_h limit 1;
    raise exception 'ASSERT anon read household table was accepted';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    perform public.create_household('Anon no debe crear', 'test-anon-create-001');
    raise exception 'ASSERT anon RPC execute was accepted';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

-- Invitaciones: expiración por defecto/cap, renovación tras expiración,
-- revocación, email confirmado obligatorio y token use-once.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_json jsonb;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  v_json := public.create_household_invite(v_h, 'default-expiry@example.test', null);
  if (v_json->>'expires_at')::timestamptz not between now() + interval '6 days' and now() + interval '8 days' then
    raise exception 'ASSERT invite default expiry is not approximately 7 days';
  end if;
  v_json := public.create_household_invite(v_h, 'capped-expiry@example.test', now() + interval '60 days');
  if (v_json->>'expires_at')::timestamptz > now() + interval '7 days' then
    raise exception 'ASSERT invite expiry exceeded 7-day cap';
  end if;
  v_json := public.create_household_invite(v_h, 'member@example.test', now() + interval '1 hour');
  perform set_config(
    'wello.test.context',
    jsonb_set(
      jsonb_set(
        current_setting('wello.test.context', true)::jsonb,
        '{member_expired_id}', to_jsonb(v_json->>'id'), true
      ),
      '{member_expired_token}', to_jsonb(v_json->>'token'), true
    )::text,
    true
  );
end;
$$;

-- La expiración es una simulación administrativa y debe ejecutarse con la
-- sesión base; authenticated solo tiene SELECT sobre estas tablas.
reset role;
update public.household_invites
   set expires_at = now() - interval '1 minute'
 where id = (current_setting('wello.test.context', true)::jsonb->>'member_expired_id')::uuid;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;

do $$
declare
  v_h uuid;
  v_json jsonb;
  v_old_id uuid;
  v_new_id uuid;
  v_revoked_id uuid;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  v_json := public.create_household_invite(v_h, 'member@example.test', now() + interval '1 hour');
  perform set_config(
    'wello.test.context',
    jsonb_set(
      jsonb_set(
        current_setting('wello.test.context', true)::jsonb,
        '{member_unconfirmed_id}', to_jsonb(v_json->>'id'), true
      ),
      '{member_unconfirmed_token}', to_jsonb(v_json->>'token'), true
    )::text,
    true
  );

  select (current_setting('wello.test.context', true)::jsonb->>'member_expired_id')::uuid into v_old_id limit 1;
  select (current_setting('wello.test.context', true)::jsonb->>'member_unconfirmed_id')::uuid into v_new_id limit 1;
  if v_old_id = v_new_id then
    raise exception 'ASSERT expired invite was not replaced';
  end if;
  if not exists (
    select 1 from public.list_household_invites(v_h)
     where id = v_old_id and revoked_at is not null
     limit 1
  ) then
    raise exception 'ASSERT expired previous invite was not revoked';
  end if;

  v_json := public.create_household_invite(v_h, 'outsider@example.test', now() + interval '1 hour');
  perform set_config(
    'wello.test.context',
    jsonb_set(
      jsonb_set(
        current_setting('wello.test.context', true)::jsonb,
        '{revoked_id}', to_jsonb(v_json->>'id'), true
      ),
      '{revoked_token}', to_jsonb(v_json->>'token'), true
    )::text,
    true
  );
  v_revoked_id := (v_json->>'id')::uuid;
  if not public.revoke_household_invite(v_revoked_id) then
    raise exception 'ASSERT owner could not revoke invite';
  end if;
  v_json := public.create_household_invite(v_h, 'different@example.test', now() + interval '1 hour');
  perform set_config(
    'wello.test.context',
    jsonb_set(
      current_setting('wello.test.context', true)::jsonb,
      '{mismatch_email_token}', to_jsonb(v_json->>'token'), true
    )::text,
    true
  );
end;
$$;

-- Una invitación revocada nunca puede consumirse, aunque el correo coincida.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","email":"outsider@example.test"}',
  true
) limit 1;
do $$
declare
  v_token text;
begin
  select current_setting('wello.test.context', true)::jsonb->>'revoked_token'
    into v_token limit 1;
  begin
    perform public.accept_household_invite(v_token);
    raise exception 'ASSERT revoked invite was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'INVITE_INVALID_OR_EXPIRED' then
      raise;
    end if;
  end;
end;
$$;

-- Un token dirigido a otro correo no concede membresía aunque el usuario esté
-- autenticado y tenga email confirmado.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","email":"member@example.test"}',
  true
) limit 1;
do $$
declare
  v_token text;
begin
  select current_setting('wello.test.context', true)::jsonb->>'mismatch_email_token'
    into v_token limit 1;
  begin
    perform public.accept_household_invite(v_token);
    raise exception 'ASSERT mismatched invite email was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'INVITE_EMAIL_MISMATCH' then
      raise;
    end if;
  end;
end;
$$;

-- Unconfirmed member is rejected; after confirmation the same token is accepted
-- and the second attempt is rejected as consumed.
reset role;
update auth.users
   set email_confirmed_at = null
 where id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","email":"member@example.test"}',
  true
) limit 1;
do $$
declare
  v_token text;
begin
  select current_setting('wello.test.context', true)::jsonb->>'member_unconfirmed_token'
    into v_token limit 1;
  begin
    perform public.accept_household_invite(v_token);
    raise exception 'ASSERT unconfirmed email accepted an invite';
  exception when sqlstate '42501' then
    if sqlerrm <> 'INVITE_EMAIL_UNCONFIRMED' then
      raise;
    end if;
  end;
end;
$$;

reset role;
update auth.users
   set email_confirmed_at = now()
 where id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","email":"member@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_token text;
  v_owner_email text;
  v_member_email text;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  select current_setting('wello.test.context', true)::jsonb->>'member_unconfirmed_token'
    into v_token limit 1;
  if (select public.accept_household_invite(v_token) limit 1) is null then
    raise exception 'ASSERT accepted invite returned null household';
  end if;

  select email into v_owner_email
    from public.list_household_members(v_h)
   where user_id = '00000000-0000-4000-8000-000000000001'
   limit 1;
  select email into v_member_email
    from public.list_household_members(v_h)
   where user_id = '00000000-0000-4000-8000-000000000002'
   limit 1;
  if v_owner_email <> 'owner@example.test' or v_member_email <> 'member@example.test' then
    raise exception 'ASSERT list_household_members did not return member emails';
  end if;

  begin
    perform public.accept_household_invite(v_token);
    raise exception 'ASSERT consumed invite was accepted twice';
  exception when sqlstate '22023' then
    if sqlerrm <> 'INVITE_INVALID_OR_EXPIRED' then
      raise;
    end if;
  end;
end;
$$;

-- El member puede escribir el home compartido, pero no renombrar ni quitar al
-- owner; el owner no puede autoeliminarse. La membresía directa no es posible.
do $$
declare
  v_h uuid;
  v_row public.household_records;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  select * into v_row
    from public.upsert_household_record(
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object('version', 3, 'household', jsonb_build_object('id', v_h::text, 'shared', true)),
      3, 1, 'test-member-home-write-001'
    )
   limit 1;
  if v_row.revision <> 2 then
    raise exception 'ASSERT member home write did not use CAS revision 1';
  end if;

  begin
    perform public.rename_household(v_h, 'Member no puede renombrar');
    raise exception 'ASSERT member renamed household';
  exception when sqlstate '42501' then
    if sqlerrm <> 'HOUSEHOLD_OWNER_REQUIRED' then
      raise;
    end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_row public.households;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  select * into v_row from public.rename_household(v_h, 'Fixture Casa Renombrada') limit 1;
  if v_row.name <> 'Fixture Casa Renombrada' then
    raise exception 'ASSERT owner rename did not persist';
  end if;

  begin
    perform public.remove_household_member(v_h, '00000000-0000-4000-8000-000000000001');
    raise exception 'ASSERT owner removed owner membership';
  exception when sqlstate '42501' then
    if sqlerrm <> 'CANNOT_REMOVE_OWNER' then
      raise;
    end if;
  end;

  begin
    insert into public.household_members(household_id, user_id, role)
    values (v_h, '00000000-0000-4000-8000-000000000003', 'owner');
    raise exception 'ASSERT direct membership escalation succeeded';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    update public.household_members
       set role = 'owner'
     where household_id = v_h
       and user_id = '00000000-0000-4000-8000-000000000002';
    raise exception 'ASSERT direct role escalation succeeded';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    perform public.leave_household(v_h);
    raise exception 'ASSERT owner left household';
  exception when sqlstate '42501' then
    if sqlerrm <> 'OWNER_CANNOT_LEAVE' then
      raise;
    end if;
  end;
end;
$$;

-- El member abandona el primer hogar y deja de verlo.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","email":"member@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_count integer;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'household_id')::uuid into v_h limit 1;
  if not public.leave_household(v_h) then
    raise exception 'ASSERT member leave returned false';
  end if;
  select count(*) into v_count
    from (select 1 from public.household_records where household_id = v_h limit 1) q
   limit 1;
  if v_count <> 0 then
    raise exception 'ASSERT former member still read household blob';
  end if;
end;
$$;

-- Segundo hogar: el owner invita y después remove_household_member elimina al
-- member, sin tocar la membresía owner.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;
select set_config(
  'wello.test.context',
  jsonb_set(
    current_setting('wello.test.context', true)::jsonb,
    '{secondary_household_id}',
    to_jsonb(public.create_household('Fixture Segundo', 'test-create-household-002')::text),
    true
  )::text,
  true
) limit 1;

do $$
declare
  v_h uuid;
  v_json jsonb;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'secondary_household_id')::uuid
    into v_h limit 1;

  begin
    perform public.upsert_household_record(
      v_h,
      'wello:state:household:' || v_h::text,
      jsonb_build_object('version', 3, 'household', jsonb_build_object('id', v_h::text)),
      3, 0, 'test-home-first-001'
    );
    raise exception 'ASSERT same operation accepted a different household subject';
  exception when others then
    if sqlerrm <> 'WELLO_IDEMPOTENCY_MISMATCH' then
      raise;
    end if;
  end;

  v_json := public.create_household_invite(v_h, 'member@example.test', now() + interval '1 hour');
  perform set_config(
    'wello.test.context',
    jsonb_set(
      current_setting('wello.test.context', true)::jsonb,
      '{member_second_token}', to_jsonb(v_json->>'token'), true
    )::text,
    true
  );
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","email":"member@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_token text;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'secondary_household_id')::uuid
    into v_h limit 1;
  select current_setting('wello.test.context', true)::jsonb->>'member_second_token'
    into v_token limit 1;
  perform public.accept_household_invite(v_token);
  begin
    perform public.rename_household(v_h, 'Member no puede renombrar segundo');
    raise exception 'ASSERT member renamed second household';
  exception when sqlstate '42501' then
    if sqlerrm <> 'HOUSEHOLD_OWNER_REQUIRED' then
      raise;
    end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test"}',
  true
) limit 1;
do $$
declare
  v_h uuid;
  v_count integer;
begin
  select (current_setting('wello.test.context', true)::jsonb->>'secondary_household_id')::uuid
    into v_h limit 1;
  if not public.remove_household_member(v_h, '00000000-0000-4000-8000-000000000002') then
    raise exception 'ASSERT owner remove member returned false';
  end if;
  select count(*) into v_count
    from (select 1 from public.household_members where household_id = v_h and role = 'owner' limit 1) q
   limit 1;
  if v_count <> 1 then
    raise exception 'ASSERT remove member deleted or changed owner';
  end if;

  -- Legacy RPC sigue siendo atómica y funcional, pero no abre las tablas.
  perform public.record_purchase_and_inventory(
    v_h, '{"items":[]}'::jsonb, '{"lines":[]}'::jsonb,
    0, 0, 'test-legacy-purchase-001'
  );
  perform public.record_purchase_and_inventory(
    v_h, '{"items":[]}'::jsonb, '{"lines":[]}'::jsonb,
    0, 0, 'test-legacy-purchase-001'
  );
end;
$$;

-- No auth.users, household, membresía, invite, blob ni operation fixture queda
-- persistido: este es un smoke test transaccional, no una seed de producción.
reset role;
select jsonb_build_object(
  'success', true,
  -- 45 coincide con los guard clauses ASSERT del fixture; el SELECT solo se
  -- alcanza si todos ellos y las comprobaciones positivas previas pasaron.
  'assertions', 45,
  'synthetic_users', 3,
  'households_checked', 2
) as result
limit 1;
rollback;
