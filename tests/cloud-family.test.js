import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountNamespace,
  bootstrapRemoteState,
  deepMerge3way,
  emptyCloudCache,
  makeFreshOperationId,
  pendingInviteToken,
  sanitizeInviteHash,
  savePendingInviteToken,
} from '../src/cloud-domain.js';
import { WelloCloudController } from '../src/cloud.js';

const HOME_UUID = '11111111-1111-4111-8111-111111111111';
const SECOND_HOME_UUID = '22222222-2222-4222-8222-222222222222';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
}

function builder(data = [], error = null) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    in() { return chain; },
    limit(value) { chain.limitValue = value; return chain; },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); },
  };
  return chain;
}

function personalBlob(moods) {
  return { version: 3, personal: { sessions: [], habits: [], moods, appointments: [] } };
}

function householdBlob(id, name = 'Casa') {
  return { version: 3, household: { id, name, habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] } };
}

test('deep merge fusiona arrays por id y detecta delete-vs-edit', () => {
  const base = { items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], note: 'base' };
  const local = { items: [{ id: 'a', value: 3 }, { id: 'b', value: 2 }, { id: 'c', value: 4 }], note: 'base' };
  const remote = { items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'd', value: 5 }], note: 'remoto' };
  const merged = deepMerge3way({ base, local, remote });
  assert.equal(merged.status, 'merged');
  assert.deepEqual(merged.state.items, [{ id: 'a', value: 3 }, { id: 'b', value: 2 }, { id: 'c', value: 4 }, { id: 'd', value: 5 }]);
  assert.equal(merged.state.note, 'remoto');

  const deleted = { items: [] };
  const edited = { items: [{ id: 'a', value: 9 }] };
  const conflict = deepMerge3way({ base: { items: [{ id: 'a', value: 1 }] }, local: deleted, remote: edited });
  assert.equal(conflict.status, 'conflict');
  assert.match(conflict.conflicts[0], /items\[a\]/);
});

test('operaciones CAS nuevas contienen revisión y token fresco, incluso al volver a A', () => {
  const a1 = makeFreshOperationId('state-upsert', 'personal:key', 4);
  const a2 = makeFreshOperationId('state-upsert', 'personal:key', 4);
  const b = makeFreshOperationId('state-upsert', 'personal:key', 5);
  assert.notEqual(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /-r4-/);
  assert.match(b, /-r5-/);
});

test('bootstrap remoto reemplaza placeholder pero conserva hogares locales con datos', () => {
  const remote = {
    personal: { data: personalBlob([{ id: 'mood:remote', date: '2026-11-03', mood: 'feliz', note: '' }]), revision: 1 },
    households: { [HOME_UUID]: { data: householdBlob(HOME_UUID, 'Familia'), revision: 2 } },
  };
  const empty = { version: 3, personal: { sessions: [], habits: [], moods: [], appointments: [] }, households: [{ id: 'placeholder', name: 'Mi hogar', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }] };
  const adopted = bootstrapRemoteState(empty, remote, {});
  assert.equal(adopted.state.households[0].id, HOME_UUID);
  assert.equal(adopted.state.personal.moods[0].id, 'mood:remote');
  assert.equal(adopted.mappings[HOME_UUID], HOME_UUID);

  const local = structuredClone(empty);
  local.households[0].id = 'local-only';
  local.households[0].inventory.push({ id: 'milk', name: 'Leche', quantity: 1 });
  const preserved = bootstrapRemoteState(local, remote, {});
  assert.equal(preserved.state.households[0].id, 'local-only');
  assert.deepEqual(preserved.unmappedRemoteHouseholds, [HOME_UUID]);
});

test('bootstrap con placeholder de hogar conserva personal local significativo', () => {
  const remote = {
    personal: { data: personalBlob([{ id: 'mood:remote' }]), revision: 4 },
    households: { [HOME_UUID]: { data: householdBlob(HOME_UUID, 'Familia'), revision: 5 } },
  };
  const local = {
    version: 3,
    personal: { sessions: [], habits: [], moods: [{ id: 'mood:local' }], appointments: [] },
    households: [{ id: 'placeholder', name: 'Mi hogar', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }],
  };
  const result = bootstrapRemoteState(local, remote, {});
  assert.deepEqual(result.state.personal.moods, [{ id: 'mood:local' }]);
  assert.equal(result.state.households[0].id, HOME_UUID);
  assert.equal(result.adoptedPersonal, false);
});

test('invite hash se sanitiza y persiste durante OAuth sin aceptación automática', () => {
  const token = 'a'.repeat(64);
  const storage = memoryStorage();
  assert.equal(sanitizeInviteHash(`#invitacion?token=${token}`), `#invitacion?token=${token}`);
  assert.equal(sanitizeInviteHash(`#invitacion?token=${token}&extra=x`), '');
  savePendingInviteToken(storage, token);
  assert.equal(pendingInviteToken(storage), token);
  const calls = [];
  const controller = new WelloCloudController({
    app: { getNamespace() { return 'local'; }, getState() { return {}; } },
    sessionStorage: storage,
    location: { hash: `#invitacion?token=${token}`, pathname: '/primera-app/', origin: 'https://example.test' },
    history: { replaceState() {} },
    configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} },
  });
  controller.client = { rpc(...args) { calls.push(args); return Promise.resolve({ data: null, error: null }); } };
  const destination = controller.inviteDestinationFromHash();
  assert.equal(destination.status, 'confirmation_required');
  assert.equal(controller.peekPendingInvite(), token);
  assert.equal(calls.length, 0);
  assert.equal(controller.getState().pendingInvite, true);
  assert.equal(controller.getState().inviteToken, undefined);
});

test('miembros e invitaciones usan RPCs seguros y no exponen token_hash', async () => {
  const calls = [];
  const controller = new WelloCloudController({ configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} } });
  controller.user = { id: 'user-a' };
  controller.state.status = 'signed_in';
  controller.client = {
    rpc(name, params) {
      calls.push({ name, params });
      if (name === 'list_household_members') return Promise.resolve({ data: [{ user_id: 'u1', email: 'a@example.test', role: 'owner', joined_at: '2026-11-03' }], error: null });
      if (name === 'list_household_invites') return Promise.resolve({ data: [{ id: 'i1', household_id: HOME_UUID, email: 'b@example.test', role: 'member', expires_at: '2026-11-10', token_hash: 'secret' }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const members = await controller.getMembers(HOME_UUID);
  const invites = await controller.listInvites(HOME_UUID);
  assert.equal(calls[0].name, 'list_household_members');
  assert.equal(calls[1].name, 'list_household_invites');
  assert.equal(members[0].email, 'a@example.test');
  assert.equal(invites[0].email, 'b@example.test');
  assert.equal('token_hash' in invites[0], false);
});

test('createShared publica solo el hogar elegido y conserva mapping explícito', async () => {
  const localId = 'local-family';
  const localState = { version: 3, personal: { sessions: [], habits: [], moods: [], appointments: [] }, households: [{ id: localId, name: 'Familia', habits: [], pets: [], inventory: [{ id: 'milk', name: 'Leche', quantity: 1 }], shopping: [], purchases: [], stores: [] }], activeHousehold: localId };
  const saved = [];
  const app = {
    getNamespace() { return accountNamespace('user-a'); },
    getState() { return structuredClone(localState); },
    readLocalState() { return structuredClone(localState); },
    async setState(state, options) { saved.push({ state, options }); },
  };
  const rpcCalls = [];
  const boundOptions = [];
  const controller = new WelloCloudController({
    app,
    localStorage: memoryStorage(),
    configResult: { ok: true, config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
    createClient(_url, _key, options) {
      boundOptions.push(options);
      return { rpc: (...args) => controller._boundRpc(...args) };
    },
  });
  controller.user = { id: 'user-a' };
  controller.state.status = 'signed_in';
  controller.cache = emptyCloudCache('user-a');
  controller.client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'access-token-user-a', user: { id: 'user-a' } } }, error: null }) },
  };
  controller._boundRpc = (name, params) => {
      rpcCalls.push({ name, params });
      if (name === 'create_household') return Promise.resolve({ data: HOME_UUID, error: null });
      if (name === 'upsert_household_record') return Promise.resolve({ data: { record_key: `wello:state:household:${HOME_UUID}`, data: householdBlob(HOME_UUID, 'Familia'), version: 3, revision: 1 }, error: null });
      return Promise.resolve({ data: null, error: null });
  };
  const result = await controller.createShared('Familia', { localId });
  assert.equal(result.id, HOME_UUID);
  assert.equal(controller.householdMappings[localId], HOME_UUID);
  assert.equal(rpcCalls[0].name, 'create_household');
  assert.match(rpcCalls[0].params.p_operation_id, /-r0-/);
  assert.equal(rpcCalls[1].name, 'upsert_household_record');
  assert.equal(boundOptions[0].global.headers.Authorization, 'Bearer access-token-user-a');
  assert.equal(boundOptions[0].auth.persistSession, false);
  assert.equal(saved.at(-1).state.households[0].id, HOME_UUID);
});

test('una carrera de cuenta invalida el snapshot y no aplica estado remoto', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = new WelloCloudController({
    app: { getState() { return { version: 3, personal: { sessions: [], habits: [], moods: [], appointments: [] }, households: [{ id: 'local', name: 'Local', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }] }; }, getNamespace() { return accountNamespace('user-a'); } },
    configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} },
  });
  controller.user = { id: 'user-a' };
  controller.state.status = 'signed_in';
  controller.cache = emptyCloudCache('user-a');
  controller.client = {
    from() { return { select() { return this; }, eq() { return this; }, in() { return this; }, limit() { return this; }, then(resolve, reject) { return pending.then(() => ({ data: [], error: null })).then(resolve, reject); } }; },
  };
  const run = controller.sync();
  controller.generation += 1;
  release();
  const result = await run;
  assert.equal(result.status, 'stale');
});

test('aceptar invitación adopta baseline de hogar pero no inventa baseline personal local', async () => {
  const remotePersonal = personalBlob([{ id: 'mood:remote' }]);
  const remoteHome = householdBlob(HOME_UUID, 'Familia');
  const localState = {
    version: 3,
    personal: { sessions: [], habits: [], moods: [{ id: 'mood:local' }], appointments: [] },
    households: [{ id: 'placeholder', name: 'Mi hogar', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }],
  };
  const saved = [];
  let controller;
  const app = {
    getNamespace() { return accountNamespace('user-a'); },
    getState() { return structuredClone(localState); },
    async setState(state) { saved.push(state); },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'access-token-user-a', user: { id: 'user-a' } } }, error: null }) },
    from(table) {
      if (table === 'private_records') return builder([{ record_key: 'wello:state:personal', data: remotePersonal, version: 3, revision: 1 }]);
      if (table === 'household_members') return builder([{ household_id: HOME_UUID, role: 'member', joined_at: '2026-11-03' }]);
      if (table === 'household_records') return builder([{ household_id: HOME_UUID, record_key: `wello:state:household:${HOME_UUID}`, data: remoteHome, version: 3, revision: 2 }]);
      if (table === 'households') return builder([{ id: HOME_UUID, name: 'Familia' }]);
      return builder([]);
    },
  };
  const localStorage = memoryStorage();
  controller = new WelloCloudController({
    app,
    localStorage,
    configResult: { ok: true, config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
    createClient() { return { rpc: (name) => name === 'accept_household_invite' ? Promise.resolve({ data: HOME_UUID, error: null }) : Promise.resolve({ data: null, error: null }) }; },
  });
  controller.client = client;
  controller.user = { id: 'user-a' };
  controller.state = { ...controller.state, status: 'signed_in', accountId: 'user-a', namespace: accountNamespace('user-a') };
  controller.cache = emptyCloudCache('user-a');

  const result = await controller.acceptInvite('a'.repeat(64));
  assert.equal(result.homeUuid, HOME_UUID);
  assert.equal(saved.at(-1).personal.moods[0].id, 'mood:local');
  assert.equal(controller.cache.personal, null);
  assert.equal(controller.cache.households[HOME_UUID].revision, 2);
});

test('sync propaga nombre canónico de households a hogar local y cache sin reescribir blob', async () => {
  const localId = 'local-family';
  const localState = { version: 3, personal: { sessions: [], habits: [], moods: [], appointments: [] }, households: [{ id: localId, name: 'Nombre viejo', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }], activeHousehold: localId };
  const saved = [];
  const app = {
    getNamespace() { return accountNamespace('user-a'); },
    getState() { return structuredClone(localState); },
    async setState(state) { saved.push(state); },
  };
  const controller = new WelloCloudController({ app, configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} } });
  controller.user = { id: 'user-a' };
  controller.state = { ...controller.state, status: 'signed_in', accountId: 'user-a', namespace: accountNamespace('user-a') };
  controller.cache = emptyCloudCache('user-a');
  controller.householdMappings = { [localId]: HOME_UUID };
  controller.cache.mappings = { [localId]: HOME_UUID };
  controller.cache.households[HOME_UUID] = { recordKey: `wello:state:household:${HOME_UUID}`, data: householdBlob(HOME_UUID, 'Nombre viejo'), version: 3, revision: 1 };
  controller.cache.revisions.households[HOME_UUID] = 1;
  controller.client = {
    from(table) {
      if (table === 'private_records') return builder([]);
      if (table === 'household_members') return builder([{ household_id: HOME_UUID, role: 'member', joined_at: '2026-11-03' }]);
      if (table === 'household_records') return builder([{ household_id: HOME_UUID, record_key: `wello:state:household:${HOME_UUID}`, data: householdBlob(HOME_UUID, 'Nombre viejo'), version: 3, revision: 1 }]);
      if (table === 'households') return builder([{ id: HOME_UUID, name: 'Nombre canónico' }]);
      return builder([]);
    },
  };
  const result = await controller.sync();
  assert.equal(result.status, 'synced');
  assert.equal(saved.at(-1).households[0].name, 'Nombre canónico');
  assert.equal(controller.cache.households[HOME_UUID].data.household.name, 'Nombre canónico');
});
