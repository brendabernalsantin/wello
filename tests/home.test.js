import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState } from '../src/core.js';
import { getHomeHabits, HOME_HABIT_LIMIT } from '../src/modules/home.js';

const DATE = '2026-11-12';
const habit = (id, extra = {}) => ({ id, name: id, startDate: DATE, frequency: 'daily', type: 'check', logs: {}, ...extra });
const ids = habits => habits.map(h => h.id);

function sample() {
  const state = initialState();
  state.personal.habits = Array.from({ length: 7 }, (_, i) => habit(`h${i + 1}`));
  return state;
}

test('Inicio limita a cuatro hábitos', () => {
  const state = sample();
  assert.equal(HOME_HABIT_LIMIT, 4);
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['h1', 'h2', 'h3', 'h4']);
});

test('marcar un hábito sube el siguiente pendiente sin borrar ni reordenar los registros', () => {
  const state = sample();
  state.personal.habits[0].logs[DATE] = true;
  const snapshot = structuredClone(state);
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['h2', 'h3', 'h4', 'h5']);
  assert.deepEqual(state, snapshot);
  assert.equal(state.personal.habits[0].logs[DATE], true);
});

test('los realizados quedan debajo de los pendientes cuando caben en Inicio', () => {
  const state = sample();
  state.personal.habits = state.personal.habits.slice(0, 4);
  state.personal.habits[0].logs[DATE] = true;
  state.personal.habits[2].logs[DATE] = true;
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['h2', 'h4', 'h1', 'h3']);
  state.personal.habits[0].logs[DATE] = false;
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['h1', 'h2', 'h4', 'h3']);
});

test('una cantidad parcial sigue pendiente y sólo una meta cumplida baja al final', () => {
  const state = initialState();
  state.personal.habits = [habit('agua', { type: 'quantity', target: 2, goalPeriod: 'day', unit: 'litros', logs: { [DATE]: 0.75 } }), habit('leer')];
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['agua', 'leer']);
  assert.equal(state.personal.habits[0].logs[DATE], 0.75);
  state.personal.habits[0].logs[DATE] = 2;
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['leer', 'agua']);
});

test('Inicio combina hábitos personales y del hogar activo pero no los de otro hogar ni fechas futuras', () => {
  const state = initialState();
  state.personal.habits = [habit('personal'), habit('futuro', { startDate: '2026-12-01' })];
  state.households[0].habits = [habit('familia')];
  state.households.push({ ...structuredClone(state.households[0]), id: 'otro-hogar', name: 'Otra casa', habits: [habit('otro')] });
  assert.deepEqual(ids(getHomeHabits(state, DATE)), ['personal', 'familia']);
});
