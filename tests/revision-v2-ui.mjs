import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1024,height:960},timezoneId:'America/Mexico_City'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let passed=0;
for(const [filename,width,height,color,type] of [['pet-upload-test.jpg',1200,800,'#D7B267','image/jpeg'],['pet-upload-test-2.png',600,1200,'#A0C3B2','image/png']]){
 const image=await page.evaluate(({width,height,color,type})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return canvas.toDataURL(type).split(',')[1];},{width,height,color,type});
 await fs.writeFile('artifacts/'+filename,Buffer.from(image,'base64'));
}
const action=(name)=>page.locator(`[data-action="${name}"]`).first();
const field=(name)=>page.locator(`#dialog [name="${name}"]:not([disabled])`).first();
const state=()=>page.evaluate(()=>window.WelloApp.getState());
const pet=async()=>(await state()).households[0].pets[0];
async function nav(route){await page.evaluate(route=>window.WelloApp.navigate(route),route);await page.waitForFunction(route=>document.body.dataset.page===route,route);}
async function save(){await page.locator('#modal-form button[type="submit"]').click();await page.waitForFunction(()=>!document.getElementById('dialog').open);}
async function close(){await action('modal-close').click();}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function newHabit(name,frequency='daily'){await action('habit-new').click();await field('name').fill(name);await field('frequency').selectOption(frequency);}
async function category(type){await action('pet-activity-add').click();await page.locator(`[data-action="pet-activity-type-select"][data-type="${type}"]`).click();}
try {
 await page.goto('file://'+path.resolve('entregables/Wello.html'));await page.waitForFunction(()=>!!window.WelloApp);await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>!!window.WelloApp);
 await check('Iconos dibujados seleccionables y fila sólo nombre/check; edición desde detalle',async()=>{
  await nav('habitos');await newHabit('Leer');assert.equal(await page.locator('select[name="icon"]').count(),0);assert.equal(await page.locator('.habit-icon-option svg').count(),6);
  await field('icon').locator('..').first().count();await page.locator('[name="icon"][value="book-open"]').check();await page.locator('[name="color"][value="#EBE4FA"]').check();
  assert.equal(await page.locator('[data-frequency-group="weekdays"]').isVisible(),false);assert.equal(await page.locator('[name="interval"]').isEnabled(),false);assert.equal(await page.locator('[name="monthlyDate"]').isEnabled(),false);assert.equal(await page.locator('[name="target"]').isEnabled(),false);await save();
  assert.equal((await state()).personal.habits[0].icon,'book-open');assert.equal(await page.locator('.habit-row-week,.habit-row-goal,.habit-row-specific').count(),0);assert.equal(await page.locator('.habit-row-check').count(),1);assert((await page.locator('.habit-row').boundingBox()).height<=64);
  await action('habit-toggle').click();assert.equal(await page.locator('.habit-row-check').getAttribute('aria-pressed'),'true');await action('habit-detail').click();assert.match(await page.locator('#dialog').textContent(),/Esta semana/);await action('habit-detail-edit').click();await field('name').fill('Leer un rato');await save();assert.equal((await state()).personal.habits[0].logs[Object.keys((await state()).personal.habits[0].logs)[0]],true);
 });
 await check('Frecuencia semanal e intervalo sólo muestran sus controles y guardan días correctos',async()=>{
  await newHabit('Caminar','weekdays');assert.equal(await page.locator('[data-frequency-group="weekdays"]').isVisible(),true);assert.equal(await page.locator('[name="weekday"]:checked').count(),5);assert.equal(await page.locator('[name="interval"]').isEnabled(),false);
  await page.locator('[name="weekday"][value="2"]').locator('..').click();await save();assert.deepEqual((await state()).personal.habits[1].weekdays,[1,3,4,5]);
  await newHabit('Ventilar','interval');assert.equal(await page.locator('[data-frequency-group="weekdays"]').isVisible(),false);assert.equal(await page.locator('[name="interval"]').isEnabled(),true);await field('interval').fill('3');await save();assert.equal((await state()).personal.habits[2].interval,3);
 });
 await check('Fecha mensual real día 3 previsualiza 3 diciembre y recurre allí',async()=>{
  await newHabit('Revisión mensual','monthly');assert.equal(await field('monthlyDate').getAttribute('type'),'date');await field('monthlyDate').fill('2026-11-03');await field('monthlyDate').blur();assert.match(await page.locator('[data-monthly-preview]').textContent(),/3 dic 2026/);await save();assert.equal((await state()).personal.habits[3].monthDay,3);
  await nav('calendario');await page.locator('[data-action="calendar-month"][data-step="1"]').click();await page.locator('[data-action="calendar-day"][data-date="2026-12-03"]').click();assert.match(await page.locator('.day-detail').textContent(),/Revisión mensual/);
 });
 await check('Cantidades parciales se capturan desde check y sólo aparecen en detalle',async()=>{
  await nav('habitos');await newHabit('Agua','daily');await field('type').selectOption('quantity');assert.equal(await page.locator('[data-type-group="quantity"]').isVisible(),true);await field('target').fill('2');await field('unit').fill('litros');await save();
  const id=(await state()).personal.habits[4].id;await page.locator(`[data-action="habit-toggle"][data-id="${id}"]`).click();await field('quantity').fill('0.75');await save();await page.locator(`[data-action="habit-detail"][data-id="${id}"]`).click();assert.match(await page.locator('#dialog').textContent(),/1.25/);await close();
 });
 await check('Foto de mascota se procesa realmente, conserva proporción y persiste al guardar inmediatamente',async()=>{
  await nav('mascotas');await action('pet-add').click();await field('name').fill('Luna');await field('type').fill('Perro');await field('sex').selectOption('female');await field('birthday').fill('2021-02-14');
  await page.evaluate(()=>{const decode=window.createImageBitmap.bind(window);window.createImageBitmap=async file=>{await new Promise(r=>setTimeout(r,500));return decode(file);};});
  await page.locator('#pet-photo-file').setInputFiles('artifacts/pet-upload-test.jpg');await save();const photo=(await pet()).photo;assert(photo?.startsWith('data:image/jpeg;base64,'));assert(photo.length<350000);
  const dimensions=await page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();return {w:img.naturalWidth,h:img.naturalHeight};},photo);assert(dimensions.w<=640&&dimensions.h<=640);assert(Math.abs(dimensions.w/dimensions.h-1.5)<0.01);await page.reload();await page.waitForFunction(()=>!!window.WelloApp);await nav('mascotas');assert.equal((await pet()).photo,photo);assert.equal(await page.locator('.pet-photo').isVisible(),true);
 });
 await check('Cambiar, previsualizar y quitar foto no borra perfil ni historial',async()=>{
  await action('pet-edit').click();await page.locator('#pet-photo-file').setInputFiles('artifacts/pet-upload-test-2.png');await page.waitForFunction(()=>document.getElementById('pet-photo-value').value!==window.WelloApp.getState().households[0].pets[0].photo);assert.equal(await page.locator('#pet-photo-preview').isVisible(),true);await save();const photo=(await pet()).photo;const dimensions=await page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();return [img.naturalWidth,img.naturalHeight];},photo);assert(dimensions.every(n=>n<=640));assert.equal(dimensions[0]/dimensions[1],0.5);
  await action('pet-edit').click();await action('pet-photo-remove').click();await save();assert.equal((await pet()).photo,undefined);assert.equal((await pet()).name,'Luna');
  await action('pet-edit').click();await page.locator('#pet-photo-file').setInputFiles('artifacts/pet-upload-test.jpg');await save();assert((await pet()).photo); // Leave a photo for export and visual checks.
 });
 await check('Menú de actividades visual y formularios específicos sin campos inconexos',async()=>{
  await action('pet-activity-add').click();assert.equal(await page.locator('.pet-category-card svg').count(),6);assert.equal(await page.locator('#dialog input[name="title"],#dialog select[name="type"]').count(),0);await page.screenshot({path:'artifacts/Wello-v2-menu-mascotas.png'});await close();
  for(const [type,present,absent] of [['walk','duration','vaccineName'],['vaccine','vaccineName','duration'],['feeding','food','trickId'],['bath','status','food'],['training','trickId','status']]){await category(type);assert.equal(await field(present).isVisible(),true);assert.equal(await page.locator(`#dialog [name="${absent}"]`).count(),0);assert.equal(await page.locator('#dialog [name="title"]').count(),0);await close();}
  await category('vaccine');await field('vaccineName').fill('Vacuna anual');await field('date').fill('2026-11-03');await field('nextDate').fill('2026-12-03');await save();
 });
 await check('Práctica desde catálogo crea entrenamiento vinculado y se puede editar',async()=>{
  await action('pet-trick-add').click();await field('name').fill('Sentarse');await field('description').fill('Responder a la señal');await save();const trickId=(await pet()).tricks[0].id;
  await action('pet-trick-practice').click();assert.equal(await field('trickId').inputValue(),trickId);await field('date').fill('2026-11-03');await field('duration').fill('5');await field('note').fill('Practicamos juntas');await save();const practice=(await pet()).activities.find(a=>a.type==='training');assert.equal(practice.trickId,trickId);assert.equal(practice.trickName,'Sentarse');assert.match(await page.locator('.pet-trick-stats').textContent(),/1 práctica/);
  await page.locator(`[data-action="pet-activity-edit"][data-id="${practice.id}"]`).click();await field('note').fill('Nota editada');await save();assert.equal((await pet()).activities.filter(a=>a.type==='training').length,1);
 });
 await check('Hembra registra celo observado, valida final y muestra duración e intervalo',async()=>{
  await category('heat');await field('date').fill('2026-10-01');await field('endDate').fill('2026-10-03');await field('note').fill('Registro anterior');await save();
  await category('heat');await field('date').fill('2026-11-01');await field('endDate').fill('2026-10-31');await page.locator('#modal-form button[type="submit"]').click();assert.equal(await page.locator('#dialog').evaluate(d=>d.open),true);await field('endDate').fill('2026-11-03');await field('note').fill('Registro observado');await save();assert.match(await page.locator('.pet-history').textContent(),/Duración observada: 3 días/);assert.match(await page.locator('.pet-history').textContent(),/Intervalo observado: 31 días/);
  await page.reload();await page.waitForFunction(()=>!!window.WelloApp);await nav('mascotas');assert.equal((await pet()).activities.filter(a=>a.type==='heat').length,2);await page.screenshot({path:'artifacts/Wello-v2-mascotas.png',fullPage:true});
 });
 await check('Calendario muestra colores propios en Mes y Agenda; exporta sólo el filtro elegido',async()=>{
  await nav('calendario');await page.locator('[data-action="calendar-day"][data-date="2026-11-03"]').click();const pets=page.locator('.day-detail .calendar-event.type-mascotas').first();assert.equal(await pets.evaluate(e=>getComputedStyle(e).getPropertyValue('--event-color').trim()),'#FFCE54');const habitId=(await state()).personal.habits[0].id;const h=page.locator(`.day-detail .calendar-event[data-id="habit:${habitId}:2026-11-03"]`);assert.equal(await h.evaluate(e=>getComputedStyle(e).getPropertyValue('--event-color').trim()),'#EBE4FA');
  await page.locator('[data-action="calendar-mode"][data-mode="agenda"]').click();assert.equal(await page.locator('.calendar-legend > span').count(),4);await page.screenshot({path:'artifacts/Wello-v2-calendario.png',fullPage:false});
  for(const [filter,wanted,forbidden] of [['mascotas','Luna','SUMMARY:Leer'],['habitos','SUMMARY:Leer','Luna']]){await action('calendar-export').click();await field('exportFilter').selectOption(filter);await field('exportMonth').fill('2026-11');const download=page.waitForEvent('download');await page.locator('#modal-form button[type="submit"]').click();const file=await download;await file.saveAs(`artifacts/v2-${filter}.ics`);await page.waitForFunction(()=>!document.getElementById('dialog').open);const text=await fs.readFile(`artifacts/v2-${filter}.ics`,'utf8');assert(text.includes(wanted));assert(!text.includes(forbidden));assert.equal(await page.locator('[data-action="calendar-filter"].active').getAttribute('data-filter'),'all');}
 });
 await check('Copia privada incluye foto/celo/prácticas y nueva recarga no pierde registros',async()=>{
  await nav('datos');const download=page.waitForEvent('download');await page.locator('[data-action="data-export"][data-type="all"]').click();const file=await download;await file.saveAs('artifacts/v2-private-test-backup.json');const backup=JSON.parse(await fs.readFile('artifacts/v2-private-test-backup.json','utf8'));assert(backup.data.households[0].pets[0].photo);assert.equal(backup.data.households[0].pets[0].activities.filter(a=>a.type==='heat').length,2);
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!window.WelloApp);assert.equal((await pet()).tricks[0].name,'Sentarse');await context.setOffline(false);
 });
 await check('Cancelar una foto pendiente no guarda el perfil ni cierra el siguiente formulario',async()=>{
  await nav('mascotas');const before=await pet();await action('pet-edit').click();await field('name').fill('No guardar este nombre');
  await page.evaluate(()=>{const decode=window.createImageBitmap.bind(window);window.createImageBitmap=async file=>{await new Promise(r=>setTimeout(r,700));return decode(file);};});
  await page.locator('#pet-photo-file').setInputFiles('artifacts/pet-upload-test-2.png');await page.locator('#modal-form button[type="submit"]').click();await close();await category('walk');await page.waitForTimeout(1000);
  assert.equal(await page.locator('#dialog').evaluate(d=>d.open),true);assert.equal(await field('duration').isVisible(),true);assert.equal((await pet()).photo,before.photo);assert.equal((await pet()).name,before.name);await close();
 });
 await check('Lista de 30 hábitos y pantallas modificadas sin desbordamiento en los cinco anchos',async()=>{
  await page.evaluate(()=>{const s=window.WelloApp.getState();const base=s.personal.habits[0];for(let i=0;i<25;i++)s.personal.habits.push({...base,id:'many-'+i,name:'Mi hábito '+(i+1),logs:{}});window.WelloApp.setState(s);});
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});for(const route of ['habitos','mascotas','calendario']){await nav(route);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route} ${width}`);}await nav('habitos');assert.equal(await page.locator('.habit-row').count(),30);assert.equal(await page.locator('.habit-row-goal,.habit-row-week').count(),0);if(width===390)await page.screenshot({path:'artifacts/Wello-v2-habitos-movil.png',fullPage:false});}
 });
 assert.deepEqual(errors,[]);await fs.writeFile('artifacts/revision-v2-ui-results.json',JSON.stringify({passed,errors,widths:[320,390,768,1024,1440],localFile:true,offline:true,executedAt:new Date().toISOString()},null,2));console.log(`Revisión v2: ${passed}/${passed} casos UI aprobados.`);
} catch(error) {console.error(error);console.error('Browser errors',errors);await page.screenshot({path:'artifacts/v2-failure.png',fullPage:true});process.exitCode=1;} finally {await browser.close();}
