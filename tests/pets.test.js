import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_ACTIVITY_TYPES, openPetActivity, registerPets } from '../src/modules/pets.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mockContext(home) {
  const actions = new Map();
  const changes = new Map();
  const modals = [];
  let generatedId = 0;
  let saves = 0;
  let renders = 0;
  const ctx = {
    home: () => home,
    today: () => '2026-11-03',
    id: () => `generated-${++generatedId}`,
    esc: escapeHtml,
    prettyDate: (value) => value,
    field: (label, name, value = '', type = 'text', extra = '') => `<label><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${extra}></label>`,
    select: (label, name, options, value = '') => `<label><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${options.map((option) => `<option value="${escapeHtml(option.value)}"${String(option.value) === String(value) ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`,
    btn: (label, action, extra = '', kind = 'secondary') => `<button class="${kind}" data-action="${escapeHtml(action)}" ${extra}>${escapeHtml(label)}</button>`,
    action: (name, callback) => actions.set(name, callback),
    change: (name, callback) => changes.set(name, callback),
    modal: (title, html, submit) => modals.push({ title, html, submit }),
    save: () => { saves += 1; },
    render: () => { renders += 1; },
    toast: () => {},
  };
  return { ctx, actions, changes, modals, get saves() { return saves; }, get renders() { return renders; } };
}

test('el formulario genérico excluye medication y sólo ofrece tipos de actividad generales', () => {
  assert.deepEqual(PET_ACTIVITY_TYPES.map(([value]) => value), ['vaccine', 'walk', 'training', 'feeding', 'bath']);

  const home = { pets: [{ id: 'pet-1', name: 'Luna', type: 'Perro', needsCare: false, activities: [], tricks: [] }] };
  const mock = mockContext(home);
  registerPets(mock.ctx);
  mock.actions.get('pet-activity-add')({ id: 'pet-1' });

  const modal = mock.modals.at(-1);
  assert.equal(modal.title, 'Nueva actividad');
  assert.match(modal.html, /data-change="pet-activity-type"/);
  assert.match(modal.html, /name="title"[^>]*required/);
  assert.doesNotMatch(modal.html, /value="medication"/);
  assert.doesNotMatch(modal.html, /name="medication"/);
  assert.match(modal.html, /data-activity-type="vaccine" hidden/);
  assert.match(modal.html, /data-activity-type="walk"/);
  assert.ok(mock.changes.has('pet-activity-type'));
});

test('editar medicamento con cuidados desactivados actualiza fecha, hora y nombre sin cambiar el id', () => {
  const original = {
    id: 'med-1',
    type: 'medication',
    title: 'Medicamento anterior',
    medication: 'Medicamento anterior',
    date: '2026-11-01',
    time: '08:00',
    note: 'Nota anterior',
  };
  const home = { pets: [{ id: 'pet-1', name: 'Luna', type: 'Perro', needsCare: false, activities: [original], tricks: [] }] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-activity-edit')({ petId: 'pet-1', id: 'med-1' });
  let modal = mock.modals.at(-1);
  assert.equal(modal.title, 'Editar medicamento');
  assert.match(modal.html, /name="medication"/);
  assert.match(modal.html, /value="Medicamento anterior"/);

  modal.submit({ medication: 'Medicamento actualizado', date: '2026-11-04', time: '21:15', note: 'Después de cenar' });
  assert.equal(home.pets[0].activities.length, 1);
  assert.equal(home.pets[0].activities[0].id, 'med-1');
  assert.equal(home.pets[0].activities[0].type, 'medication');
  assert.equal(home.pets[0].activities[0].medication, 'Medicamento actualizado');
  assert.equal(home.pets[0].activities[0].title, 'Medicamento actualizado');
  assert.equal(home.pets[0].activities[0].date, '2026-11-04');
  assert.equal(home.pets[0].activities[0].time, '21:15');
  assert.equal(home.pets[0].activities[0].note, 'Después de cenar');
  assert.equal(mock.saves, 1);
  assert.equal(mock.renders, 1);
});

test('las altas de medicamento requieren cuidados activos incluso si se desactivan antes de guardar', () => {
  const home = { pets: [{ id: 'pet-1', name: 'Luna', type: 'Perro', needsCare: false, activities: [], tricks: [] }] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-medication-add')({ id: 'pet-1' });
  assert.equal(mock.modals.length, 0);

  home.pets[0].needsCare = true;
  mock.actions.get('pet-medication-add')({ id: 'pet-1' });
  const modal = mock.modals.at(-1);
  home.pets[0].needsCare = false;
  modal.submit({ medication: 'No debe guardarse', date: '2026-11-04', time: '10:00', note: '' });
  assert.deepEqual(home.pets[0].activities, []);
  assert.equal(mock.saves, 0);
});

test('openPetActivity abre el registro original o el perfil cuando no hay actividad', () => {
  const home = {
    pets: [{
      id: 'pet-1', name: 'Luna', type: 'Perro', birthday: '2021-02-14', needsCare: false,
      activities: [{ id: 'walk-1', type: 'walk', title: 'Paseo', date: '2026-11-03', time: '07:00' }], tricks: [],
    }],
  };
  const mock = mockContext(home);

  openPetActivity(mock.ctx, 'pet-1', 'walk-1');
  assert.equal(mock.modals.at(-1).title, 'Editar actividad');
  assert.match(mock.modals.at(-1).html, /value="Paseo"/);

  openPetActivity(mock.ctx, 'pet-1');
  assert.equal(mock.modals.at(-1).title, 'Editar mascota');
  mock.modals.at(-1).submit({ name: 'Luna', type: 'Perro', birthday: '2021-02-15' });
  assert.equal(home.pets[0].birthday, '2021-02-15');
});
