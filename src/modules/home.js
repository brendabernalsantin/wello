import { visibleHabits, scheduled, habitProgress } from '../core.js';

export const HOME_HABIT_LIMIT = 4;

/** Cambia sólo la presentación; no modifica el orden ni los registros guardados. */
export function getHomeHabits(state, date) {
  return visibleHabits(state)
    .filter(habit => scheduled(habit, date))
    .map((habit, index) => ({ habit, index, done: habitProgress(habit, date).done }))
    .sort((left, right) => Number(left.done) - Number(right.done) || left.index - right.index)
    .slice(0, HOME_HABIT_LIMIT)
    .map(item => item.habit);
}
