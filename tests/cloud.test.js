import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CLOUD_STATE_VERSION,
  NFC_HASH,
  applyRemoteBlobs,
  accountNamespace,
  basePathFor,
  cacheStorageKey,
  callbackUrlFor,
  emptyCloudCache,
  householdRecordKey,
  isConflictError,
  isUuid,
  makeIdempotencyKey,
  mergeForReview,
  prepareCloudRecords,
  sanitizeNfcHash,
  savePendingNfcHash,
  takePendingNfcHash,
} from '../src/cloud-domain.js';
import { WelloCloudController, isPrivilegedSupabaseKey, readWelloConfig } from '../src/cloud.js';

const REMOTE_HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('separa namespace y cache por cuenta sin colisiones', () => {
  assert.notEqual(accountNamespace('user-a'), accountNamespace('user-b'));
  assert.notEqual(cacheStorageKey('user-a'), cacheStorageKey('user-b'));
  assert.equal(emptyCloudCache('user-a').version, CLOUD_STATE_VERSION);
  assert.equal(emptyCloudCache('user-a').userId, 'user-a');
  assert.throws(() => accountNamespace(''), /identificador válido/);
});

test('la configuración exige modo/url/clave pública y rechaza secretos', () => {
  assert.equal(readWelloConfig(undefined).reason, 'missing');
  assert.equal(readWelloConfig({ url: 'https://project.supabase.co', key: 'sb_publishable_1234567890', mode: 'production' }).ok, true);
  const anonPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
  assert.equal(readWelloConfig({ url: 'https://project.supabase.co', key: `eyJhbGciOiJIUzI1NiJ9.${anonPayload}.firma`, mode: 'production' }).ok, true);
  assert.equal(readWelloConfig({ url: 'https://project.supabase.co', key: 'not-a-public-supabase-key', mode: 'production' }).reason, 'invalid_key');
  assert.equal(readWelloConfig({ url: 'https://project.supabase.co', key: 'service_role_1234567890', mode: 'production' }).reason, 'privileged_key');
  assert.equal(readWelloConfig({ url: 'https://project.supabase.co', key: 'sb_secret_1234567890', mode: 'production' }).reason, 'privileged_key');
  assert.equal(isPrivilegedSupabaseKey('service_role_abc'), true);
  assert.equal(isPrivilegedSupabaseKey('sb_secret_abc'), true);
  assert.equal(isPrivilegedSupabaseKey('sb_publishable_abc'), false);
});

test('NFC solo acepta el destino explícito y se consume una vez', () => {
  assert.equal(sanitizeNfcHash('#super?accion=agregar'), NFC_HASH);
  assert.equal(sanitizeNfcHash('super?accion=agregar'), NFC_HASH);
  assert.equal(sanitizeNfcHash('#super?accion=agregar&otro=malicioso'), '');
  assert.equal(sanitizeNfcHash('#otra-ruta?accion=agregar'), '');
  const storage = memoryStorage();
  assert.equal(savePendingNfcHash(storage, '#super?accion=agregar'), NFC_HASH);
  assert.equal(takePendingNfcHash(storage), NFC_HASH);
  assert.equal(takePendingNfcHash(storage), '');
  storage.setItem('wello:nfc-pending', 'super?accion=agregar');
  assert.equal(takePendingNfcHash(storage), NFC_HASH);
  assert.equal(takePendingNfcHash(storage), '');
});

test('callback OAuth conserva la base relativa de Pages', () => {
  assert.equal(basePathFor('/primera-app/'), '/primera-app/');
  assert.equal(basePathFor('/primera-app/index.html'), '/primera-app/');
  assert.equal(callbackUrlFor({ origin: 'https://example.github.io', pathname: '/primera-app/' }), 'https://example.github.io/primera-app/');
  assert.throws(() => callbackUrlFor({ origin: 'javascript:alert(1)', pathname: '/primera-app/' }), /origen HTTPS/);
});

test('los ids locales no autorizan hogares: solo se preparan mapeos explícitos', () => {
  assert.equal(isUuid(REMOTE_HOUSEHOLD), true);
  assert.equal(householdRecordKey(REMOTE_HOUSEHOLD), `wello:state:household:${REMOTE_HOUSEHOLD}`);
  const state = {
    version: 3,
    personal: { moods: [{ id: 'mood:today' }] },
    households: [{ id: 'local-1', name: 'Casa', inventory: [{ id: 'milk' }] }],
  };
  const withoutMapping = prepareCloudRecords(state);
  assert.deepEqual(withoutMapping.unmappedLocalHouseholds, ['local-1']);
  assert.equal(withoutMapping.records.length, 1);
  const withMapping = prepareCloudRecords(state, { 'local-1': REMOTE_HOUSEHOLD });
  assert.equal(withMapping.records.length, 2);
  assert.equal(withMapping.records[1].remoteId, REMOTE_HOUSEHOLD);
});

test('la importación remota requiere mapping y no crea hogares implícitos', () => {
  const base = { version: 3, personal: { moods: [] }, households: [{ id: 'local-1', name: 'Casa local', inventory: [] }] };
  const remote = {
    personal: { data: { version: 3, personal: { moods: [{ id: 'mood:remote' }] } }, revision: 1 },
    households: { [REMOTE_HOUSEHOLD]: { data: { household: { id: REMOTE_HOUSEHOLD, name: 'Casa nube', inventory: [] } }, revision: 1 } },
  };
  const preview = applyRemoteBlobs(base, remote);
  assert.deepEqual(preview.unmappedRemoteHouseholds, [REMOTE_HOUSEHOLD]);
  assert.deepEqual(preview.state.personal.moods, [{ id: 'mood:remote' }]);
  assert.equal(preview.state.households[0].name, 'Casa local');
  const imported = applyRemoteBlobs(base, remote, { 'local-1': REMOTE_HOUSEHOLD });
  assert.deepEqual(imported.unmappedRemoteHouseholds, []);
  assert.equal(imported.state.households[0].name, 'Casa nube');
});

test('merge de revisión combina cambios disjuntos y rechaza last-wins', () => {
  const base = { name: 'Casa', color: 'mint', note: 'base' };
  const merged = mergeForReview({ base, local: { ...base, color: 'lavender' }, remote: { ...base, note: 'remoto' } });
  assert.equal(merged.status, 'merged');
  assert.deepEqual(merged.state, { name: 'Casa', color: 'lavender', note: 'remoto' });
  const conflict = mergeForReview({ base, local: { ...base, color: 'rosa' }, remote: { ...base, color: 'azul' } });
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.conflicts, ['color']);
  assert.equal(isConflictError({ code: 'WELLO_REVISION_CONFLICT' }), true);
  assert.equal(isConflictError({ status: 409 }), true);
});

test('operaciones estables son idempotentes y sensibles al sujeto', () => {
  assert.equal(makeIdempotencyKey('purchase', 'household-a'), makeIdempotencyKey('purchase', 'household-a'));
  assert.notEqual(makeIdempotencyKey('purchase', 'household-a'), makeIdempotencyKey('purchase', 'household-b'));
  assert.throws(() => makeIdempotencyKey('purchase', ''), /operación idempotente/);
});

test('el cliente online usa SDK oficial, configuración global y no claves privilegiadas', () => {
  const source = fs.readFileSync(new URL('../src/cloud.js', import.meta.url), 'utf8');
  assert.match(source, /@supabase\/supabase-js/);
  assert.match(source, /flowType:\s*['"]pkce['"]/);
  assert.match(source, /window\.WELLO_CONFIG/);
  assert.match(source, /service_role/);
  assert.match(source, /sb_secret_/);
  assert.match(source, /signInWithOAuth/);
  assert.match(source, /exchangeCodeForSession/);
});

test('el controlador limpia namespace al perder sesión y no cambia namespace durante TOKEN_REFRESHED', async () => {
  const switches = [];
  const app = {
    namespace: 'local',
    getNamespace() { return this.namespace; },
    async switchNamespace(namespace) { switches.push(namespace); this.namespace = namespace; },
    getState() { return {}; },
  };
  const controller = new WelloCloudController({
    app,
    configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} },
    localStorage: memoryStorage(),
  });
  const session = { user: { id: 'user-a', email: 'a@example.com' } };

  await controller.handleSession('SIGNED_IN', session);
  assert.deepEqual(switches, [accountNamespace('user-a')]);
  switches.length = 0;
  await controller.handleSession('TOKEN_REFRESHED', session);
  assert.deepEqual(switches, []);

  await controller.handleSession('SIGNED_OUT', null);
  assert.deepEqual(switches, ['cloud:logged-out']);
  assert.equal(controller.user, null);
  assert.equal(app.namespace, 'cloud:logged-out');

  await controller.handleSession('SIGNED_IN', session);
  switches.length = 0;
  await controller.handleSession('TOKEN_REFRESHED', null);
  assert.deepEqual(switches, ['cloud:logged-out']);
  assert.equal(controller.state.accountId, null);
  assert.equal(controller.state.namespace, null);
});

test('el destino NFC se consume una vez y deja la ruta base en #alimentos después de abrir', async () => {
  const storage = memoryStorage();
  savePendingNfcHash(storage, NFC_HASH);
  const urls = [];
  let opened = 0;
  const controller = new WelloCloudController({
    app: {
      getNamespace() { return 'local'; },
      async switchNamespace() {},
      openSuper() { opened += 1; },
    },
    location: { pathname: '/primera-app/', hash: '' },
    history: { replaceState(_state, _title, url) { urls.push(url); } },
    sessionStorage: storage,
    configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} },
  });

  await controller.handleSession('SIGNED_IN', { user: { id: 'user-a' } });
  assert.equal(opened, 1);
  assert.deepEqual(urls, ['/primera-app/#alimentos']);
  assert.equal(controller.consumeNfcDestination(), false);
  assert.equal(opened, 1);
  assert.equal(urls.length, 1);
});

test('un conflicto conserva la revisión CAS confiable para el siguiente intento', async () => {
  const localStorage = memoryStorage();
  const userId = 'user-a';
  const baseline = emptyCloudCache(userId);
  baseline.revisions.personal = 1;
  baseline.personal = { recordKey: 'wello:state:personal', data: { version: 3, personal: { moods: [{ id: 'base' }] } }, version: 3, revision: 1 };
  localStorage.setItem(cacheStorageKey(userId), JSON.stringify(baseline));
  const remote = { record_key: 'wello:state:personal', data: { version: 3, personal: { moods: [{ id: 'remote' }] } }, version: 3, revision: 2 };
  const queryBuilder = (data) => {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      limit() { return builder; },
      in() { return builder; },
      then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
    };
    return builder;
  };
  const client = {
    from(table) {
      if (table === 'private_records') return queryBuilder([remote]);
      if (table === 'household_members') return queryBuilder([]);
      return queryBuilder([]);
    },
    rpc() { return Promise.resolve({ data: null, error: { code: 'WELLO_REVISION_CONFLICT', message: 'revision conflict' } }); },
  };
  const controller = new WelloCloudController({
    app: { getState() { return { version: 3, personal: { moods: [{ id: 'local' }] }, households: [] }; } },
    localStorage,
    configResult: { ok: true, config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' }, message: 'ok' },
  });
  controller.client = client;
  await controller.handleSession('SIGNED_IN', { user: { id: userId } });

  const first = await controller.sync();
  assert.equal(first.status, 'conflict');
  assert.equal(controller.cache.revisions.personal, 1);
  assert.equal(JSON.parse(localStorage.getItem(cacheStorageKey(userId))).revisions.personal, 1);
  const second = await controller.sync();
  assert.equal(second.status, 'conflict');
  assert.equal(controller.cache.revisions.personal, 1);
});

test('la migración cubre RLS, WITH CHECK, search_path seguro y conflicto CAS', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/001_wello.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /security definer/gi);
  assert.match(sql, /set search_path = pg_catalog, public/gi);
  assert.match(sql, /with check/gi);
  assert.match(sql, /WELLO_REVISION_CONFLICT/g);
  assert.match(sql, /record_purchase_and_inventory/g);
  assert.doesNotMatch(sql, /set\s+role\s+/i);
});
