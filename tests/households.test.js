import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHouseholds, registerHouseholds, inviteTokenFromHash } from '../src/modules/households.js';

const TOKEN = 'a'.repeat(64);
const REMOTE_ID = '11111111-1111-4111-8111-111111111111';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function context({ cloud = null, state = null } = {}) {
  const actions = new Map();
  const modals = [];
  const toasts = [];
  const renders = [];
  const current = state || {
    version: 3,
    personal: { sessions: [], habits: [], moods: [], appointments: [] },
    households: [{ id: 'local-1', name: 'Casa local', habits: [], pets: [], inventory: [], shopping: [], purchases: [], stores: [] }],
    activeHousehold: 'local-1',
  };
  const view = {};
  const ctx = {
    state: () => current,
    home: () => current.households[0],
    view,
    esc: escapeHtml,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    btn: (label, action, extra = '', kind = 'primary') => `<button class="btn ${kind}" data-action="${action}" ${extra}>${label}</button>`,
    field: (label, name, value = '', type = 'text', extra = '') => `<label>${escapeHtml(label)}<input name="${name}" value="${escapeHtml(value)}" type="${type}" ${extra}></label>`,
    prettyDate: value => value,
    action: (name, handler) => actions.set(name, handler),
    modal: (title, html, onSubmit, submitLabel) => { modals.push({ title, html, onSubmit, submitLabel }); },
    confirm: (message, callback) => { modals.push({ title: '¿Confirmamos?', message, callback }); },
    render: () => { renders.push(true); },
    toast: message => { toasts.push(message); },
    readLocalState: () => current,
  };
  const previous = globalThis.window;
  globalThis.window = { WelloCloud: cloud };
  return {
    ctx,
    actions,
    modals,
    toasts,
    renders,
    state: current,
    restore() { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; },
  };
}

test('renderiza hogares locales y compartidos sin mezclar datos personales', () => {
  const mock = context({ cloud: { isAuthenticated: () => true } });
  mock.ctx.view.cloudHomes = [{ id: REMOTE_ID, name: 'Casa compartida', role: 'owner' }];
  const html = renderHouseholds(mock.ctx);
  assert.match(html, /Casa local/);
  assert.match(html, /Casa compartida/);
  assert.match(html, /Compartir este hogar/);
  assert.match(html, /Miembros e invitaciones/);
  assert.doesNotMatch(html, /Salir del hogar/);
  assert.match(html, /Gym, mood, citas/);
  mock.restore();
});

test('un miembro solo ve la salida confirmable, no la administración de propietaria', () => {
  const mock = context({ cloud: { isAuthenticated: () => true } });
  mock.ctx.view.cloudHomes = [{ id: REMOTE_ID, name: 'Casa compartida', role: 'member' }];
  const html = renderHouseholds(mock.ctx);
  assert.match(html, /Salir del hogar/);
  assert.doesNotMatch(html, /Miembros e invitaciones/);
  assert.doesNotMatch(html, /Renombrar hogar compartido/);
  mock.restore();
});

test('publicar hogar requiere confirmación explícita y solo envía localId', async () => {
  const calls = [];
  const mock = context({ cloud: {
    isAuthenticated: () => true,
    createShared: async (...args) => { calls.push(args); return { id: REMOTE_ID, name: 'Casa local', role: 'owner' }; },
  } });
  registerHouseholds(mock.ctx);
  await mock.actions.get('household-publish')({ localId: 'local-1' });
  assert.equal(mock.modals.length, 1);
  assert.match(mock.modals[0].html, /mascotas/);
  assert.match(mock.modals[0].html, /No incluye/);
  await mock.modals[0].onSubmit({}, null);
  assert.deepEqual(calls, [['Casa local', { localId: 'local-1' }]]);
  assert.equal(mock.state.personal.moods.length, 0);
  assert.equal(mock.modals.length, 2);
  assert.equal(mock.modals[1].title, 'Hogar compartido');
  mock.restore();
});

test('invitación queda ligada al correo, muestra enlace de 7 días y no envía correo', async () => {
  const url = `https://example.test/#invitacion?token=${TOKEN}`;
  let calls = 0;
  const mock = context({ cloud: {
    isAuthenticated: () => true,
    getState: () => ({ status: 'signed_in', email: 'persona@example.test' }),
    createInvite: async payload => { calls += 1; assert.deepEqual(payload, { householdId: REMOTE_ID, email: 'persona@example.test' }); return { invite: { id: 'invite-1', expires_at: '2026-11-10' }, url }; },
  } });
  mock.ctx.view.cloudHomes = [{ id: REMOTE_ID, name: 'Casa compartida', role: 'owner' }];
  registerHouseholds(mock.ctx);
  await mock.actions.get('household-invite')({ householdId: REMOTE_ID });
  const form = { querySelector: () => null };
  await mock.modals[0].onSubmit({ email: 'Persona@Example.test' }, form);
  assert.equal(calls, 1);
  assert.match(mock.modals.at(-1).html, /persona@example\.test/);
  assert.match(mock.modals.at(-1).html, /7 días/);
  assert.match(mock.modals.at(-1).html, new RegExp(TOKEN));
  assert.match(mock.modals.at(-1).html, /No se envió ningún correo/);
  mock.restore();
});

test('un formulario asíncrono ocupado no duplica la invitación y permite reintentar después', async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const mock = context({ cloud: {
    isAuthenticated: () => true,
    createInvite: async () => { calls += 1; await pending; return { url: `https://example.test/#invitacion?token=${TOKEN}` }; },
  } });
  registerHouseholds(mock.ctx);
  await mock.actions.get('household-invite')({ householdId: REMOTE_ID });
  const form = { button: { disabled: false, dataset: {}, setAttribute() {}, removeAttribute() {} }, querySelector() { return this.button; } };
  const first = mock.modals[0].onSubmit({ email: 'a@example.test' }, form);
  const second = await mock.modals[0].onSubmit({ email: 'a@example.test' }, form);
  assert.equal(second, false);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(form.button.disabled, false);
  mock.restore();
});

test('aceptar una invitación requiere cuenta y confirmación, nunca se ejecuta al renderizar', async () => {
  assert.equal(inviteTokenFromHash(`#invitacion?token=${TOKEN}`), TOKEN);
  assert.equal(inviteTokenFromHash('#invitacion?token=not-valid'), '');
  let accepted = '';
  const mock = context({ cloud: {
    isAuthenticated: () => true,
    getState: () => ({ status: 'signed_in', email: 'persona@example.test' }),
    acceptInvite: async token => { accepted = token; return { homeUuid: REMOTE_ID }; },
    listHouseholds: async () => [],
  } });
  globalThis.location = { hash: `#invitacion?token=${TOKEN}`, pathname: '/', search: '' };
  registerHouseholds(mock.ctx);
  const html = renderHouseholds(mock.ctx);
  assert.match(html, /persona@example\.test/);
  assert.equal(accepted, '');
  await mock.actions.get('household-accept-invite')();
  assert.equal(mock.modals.length, 1);
  assert.match(mock.modals[0].message, /persona@example\.test/);
  await mock.modals[0].callback();
  assert.equal(accepted, TOKEN);
  delete globalThis.location;
  mock.restore();
});

test('un hogar remoto no aparece como local ni ofrece el renombrado local a un miembro', () => {
  const mock = context({ cloud: { isAuthenticated: () => true } });
  mock.state.households.push({ id: REMOTE_ID, name: 'Hogar familiar remoto', pets: [], habits: [], inventory: [], shopping: [], purchases: [], stores: [] });
  mock.ctx.view.cloudHomes = [{ id: REMOTE_ID, name: 'Hogar familiar remoto', role: 'member' }];
  const html = renderHouseholds(mock.ctx);
  assert.equal((html.match(/<h2>Hogar familiar remoto<\/h2>/g) || []).length, 1);
  assert.ok(html.includes(`data-action="home-switch" data-id="${REMOTE_ID}"`));
  assert.ok(!html.includes(`data-action="home-rename" data-id="${REMOTE_ID}"`));
  assert.ok(!html.includes(`data-local-id="${REMOTE_ID}"`));
  mock.restore();
});

test('la importación local confirmada llama al controlador con confirm true y no cambia la copia original', async () => {
  let options;
  const mock = context({ cloud: {
    isAuthenticated: () => true,
    importFromLocal: async value => { options = value; return { status: 'imported' }; },
  } });
  const original = JSON.stringify(mock.state);
  registerHouseholds(mock.ctx);
  await mock.actions.get('data-import-local')();
  assert.equal(options, undefined);
  await mock.modals.at(-1).onSubmit({}, null);
  assert.deepEqual(options, { confirm: true });
  assert.equal(JSON.stringify(mock.state), original);
  assert.ok(mock.toasts.at(-1).includes('importada'));
  mock.restore();
});
