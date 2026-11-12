import assert from 'node:assert/strict';
import test from 'node:test';
import { accountNamespace } from '../src/cloud-domain.js';
import { WelloCloudController } from '../src/cloud.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

class FakeElement {
  constructor(document, tag = 'div') {
    this.document = document;
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.innerHTML = '';
    this.dataset = {};
    this.hidden = false;
    this.listeners = new Map();
  }

  addEventListener(type, handler) { this.listeners.set(type, handler); }
  appendChild(child) { this.document.register(child); return child; }
  remove() { this.document.unregister(this); }
}

class FakeDocument {
  constructor() {
    this.title = 'Wello';
    this.documentElement = { dataset: {} };
    this.body = new FakeElement(this, 'body');
    this.head = new FakeElement(this, 'head');
    this.nodes = new Map();
  }

  createElement(tag) { return new FakeElement(this, tag); }
  register(element) { if (element?.id) this.nodes.set(element.id, element); return element; }
  unregister(element) { if (element?.id) this.nodes.delete(element.id); }
  getElementById(id) { return this.nodes.get(id) ?? null; }
}

function appMock() {
  const app = {
    namespace: 'local',
    locks: [],
    getNamespace() { return this.namespace; },
    async switchNamespace(namespace) { this.namespace = namespace; },
    setAccessLocked(locked) { this.locks.push(locked); },
  };
  return app;
}

function productionController({ app = appMock(), getUser = async (_token) => ({ data: { user: { id: 'user-a', email: 'a@example.test' } }, error: null }), document = new FakeDocument() } = {}) {
  const controller = new WelloCloudController({
    app,
    document,
    localStorage: memoryStorage(),
    configResult: { ok: true, message: 'ok', config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
  });
  controller.client = { auth: { getUser, signOut: async () => ({ error: null }) } };
  controller.mount();
  return { controller, app, document };
}

test('producción requiere getUser remoto y desbloquea sólo después del namespace correcto', async () => {
  const calls = [];
  const { controller, app, document } = productionController({
    getUser: async (token) => {
      calls.push(token);
      return { data: { user: { id: 'user-a', email: 'a@example.test' } }, error: null };
    },
  });

  controller.render();
  assert.equal(controller.requiresAuthentication(), true);
  assert.equal(controller.isAuthenticated(), false);
  assert.equal(document.documentElement.dataset.welloAuth, 'locked');
  assert.match(controller.root.innerHTML, /Tu espacio empieza contigo\./);
  assert.doesNotMatch(controller.root.innerHTML, /Continuar en modo local|wello-cloud-close/);

  await controller.handleSession('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a', email: 'a@example.test' } });
  assert.deepEqual(calls, ['token-a']);
  assert.equal(app.namespace, accountNamespace('user-a'));
  assert.equal(controller.authReady, true);
  assert.equal(controller.isAuthenticated(), true);
  assert.equal(document.documentElement.dataset.welloAuth, 'ready');
  assert.equal(app.locks.at(-1), false);
  assert.doesNotMatch(controller.root.innerHTML, /data-wello-cloud-action="local"/);
});

test('getUser inválido mantiene el gate cerrado y no borra copias locales', async () => {
  const localStorage = memoryStorage();
  localStorage.setItem('wello:cloud-conflict-backup:user-a:1', '{"userId":"user-a"}');
  const app = appMock();
  const document = new FakeDocument();
  const controller = new WelloCloudController({
    app,
    document,
    localStorage,
    configResult: { ok: true, message: 'ok', config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
  });
  controller.client = { auth: { getUser: async () => ({ data: { user: null }, error: new Error('token rechazado') }) } };
  controller.mount();

  await controller.handleSession('INITIAL_SESSION', { access_token: 'expired', user: { id: 'user-a' } });
  assert.equal(controller.authReady, false);
  assert.equal(controller.isAuthenticated(), false);
  assert.equal(controller.state.status, 'error');
  assert.equal(document.documentElement.dataset.welloAuth, 'locked');
  assert.equal(localStorage.getItem('wello:cloud-conflict-backup:user-a:1'), '{"userId":"user-a"}');
  assert.match(controller.root.innerHTML, /token rechazado/);
});

test('una verificación obsoleta no puede desbloquear una cuenta anterior', async () => {
  const pending = new Map();
  const { controller, app } = productionController({
    getUser: (token) => new Promise((resolve) => pending.set(token, resolve)),
  });
  const first = controller.handleSession('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a' } });
  const second = controller.handleSession('SIGNED_IN', { access_token: 'token-b', user: { id: 'user-b' } });

  pending.get('token-b')({ data: { user: { id: 'user-b' } }, error: null });
  await second;
  pending.get('token-a')({ data: { user: { id: 'user-a' } }, error: null });
  await first;

  assert.equal(controller.isAuthenticated(), true);
  assert.equal(controller.user.id, 'user-b');
  assert.equal(app.namespace, accountNamespace('user-b'));
});

test('TOKEN_REFRESHED no repite getUser cuando la sesión verificada sigue en el mismo namespace', async () => {
  let calls = 0;
  const { controller } = productionController({
    getUser: async () => {
      calls += 1;
      return { data: { user: { id: 'user-a' } }, error: null };
    },
  });
  const session = { access_token: 'token-a', user: { id: 'user-a' } };
  await controller.handleSession('INITIAL_SESSION', session);
  await controller.handleSession('TOKEN_REFRESHED', session);
  assert.equal(calls, 1);
  assert.equal(controller.isAuthenticated(), true);
});

test('un INITIAL_SESSION nulo obsoleto no pisa el callback válido observado', async () => {
  const app = appMock();
  const document = new FakeDocument();
  let emitAuth;
  const controller = new WelloCloudController({
    app,
    document,
    createClient() {
      return {
        auth: {
          onAuthStateChange(handler) {
            emitAuth = handler;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          getSession: async () => {
            emitAuth('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a' } });
            return { data: { session: null }, error: null };
          },
          getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
        },
      };
    },
    configResult: { ok: true, message: 'ok', config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
  });

  await controller.init();
  assert.equal(controller.isAuthenticated(), true);
  assert.equal(controller.user.id, 'user-a');
  assert.equal(app.namespace, accountNamespace('user-a'));
});

test('preview conserva el flujo local y no exige getUser', async () => {
  const app = appMock();
  const document = new FakeDocument();
  const controller = new WelloCloudController({
    app,
    document,
    configResult: { ok: false, reason: 'missing', message: 'sin configuración', config: {} },
  });
  controller.mount();
  await controller.handleSession('SIGNED_IN', { user: { id: 'preview-user' } });
  assert.equal(controller.requiresAuthentication(), false);
  assert.equal(controller.isAuthenticated(), true);
  assert.equal(document.documentElement.dataset.welloAuth, 'ready');
  assert.match(controller.root.innerHTML, /data-wello-cloud-action="local"/);
});

test('cerrar sesión reemplaza el panel inmediatamente antes de la respuesta remota', async () => {
  const { controller, document } = productionController();
  await controller.handleSession('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a', email: 'a@example.test' } });
  controller.open();
  assert.match(controller.root.innerHTML, /a@example.test/);
  let finish;
  controller.client.auth.signOut = () => new Promise(resolve => { finish = resolve; });
  const operation = controller.signOut();
  assert.equal(document.documentElement.dataset.welloAuth, 'locked');
  assert.equal(controller.isAuthenticated(), false);
  assert.match(controller.root.innerHTML, /wello-access-screen/);
  assert.doesNotMatch(controller.root.innerHTML, /a@example.test|Sincronizar ahora/);
  await Promise.resolve();
  finish({ error: null });
  await operation;
  assert.equal(controller.state.status, 'signed_out');
});

test('SIGNED_OUT observado durante getUser invalida la respuesta anterior sin desbloquearla', async () => {
  let finishUser;
  const { controller, app } = productionController({
    getUser: () => new Promise(resolve => { finishUser = resolve; }),
  });
  const operation = controller.enqueueAuthEvent('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a' } });
  await Promise.resolve();
  assert.equal(typeof finishUser, 'function');
  controller.queueAuthStateChange('SIGNED_OUT', null);
  finishUser({ data: { user: { id: 'user-a' } }, error: null });
  await operation;
  assert.equal(controller.isAuthenticated(), false);
  assert.equal(app.locks.includes(false), false, 'la cuenta A nunca debe desbloquearse');
  await Promise.resolve();
  await controller.authEventQueue;
  assert.equal(controller.state.status, 'signed_out');
  assert.equal(app.namespace, 'cloud:logged-out');
});

test('un callback de cuenta B durante getUser nunca deja visible la cuenta A', async () => {
  let finishA;
  const app = appMock();
  const unlocked = [];
  app.setAccessLocked = function(locked) { this.locks.push(locked); if (!locked) unlocked.push(this.namespace); };
  const { controller } = productionController({
    app,
    getUser: token => token === 'token-a'
      ? new Promise(resolve => { finishA = resolve; })
      : Promise.resolve({ data: { user: { id: 'user-b' } }, error: null }),
  });
  const operation = controller.enqueueAuthEvent('SIGNED_IN', { access_token: 'token-a', user: { id: 'user-a' } });
  await Promise.resolve();
  controller.queueAuthStateChange('SIGNED_IN', { access_token: 'token-b', user: { id: 'user-b' } });
  finishA({ data: { user: { id: 'user-a' } }, error: null });
  await operation;
  await Promise.resolve();
  await controller.authEventQueue;
  assert.equal(controller.user.id, 'user-b');
  assert.equal(controller.isAuthenticated(), true);
  assert.equal(unlocked.includes(accountNamespace('user-a')), false);
  assert.equal(app.namespace, accountNamespace('user-b'));
});

test('INITIAL_SESSION no nulo obsoleto no reemplaza un callback de cuenta más reciente', async () => {
  const app = appMock();
  const unlocked = [];
  app.setAccessLocked = function(locked) { this.locks.push(locked); if (!locked) unlocked.push(this.namespace); };
  let emit;
  const controller = new WelloCloudController({
    app, document: new FakeDocument(),
    configResult: { ok: true, message: 'ok', config: { url: 'https://project.supabase.co', key: 'sb_publishable_test', mode: 'production' } },
    createClient() {
      return { auth: {
        onAuthStateChange(handler) { emit = handler; return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: async () => {
          emit('SIGNED_IN', { access_token: 'token-b', user: { id: 'user-b' } });
          return { data: { session: { access_token: 'token-a', user: { id: 'user-a' } } }, error: null };
        },
        getUser: async token => ({ data: { user: { id: token === 'token-a' ? 'user-a' : 'user-b' } }, error: null }),
      } };
    },
  });
  await controller.init();
  await controller.authEventQueue;
  assert.equal(controller.user.id, 'user-b');
  assert.equal(controller.isAuthenticated(), true);
  assert.equal(app.namespace, accountNamespace('user-b'));
  assert.equal(unlocked.includes(accountNamespace('user-a')), false);
});
