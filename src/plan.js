/**
 * Plan público de entrenamiento de Wello.
 *
 * Las filas representan el objetivo del plan; nunca son evidencia de una
 * sesión realizada. Las cargas históricas se mantienen fuera de este archivo.
 */

const entry = (id, group, name, reps) => ({
  id,
  group,
  name,
  sets: reps.length,
  reps: [...reps],
  targets: [...reps],
});

export const ROUTINES = [
  {
    id: 'd1',
    name: 'Día 1',
    title: 'Glúteo, isquios y cuádriceps',
    exercises: [
      entry('d1-sentadilla', 'Tren inferior', 'Sentadilla libre con barra', [10, 10, 10]),
      entry('d1-desplante', 'Tren inferior', 'Desplante en reversa con mancuernas', [12, 12, 12]),
      entry('d1-peso', 'Tren inferior', 'Peso muerto con barra', [10, 10, 10, 10]),
      entry('d1-hip', 'Tren inferior', 'Hip thrust con barra', [10, 10, 10, 10]),
      entry('d1-femoral', 'Tren inferior', 'Femoral acostada en máquina a dos piernas', [12, 12, 12, 12]),
      entry('d1-prensa', 'Tren inferior', 'Prensa 45°', [6, 8, 10, 12]),
      entry('d1-patada', 'Tren inferior', 'Patada para glúteo en polea', [10, 10, 10, 10]),
      entry('d1-costurera', 'Pantorrilla', 'Costurera', [15, 15, 15, 15]),
    ],
  },
  {
    id: 'd2',
    name: 'Día 2',
    title: 'Tríceps, espalda y abdomen',
    exercises: [
      entry('d2-extension', 'Tríceps', 'Extensión con cuerda', [15, 15, 15, 15]),
      entry('d2-patada', 'Tríceps', 'Patada para tríceps con mancuerna', [10, 10, 10, 10]),
      entry('d2-copa', 'Tríceps', 'Copa a una mano', [12, 12, 12, 12]),
      entry('d2-fondos', 'Tríceps', 'Fondos en banco sin peso', [12, 12, 12, 12]),
      entry('d2-dominadas', 'Espalda', 'Dominadas abiertas asistidas', [12, 12, 12]),
      entry('d2-abierto', 'Espalda', 'Jalón abierto al pecho', [12, 12, 12]),
      entry('d2-cerrado', 'Espalda', 'Jalón cerrado al pecho', [10, 10, 10]),
      entry('d2-remo', 'Espalda', 'Remo con mancuerna a una mano', [10, 10, 10]),
      entry('d2-crunch', 'Abdomen', 'Abdominal crunch en colchoneta', [12, 12, 12]),
      entry('d2-plancha', 'Abdomen', 'Plancha', ['40 seg', '40 seg', '40 seg']),
      entry('d2-lateral', 'Abdomen', 'Crunch lateral cruzado', [12, 12, 12]),
    ],
  },
  {
    id: 'd3',
    name: 'Día 3',
    title: 'Isquios, glúteo y cuádriceps',
    exercises: [
      entry('d3-sentadilla', 'Tren inferior', 'Sentadilla libre', [10, 10, 10, 10]),
      entry('d3-goblet', 'Tren inferior', 'Sentadilla goblet', [10, 10, 10, 10]),
      entry('d3-hack', 'Tren inferior', 'Hack squat', [10, 10, 10, 10]),
      entry('d3-extension', 'Tren inferior', 'Extensión a dos piernas', [12, 10, 8, 6]),
      entry('d3-isometrica', 'Tren inferior', 'Sentadilla isométrica con peso', ['30 seg', '30 seg', '30 seg', '30 seg']),
      entry('d3-hip', 'Tren inferior', 'Hip thrust con barra', [10, 10, 10, 10]),
      entry('d3-patada', 'Tren inferior', 'Patada para glúteo en polea', [10, 10, 10, 10]),
      entry('d3-costurera', 'Pantorrilla', 'Costurera', [15, 15, 15, 15]),
    ],
  },
  {
    id: 'd4',
    name: 'Día 4',
    title: 'Bíceps, hombro y pecho',
    exercises: [
      entry('d4-curl', 'Bíceps', 'Curl con barra de pie', [10, 10, 10]),
      entry('d4-martillo', 'Bíceps', 'Curl martillo con mancuernas', [12, 12, 12]),
      entry('d4-polea', 'Bíceps', 'Curl en polea con barra chica', [10, 10, 10]),
      entry('d4-cuerda', 'Bíceps', 'Curl con cuerda en polea', [12, 12, 12]),
      entry('d4-militar', 'Hombro', 'Press militar con mancuernas sentada', [10, 10, 10]),
      entry('d4-frontal', 'Hombro', 'Elevación frontal en polea con cuerda', [10, 10, 10]),
      entry('d4-laterales', 'Hombro', 'Elevaciones laterales con mancuernas', [15, 15, 15]),
      entry('d4-flies', 'Hombro', 'Flies invertidos en máquina', [12, 12, 12]),
      entry('d4-inclinado', 'Pecho', 'Press inclinado con mancuernas', [10, 10, 10]),
      entry('d4-fly', 'Pecho', 'Pectoral fly en máquina', [12, 12, 12]),
      entry('d4-horizontal', 'Pecho', 'Press en banco horizontal con barra', [10, 10, 10]),
    ],
  },
];

export const GYM_PLAN = ROUTINES;
export const gymPlan = ROUTINES;
export const PLAN = ROUTINES;
export const plan = ROUTINES;

export const PLAN_ENTRIES = ROUTINES.flatMap((routine) => routine.exercises);
export const EXERCISES_BY_ID = Object.fromEntries(
  PLAN_ENTRIES.map((exercise) => [exercise.id, exercise]),
);

export function routineById(routineId) {
  return ROUTINES.find((routine) => routine.id === routineId) || null;
}

export function exerciseById(exerciseId, routineId) {
  const routine = routineId ? routineById(routineId) : null;
  if (routine) return routine.exercises.find((exercise) => exercise.id === exerciseId) || null;
  return EXERCISES_BY_ID[exerciseId] || null;
}
