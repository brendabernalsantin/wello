import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storageKey } from '../src/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_FILE = path.join(ROOT, 'dist', 'index.html');
const LOCAL_FILE = path.join(ROOT, 'entregables', 'Wello.html');
const ARTIFACT = path.join(ROOT, 'artifacts', 'auth-access-ui-results.json');
const TARGET = process.env.WELLO_AUTH_UI_URL || pathToFileURL(DIST_FILE).href;
const USER_ID = '4a8f9e31-7b8c-4d2e-9f10-1234567890ab';
const USER_EMAIL = 'auth-ui@example.test';
const CACHE_KEY = `wello:cloud-cache:${encodeURIComponent(USER_ID)}`;
const ACCOUNT_DATA_KEY = storageKey(`cloud:${encodeURIComponent(USER_ID)}`);
const AUTH_CACHE_MARKER = 'AUTH_UI_PRIVATE_CACHE_MUST_SURVIVE';

const productionHtml = await fs.readFile(DIST_FILE, 'utf8');
const configMatch = productionHtml.match(/window\.WELLO_CONFIG\s*=\s*(\{.*?\})\s*;/s);
const publicConfig = configMatch
  ? JSON.parse(configMatch[1])
  : JSON.parse(await fs.readFile(path.join(ROOT, 'wello-public-config.json'), 'utf8'));
if (publicConfig?.mode !== 'production' || !publicConfig?.url) {
  throw new Error('dist/index.html no contiene una configuración de producción de Supabase. Ejecuta el build de producción antes de este test.');
}
const SUPABASE_ORIGIN = new URL(publicConfig.url).origin;
const PROJECT_REF = new URL(publicConfig.url).hostname.split('.')[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const json = (value) => JSON.stringify(value);
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeJwt() {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({
      aud: 'authenticated',
      role: 'authenticated',
      sub: USER_ID,
      email: USER_EMAIL,
      email_verified: true,
      iat: now - 10,
      exp: now + 3600,
      iss: `${SUPABASE_ORIGIN}/auth/v1`,
      session_id: 'auth-ui-session',
    }),
    'auth-ui-test-signature',
  ].join('.');
}

function makeUser() {
  const now = new Date().toISOString();
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: USER_EMAIL,
    email_confirmed_at: now,
    phone: '',
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Auth UI Test' },
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function makeSession() {
  const accessToken = makeJwt();
  return {
    access_token: accessToken,
    refresh_token: 'auth-ui-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: makeUser(),
  };
}

const accountCache = {
  version: 1,
  userId: USER_ID,
  namespace: `cloud:${encodeURIComponent(USER_ID)}`,
  privateMarker: AUTH_CACHE_MARKER,
  personal: { data: { personal: { marker: AUTH_CACHE_MARKER } }, revision: 7 },
  households: {},
  mappings: {},
  memberships: [],
  revisions: { personal: 7, households: {} },
};

async function installStorage(context, scenario) {
  await context.addInitScript(({ storageKey, session, cacheKey, cache }) => {
    window.localStorage.clear();
    if (session) {
      const serialized = JSON.stringify(session);
      window.localStorage.setItem(storageKey, serialized);
      // GoTrue uses this companion key when the SDK has userStorage enabled.
      window.localStorage.setItem(`${storageKey}-user`, JSON.stringify({ user: session.user }));
    }
    if (cache) window.localStorage.setItem(cacheKey, JSON.stringify(cache));
  }, {
    storageKey: STORAGE_KEY,
    session: scenario.session ? makeSession() : null,
    cacheKey: CACHE_KEY,
    cache: scenario.seedCache ? accountCache : null,
  });
}

async function createScenario(browser, scenario = {}) {
  const options = {
    auth: 'signed_out',
    userDelayMs: 0,
    logoutDelayMs: 0,
    oauthError: false,
    seedCache: false,
    ...scenario,
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Mexico_City',
  });
  await installStorage(context, {
    ...options,
    session: options.auth === 'valid' || options.auth === 'invalid' || options.auth === 'failure',
  });

  const requests = [];
  const unexpectedExternal = [];
  const restWrites = [];
  const rpcWrites = [];
  const userRequests = [];
  const logoutRequests = [];
  const user = makeUser();

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    requests.push({ method: request.method(), url: requestUrl });

    if (requestUrl.startsWith(SUPABASE_ORIGIN)) {
      const parsed = new URL(requestUrl);
      const pathname = parsed.pathname;
      const method = request.method().toUpperCase();

      if (pathname === '/auth/v1/user') {
        userRequests.push({ at: Date.now(), method });
        if (options.userDelayMs > 0) await delay(options.userDelayMs);
        if (options.auth === 'invalid') {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: json({ code: 'invalid_token', error_code: 'invalid_token', msg: 'Invalid JWT' }),
          });
          return;
        }
        if (options.auth === 'failure') {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: json({ code: 'service_unavailable', msg: 'Auth verification unavailable in test' }),
          });
          return;
        }
        if (options.auth === 'valid') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: json(user) });
          return;
        }
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: json({ code: 'no_session', error_code: 'session_not_found', msg: 'No active session' }),
        });
        return;
      }

      if (pathname === '/auth/v1/token') {
        // The session is deliberately far from expiry. This response also prevents
        // an accidental refresh from escaping to a real Auth service.
        await route.fulfill({ status: 200, contentType: 'application/json', body: json(makeSession()) });
        return;
      }

      if (pathname === '/auth/v1/logout') {
        logoutRequests.push({ at: Date.now(), method });
        if (options.logoutDelayMs > 0) await delay(options.logoutDelayMs);
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      if (pathname === '/auth/v1/authorize') {
        if (options.oauthError) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: json({ error: 'access_denied', error_description: 'Google test denial' }),
          });
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', body: json({}) });
        }
        return;
      }

      if (pathname.startsWith('/rest/v1/rpc/')) {
        if (method !== 'GET' && method !== 'HEAD') rpcWrites.push({ method, pathname });
        const rpcName = pathname.slice('/rest/v1/rpc/'.length);
        const data = rpcName === 'create_household' ? { id: '00000000-0000-4000-8000-000000000001' } : null;
        await route.fulfill({ status: 200, contentType: 'application/json', body: json(data) });
        return;
      }

      if (pathname.startsWith('/rest/v1/')) {
        if (method !== 'GET' && method !== 'HEAD') restWrites.push({ method, pathname });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }

      if (pathname.startsWith('/realtime/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    if (/^https?:/i.test(requestUrl)) {
      unexpectedExternal.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => {
    page.__authUiErrors ??= [];
    page.__authUiErrors.push(error.message);
  });
  page.__authUiRequests = requests;
  page.__authUiExternal = unexpectedExternal;
  page.__authUiRestWrites = restWrites;
  page.__authUiRpcWrites = rpcWrites;
  page.__authUiUserRequests = userRequests;
  page.__authUiLogoutRequests = logoutRequests;
  return { context, page, options };
}

function fileTarget(file = DIST_FILE, suffix = '') {
  return `${pathToFileURL(file).href}${suffix}`;
}

async function waitForCloud(page) {
  await page.waitForFunction(() => Boolean(window.WelloApp && window.WelloCloud));
}

async function waitForLocked(page) {
  await page.waitForFunction(() => document.documentElement.dataset.welloAuth === 'locked');
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    const dialog = document.getElementById('dialog');
    return Boolean(app?.hidden && app?.inert && dialog && !dialog.open);
  });
}

async function waitForAuthenticated(page) {
  await page.waitForFunction(() => window.WelloCloud?.isAuthenticated?.() === true, null, { timeout: 5000 });
  await page.waitForFunction(() => document.documentElement.dataset.welloAuth === 'ready');
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return Boolean(app && !app.hidden && !app.inert);
  });
}

async function assertNoUnexpectedNetwork(page, label) {
  assert.deepEqual(page.__authUiExternal, [], `${label}: hubo una petición HTTP externa no interceptada`);
  assert.equal(page.__authUiRestWrites.length, 0, `${label}: se intentó escribir en REST`);
  assert.equal(page.__authUiRpcWrites.length, 0, `${label}: se intentó escribir por RPC`);
}

async function assertLockedSurface(page, label) {
  assert.equal(await page.locator('#app').isVisible(), false, `${label}: #app no debe ser visible`);
  assert.equal(await page.locator('#app').getAttribute('inert'), '', `${label}: #app debe ser inert`);
  assert.equal(await page.locator('#dialog').evaluate((dialog) => dialog.open), false, `${label}: dialog debe estar cerrado`);
  assert.equal(await page.locator('#main').textContent(), '', `${label}: #main no debe exponer datos privados`);
  assert.equal(await page.locator('#main').innerHTML(), '', `${label}: #main debe quedar vacío`);
  assert.equal(await page.locator('#wello-access-screen').count(), 1, `${label}: falta la pantalla de acceso raíz`);
  assert.equal(await page.locator('#wello-access-screen').isVisible(), true, `${label}: la pantalla de acceso debe ser visible`);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});

const results = [];
const allPageErrors = [];
let passed = 0;

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    passed += 1;
    results.push({ name, status: 'passed', durationMs: Date.now() - startedAt });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: error.message });
    throw error;
  }
}

try {
  await check('CSS de producción bloquea la app antes de JavaScript y deja una pantalla sin JS', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const external = [];
    await context.route('**/*', async (route) => {
      if (/^https?:/i.test(route.request().url())) {
        external.push(route.request().url());
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
    const page = await context.newPage();
    await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#app').evaluate((app) => getComputedStyle(app).display, null), 'none');
    assert.equal(await page.locator('#app').isVisible(), false);
    assert.equal(await page.locator('#dialog').evaluate((dialog) => getComputedStyle(dialog).display, null), 'none');
    const accessFallback = page.locator('#wello-access-screen, #wello-access-fallback').first();
    assert.equal(await accessFallback.count(), 1, 'la producción sin JS necesita una pantalla/fallback de acceso');
    assert.equal(await accessFallback.isVisible(), true, 'la pantalla/fallback sin JS debe quedar visible');
    assert.deepEqual(external, []);
    await context.close();
  });

  await check('Producción firmada fuera muestra sólo acceso, bloquea hashes y no permite local/close como bypass', async () => {
    const fixture = await createScenario(browser, { auth: 'signed_out' });
    const { page } = fixture;
    allPageErrors.push(...(page.__authUiErrors ?? []));
    try {
      await page.goto(fileTarget(DIST_FILE));
      await waitForCloud(page);
      await waitForLocked(page);
      await assertLockedSurface(page, 'signed-out inicial');
      assert.equal(await page.locator('[data-nav]:visible').count(), 0, 'la navegación no debe quedar expuesta');
      assert.equal(await page.locator('[data-wello-cloud-action="local"]').count(), 0, 'producción no debe ofrecer continuar en local');
      assert.equal(await page.evaluate(() => window.WelloApp.getNamespace()), 'cloud:logged-out');

      for (const hash of ['#gym', '#super?accion=agregar', `#invitacion?token=${'a'.repeat(64)}`]) {
        await page.goto(fileTarget(DIST_FILE, hash));
        await waitForCloud(page);
        await waitForLocked(page);
        await assertLockedSurface(page, `hash ${hash}`);
      }

      const bypassResult = await page.evaluate(() => {
        const navigateResult = window.WelloApp.navigate('gym');
        let localError = '';
        try { window.WelloCloud.enterLocalMode(); } catch (error) { localError = error.message; }
        window.WelloCloud.close();
        return { navigateResult, localError, namespace: window.WelloApp.getNamespace() };
      });
      assert.equal(bypassResult.navigateResult, false, 'navigate no debe abrir una ruta bloqueada');
      assert.match(bypassResult.localError, /no está disponible en producción/, 'el método local debe rechazar el acceso');
      await waitForLocked(page);
      await assertLockedSurface(page, 'enterLocalMode/close directos');
      assert.equal(await page.evaluate(() => window.WelloCloud.isAuthenticated()), false);
      assert.equal(await page.locator('[data-wello-cloud-action="google"]').isEnabled(), true, 'Google debe seguir siendo la única entrada');
      await assertNoUnexpectedNetwork(page, 'signed-out');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('La pantalla de login no tiene overflow horizontal en 320, 390, 768 y 1440 px', async () => {
    const fixture = await createScenario(browser, { auth: 'signed_out' });
    const { page } = fixture;
    try {
      await page.goto(fileTarget(DIST_FILE));
      await waitForCloud(page);
      await waitForLocked(page);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width <= 390 ? 640 : 900 });
        const measurements = await page.evaluate(() => ({
          innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          rootWidth: document.getElementById('wello-cloud-root')?.scrollWidth ?? 0,
        }));
        assert(measurements.documentWidth <= measurements.innerWidth, `document overflow en ${width}px: ${JSON.stringify(measurements)}`);
        assert(measurements.bodyWidth <= measurements.innerWidth, `body overflow en ${width}px: ${JSON.stringify(measurements)}`);
        assert(measurements.rootWidth <= measurements.innerWidth, `access root overflow en ${width}px: ${JSON.stringify(measurements)}`);
        await assertLockedSurface(page, `responsive ${width}`);
      }
      await assertNoUnexpectedNetwork(page, 'responsive');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('La app permanece oculta mientras getUser verifica y sólo después abre el namespace de cuenta', async () => {
    const fixture = await createScenario(browser, { auth: 'valid', userDelayMs: 700 });
    const { page } = fixture;
    try {
      await page.goto(fileTarget(DIST_FILE));
      await waitForCloud(page);
      await page.waitForSelector('#wello-access-screen');
      await waitForLocked(page);
      assert.equal(await page.evaluate(() => window.WelloCloud.getState().status), 'checking');
      assert.equal(await page.evaluate(() => window.WelloApp.getNamespace()), 'cloud:logged-out');
      assert.equal(await page.locator('#main').innerHTML(), '');
      assert.equal(page.__authUiUserRequests.length >= 1, true, 'el caso no llegó a getUser');
      await waitForAuthenticated(page);
      assert.equal(await page.evaluate(() => window.WelloCloud.getState().accountId), USER_ID);
      assert.equal(await page.evaluate(() => window.WelloCloud.getState().email), USER_EMAIL);
      assert.equal(await page.evaluate(() => window.WelloApp.getNamespace()), `cloud:${encodeURIComponent(USER_ID)}`);
      assert.equal(await page.locator('#wello-access-screen').count(), 0, 'la pantalla de acceso no debe quedar superpuesta');
      assert.equal(await page.locator('#main').isVisible(), true);
      await assertNoUnexpectedNetwork(page, 'delayed getUser');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('Una respuesta 401 de getUser mantiene el bloqueo, oculta el namespace y conserva el caché privado', async () => {
    const fixture = await createScenario(browser, { auth: 'invalid', seedCache: true });
    const { page } = fixture;
    try {
      await page.goto(fileTarget(DIST_FILE));
      await waitForCloud(page);
      await page.waitForTimeout(80);
      assert.equal(fixture.page.__authUiUserRequests.length >= 1, true, 'el caso no llegó a getUser');
      await waitForLocked(page);
      assert.equal(await page.evaluate(() => window.WelloCloud.isAuthenticated()), false);
      assert.equal(await page.evaluate(() => window.WelloCloud.getState().accountId), null);
      assert.equal(await page.evaluate(() => window.WelloApp.getNamespace()), 'cloud:logged-out');
      await assertLockedSurface(page, 'getUser 401');
      const cached = await page.evaluate((cacheKey) => localStorage.getItem(cacheKey), CACHE_KEY);
      assert.match(cached ?? '', new RegExp(AUTH_CACHE_MARKER));
      await assertNoUnexpectedNetwork(page, 'getUser 401');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('Un error de Google o de verificación nunca desbloquea la app', async () => {
    const fixture = await createScenario(browser, { auth: 'signed_out', oauthError: true });
    const { page } = fixture;
    try {
      await page.goto(fileTarget(DIST_FILE, '?error=access_denied&error_description=Google%20denied')); 
      await waitForCloud(page);
      await waitForLocked(page);
      await assertLockedSurface(page, 'callback Google error');
      assert.match(await page.locator('#wello-access-screen').textContent(), /Google|sesión|Inicia/i);

      const failureFixture = await createScenario(browser, { auth: 'failure', seedCache: true });
      try {
        await failureFixture.page.goto(fileTarget(DIST_FILE));
        await waitForCloud(failureFixture.page);
        await waitForLocked(failureFixture.page);
        assert.equal(await failureFixture.page.evaluate(() => window.WelloCloud.isAuthenticated()), false);
        assert.equal(await failureFixture.page.evaluate(() => window.WelloApp.getNamespace()), 'cloud:logged-out');
        await assertLockedSurface(failureFixture.page, 'error de Auth server');
        await assertNoUnexpectedNetwork(failureFixture.page, 'error de Auth server');
      } finally {
        allPageErrors.push(...(failureFixture.page.__authUiErrors ?? []));
        await failureFixture.context.close();
      }
      await assertNoUnexpectedNetwork(page, 'callback Google error');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('Cerrar sesión bloquea antes de que responda la red, cierra dialog y conserva la copia de cuenta', async () => {
    const fixture = await createScenario(browser, { auth: 'valid', logoutDelayMs: 900, seedCache: true });
    const { page } = fixture;
    try {
      await page.goto(fileTarget(DIST_FILE));
      await waitForCloud(page);
      await waitForAuthenticated(page);
      await page.evaluate(() => window.WelloApp.navigate('habitos'));
      await page.waitForFunction(() => document.body.dataset.page === 'habitos');
      await page.locator('[data-action="habit-new"]').first().click();
      await page.waitForFunction(() => document.getElementById('dialog')?.open === true);
      assert.match(await page.locator('#dialog').textContent(), /Nombre/i);

      // La copia persistida de registros es distinta del cache de revisiones,
      // que se puede limpiar de forma segura al cerrar sesión.
      const savedAccountCopy = await page.evaluate(({ key, marker }) => {
        const copy = window.WelloApp.getState();
        copy.personal.moods.push({ id: 'mood:2026-11-12', date: '2026-11-12', mood: 'calma', note: marker });
        const raw = JSON.stringify(copy);
        localStorage.setItem(key, raw);
        return raw;
      }, { key: ACCOUNT_DATA_KEY, marker: AUTH_CACHE_MARKER });
      await page.evaluate(() => {
        window.__authUiSignOutPromise = window.WelloCloud.signOut();
      });
      await page.waitForTimeout(80);
      assert.equal(fixture.page.__authUiLogoutRequests.length >= 1, true, 'signOut no llegó al endpoint logout mockeado');
      await waitForLocked(page);
      await assertLockedSurface(page, 'signOut inmediato');
      assert.equal(await page.locator('#dialog').innerHTML(), '', 'el dialog no debe retener contenido privado');
      assert.equal(await page.evaluate(() => window.WelloCloud.isAuthenticated()), false);
      assert.equal(await page.evaluate(() => window.WelloApp.getNamespace()), 'cloud:logged-out');
      const cachedBeforeNetworkResponse = await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_DATA_KEY);
      assert.equal(cachedBeforeNetworkResponse, savedAccountCopy, 'signOut no debe borrar los registros de cuenta');
      await page.evaluate(async () => { await window.__authUiSignOutPromise; });
      const cachedAfterNetworkResponse = await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_DATA_KEY);
      assert.equal(cachedAfterNetworkResponse, savedAccountCopy);
      await assertNoUnexpectedNetwork(page, 'signOut');
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await fixture.context.close();
    }
  });

  await check('El HTML local/preview conserva la app visible y no monta WelloCloud', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const external = [];
    await context.route('**/*', async (route) => {
      if (/^https?:/i.test(route.request().url())) {
        external.push(route.request().url());
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
    const page = await context.newPage();
    try {
      await page.goto(fileTarget(LOCAL_FILE));
      await page.waitForFunction(() => Boolean(window.WelloApp));
      assert.equal(await page.evaluate(() => Boolean(window.WELLO_CONFIG)), false);
      assert.equal(await page.evaluate(() => Boolean(window.WelloCloud)), false);
      assert.equal(await page.locator('#app').isVisible(), true);
      assert.equal(await page.locator('#app').getAttribute('inert'), null);
      assert.equal(await page.locator('#main').isVisible(), true);
      assert.match(await page.locator('#main').textContent(), /Qué bueno tenerte aquí/i);
      assert.deepEqual(external, []);
    } finally {
      allPageErrors.push(...(page.__authUiErrors ?? []));
      await context.close();
    }
  });

  assert.deepEqual(allPageErrors, [], `errores de página: ${allPageErrors.join('; ')}`);
  await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
  await fs.writeFile(ARTIFACT, JSON.stringify({
    passed,
    total: results.length,
    results,
    target: TARGET,
    production: true,
    projectRef: PROJECT_REF,
    widths: [320, 390, 768, 1440],
    network: 'Supabase Auth/REST/RPC mockeado; HTTP externo abortado; sin login real de Google',
    executedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`Auth/access UI ${passed}/${results.length} casos aprobados.`);
} catch (error) {
  await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
  await fs.writeFile(ARTIFACT, JSON.stringify({
    passed,
    total: results.length,
    results,
    target: TARGET,
    production: true,
    projectRef: PROJECT_REF,
    widths: [320, 390, 768, 1440],
    network: 'Supabase Auth/REST/RPC mockeado; HTTP externo abortado; sin login real de Google',
    error: error.stack || error.message,
    pageErrors: allPageErrors,
    executedAt: new Date().toISOString(),
  }, null, 2));
  console.error('FAIL auth/access UI', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
