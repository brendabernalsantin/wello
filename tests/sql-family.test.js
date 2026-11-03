import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/001_wello.sql', import.meta.url), 'utf8');
const fixture = fs.readFileSync(new URL('../supabase/tests/production-rls.sql', import.meta.url), 'utf8');

function grantLines(sql) {
  return sql.split('\n').filter((line) => /^grant\s+/i.test(line));
}

test('la migración SQL publica solo lectura de blobs y RPC authenticated', () => {
  assert.match(migration, /create or replace function public\.create_household\(\s*p_name text,\s*p_operation_id text default null/i);
  for (const functionName of [
    'rename_household',
    'list_household_members',
    'remove_household_member',
    'leave_household',
    'create_household_invite',
    'list_household_invites',
    'revoke_household_invite',
    'accept_household_invite',
    'upsert_private_record',
    'upsert_household_record',
    'record_purchase_and_inventory',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`));
  }
  assert.match(migration, /grant select on table public\.households,[\s\S]*public\.private_records,[\s\S]*public\.household_records[\s\S]*to authenticated/i);
  assert.match(migration, /grant execute on function public\.upsert_private_record[\s\S]*to authenticated/i);
  assert.match(migration, /grant execute on function public\.upsert_household_record[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /^grant\s+[^;]*(?:insert|update|delete)/im);
  assert.match(migration, /revoke all on function public\.is_household_member\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\._upsert_household_record[\s\S]*from public, anon, authenticated/i);
});

test('la migración conserva locks, huella de idempotencia, CAS y scope estricto', () => {
  assert.match(migration, /pg_advisory_xact_lock/g);
  assert.match(migration, /hashtextextended\(.*:operation:/s);
  assert.match(migration, /subject_key text not null/i);
  assert.match(migration, /record_key text not null/i);
  assert.match(migration, /payload jsonb not null/i);
  assert.match(migration, /requested_version integer/i);
  assert.match(migration, /expected_revision bigint/i);
  assert.match(migration, /WELLO_IDEMPOTENCY_MISMATCH/g);
  assert.match(migration, /WELLO_REVISION_CONFLICT/g);
  assert.match(migration, /wello:state:personal/g);
  assert.match(migration, /wello:state:household:/g);
  assert.match(migration, /RECORD_SCOPE_INVALID/g);
  assert.match(migration, /set search_path = pg_catalog, public, extensions/g);
  assert.match(migration, /security definer/gi);
});

test('el fixture es sintético, acotado, cubre roles e invariantes y revierte todo', () => {
  assert.match(fixture, /^begin;\s*$/m);
  assert.match(fixture, /^rollback;\s*$/m);
  for (const id of [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ]) {
    assert.match(fixture, new RegExp(id, 'g'));
  }
  for (const marker of [
    'WELLO_IDEMPOTENCY_MISMATCH',
    'WELLO_REVISION_CONFLICT',
    'RECORD_SCOPE_INVALID',
    'INVITE_EMAIL_UNCONFIRMED',
    'CANNOT_REMOVE_OWNER',
    'OWNER_CANNOT_LEAVE',
    'set local role authenticated',
    'set local role anon',
  ]) {
    assert.match(fixture, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(fixture, /set_config\(\s*'wello\.test\.context'/i);
  assert.match(fixture, /current_setting\('wello\.test\.context'/i);
  assert.match(fixture, /do \$\$[\s\S]*insert into auth\.users[\s\S]*\$\$;/i);
  assert.doesNotMatch(fixture, /create\s+temporary\s+table/i);
  assert.doesNotMatch(fixture, /^\s*grant\b/im);
  assert.match(fixture, /reset role;\s*update public\.household_invites[\s\S]*set local role authenticated;/i);
  assert.match(fixture, /reset role;\s*update auth\.users[\s\S]*set local role authenticated;/i);
  assert.match(fixture, /select jsonb_build_object\([\s\S]*'success',\s*true[\s\S]*'assertions'[\s\S]*\) as result\s*limit 1;[\s\S]*rollback;/i);
  assert.doesNotMatch(fixture, /after_statement/i);
});

// Keep this helper exercised so an accidental broad DML grant is visible in a
// failing test diff rather than hidden in a multiline SQL grant statement.
test('los grants textuales del artefacto no incluyen DML', () => {
  for (const line of grantLines(migration)) {
    assert.doesNotMatch(line, /\b(insert|update|delete)\b/i);
  }
});

test('la caducidad se limita a siete días en SQL, no sólo en la interfaz', () => {
  const createInvite = migration.split('create or replace function public.create_household_invite(')[1].split('$$;')[0];
  assert.match(createInvite, /v_expires := least\([\s\S]*now\(\) \+ interval '7 days'/);
  assert.doesNotMatch(createInvite, /interval '30 days'/);
  assert.match(fixture, /7-day cap/);
});
