import { EXERCISES_BY_ID, ROUTINES, exerciseById, routineById } from '../plan.js';

const LAVENDER = '#AC92EC';
const LAVENDER_DARK = '#7557B8';
const LAVENDER_SOFT = '#F3EEFF';
const VALID_REFERENCES = new Set(['total', 'discs', 'machine', 'reported', 'assistance']);

/** Return the stable personal identity of a session. */
export function sessionKey(date, routineId) {
  return `${String(date || '')}:${String(routineId || '')}`;
}

function normalizeWeight(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (text === '') return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function normalizeSet(value) {
  if (!value || typeof value !== 'object') return { weight: null, done: false };
  return {
    weight: normalizeWeight(value.weight),
    done: value.done === true,
  };
}

/**
 * Create a draft with all target series present. Targets are kept separate
 * from performed values: null means "sin peso anotado", not zero kilograms.
 */
export function createSession(date, routineId) {
  const routine = routineById(routineId);
  const sets = {};
  for (const exercise of routine?.exercises || []) {
    sets[exercise.id] = exercise.reps.map(() => ({ weight: null, done: false }));
  }
  return {
    id: sessionKey(date, routineId),
    date: String(date || ''),
    routineId: String(routineId || ''),
    sets,
    status: 'draft',
    observations: [],
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const routine = routineById(session.routineId);
  const base = createSession(session.date, session.routineId);
  const existingSets = session.sets && typeof session.sets === 'object' ? session.sets : {};
  const sets = { ...base.sets };

  for (const [exerciseId, rows] of Object.entries(existingSets)) {
    if (!Array.isArray(rows)) continue;
    sets[exerciseId] = rows.map(normalizeSet);
  }

  if (routine) {
    for (const exercise of routine.exercises) {
      const rows = Array.isArray(sets[exercise.id]) ? sets[exercise.id] : [];
      sets[exercise.id] = exercise.reps.map((_, index) => normalizeSet(rows[index]));
    }
  }

  return {
    ...session,
    id: session.id || sessionKey(session.date, session.routineId),
    date: String(session.date || ''),
    routineId: String(session.routineId || ''),
    sets,
    status: session.status === 'finished' ? 'finished' : 'draft',
    observations: Array.isArray(session.observations) ? session.observations.map((observation) => ({ ...observation })) : [],
  };
}

/**
 * Update one performed series immutably. The object form is preferred:
 * updateSet(session, exerciseId, index, { weight, done }). A primitive is also
 * accepted as a convenient weight-only update for integrations.
 */
export function updateSet(session, exerciseId, setIndex, changes, done) {
  if (!session || !session.sets || !Array.isArray(session.sets[exerciseId])) return session;
  const index = Number(setIndex);
  if (!Number.isInteger(index) || index < 0 || index >= session.sets[exerciseId].length) return session;

  const patch = changes && typeof changes === 'object' && !Array.isArray(changes)
    ? changes
    : { weight: changes, ...(done === undefined ? {} : { done }) };
  const current = normalizeSet(session.sets[exerciseId][index]);
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'weight')) {
    next.weight = normalizeWeight(patch.weight);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'done')) {
    next.done = patch.done === true || patch.done === 'true' || patch.done === 1;
  }

  const rows = session.sets[exerciseId].map((row, rowIndex) => (
    rowIndex === index ? next : normalizeSet(row)
  ));
  return {
    ...session,
    sets: { ...session.sets, [exerciseId]: rows },
  };
}

function observationReference(value) {
  return VALID_REFERENCES.has(value) ? value : 'reported';
}

function observationWeight(value) {
  const weight = normalizeWeight(value);
  return weight === null ? null : weight;
}

function dateOrder(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function sourceNotesFor(value) {
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function sessionPointsFor(sessions, exerciseId) {
  const points = [];
  for (const rawSession of Array.isArray(sessions) ? sessions : []) {
    const session = normalizeSession(rawSession);
    if (!session || !session.date || !session.sets || !Array.isArray(session.sets[exerciseId])) continue;
    const performed = session.sets[exerciseId]
      .map((set, index) => ({ ...normalizeSet(set), index }))
      .filter((set) => set.done && set.weight !== null);
    if (performed.length) {
      const weights = performed.map((set) => set.weight);
      points.push({
        date: session.date,
        weight: Math.max(...weights),
        maxWeight: Math.max(...weights),
        weights,
        series: performed.map((set) => set.index),
        source: 'session',
        reference: observationReference(session.weightReferences?.[exerciseId] || 'total'),
        sessionId: session.id || sessionKey(session.date, session.routineId),
        routineId: session.routineId,
      });
    }
  }
  return points;
}

function observationPointsFor(sessions, exerciseId) {
  const points = [];
  for (const rawSession of Array.isArray(sessions) ? sessions : []) {
    const session = normalizeSession(rawSession);
    if (!session) continue;
    const observations = Array.isArray(session.observations) ? session.observations : [];
    for (const rawObservation of observations) {
      if (!rawObservation || rawObservation.exerciseId !== exerciseId) continue;
      const weight = observationWeight(rawObservation.weight);
      if (weight === null) continue;
      points.push({
        date: rawObservation.date || session.date,
        weight,
        source: 'observation',
        reference: observationReference(rawObservation.reference),
        granularity: rawObservation.granularity || 'unknown',
        verified: rawObservation.verified === true,
        note: rawObservation.note || rawObservation.sourceNote || '',
        sourceNotes: sourceNotesFor(rawObservation.sourceNotes).length
          ? sourceNotesFor(rawObservation.sourceNotes)
          : sourceNotesFor(session.sourceNotes),
        sessionId: session.id || sessionKey(session.date, session.routineId),
        routineId: session.routineId,
      });
    }
  }
  return points;
}

/**
 * Derive reproducible progress data. Session points use the greatest load of
 * a performed series on each date. Historical observations remain explicit;
 * references other than total are excluded from comparable chart/statistics.
 */
export function evolutionData(sessions, exerciseId, reference = 'total') {
  const sessionPoints = sessionPointsFor(sessions, exerciseId).sort((a, b) => dateOrder(a.date, b.date));
  const observationPoints = observationPointsFor(sessions, exerciseId).sort((a, b) => dateOrder(a.date, b.date));
  const points = [...sessionPoints, ...observationPoints].sort((a, b) => {
    const dateResult = dateOrder(a.date, b.date);
    if (dateResult !== 0) return dateResult;
    if (a.source === b.source) return 0;
    return a.source === 'session' ? -1 : 1;
  });
  const chartPoints = points.filter((point) => point.reference === reference && (point.source === 'session' || point.verified));
  const byDate = new Map();
  for (const point of chartPoints) {
    const previous = byDate.get(point.date);
    if (!previous || point.weight > previous.weight) byDate.set(point.date, point);
  }
  const comparableSessions = [...byDate.values()].sort((a,b) => dateOrder(a.date,b.date));
  const firstPoint = comparableSessions[0] || null;
  const lastPoint = comparableSessions[comparableSessions.length - 1] || null;
  const difference = firstPoint && lastPoint ? lastPoint.weight - firstPoint.weight : null;

  return {
    exerciseId,
    points,
    chartPoints,
    sessionPoints,
    observationPoints,
    history: points,
    first: firstPoint ? firstPoint.weight : null,
    latest: lastPoint ? lastPoint.weight : null,
    firstWeight: firstPoint ? firstPoint.weight : null,
    lastWeight: lastPoint ? lastPoint.weight : null,
    difference,
    rule: 'Mayor carga de una serie realizada por fecha; se excluyen series sin carga o no realizadas.',
    excludedObservations: observationPoints.filter((point) => point.reference !== reference || !point.verified),
  };
}

function escapeHtml(ctx, value) {
  const text = String(value ?? '');
  if (ctx && typeof ctx.esc === 'function') return ctx.esc(text);
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function icon(ctx, name, size = 18) {
  return ctx && typeof ctx.icon === 'function' ? ctx.icon(name, size) : '';
}

function prettyDate(ctx, date) {
  if (!date) return 'Sin fecha';
  if (ctx && typeof ctx.prettyDate === 'function') return ctx.prettyDate(date);
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('es-MX', { dateStyle: 'medium' });
}

function today(ctx) {
  if (ctx && typeof ctx.today === 'function') return ctx.today();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function viewFor(ctx) {
  if (!ctx.view || typeof ctx.view !== 'object') ctx.view = {};
  return ctx.view;
}

function stateFor(ctx) {
  const state = ctx && typeof ctx.state === 'function' ? (ctx.state() || {}) : {};
  if (!state.personal || typeof state.personal !== 'object') state.personal = {};
  if (!Array.isArray(state.personal.sessions)) state.personal.sessions = [];
  return state;
}

function sessionsFor(ctx) {
  return stateFor(ctx).personal.sessions;
}

function selectedRoutineId(view) {
  return view.gymRoutine || ROUTINES[0]?.id || '';
}

function selectedDate(ctx, view) {
  return view.gymDate || today(ctx);
}

function selectedSession(sessions, date, routineId) {
  const id = sessionKey(date, routineId);
  return sessions.find((session) => session && (session.id === id || (session.date === date && session.routineId === routineId))) || null;
}

function setInSession(session, exerciseId, index) {
  const row = session?.sets?.[exerciseId]?.[index];
  return normalizeSet(row);
}

function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === '') return 'Sin peso anotado';
  return `${String(weight).replace(/\.0+$/, '')} kg`;
}

function referenceLabel(reference) {
  return ({
    total: 'peso total',
    discs: 'peso en discos',
    machine: 'peso de máquina',
    reported: 'peso reportado',
    assistance: 'asistencia',
  })[reference] || 'peso reportado';
}

function observationLabel(point, ctx) {
  const parts = [referenceLabel(point.reference)];
  if (point.granularity === 'unknown') parts.push('granularidad desconocida');
  if (point.verified === false) parts.push('pendiente de verificar');
  return escapeHtml(ctx, parts.join(' · '));
}

function routineOptions(viewRoutineId, ctx) {
  return ROUTINES.map((routine) => `<option value="${escapeHtml(ctx, routine.id)}"${routine.id === viewRoutineId ? ' selected' : ''}>${escapeHtml(ctx, `${routine.name} · ${routine.title}`)}</option>`).join('');
}

function exerciseOptions(routine, selectedExerciseId, ctx) {
  return (routine?.exercises || []).map((exercise) => `<option value="${escapeHtml(ctx, exercise.id)}"${exercise.id === selectedExerciseId ? ' selected' : ''}>${escapeHtml(ctx, exercise.name)}</option>`).join('');
}

function renderRoutineCards(view, ctx) {
  return `<div class="gym-routine-cards grid-four" role="list" aria-label="Rutinas">
    ${ROUTINES.map((routine) => `<button type="button" class="card gym-routine-card${routine.id === selectedRoutineId(view) ? ' active' : ''}" data-action="gym-routine-card" data-routine-id="${escapeHtml(ctx, routine.id)}" role="listitem">
      <span class="eyebrow">${escapeHtml(ctx, routine.name)}</span>
      <strong>${escapeHtml(ctx, routine.title)}</strong>
    </button>`).join('')}
  </div>`;
}

function renderExerciseCard(exercise, session, ctx) {
  const rows = exercise.reps.map((target, index) => {
    const set = setInSession(session, exercise.id, index);
    const checked = set.done ? ' checked' : '';
    const value = set.weight === null ? '' : escapeHtml(ctx, set.weight);
    const targetText = typeof target === 'number' ? `${target} rep${target === 1 ? '' : 's'}` : target;
    return `<div class="gym-set-row${set.done ? ' is-done' : ''}">
      <span class="gym-set-target">Serie ${index + 1} · ${escapeHtml(ctx, targetText)}</span>
      <label class="field gym-weight-field">
        <span class="sr-only">Peso de la serie ${index + 1} de ${escapeHtml(ctx, exercise.name)} en kg</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="kg" value="${value}" data-change="gym-set-weight" data-exercise-id="${escapeHtml(ctx, exercise.id)}" data-set-index="${index}" aria-label="Peso de la serie ${index + 1}">
      </label>
      <label class="gym-done-toggle">
        <input type="checkbox"${checked} data-change="gym-set-done" data-exercise-id="${escapeHtml(ctx, exercise.id)}" data-set-index="${index}" aria-label="Marcar serie ${index + 1} realizada">
        <span>Hecha</span>
      </label>
    </div>`;
  }).join('');

  return `<article class="card exercise-card gym-exercise-card" data-exercise-id="${escapeHtml(ctx, exercise.id)}">
    <div class="section-head">
      <div>
        <span class="eyebrow">${escapeHtml(ctx, exercise.group)}</span>
        <h3 class="section-title">${escapeHtml(ctx, exercise.name)}</h3>
      </div>
      ${icon(ctx, 'dumbbell', 20)}
    </div>
    <label class="field small">Referencia de la carga<select data-change="gym-reference" data-exercise-id="${escapeHtml(ctx, exercise.id)}">${[...VALID_REFERENCES].map(ref => `<option value="${ref}" ${(session?.weightReferences?.[exercise.id] || 'total') === ref ? 'selected' : ''}>${referenceLabel(ref)}</option>`).join('')}</select></label>
    <div class="series-grid gym-series-grid">${rows}</div>
  </article>`;
}

function renderTraining(view, sessions, ctx) {
  const date = selectedDate(ctx, view);
  const routineId = selectedRoutineId(view);
  const routine = routineById(routineId) || ROUTINES[0];
  const session = selectedSession(sessions, date, routine.id);
  const groups = [];
  for (const exercise of routine.exercises) {
    let group = groups.find((item) => item.name === exercise.group);
    if (!group) {
      group = { name: exercise.group, exercises: [] };
      groups.push(group);
    }
    group.exercises.push(exercise);
  }

  return `<div class="gym-training-view">
    <div class="toolbar gym-controls">
      <label class="field"><span>Fecha</span><input type="date" name="gym-date" value="${escapeHtml(ctx, date)}" data-change="gym-date"></label>
      <label class="field"><span>Rutina</span><select name="gym-routine" data-change="gym-routine">${routineOptions(routine.id, ctx)}</select></label>
    </div>
    ${renderRoutineCards({ ...view, gymRoutine: routine.id }, ctx)}
    <div class="section-head gym-session-heading">
      <div>
        <span class="eyebrow">${escapeHtml(ctx, routine.name)}</span>
        <h2 class="section-title">${escapeHtml(ctx, routine.title)}</h2>
        <p class="muted small">${escapeHtml(ctx, prettyDate(ctx, date))}. Captura el peso por serie y marca únicamente lo que sí realizaste.</p>
      </div>
      <span class="chip gym-status">${session?.status === 'finished' ? 'Terminado' : 'Borrador'}</span>
    </div>
    ${groups.map((group, groupIndex) => `<section class="gym-group-card" aria-labelledby="gym-group-${groupIndex}">
      <div class="section-head"><h3 id="gym-group-${groupIndex}" class="section-title">${escapeHtml(ctx, group.name)}</h3></div>
      <div class="stack">${group.exercises.map((exercise) => renderExerciseCard(exercise, session, ctx)).join('')}</div>
    </section>`).join('')}
    <div class="gym-finish-row">
      <p class="muted small">Terminar guarda la sesión aunque haya ejercicios o series pendientes. Lo que no marques permanece sin realizar.</p>
      <button type="button" class="btn primary" data-action="gym-finish" data-date="${escapeHtml(ctx, date)}" data-routine-id="${escapeHtml(ctx, routine.id)}">${icon(ctx, 'check', 17)} Terminar sesión</button>
    </div>
  </div>`;
}

function chartY(value, min, max, top, height) {
  if (max === min) return top + height / 2;
  return top + height - ((value - min) / (max - min)) * height;
}

function renderEvolutionChart(data, ctx) {
  const chartPoints = data.chartPoints || [];
  if (!chartPoints.length) {
    return `<div class="empty gym-chart-empty"><strong>Aún no hay cargas comparables</strong><span>Marca una serie realizada con un peso para verla aquí. Las observaciones con otra referencia se conservan abajo sin mezclarse.</span></div>`;
  }

  const width = 720;
  const height = 280;
  const left = 58;
  const right = 20;
  const top = 24;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const weights = chartPoints.map((point) => point.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const dates = [...new Set(chartPoints.map((point) => point.date))];
  const xFor = (date) => {
    const index = dates.indexOf(date);
    return dates.length === 1 ? left + plotWidth / 2 : left + (index / (dates.length - 1)) * plotWidth;
  };
  const sessionPoints = chartPoints.filter((point) => point.source === 'session');
  const sessionPolyline = sessionPoints.map((point) => `${xFor(point.date)},${chartY(point.weight, min, max, top, plotHeight)}`).join(' ');
  const yTicks = [max, min === max ? min : min + (max - min) / 2, min];
  const labels = dates.map((date) => `<text x="${xFor(date)}" y="${height - 15}" text-anchor="middle" class="gym-chart-label">${escapeHtml(ctx, date.slice(5))}</text>`).join('');
  const grid = yTicks.map((tick) => {
    const y = chartY(tick, min, max, top, plotHeight);
    return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="gym-chart-grid"></line><text x="${left - 10}" y="${y + 4}" text-anchor="end" class="gym-chart-label">${escapeHtml(ctx, formatWeight(tick))}</text>`;
  }).join('');
  const marks = chartPoints.map((point) => {
    const x = xFor(point.date);
    const y = chartY(point.weight, min, max, top, plotHeight);
    const observation = point.source === 'observation';
    return `<circle cx="${x}" cy="${y}" r="${observation ? 6 : 5}" class="${observation ? 'gym-chart-observation' : 'gym-chart-point'}"><title>${escapeHtml(ctx, `${point.date} · ${formatWeight(point.weight)}${observation ? ` · ${referenceLabel(point.reference)}` : ''}`)}</title></circle>`;
  }).join('');

  return `<div class="chart gym-chart-wrap">
    <svg class="gym-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución de cargas por fecha">
      ${grid}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" class="gym-chart-axis"></line>
      <line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" class="gym-chart-axis"></line>
      ${sessionPolyline ? `<polyline points="${sessionPolyline}" class="gym-chart-line"></polyline>` : ''}
      ${marks}${labels}
    </svg>
    <div class="gym-chart-legend"><span><i class="gym-legend-dot"></i>Serie realizada</span><span><i class="gym-legend-observation"></i>Observación histórica etiquetada</span></div>
  </div>`;
}

function renderObservationHistory(data, ctx) {
  if (!data.observationPoints.length) return '';
  return `<section class="card gym-observations"><div class="section-head"><div><span class="eyebrow">Histórico importado</span><h3 class="section-title">Observaciones conservadas</h3></div></div>
    <div class="stack">${data.observationPoints.map((point) => `<div class="list-row gym-observation-row">
      <div><strong>${escapeHtml(ctx, prettyDate(ctx, point.date))}</strong><div class="muted small">${observationLabel(point, ctx)}${point.granularity === 'unknown' ? '' : ''}</div></div>
      <strong>${escapeHtml(ctx, formatWeight(point.weight))}</strong>
      ${point.note ? `<p class="note">${escapeHtml(ctx, point.note)}</p>` : ''}
    </div>`).join('')}</div>
    <p class="muted small">Las referencias a discos, máquina o peso reportado no se comparan con un peso total. La granularidad desconocida se muestra tal como llegó.</p>
  </section>`;
}

function renderEvolution(view, sessions, ctx) {
  const routine = routineById(view.gymEvolutionRoutine || selectedRoutineId(view)) || ROUTINES[0];
  const exerciseId = view.gymEvolutionExercise && routine.exercises.some((exercise) => exercise.id === view.gymEvolutionExercise)
    ? view.gymEvolutionExercise
    : routine.exercises[0]?.id;
  const exercise = exerciseById(exerciseId, routine.id) || routine.exercises[0];
  const reference = VALID_REFERENCES.has(view.gymEvolutionReference) ? view.gymEvolutionReference : 'total';
  const data = evolutionData(sessions, exercise?.id, reference);
  const assisted = exercise?.name?.toLocaleLowerCase('es-MX').includes('asistid');
  const first = data.first === null ? 'Sin datos' : formatWeight(data.first);
  const latest = data.latest === null ? 'Sin datos' : formatWeight(data.latest);
  const difference = data.difference === null ? 'Sin datos' : `${data.difference > 0 ? '+' : ''}${formatWeight(data.difference)}`;

  return `<div class="gym-evolution-view">
    <div class="toolbar gym-controls">
      <label class="field"><span>Rutina</span><select data-change="gym-evolution-routine">${routineOptions(routine.id, ctx)}</select></label>
      <label class="field"><span>Ejercicio</span><select data-change="gym-evolution-exercise">${exerciseOptions(routine, exercise?.id, ctx)}</select></label>
      <label class="field"><span>Comparar solo</span><select data-change="gym-evolution-reference">${[...VALID_REFERENCES].map(ref => `<option value="${ref}" ${reference === ref ? 'selected' : ''}>${referenceLabel(ref)}</option>`).join('')}</select></label>
    </div>
    <div class="section-head"><div><span class="eyebrow">Evolución</span><h2 class="section-title">${escapeHtml(ctx, exercise?.name || 'Ejercicio')}</h2></div></div>
    <div class="grid-three gym-metrics">
      <div class="metric"><span class="muted small">Primera carga</span><strong>${escapeHtml(ctx, first)}</strong></div>
      <div class="metric"><span class="muted small">Última carga</span><strong>${escapeHtml(ctx, latest)}</strong></div>
      <div class="metric"><span class="muted small">Diferencia en kg</span><strong>${escapeHtml(ctx, difference)}</strong></div>
    </div>
    <p class="note gym-evolution-rule">${escapeHtml(ctx, data.rule)} Solo ${referenceLabel(reference)}. Las observaciones verificadas se muestran etiquetadas, sin inferir series; si hay varias el mismo día, la comparación usa la mayor observada. ${assisted || reference === 'assistance' ? 'En ejercicios asistidos, una menor asistencia puede ser progreso.' : ''}</p>
    ${renderEvolutionChart(data, ctx)}
    ${data.sessionPoints.length ? `<section class="panel"><h3>Cargas por serie y fecha</h3>${data.sessionPoints.map(point=>`<div class="list-row"><span><strong>${prettyDate(ctx,point.date)}</strong><span class="small muted">${referenceLabel(point.reference)}</span></span><span class="small">${point.weights.map((weight,i)=>`Serie ${point.series[i]+1}: ${formatWeight(weight)}`).join(' · ')}</span></div>`).join('')}</section>` : ''}
    ${renderObservationHistory(data, ctx)}
  </div>`;
}

function renderHistorySession(session, ctx) {
  const routine = routineById(session.routineId);
  const rows = [];
  for (const exercise of routine?.exercises || []) {
    const sets = Array.isArray(session.sets?.[exercise.id]) ? session.sets[exercise.id] : [];
    sets.forEach((set, index) => {
      const normalized = normalizeSet(set);
      if (!normalized.done && normalized.weight === null) return;
      rows.push(`<div class="list-row"><span>${escapeHtml(ctx, `${exercise.name} · serie ${index + 1}`)}</span><span>${normalized.done ? 'Realizada' : 'Sin marcar'} · ${escapeHtml(ctx, formatWeight(normalized.weight))}</span></div>`);
    });
  }
  const observations = Array.isArray(session.observations) ? session.observations : [];
  const notes = sourceNotesFor(session.sourceNotes);
  return `<article class="card gym-history-card">
    <div class="section-head"><div><span class="eyebrow">${escapeHtml(ctx, prettyDate(ctx, session.date))}</span><h3 class="section-title">${escapeHtml(ctx, routine?.name || session.routineId)} · ${escapeHtml(ctx, routine?.title || '')}</h3></div><span class="chip">${session.status === 'finished' ? 'Terminado' : 'Borrador'}</span></div>
    ${rows.length ? `<div class="stack gym-history-sets">${rows.join('')}</div>` : '<p class="muted small">No hay series marcadas; las pendientes no se marcaron automáticamente.</p>'}
    ${observations.length ? `<div class="stack gym-history-observations"><strong>Observaciones</strong>${observations.map((observation) => `<div class="note">${escapeHtml(ctx, `${observation.exerciseId || 'Ejercicio'} · ${formatWeight(observation.weight)} · ${referenceLabel(observation.reference)}`)}${observation.granularity === 'unknown' ? ' · granularidad desconocida' : ''}${observation.note ? ` · ${escapeHtml(ctx, observation.note)}` : ''}</div>`).join('')}</div>` : ''}
    ${notes.length ? `<div class="note"><strong>Notas de fuente:</strong> ${notes.map((note) => escapeHtml(ctx, note)).join(' · ')}</div>` : ''}
  </article>`;
}

function renderHistory(sessions, ctx) {
  const ordered = [...sessions].filter(Boolean).sort((a, b) => dateOrder(b.date, a.date));
  if (!ordered.length) {
    return `<div class="empty"><strong>Aún no hay historial</strong><span>Termina una sesión para conservarla aquí. Las sesiones parciales mantienen únicamente tus marcas.</span></div>`;
  }
  return `<div class="gym-history-view"><div class="section-head"><div><span class="eyebrow">Historial</span><h2 class="section-title">Tus entrenamientos guardados</h2><p class="muted small">Las series omitidas no se convierten en realizadas.</p></div></div><div class="stack">${ordered.map((session) => renderHistorySession(session, ctx)).join('')}</div></div>`;
}

/** Render only; persistence is handled by registerGym handlers. */
export function renderGym(ctx = {}) {
  const view = viewFor(ctx);
  const sessions = sessionsFor(ctx);
  const tab = ['entrenar', 'evolucion', 'historial'].includes(view.gymTab) ? view.gymTab : 'entrenar';
  const tabs = [
    ['entrenar', 'Entrenar', 'dumbbell'],
    ['evolucion', 'Evolución', 'trending-up'],
    ['historial', 'Historial', 'history'],
  ];
  let body = renderTraining(view, sessions, ctx);
  if (tab === 'evolucion') body = renderEvolution(view, sessions, ctx);
  if (tab === 'historial') body = renderHistory(sessions, ctx);

  return `<section class="gym-module panel" data-module="gym" data-page="gym" style="--accent:${LAVENDER};--soft:${LAVENDER_SOFT};--gym-ink:${LAVENDER_DARK}">
    <header class="section-head gym-header"><div><span class="eyebrow">Wello · Gym</span><h1 class="section-title">Entrena a tu ritmo</h1><p class="muted">Registra cargas reales sin perder el contexto de cada rutina.</p></div>${ctx.img ? ctx.img('gym', 'gym-illustration') : ''}</header>
    <nav class="tabs gym-tabs" aria-label="Vistas de Gym">${tabs.map(([id, label, iconName]) => `<button type="button" class="tab${id === tab ? ' active' : ''}" data-action="gym-tab" data-tab="${id}" aria-selected="${id === tab}">${icon(ctx, iconName, 17)}<span>${label}</span></button>`).join('')}</nav>
    ${body}
  </section>`;
}

function datasetOf(data, event, element) {
  if (data && typeof data === 'object' && !data.target && !data.currentTarget) return data;
  return element?.dataset || event?.target?.dataset || {};
}

function valueOf(data, event, element) {
  if (element && 'value' in element) return element.value;
  if (event?.target && 'value' in event.target) return event.target.value;
  return data?.value;
}

function upsertSession(ctx, session) {
  const state = stateFor(ctx);
  const sessions = state.personal.sessions;
  const index = sessions.findIndex((candidate) => candidate && (candidate.id === session.id || sessionKey(candidate.date, candidate.routineId) === session.id));
  if (index === -1) sessions.push(session);
  else sessions[index] = session;
  if (typeof ctx.save === 'function') ctx.save();
}

function ensureSession(ctx, date, routineId) {
  const sessions = sessionsFor(ctx);
  const existing = selectedSession(sessions, date, routineId);
  return normalizeSession(existing) || createSession(date, routineId);
}

function updatePerformedSet(ctx, data, event, element, patch) {
  const view = viewFor(ctx);
  const dataset = datasetOf(data, event, element);
  const date = dataset.date || selectedDate(ctx, view);
  const routineId = dataset.routineId || selectedRoutineId(view);
  const exerciseId = dataset.exerciseId;
  const setIndex = Number(dataset.setIndex);
  if (!exerciseId || !Number.isInteger(setIndex)) return;
  const session = ensureSession(ctx, date, routineId);
  const updated = updateSet(session, exerciseId, setIndex, patch);
  upsertSession(ctx, updated);
  // Deliberately do not call ctx.render(): a change persists without replacing
  // the input, so focus and cursor position are not lost during a workout.
}

function rerender(ctx) {
  if (typeof ctx.render === 'function') ctx.render();
}

/** Register delegated actions and change handlers with the module contract. */
export function registerGym(ctx = {}) {
  if (!ctx) return;
  const view = () => viewFor(ctx);
  const action = (name, handler) => {
    if (typeof ctx.action === 'function') ctx.action(name, handler);
  };
  const change = (name, handler) => {
    if (typeof ctx.change === 'function') ctx.change(name, handler);
  };

  action('gym-tab', (data, event, element) => {
    const dataset = datasetOf(data, event, element);
    if (['entrenar', 'evolucion', 'historial'].includes(dataset.tab)) {
      view().gymTab = dataset.tab;
      rerender(ctx);
    }
  });

  action('gym-routine-card', (data, event, element) => {
    const dataset = datasetOf(data, event, element);
    if (!routineById(dataset.routineId)) return;
    view().gymRoutine = dataset.routineId;
    rerender(ctx);
  });

  action('gym-finish', (data, event, element) => {
    const dataset = datasetOf(data, event, element);
    const date = dataset.date || selectedDate(ctx, view());
    const routineId = dataset.routineId || selectedRoutineId(view());
    const session = ensureSession(ctx, date, routineId);
    upsertSession(ctx, { ...session, status: 'finished' });
    if (typeof ctx.toast === 'function') ctx.toast('Sesión guardada; las series pendientes siguen sin marcar.');
    rerender(ctx);
  });

  change('gym-date', (data, event, element) => {
    const nextDate = valueOf(data, event, element);
    if (!nextDate) return;
    view().gymDate = nextDate;
    rerender(ctx);
  });

  change('gym-routine', (data, event, element) => {
    const nextRoutine = valueOf(data, event, element);
    if (!routineById(nextRoutine)) return;
    view().gymRoutine = nextRoutine;
    rerender(ctx);
  });

  change('gym-evolution-routine', (data, event, element) => {
    const nextRoutine = valueOf(data, event, element);
    const routine = routineById(nextRoutine);
    if (!routine) return;
    view().gymEvolutionRoutine = nextRoutine;
    view().gymEvolutionExercise = routine.exercises[0]?.id;
    rerender(ctx);
  });

  change('gym-evolution-exercise', (data, event, element) => {
    const nextExercise = valueOf(data, event, element);
    if (!EXERCISES_BY_ID[nextExercise]) return;
    view().gymEvolutionExercise = nextExercise;
    rerender(ctx);
  });

  change('gym-reference', (data, event, element) => {
    const dataset = datasetOf(data, event, element);
    const reference = valueOf(data, event, element);
    if (!VALID_REFERENCES.has(reference)) return;
    const session = ensureSession(ctx, selectedDate(ctx, view()), selectedRoutineId(view()));
    session.weightReferences = { ...(session.weightReferences || {}), [dataset.exerciseId]: reference };
    upsertSession(ctx, session);
  });
  change('gym-evolution-reference', (data,event,element) => {
    view().gymEvolutionReference = valueOf(data,event,element);
    rerender(ctx);
  });
  change('gym-set-weight', (data, event, element) => {
    updatePerformedSet(ctx, data, event, element, { weight: valueOf(data, event, element) });
  });

  change('gym-set-done', (data, event, element) => {
    const checked = element ? element.checked : event?.target?.checked;
    updatePerformedSet(ctx, data, event, element, { done: checked === true });
  });
}

export { normalizeWeight };
