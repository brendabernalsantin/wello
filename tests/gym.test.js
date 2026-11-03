import test from 'node:test';
import assert from 'node:assert/strict';
import { GYM_PLAN } from '../src/plan.js';
import { createSession, evolutionData, sessionKey, updateSet } from '../src/modules/gym.js';

test('el plan público contiene cuatro rutinas y 38 entradas con IDs estables', () => {
  assert.equal(GYM_PLAN.length, 4);
  assert.equal(GYM_PLAN.reduce((total, routine) => total + routine.exercises.length, 0), 38);

  const ids = GYM_PLAN.flatMap((routine) => routine.exercises.map((exercise) => exercise.id));
  assert.equal(new Set(ids).size, 38);
  assert.deepEqual(GYM_PLAN[0].exercises.find((exercise) => exercise.id === 'd1-prensa').reps, [6, 8, 10, 12]);
  assert.deepEqual(GYM_PLAN[2].exercises.find((exercise) => exercise.id === 'd3-extension').reps, [12, 10, 8, 6]);
  assert.deepEqual(GYM_PLAN[1].exercises.find((exercise) => exercise.id === 'd2-plancha').reps, ['40 seg', '40 seg', '40 seg']);
  assert.deepEqual(GYM_PLAN[2].exercises.find((exercise) => exercise.id === 'd3-isometrica').reps, ['30 seg', '30 seg', '30 seg', '30 seg']);
});

test('la identidad de sesión usa fecha local y rutina', () => {
  assert.equal(sessionKey('2026-11-03', 'd1'), '2026-11-03:d1');
  const session = createSession('2026-11-03', 'd1');
  assert.equal(session.id, '2026-11-03:d1');
  assert.equal(session.status, 'draft');
  assert.deepEqual(session.observations, []);
  assert.deepEqual(session.sets['d1-sentadilla'][0], { weight: null, done: false });
});

test('updateSet distingue cero kilogramos de sin peso y no muta la sesión original', () => {
  const original = createSession('2026-11-03', 'd1');
  const withZero = updateSet(original, 'd1-sentadilla', 0, { weight: '0', done: true });
  assert.notEqual(withZero, original);
  assert.deepEqual(original.sets['d1-sentadilla'][0], { weight: null, done: false });
  assert.deepEqual(withZero.sets['d1-sentadilla'][0], { weight: 0, done: true });

  const withoutWeight = updateSet(withZero, 'd1-sentadilla', 0, { weight: '', done: true });
  assert.deepEqual(withoutWeight.sets['d1-sentadilla'][0], { weight: null, done: true });
});

test('evolutionData usa la mayor carga de series realizadas y excluye series sin marcar', () => {
  let first = createSession('2026-10-01', 'd1');
  first = updateSet(first, 'd1-sentadilla', 0, { weight: 20, done: true });
  first = updateSet(first, 'd1-sentadilla', 1, { weight: 25, done: true });
  first = updateSet(first, 'd1-sentadilla', 2, { weight: 100, done: false });

  let second = createSession('2026-10-08', 'd1');
  second = updateSet(second, 'd1-sentadilla', 0, { weight: 0, done: true });

  const result = evolutionData([second, first], 'd1-sentadilla');
  assert.deepEqual(result.sessionPoints.map((point) => point.weight), [25, 0]);
  assert.deepEqual(result.sessionPoints[0].weights, [20, 25]);
  assert.equal(result.firstWeight, 25);
  assert.equal(result.lastWeight, 0);
  assert.equal(result.difference, -25);
  assert.equal(result.rule.includes('Mayor carga'), true);
});

test('las observaciones conservan referencia, nota y granularidad sin compararse como total', () => {
  const session = {
    ...createSession('2026-09-07', 'd1'),
    sourceNotes: ['Nota de ejemplo'],
    observations: [
      {
        exerciseId: 'd1-hip',
        weight: 17.25,
        reference: 'discs',
        date: '2026-09-07',
        note: 'Observación de ejemplo',
        verified: true,
        granularity: 'unknown',
      },
    ],
  };
  const result = evolutionData([session], 'd1-hip');
  assert.equal(result.observationPoints.length, 1);
  assert.equal(result.observationPoints[0].reference, 'discs');
  assert.equal(result.observationPoints[0].granularity, 'unknown');
  assert.equal(result.observationPoints[0].note, 'Observación de ejemplo');
  assert.equal(result.observationPoints[0].sourceNotes[0], 'Nota de ejemplo');
  assert.equal(result.chartPoints.length, 0);
  assert.equal(result.excludedObservations[0].reference, 'discs');
  assert.equal(result.first, null);
});

test('la gráfica compara solo la referencia seleccionada y excluye candidatos sin verificar',()=>{
  const session=createSession('2026-11-01','d1');
  session.observations=[{exerciseId:'d1-hip',weight:20,reference:'discs',verified:true,granularity:'unknown'},{exerciseId:'d1-hip',weight:999,reference:'discs',verified:false}];
  assert.equal(evolutionData([session],'d1-hip').chartPoints.length,0);
  const data=evolutionData([session],'d1-hip','discs');
  assert.equal(data.chartPoints.length,1);
  assert.equal(data.first,20);
  assert.equal(data.latest,20);
});
