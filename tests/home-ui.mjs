import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = pathToFileURL(path.join(ROOT, 'entregables', 'Wello.html')).href;
const ARTIFACT = path.join(ROOT, 'artifacts', 'home-ui-results.json');
const WIDTHS = [320, 390, 768, 1440];
const MEDITATION_BYTES = await fs.readFile(path.join(ROOT, 'assets', 'meditation-transparent.png'));
const MEDITATION_DATA_URL = `data:image/png;base64,${MEDITATION_BYTES.toString('base64')}`;
const MEDITATION_WIDTH = MEDITATION_BYTES.readUInt32BE(16);
const MEDITATION_HEIGHT = MEDITATION_BYTES.readUInt32BE(20);

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: 'America/Mexico_City',
});
const page = await context.newPage();
const pageErrors = [];
const requests = [];
const results = [];
let passed = 0;

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));

const state = () => page.evaluate(() => window.WelloApp.getState());
const homeRowIds = () => page.locator('#main .home-habits .compact-habit [data-action="home-habit"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.id));
const waitForHome = () => page.waitForFunction(() => Boolean(window.WelloApp) && document.body.dataset.page === 'inicio');
const waitForModal = () => page.waitForFunction(() => document.getElementById('dialog')?.open === true);
const closeSavedModal = async () => {
  const saveButton = page.locator('#modal-form').getByRole('button', { name: 'Guardar', exact: true });
  assert.equal(await saveButton.count(), 1);
  await saveButton.click();
  await page.waitForFunction(() => !document.getElementById('dialog')?.open);
};

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

async function writeReport(error = null) {
  await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
  const networkRequests = requests.filter(({ url }) => /^(?:https?|wss?):/i.test(url));
  await fs.writeFile(ARTIFACT, JSON.stringify({
    passed,
    total: results.length,
    results,
    target: TARGET,
    executablePath: '/usr/bin/chromium',
    localFile: true,
    viewportWidths: WIDTHS,
    networkRequests,
    pageErrors,
    error: error ? error.stack || error.message : null,
    executedAt: new Date().toISOString(),
  }, null, 2));
}

const today = await page.evaluate(() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});

try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.WelloApp));

  await check('Inicio retira los textos indicados y conserva encabezado y fecha', async () => {
    const mainText = await page.locator('#main').innerText();
    assert.equal(await page.locator('#main h1').first().textContent(), 'Qué bueno tenerte aquí.');
    assert.doesNotMatch(mainText, /No tienes que hacerlo todo hoy\./);
    assert.doesNotMatch(mainText, /Solo empezar por algo que te haga bien\./);
    assert.doesNotMatch(mainText, /Aquí, cada pequeño paso cuenta\./);
    assert.doesNotMatch(mainText, /Todo lo que cuidas, aquí\./);
    assert.equal(await page.locator('#main .home-heading .eyebrow').count(), 0);
    assert.doesNotMatch(mainText, /Buenos días|Buenas tardes|Buenas noches/i);
    assert.equal((await page.locator('#top-title').textContent()).trim(), 'Inicio');
    assert.match(await page.title(), /Wello.*Inicio/);
  });

  await check('Estado válido limita Home a cuatro hábitos y conserva alcance/scope', async () => {
    await page.evaluate((date) => {
      const current = structuredClone(window.WelloApp.getState());
      const makeHabit = (id, name) => ({
        id,
        name,
        icon: 'leaf',
        color: '#F7DCEB',
        startDate: date,
        frequency: 'daily',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        interval: 2,
        monthDay: Number(date.slice(-2)),
        type: 'check',
        target: 1,
        unit: 'veces',
        goalPeriod: 'day',
        logs: {},
      });
      const template = structuredClone(current.households[0] || {});
      const makeHome = (id, name, habits) => ({
        ...template,
        id,
        name,
        habits,
        pets: [],
        inventory: [],
        shopping: [],
        purchases: [],
        stores: [],
      });
      current.personal = {
        ...current.personal,
        sessions: [],
        habits: ['h1', 'h2', 'h3', 'h4'].map((id, index) => makeHabit(id, `Personal ${index + 1}`)),
        moods: [],
        appointments: [],
      };
      current.households = [
        makeHome('h1', 'Casa activa', ['h5', 'h6', 'h7'].map((id, index) => makeHabit(id, `Hogar ${index + 1}`))),
        makeHome('h2', 'Casa inactiva', [makeHabit('other-home', 'No debe salir')]),
      ];
      current.activeHousehold = 'h1';
      window.WelloApp.setState(current);
    }, today);
    await page.evaluate(() => window.WelloApp.navigate('inicio'));
    await waitForHome();

    assert.deepEqual(await homeRowIds(), ['h1', 'h2', 'h3', 'h4']);
    assert.equal(await page.locator('#main .home-habits .compact-habit').count(), 4);
    const rowButtons = page.locator('#main .home-habits .compact-habit [data-action="home-habit"]');
    assert.equal(await rowButtons.count(), 4);
    for (let index = 0; index < await rowButtons.count(); index += 1) {
      assert.equal(await rowButtons.nth(index).evaluate((node) => node.tagName), 'BUTTON');
      assert.equal(await rowButtons.nth(index).getAttribute('type'), 'button');
      assert.equal(await rowButtons.nth(index).getAttribute('data-id'), `h${index + 1}`);
      assert.equal(await rowButtons.nth(index).getAttribute('aria-pressed'), 'false');
    }
    const source = await state();
    assert.deepEqual(source.personal.habits.map(({ id }) => id), ['h1', 'h2', 'h3', 'h4']);
    assert.deepEqual(source.households.find(({ id }) => id === 'h1').habits.map(({ id }) => id), ['h5', 'h6', 'h7']);
    assert.equal(await page.locator('#main .compact-habit').filter({ hasText: 'No debe salir' }).count(), 0);

    const panelText = await page.locator('#main .home-habits').innerText();
    assert.doesNotMatch(panelText, /semana|meta|objetivo|contador|progreso/i);
    assert.equal(await page.locator('#main .home-habits [data-counter], #main .home-habits [data-goal], #main .home-habits [class*="week"], #main .home-habits [class*="goal"]').count(), 0);

    const viewAll = page.locator('#main button[data-action="nav"][data-route="habitos"]').filter({ hasText: 'Ver todos mis hábitos' });
    assert.equal(await viewAll.count(), 1);
    const lastRowBox = await page.locator('#main .home-habits .compact-habit').last().boundingBox();
    const viewAllBox = await viewAll.boundingBox();
    assert(lastRowBox && viewAllBox && viewAllBox.y >= lastRowBox.y + lastRowBox.height - 1, 'El enlace de hábitos debe quedar debajo de la lista.');
  });

  await check('Ilustración PNG transparente sin fondo ni mezcla en todos los anchos', async () => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const image = document.querySelector('.welcome-art img');
        const imageStyle = getComputedStyle(image);
        const artStyle = getComputedStyle(image.parentElement);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
        return {
          innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          source: image.getAttribute('src') || '',
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          mixBlendMode: imageStyle.mixBlendMode,
          filter: imageStyle.filter,
          borderRadius: imageStyle.borderRadius,
          artOpacity: artStyle.opacity,
          backgroundColor: imageStyle.backgroundColor,
          cornerAlpha: [alpha(0, 0), alpha(canvas.width-1, 0), alpha(0, canvas.height-1), alpha(canvas.width-1, canvas.height-1)],
          centerAlpha: alpha(Math.floor(canvas.width/2), Math.floor(canvas.height/2)),
        };
      });
      assert(metrics.documentWidth <= metrics.innerWidth, `overflow document en ${width}px: ${JSON.stringify(metrics)}`);
      assert(metrics.bodyWidth <= metrics.innerWidth, `overflow body en ${width}px: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.source, MEDITATION_DATA_URL);
      assert.equal(metrics.naturalWidth, MEDITATION_WIDTH);
      assert.equal(metrics.naturalHeight, MEDITATION_HEIGHT);
      assert.equal(metrics.mixBlendMode, 'normal');
      assert.equal(metrics.filter, 'none');
      assert.equal(metrics.borderRadius, '0px');
      assert.equal(metrics.backgroundColor, 'rgba(0, 0, 0, 0)');
      assert(metrics.cornerAlpha.every(alpha => alpha <= 2), 'Las esquinas deben ser transparentes, no un fondo opaco.');
      assert(metrics.centerAlpha >= 250, 'El sujeto debe conservar su opacidad.');
      assert.equal(metrics.artOpacity, '1');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('Checks del Home ordenan pendientes primero, sin inventar logs ni mutar fuentes', async () => {
    await page.locator('#main .home-habits [data-action="home-habit"][data-id="h1"]').click();
    assert.deepEqual(await homeRowIds(), ['h2', 'h3', 'h4', 'h5']);
    let afterFirst = await state();
    assert.deepEqual(afterFirst.personal.habits.find(({ id }) => id === 'h1').logs, { [today]: true });
    assert.deepEqual(afterFirst.personal.habits.filter(({ id }) => id !== 'h1').map(({ logs }) => logs), [{}, {}, {}]);
    assert.deepEqual(afterFirst.households.find(({ id }) => id === 'h1').habits.map(({ id }) => id), ['h5', 'h6', 'h7']);

    for (const id of ['h2', 'h3', 'h4']) {
      await page.locator(`#main .home-habits [data-action="home-habit"][data-id="${id}"]`).click();
    }
    assert.deepEqual(await homeRowIds(), ['h5', 'h6', 'h7', 'h1']);
    const lastCheck = page.locator('#main .home-habits .compact-habit').last().locator('[data-action="home-habit"]');
    assert.equal(await lastCheck.getAttribute('aria-pressed'), 'true');
    assert.match(await lastCheck.getAttribute('class'), /done/);

    const afterChecks = await state();
    assert.deepEqual(afterChecks.personal.habits.map(({ id }) => id), ['h1', 'h2', 'h3', 'h4']);
    assert.deepEqual(afterChecks.households.find(({ id }) => id === 'h1').habits.map(({ id }) => id), ['h5', 'h6', 'h7']);
    for (const habit of afterChecks.personal.habits) assert.deepEqual(Object.keys(habit.logs), [today]);
    assert.deepEqual(afterChecks.households.find(({ id }) => id === 'h1').habits.map(({ logs }) => logs), [{}, {}, {}]);
  });

  await check('Recarga conserva done y límite de cuatro; botón navega a hábitos', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHome();
    assert.deepEqual(await homeRowIds(), ['h5', 'h6', 'h7', 'h1']);
    assert.equal((await state()).personal.habits.find(({ id }) => id === 'h1').logs[today], true);
    assert.equal(await page.locator('#main .home-habits .compact-habit').count(), 4);

    await page.locator('#main button[data-action="nav"][data-route="habitos"]').filter({ hasText: 'Ver todos mis hábitos' }).click();
    await page.waitForFunction(() => document.body.dataset.page === 'habitos');
    assert.equal(await page.evaluate(() => location.hash), '#habitos');
  });

  await check('Cantidad parcial no marca completado automáticamente y 2 mueve el row al final', async () => {
    const quantityState = await page.evaluate((date) => {
      const next = structuredClone(window.WelloApp.getState());
      const makeHabit = (id, name, type = 'check', extra = {}) => ({
        id,
        name,
        icon: 'leaf',
        color: '#F7DCEB',
        startDate: date,
        frequency: 'daily',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        interval: 2,
        monthDay: Number(date.slice(-2)),
        type,
        target: 1,
        unit: 'veces',
        goalPeriod: 'day',
        logs: {},
        ...extra,
      });
      next.personal.habits = [
        makeHabit('water', 'Tomar agua', 'quantity', { target: 2, unit: 'litros' }),
        makeHabit('q1', 'Respirar'),
        makeHabit('q2', 'Caminar'),
      ];
      next.households = next.households.map((home) => ({ ...home, habits: [] }));
      next.activeHousehold = 'h1';
      return next;
    }, today);
    await page.evaluate((next) => window.WelloApp.setState(next), quantityState);
    await page.evaluate(() => window.WelloApp.navigate('inicio'));
    await waitForHome();
    assert.deepEqual(await homeRowIds(), ['water', 'q1', 'q2']);

    await page.locator('#main .home-habits [data-action="home-habit"][data-id="water"]').click();
    await waitForModal();
    assert.equal(await page.locator('#dialog [name="quantity"]').count(), 1);
    assert.deepEqual((await state()).personal.habits.find(({ id }) => id === 'water').logs, {});
    await page.locator('#dialog [name="quantity"]').fill('0.75');
    await closeSavedModal();
    let partial = await state();
    assert.equal(partial.personal.habits.find(({ id }) => id === 'water').logs[today], 0.75);
    assert.deepEqual(await homeRowIds(), ['water', 'q1', 'q2']);
    assert.equal(await page.locator('#main .home-habits [data-id="water"]').getAttribute('aria-pressed'), 'false');

    await page.locator('#main .home-habits [data-action="home-habit"][data-id="water"]').click();
    await waitForModal();
    assert.equal(await page.locator('#dialog [name="quantity"]').inputValue(), '0.75');
    await page.locator('#dialog [name="quantity"]').fill('2');
    await closeSavedModal();
    const complete = await state();
    assert.equal(complete.personal.habits.find(({ id }) => id === 'water').logs[today], 2);
    assert.deepEqual(complete.personal.habits.filter(({ id }) => id !== 'water').map(({ logs }) => logs), [{}, {}]);
    assert.deepEqual(await homeRowIds(), ['q1', 'q2', 'water']);
    assert.equal(await page.locator('#main .home-habits .compact-habit').last().locator('[data-id="water"]').count(), 1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHome();
    assert.equal((await state()).personal.habits.find(({ id }) => id === 'water').logs[today], 2);
    assert.equal(await page.locator('#main .home-habits .compact-habit').last().locator('[data-id="water"]').count(), 1);
  });

  assert.deepEqual(pageErrors, [], `errores de página: ${pageErrors.join('; ')}`);
  assert.deepEqual(requests.filter(({ url }) => /^(?:https?|wss?):/i.test(url)), [], 'El HTML local no debe hacer peticiones de red.');
  await writeReport();
  console.log(`Home UI ${passed}/${results.length} casos aprobados.`);
} catch (error) {
  await writeReport(error);
  console.error('FAIL Home UI', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
