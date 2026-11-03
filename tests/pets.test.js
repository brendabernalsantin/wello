import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_INPUT_BYTES,
  PET_ACTIVITY_TYPES,
  PET_SEX_VALUES,
  normalizePet,
  openPetActivity,
  registerPets,
  renderPets,
} from '../src/modules/pets.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mockContext(home, { saveResult = true } = {}) {
  const actions = new Map();
  const changes = new Map();
  const modals = [];
  const toasts = [];
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
    btn: (label, action, extra = '', kind = 'secondary') => `<button class="${kind}" data-action="${escapeHtml(action)}" ${extra}>${typeof label === 'string' ? label : String(label)}</button>`,
    action: (name, callback) => actions.set(name, callback),
    change: (name, callback) => changes.set(name, callback),
    modal: (title, html, submit) => modals.push({ title, html, submit }),
    closeModal: () => {},
    save: () => { saves += 1; return saveResult; },
    render: () => { renders += 1; },
    toast: (message) => toasts.push(message),
  };
  return {
    ctx,
    actions,
    changes,
    modals,
    toasts,
    get saves() { return saves; },
    get renders() { return renders; },
  };
}

function basePet(overrides = {}) {
  return {
    id: 'pet-1',
    name: 'Luna',
    type: 'Perro',
    needsCare: false,
    activities: [],
    tricks: [],
    ...overrides,
  };
}

const tinyPhoto = `data:image/jpeg;base64,${'a'.repeat(32)}`;

 test('normaliza mascotas legacy a sexo unknown y conserva campos opcionales', () => {
  const source = { id: 'pet-1', name: 'Luna', type: 'Perro', legacyFlag: true, custom: { source: 'old' }, activities: [], tricks: [] };
  const normalized = normalizePet({ id: () => 'generated' }, source);

  assert.deepEqual(PET_ACTIVITY_TYPES.map(([value]) => value), ['vaccine', 'walk', 'training', 'feeding', 'bath']);
  assert.deepEqual(PET_SEX_VALUES, ['female', 'male', 'unknown']);
  assert.equal(normalized.sex, 'unknown');
  assert.equal(normalized.legacyFlag, true);
  assert.deepEqual(normalized.custom, { source: 'old' });
});

test('Agregar actividad abre selector visual y sólo muestra categorías condicionales', () => {
  const home = { pets: [basePet({ sex: 'female', needsCare: false })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);
  mock.actions.get('pet-activity-add')({ id: 'pet-1' });

  const chooser = mock.modals.at(-1);
  assert.equal(chooser.title, 'Agregar actividad');
  assert.match(chooser.html, /data-action="pet-activity-type-select"/);
  assert.match(chooser.html, /data-pet-id="pet-1" data-type="heat"/);
  assert.doesNotMatch(chooser.html, /data-type="medication"/);
  assert.doesNotMatch(chooser.html, /name="title"/);
  assert.match(chooser.html, /pet-icon-fallback/);

  mock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'walk' });
  const walk = mock.modals.at(-1);
  assert.equal(walk.title, 'Registrar paseo');
  assert.match(walk.html, /name="duration"/);
  assert.match(walk.html, /name="date"/);
  assert.match(walk.html, /name="note"/);
  assert.doesNotMatch(walk.html, /name="vaccineName"|name="food"|name="status"|name="endDate"|name="title"/);
});

test('Cuidados activa medication y el selector no ofrece celo a machos', () => {
  const home = { pets: [basePet({ sex: 'male', needsCare: true })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);
  mock.actions.get('pet-activity-add')({ id: 'pet-1' });

  const chooser = mock.modals.at(-1);
  assert.match(chooser.html, /data-type="medication"/);
  assert.doesNotMatch(chooser.html, /data-type="heat"/);

  mock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'medication' });
  assert.equal(mock.modals.at(-1).title, 'Registrar medicamento');
  assert.match(mock.modals.at(-1).html, /name="medication"/);
});

test('registra celo observado en hembra, valida el intervalo y conserva el log al cambiar sexo', () => {
  const home = { pets: [basePet({ sex: 'female' })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-activity-add')({ id: 'pet-1' });
  mock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'heat' });
  const heatModal = mock.modals.at(-1);
  assert.equal(heatModal.title, 'Registrar celo');
  assert.doesNotMatch(heatModal.html, /name="title"/);
  assert.match(heatModal.html, /name="endDate"/);
  heatModal.submit({ date: '2026-11-01', endDate: '2026-11-03', note: 'Observado' });

  assert.equal(home.pets[0].activities.length, 1);
  assert.deepEqual(home.pets[0].activities[0], {
    id: 'generated-1',
    type: 'heat',
    title: 'Celo',
    date: '2026-11-01',
    time: '',
    note: 'Observado',
    endDate: '2026-11-03',
  });

  mock.actions.get('pet-edit')({ id: 'pet-1' });
  mock.modals.at(-1).submit({ name: 'Luna', type: 'Perro', sex: 'male', birthday: '', photo: '' });
  assert.equal(home.pets[0].sex, 'male');
  assert.equal(home.pets[0].activities[0].type, 'heat');

  openPetActivity(mock.ctx, 'pet-1', 'generated-1');
  const legacyHeat = mock.modals.at(-1);
  assert.equal(legacyHeat.title, 'Editar celo');
  legacyHeat.submit({ date: '2026-11-01', endDate: '2026-11-04', note: 'Actualizado' });
  assert.equal(home.pets[0].activities[0].endDate, '2026-11-04');
  assert.equal(home.pets[0].activities[0].note, 'Actualizado');
  assert.match(renderPets(mock.ctx), /Duración observada: 4 días/);
});

test('rechaza una fecha final anterior y no guarda una alta de celo en macho', () => {
  const femaleHome = { pets: [basePet({ sex: 'female' })] };
  const femaleMock = mockContext(femaleHome);
  registerPets(femaleMock.ctx);
  femaleMock.actions.get('pet-activity-add')({ id: 'pet-1' });
  femaleMock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'heat' });
  femaleMock.modals.at(-1).submit({ date: '2026-11-03', endDate: '2026-11-02' });
  assert.equal(femaleHome.pets[0].activities.length, 0);
  assert.equal(femaleMock.saves, 0);

  const maleHome = { pets: [basePet({ sex: 'male' })] };
  const maleMock = mockContext(maleHome);
  registerPets(maleMock.ctx);
  maleMock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'heat' });
  assert.equal(maleMock.modals.length, 0);
});

test('registrar práctica desde cada truco crea snapshot y eliminar truco no borra entrenamientos', () => {
  const trick = { id: 'trick-1', name: 'Sentarse', description: 'Con señal' };
  const home = { pets: [basePet({ tricks: [trick] })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-trick-practice')({ petId: 'pet-1', id: 'trick-1' });
  const practiceModal = mock.modals.at(-1);
  assert.equal(practiceModal.title, 'Registrar entrenamiento');
  assert.match(practiceModal.html, /name="trickId"/);
  assert.match(practiceModal.html, /value="trick-1"/);
  assert.doesNotMatch(practiceModal.html, /name="title"/);
  practiceModal.submit({ trickId: 'trick-1', date: '2026-11-03', duration: '12', note: 'Muy bien' });

  const training = home.pets[0].activities[0];
  assert.equal(training.type, 'training');
  assert.equal(training.trickId, 'trick-1');
  assert.equal(training.trickName, 'Sentarse');
  assert.equal(training.trickDescription, 'Con señal');
  assert.equal(training.duration, 12);
  assert.match(renderPets(mock.ctx), /1 práctica/);

  mock.actions.get('pet-trick-delete')({ petId: 'pet-1', id: 'trick-1' });
  assert.equal(home.pets[0].tricks.length, 0);
  assert.equal(home.pets[0].activities[0].trickName, 'Sentarse');
});

test('foto, sexo y edición de perfil son locales, y quitar foto elimina sólo el campo photo', () => {
  const existingActivity = { id: 'walk-1', type: 'walk', title: 'Paseo', date: '2026-11-03' };
  const home = { pets: [basePet({ activities: [existingActivity], sex: 'unknown' })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-edit')({ id: 'pet-1' });
  const profile = mock.modals.at(-1);
  assert.match(profile.html, /name="sex"/);
  assert.match(profile.html, /id="pet-photo-value" name="photo"/);
  assert.match(profile.html, /id="pet-photo-file"/);
  profile.submit({ name: 'Luna', type: 'Perro', sex: 'female', birthday: '', photo: tinyPhoto });
  assert.equal(home.pets[0].sex, 'female');
  assert.equal(home.pets[0].photo, tinyPhoto);
  assert.equal(home.pets[0].activities[0], existingActivity);

  mock.actions.get('pet-edit')({ id: 'pet-1' });
  mock.actions.get('pet-photo-remove')({});
  mock.modals.at(-1).submit({ name: 'Luna', type: 'Perro', sex: 'female', birthday: '' });
  assert.equal('photo' in home.pets[0], false);
  assert.equal(home.pets[0].activities[0].id, 'walk-1');
});

test('editar medicamento legacy sigue permitido aunque Cuidados esté desactivado; alta nueva no', () => {
  const original = {
    id: 'med-1', type: 'medication', title: 'Medicamento anterior', medication: 'Medicamento anterior',
    date: '2026-11-01', time: '08:00', note: 'Nota anterior',
  };
  const home = { pets: [basePet({ activities: [original], needsCare: false })] };
  const mock = mockContext(home);
  registerPets(mock.ctx);

  mock.actions.get('pet-activity-edit')({ petId: 'pet-1', id: 'med-1' });
  assert.equal(mock.modals.at(-1).title, 'Editar medicamento');
  mock.modals.at(-1).submit({ medication: 'Medicamento actualizado', date: '2026-11-04', time: '21:15', note: 'Después de cenar' });
  assert.equal(home.pets[0].activities[0].medication, 'Medicamento actualizado');
  assert.equal(home.pets[0].activities[0].id, 'med-1');

  mock.actions.get('pet-medication-add')({ id: 'pet-1' });
  assert.equal(mock.modals.length, 1);
});

test('rollback transaccional restaura una actividad cuando ctx.save falla', () => {
  const home = { pets: [basePet({ sex: 'female' })] };
  const mock = mockContext(home, { saveResult: false });
  registerPets(mock.ctx);
  mock.actions.get('pet-activity-add')({ id: 'pet-1' });
  mock.actions.get('pet-activity-type-select')({ petId: 'pet-1', type: 'heat' });
  mock.modals.at(-1).submit({ date: '2026-11-03', endDate: '' });

  assert.deepEqual(home.pets[0].activities, []);
  assert.equal(mock.renders, 0);
});

test('el origen de una actividad se abre con openPetActivity y el perfil sin id', () => {
  const home = { pets: [basePet({ activities: [{ id: 'walk-1', type: 'walk', title: 'Paseo', date: '2026-11-03' }] })] };
  const mock = mockContext(home);

  openPetActivity(mock.ctx, 'pet-1', 'walk-1');
  assert.equal(mock.modals.at(-1).title, 'Editar paseo');
  assert.match(mock.modals.at(-1).html, /name="duration"/);

  openPetActivity(mock.ctx, 'pet-1');
  assert.equal(mock.modals.at(-1).title, 'Editar mascota');
});

test('expone límites de foto compatibles con el contrato local', () => {
  assert.equal(MAX_PHOTO_INPUT_BYTES, 12 * 1024 * 1024);
  assert.equal(MAX_PHOTO_BYTES, 350000);
});
