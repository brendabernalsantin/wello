import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = pathToFileURL(path.join(ROOT, 'entregables', 'Wello.html')).href;
const ARTIFACT = path.join(ROOT, 'artifacts', 'Wello-habitos-estado.png');
const REPORT = path.join(ROOT, 'artifacts', 'habits-polish-ui-results.json');
const MOODS = ['feliz', 'calma', 'neutral', 'cansada', 'triste', 'estresada'];
const WIDTHS = [320, 390, 768, 1440];
const assetFiles = Object.fromEntries(MOODS.map(id => [id, path.join(ROOT, 'assets', `mood-${id}-transparent.png`)]));
const assetSizes = Object.fromEntries(await Promise.all(MOODS.map(async id => {
  const bytes = await fs.readFile(assetFiles[id]);
  return [id, { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }];
})));

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Mexico_City' });
const page = await context.newPage();
const pageErrors = [];
const requests = [];
const groups = [];
let passed = 0;
page.on('pageerror', error => pageErrors.push(error.message));
page.on('request', request => requests.push({ method: request.method(), url: request.url() }));

const state = () => page.evaluate(() => window.WelloApp.getState());
const field = name => page.locator(`#dialog [name="${name}"]:not([disabled])`).first();
const topDate = () => page.locator('.habit-page-heading .habit-date-control input[data-change="habit-date"]').first();
const moodAction = () => page.locator('.mood-banner [data-action="mood-open"]').first();
const waitModal = () => page.waitForFunction(() => document.getElementById('dialog')?.open === true);
const waitRoute = route => page.waitForFunction(value => document.body.dataset.page === value, route);
const navigate = async route => { await page.evaluate(value => window.WelloApp.navigate(value), route); await waitRoute(route); };
const saveModal = async () => { await page.locator('#modal-form button[type="submit"]').click(); await page.waitForFunction(() => !document.getElementById('dialog')?.open); };
const closeModal = async () => { await page.locator('#dialog [data-action="modal-close"]').first().click(); await page.waitForFunction(() => !document.getElementById('dialog')?.open); };
const localDate = offset => page.evaluate(days => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, offset);
const selectHabitDate = async date => { await topDate().fill(date); await page.waitForFunction(value => document.querySelector('.habit-page-heading .habit-date-control input[data-change="habit-date"]')?.value === value, date); };

async function check(name, fn) {
  const started = Date.now();
  try { await fn(); passed += 1; groups.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { groups.push({ name, status: 'failed', error: error.message, durationMs: Date.now() - started }); throw error; }
}

async function writeReport(error = null) {
  const networkRequests = requests.filter(({ url }) => /^(?:https?|wss?):/i.test(url));
  await fs.mkdir(path.dirname(REPORT), { recursive: true });
  await fs.writeFile(REPORT, JSON.stringify({
    passed, total: groups.length, groups, errors: pageErrors,
    network: networkRequests.length, networkRequests, target: TARGET,
    executablePath: '/usr/bin/chromium', localFile: true, viewportWidths: WIDTHS,
    failure: error ? error.stack || error.message : null, executedAt: new Date().toISOString(),
  }, null, 2));
}

try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.WelloApp));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.WelloApp));
  const today = await localDate(0);
  const yesterday = await localDate(-1);
  const tomorrow = await localDate(1);
  await navigate('habitos');
  assert.deepEqual((await state()).personal.moods, []);

  await check('Contrato visible, textos anteriores ausentes y fecha sobre el banner', async () => {
    const visibleText = (await page.locator('#main, #dialog').allInnerTexts()).join('\n');
    assert.doesNotMatch(visibleText, /Un espacio para lo que te hace bien|Te sientes (?:feliz|en calma|neutral|cansada|triste|estresada)\. Puedes cambiarlo cuando quieras\./i);
    assert.equal(await page.locator('.habit-page-heading .habit-date-control input[aria-label="Fecha de hábitos y estado de ánimo"]').count(), 1);
    const dateBox = await page.locator('.habit-page-heading .habit-date-control').boundingBox();
    const bannerBox = await page.locator('.mood-banner').boundingBox();
    assert(dateBox && bannerBox && dateBox.y + dateBox.height <= bannerBox.y + 2, 'La fecha debe estar antes del banner.');
    assert.equal(await page.locator('.habit-page-heading [data-action="habit-new"]').count(), 0);
    const section = page.locator('.habit-section-head');
    assert.equal((await section.locator('h2').textContent()).trim(), 'Lo que cuido de mí');
    assert.equal(await section.locator('button[data-action="habit-new"]').count(), 1);
    const headingBox = await section.locator('h2').boundingBox();
    const createBox = await section.locator('button[data-action="habit-new"]').boundingBox();
    assert(headingBox && createBox && createBox.y < headingBox.y + headingBox.height + 18, 'Crear hábito debe acompañar al h2.');
  });

  await check('Sin moods conserva tres placeholders y registra nota literal escapada', async () => {
    assert.equal(await page.locator('.mood-banner-faces img').count(), 3);
    assert.equal(await page.locator('.mood-selected-face').count(), 0);
    assert.match((await moodAction().innerText()).trim(), /^Registrar estado de ánimo$/);
    const motion = await page.locator('.mood-banner-faces .mood-sprite').first().evaluate(node => {
      const animation = node.getAnimations()[0];
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 0;
      const start = getComputedStyle(node).transform;
      animation.currentTime = 2000;
      const midpoint = getComputedStyle(node).transform;
      animation.currentTime = 4000;
      const end = getComputedStyle(node).transform;
      return { start, midpoint, end };
    });
    assert(motion && motion.midpoint !== motion.start, 'La animación debe cambiar realmente la posición de la carita.');
    assert.equal(motion.end, motion.start, 'La carita debe terminar en reposo.');
    await moodAction().click(); await waitModal();
    assert.equal((await page.locator('#dialog h2').textContent()).trim(), 'Mi estado de ánimo');
    assert.deepEqual(await page.locator('#dialog input[name="mood"]').evaluateAll(nodes => nodes.map(node => node.value)), MOODS);
    assert.equal(await field('date').inputValue(), today);
    assert.equal(await page.locator('#dialog .mood-option img').count(), 6);
    const modalSources = await page.locator('#dialog .mood-option img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
    const assetSources = await page.evaluate(ids => ids.map(id => window.WELLO_ASSETS[`mood-${id}`]), MOODS);
    assert.deepEqual(modalSources, assetSources);
    await page.locator('#dialog input[name="mood"][value="feliz"]').check();
    const hostileNote = '<img src=x onerror=window.__moodXss=1>\nSegunda línea';
    await field('note').fill(hostileNote);
    await saveModal();
    const saved = (await state()).personal.moods;
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], { id: `mood:${today}`, date: today, mood: 'feliz', note: hostileNote });
    assert.equal(await page.locator('.mood-banner-faces').count(), 0);
    const selected = page.locator('.mood-banner .mood-selected-face .mood-sprite img');
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.getAttribute('src'), await page.evaluate(() => window.WELLO_ASSETS['mood-feliz']));
    assert.equal(await page.locator('.mood-note').textContent(), hostileNote);
    assert.equal(await page.locator('.mood-note img').count(), 0);
    assert.equal(await page.locator('.mood-history, .mood-record').count(), 0);
  });

  await check('Editar el mismo día reemplaza mood sin duplicar y recarga conserva el registro', async () => {
    await moodAction().click(); await waitModal();
    assert.equal(await page.locator('#dialog input[name="mood"]:checked').inputValue(), 'feliz');
    await page.locator('#dialog input[name="mood"][value="calma"]').check();
    await saveModal();
    assert.equal((await state()).personal.moods.length, 1);
    assert.equal((await state()).personal.moods[0].mood, 'calma');
    assert.equal((await page.locator('.mood-banner h2').textContent()).trim(), 'Hoy estoy en calma');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => Boolean(window.WelloApp)); await navigate('habitos');
    assert.equal((await state()).personal.moods.length, 1);
    assert.equal((await page.locator('.mood-banner h2').textContent()).trim(), 'Hoy estoy en calma');
    assert.equal(await page.locator('.mood-banner .mood-selected-face .mood-sprite img').getAttribute('src'), await page.evaluate(() => window.WELLO_ASSETS['mood-calma']));
  });

  let quantityBefore;
  await check('Crear hábito desde el encabezado de sección conserva fecha y meta cuantitativa', async () => {
    const create = page.locator('.habit-section-head button[data-action="habit-new"]');
    await create.click(); await waitModal();
    assert.equal(await page.locator('#dialog h2').count(), 1);
    await field('name').fill('Tomar agua');
    await field('type').selectOption('quantity');
    await field('startDate').fill(today);
    await field('target').fill('2');
    await field('unit').fill('litros');
    await saveModal();
    const after = await state();
    assert.equal(after.personal.habits.length, 1);
    quantityBefore = structuredClone(after.personal.habits[0]);
    assert.equal(quantityBefore.startDate, today);
    const id = quantityBefore.id;
    const dateValues = await page.locator(`.habit-list [data-id="${id}"][data-date]`).evaluateAll(nodes => nodes.map(node => node.dataset.date));
    assert(dateValues.length >= 2 && dateValues.every(date => date === today), `Fecha de fila inesperada: ${dateValues.join(',')}`);
    assert.equal(quantityBefore.target, 2);
    assert.equal(quantityBefore.unit, 'litros');
  });

  await check('Cambiar fecha común registra pasado/futuro sin mutar hoy ni la meta cuantitativa', async () => {
    await selectHabitDate(yesterday);
    const rowDates = await page.locator('.habit-list [data-date]').evaluateAll(nodes => nodes.map(node => node.dataset.date));
    assert(rowDates.length >= 2 && rowDates.every(date => date === yesterday));
    assert.equal(await page.locator('.mood-selected-face').count(), 0);
    assert.match((await page.locator('.mood-banner h2').textContent()).trim(), /Estado de ánimo|¿Cómo/);
    await moodAction().click(); await waitModal();
    assert.equal(await field('date').inputValue(), yesterday);
    await page.locator('#dialog input[name="mood"][value="neutral"]').check();
    await field('note').fill('Día anterior'); await saveModal();
    assert.equal(await topDate().inputValue(), yesterday);
    assert.equal((await page.locator('.mood-banner h2').textContent()).trim(), 'Ese día me sentí neutral');
    assert.doesNotMatch((await page.locator('.mood-banner h2').textContent()).trim(), /^Hoy/);
    assert.equal((await state()).personal.moods.length, 2);
    assert.equal((await state()).personal.moods.find(item => item.date === today).mood, 'calma');
    assert.equal((await state()).personal.habits.find(item => item.id === quantityBefore.id).target, quantityBefore.target);
    await selectHabitDate(tomorrow);
    await moodAction().click(); await waitModal();
    assert.equal(await field('date').inputValue(), tomorrow);
    await page.locator('#dialog input[name="mood"][value="neutral"]').check(); await field('note').fill('Por venir'); await saveModal();
    assert.match((await page.locator('.mood-banner h2').textContent()).trim(), /^Estado registrado:/);
    await page.evaluate(future => { const next = window.WelloApp.getState(); next.personal.moods = next.personal.moods.filter(item => item.date !== future); window.WelloApp.setState(next); }, tomorrow);
    await selectHabitDate(yesterday);
    const final = await state();
    assert.equal(final.personal.moods.length, 2);
    assert.deepEqual(final.personal.habits.find(item => item.id === quantityBefore.id), quantityBefore);
  });

  await check('Calendario filtra el evento mood por ID, abre su fecha fuente y vuelve sin historial', async () => {
    await navigate('calendario');
    await page.locator(`[data-action="calendar-day"][data-date="${yesterday}"]`).click();
    await page.locator('[data-action="calendar-filter"][data-filter="habitos"]').click();
    const moodEvent = page.locator(`.day-detail [data-action="calendar-event"][data-id="mood:${yesterday}"]`);
    assert.equal(await moodEvent.count(), 1);
    await moodEvent.click(); await waitModal();
    assert.equal((await page.locator('#dialog h2').textContent()).trim(), 'Mi estado de ánimo');
    assert.equal(await field('date').inputValue(), yesterday);
    assert.equal(await page.locator('#dialog input[name="mood"]:checked').inputValue(), 'neutral');
    await closeModal();
    await navigate('habitos');
    assert.equal(await page.locator('.mood-history, .mood-record').count(), 0);
    assert.equal((await state()).personal.moods.length, 2);
    assert.equal((await state()).personal.moods.find(item => item.date === today).mood, 'calma');
  });

  await check('Assets nativos, animación finita, reduce-motion y layout sin overflow', async () => {
    const assetCheck = await page.evaluate(async ids => {
      const out = {};
      for (const id of ids) {
        const src = window.WELLO_ASSETS[`mood-${id}`];
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
        const samples = [];
        for (let x = Math.floor(image.naturalWidth * .45); x <= Math.ceil(image.naturalWidth * .55); x += 2)
          for (let y = Math.floor(image.naturalHeight * .45); y <= Math.ceil(image.naturalHeight * .55); y += 2) samples.push(alpha(x, y));
        out[id] = { src, width: image.naturalWidth, height: image.naturalHeight, corners: [alpha(0, 0), alpha(image.naturalWidth - 1, 0), alpha(0, image.naturalHeight - 1), alpha(image.naturalWidth - 1, image.naturalHeight - 1)], centerAlpha: Math.max(...samples) };
      }
      return out;
    }, MOODS);
    for (const id of MOODS) {
      const info = assetCheck[id];
      assert.match(info.src, /^data:image\/png;base64,/);
      assert.deepEqual({ width: info.width, height: info.height }, assetSizes[id]);
      assert(info.corners.every(alpha => alpha <= 3), `${id} tiene fondo opaco: ${info.corners}`);
      assert(info.centerAlpha > 200, `${id} perdió el sujeto central.`);
    }
    await moodAction().click(); await waitModal();
    const animation = await page.locator('#dialog .mood-option img').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return { name: style.animationName, iteration: style.animationIterationCount }; }));
    assert(animation.every(item => item.iteration !== 'infinite'), `Animación infinita: ${JSON.stringify(animation)}`);
    await closeModal();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.locator('.mood-banner .mood-sprite, .mood-banner .mood-sprite img').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return { animation: style.animationName, duration: style.animationDuration, transition: style.transitionDuration }; }));
    assert(reduced.length > 0 && reduced.every(item => (item.animation === 'none' || item.duration === '0s') && (item.transition === '0s' || item.transition === '0.0s')), `reduce-motion no desactivó la carita: ${JSON.stringify(reduced)}`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({ innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
      assert(overflow.documentWidth <= width && overflow.bodyWidth <= width, `Overflow en ${width}: ${JSON.stringify(overflow)}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectHabitDate(today);
    await page.screenshot({ path: ARTIFACT, fullPage: true });
  });

  assert.deepEqual(pageErrors, [], `Errores de página: ${pageErrors.join('; ')}`);
  const networkRequests = requests.filter(({ url }) => /^(?:https?|wss?):/i.test(url));
  assert.deepEqual(networkRequests, [], 'El HTML local no debe usar red ni Supabase.');
  await writeReport();
  console.log(`Hábitos polish UI ${passed}/${groups.length} grupos aprobados.`);
} catch (error) {
  await writeReport(error);
  console.error('FAIL Hábitos polish UI', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
