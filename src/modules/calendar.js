import {
  visibleHabits, scheduled, habitProgress, MOODS, COLORS, addDays, today,
  dateObject, validDate, validTime,
} from '../core.js';
import { openMood, openHabitDetails } from './habits.js';
import { openPetActivity } from './pets.js';

export const CALENDAR_PALETTE = {
  habitos: { color: '#EC87C0', soft: '#F7DCEB', label: 'Hábitos', icon: 'leaf' },
  gym: { color: '#AC92EC', soft: '#EBE4FA', label: 'Gym', icon: 'dumbbell' },
  mascotas: { color: '#FFCE54', soft: '#FFF0BE', label: 'Mascotas', icon: 'paw-print' },
  citas: { color: '#48CFAD', soft: '#DEF4EE', label: 'Citas personales', icon: 'calendar-check' },
};
const typeLabels = { all: 'Todas', ...Object.fromEntries(Object.entries(CALENDAR_PALETTE).map(([key, value]) => [key, value.label])) };
const activityLabels = { vaccine: 'Vacuna', walk: 'Paseo', training: 'Práctica de truco', feeding: 'Alimentación', bath: 'Baño', medication: 'Medicamento', heat: 'Celo' };

export function eventColors(event) {
  const palette = CALENDAR_PALETTE[event.type] || CALENDAR_PALETTE.citas;
  const chosen = event.source === 'habit' && COLORS.includes(event.color) ? event.color : null;
  return { color: chosen || palette.color, soft: chosen || palette.soft };
}
function persist(ctx,rollback) {
  try {if(ctx.save()!==false)return true;} catch(error){ctx.toast(error.message||'No se pudo guardar.');}
  rollback();return false;
}
function colorStyle(event) {
  const { color, soft } = eventColors(event);
  return `--event-color:${color};--event-soft:${soft}`;
}

export function deriveEvents(state, start, end) {
  const events = [];
  const home = state.households.find(h => h.id === state.activeHousehold);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    for (const h of visibleHabits(state)) {
      if (!scheduled(h, date) && h.logs?.[date] === undefined) continue;
      const progress = habitProgress(h, date);
      events.push({
        id: `habit:${h.id}:${date}`, type: 'habitos', source: 'habit', sourceId: h.id,
        date, title: h.name, color: h.color, icon: h.icon || 'leaf', allDay: true,
        note: h.type === 'quantity' ? `${progress.value} / ${progress.target} ${h.unit}${h.goalPeriod === 'week' ? ' esta semana' : ''}` : progress.done ? 'Realizado' : 'Programado',
        done: progress.done,
      });
    }
  }
  for (const mood of state.personal.moods) {
    if (mood.date < start || mood.date > end) continue;
    events.push({ id: `mood:${mood.date}`, type: 'habitos', source: 'mood', sourceId: mood.id,
      date: mood.date, title: `Estado de ánimo: ${MOODS.find(x => x.id === mood.mood)?.name || mood.mood}`,
      note: mood.note || '', mood: mood.mood, allDay: true });
  }
  for (const session of state.personal.sessions) {
    if (session.date < start || session.date > end) continue;
    events.push({ id: `gym:${session.date}:${session.routineId}`, type: 'gym', source: 'gym', sourceId: session.id,
      date: session.date, title: `Gym · ${String(session.routineId).replace(/^d/, 'Día ')}`,
      routineId: session.routineId, allDay: true,
      note: session.status === 'finished' ? 'Entrenamiento guardado. Puede incluir ejercicios pendientes.' : 'Entrenamiento en curso' });
  }
  for (const pet of home?.pets || []) {
    for (const activity of pet.activities || []) {
      if (activity.type === 'heat') {
        if (!validDate(activity.date)) continue;
        if(!activity.endDate){
          if(activity.date>=start&&activity.date<=end)events.push({id:`pet:${pet.id}:${activity.id}`,type:'mascotas',source:'pet',sourceId:pet.id,activityId:activity.id,date:activity.date,allDay:true,title:`${pet.name} · Inicio de celo`,note:`Sin final registrado${activity.note?' · '+activity.note:''}`});
          continue;
        }
        const observedEnd = activity.endDate;
        const from = activity.date > start ? activity.date : start;
        const to = observedEnd < end ? observedEnd : end;
        for (let date = from; date <= to; date = addDays(date, 1)) {
          events.push({ id: date === activity.date ? `pet:${pet.id}:${activity.id}` : `pet:${pet.id}:${activity.id}:${date}`,
            rangeId: `heat:${pet.id}:${activity.id}`, type: 'mascotas', source: 'pet', sourceId: pet.id,
            activityId: activity.id, date, allDay: true, title: `${pet.name} · Celo`,
            note: `Inicio: ${activity.date}${activity.endDate ? ` · Final: ${activity.endDate}` : ' · Sin final registrado'}${activity.note ? ' · ' + activity.note : ''}` });
        }
        continue;
      }
      if (activity.date >= start && activity.date <= end) {
        events.push({ id: `pet:${pet.id}:${activity.id}`, type: 'mascotas', source: 'pet', sourceId: pet.id,
          activityId: activity.id, date: activity.date, time: activity.time || '', allDay: !activity.time,
          title: `${pet.name} · ${activity.title || activityLabels[activity.type] || 'Actividad'}`,
          note: activity.note || '', done: activity.done || activity.status === 'done' || activity.status === 'completed' });
      }
      if (activity.nextDate >= start && activity.nextDate <= end) {
        events.push({ id: `pet-next:${pet.id}:${activity.id}`, type: 'mascotas', source: 'pet', sourceId: pet.id,
          activityId: activity.id, date: activity.nextDate, allDay: true,
          title: `${pet.name} · Próxima ${activity.title || activityLabels[activity.type] || 'actividad'}`, note: activity.note || '' });
      }
    }
    if (pet.birthday) {
      const monthDay = pet.birthday.slice(5);
      for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
        let date = `${year}-${monthDay}`;
        if (monthDay === '02-29' && new Date(year, 1, 29).getMonth() !== 1) date = `${year}-02-28`;
        if (date >= start && date <= end) events.push({ id: `birthday:${pet.id}:${year}`, type: 'mascotas', source: 'pet', sourceId: pet.id,
          date, title: `Cumpleaños de ${pet.name}`, allDay: true, note: 'Un día para celebrar.' });
      }
    }
  }
  for (const appointment of state.personal.appointments) {
    if (appointment.date >= start && appointment.date <= end) events.push({ ...appointment, type: 'citas', source: 'appointment', sourceId: appointment.id });
  }
  return events.sort((a, b) => `${a.date}${a.time || '00:00'}`.localeCompare(`${b.date}${b.time || '00:00'}`) || a.id.localeCompare(b.id));
}
export function filterEvents(events, type = 'all') {
  return type === 'all' ? events : events.filter(event => event.type === type);
}
function icsEscape(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function fold(line) {
  const parts = []; let part = ''; let size = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (size + bytes > 73) { parts.push(part); part = ' ' + char; size = 1 + bytes; }
    else { part += char; size += bytes; }
  }
  parts.push(part);
  return parts.join('\r\n');
}
export function createICS(events, { filter = 'all', includeMoods = false, includeMoodNotes = false, timezone = 'America/Mexico_City', stamp = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wello//Bienestar//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', `TZID:${timezone}`, 'BEGIN:STANDARD', 'DTSTART:20230101T000000', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE'];
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const selected = filterEvents(events, filter).filter(event => validDate(event.date) && (!event.time || validTime(event.time)) && (event.source !== 'mood' || includeMoods));
  const ranges = new Map(); const exportEvents = [];
  for (const event of selected) {
    if (!event.rangeId) { exportEvents.push(event); continue; }
    const existing = ranges.get(event.rangeId);
    if (existing) { existing.date = event.date < existing.date ? event.date : existing.date; existing.endDate = event.date > existing.endDate ? event.date : existing.endDate; }
    else { const range = { ...event, id: event.rangeId, endDate: event.date }; ranges.set(event.rangeId, range); exportEvents.push(range); }
  }
  for (const event of exportEvents) {
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(event.id)}@wello.local`, `DTSTAMP:${dtstamp}`);
    if (event.allDay || !event.time) lines.push(`DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${addDays(event.endDate || event.date, 1).replaceAll('-', '')}`);
    else lines.push(`DTSTART;TZID=${timezone}:${event.date.replaceAll('-', '')}T${event.time.replace(':', '')}00`);
    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.type) lines.push(`CATEGORIES:${icsEscape(typeLabels[event.type] || event.type)}`);
    if (event.note && (event.source !== 'mood' || includeMoodNotes)) lines.push(`DESCRIPTION:${icsEscape(event.note)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function openAppointment(ctx, id, date = ctx.view.calendarDate || ctx.today()) {
  const appointment = ctx.state().personal.appointments.find(x => x.id === id) || { title: '', date, time: '', note: '', allDay: true };
  ctx.modal(id ? 'Editar cita' : 'Una cita para ti', `${ctx.field('Título', 'title', appointment.title, 'text', 'required maxlength="150"')}${ctx.field('Fecha', 'date', appointment.date, 'date', 'required')}<div class="form-grid">${ctx.select('Horario', 'allDay', [{ value: 'true', label: 'Todo el día' }, { value: 'false', label: 'A una hora' }], String(appointment.allDay))}${ctx.field('Hora local (Ciudad de México)', 'time', appointment.time, 'time')}</div><label class="field">Nota<textarea name="note" maxlength="2000" rows="3">${ctx.esc(appointment.note)}</textarea></label><p class="small muted">Es una cita personal. No cambia al elegir otro hogar.</p>${id ? ctx.btn('Eliminar cita', 'calendar-delete', `data-id="${id}"`, 'danger') : ''}`, data => {
    if (data.allDay === 'false' && !validTime(data.time)) { ctx.toast('Indica una hora válida.'); return false; }
    const record = { ...appointment, id: id || ctx.id(), title: data.title.trim(), date: data.date, time: data.allDay === 'true' ? '' : data.time, allDay: data.allDay === 'true', note: data.note };
    if (!record.title || !validDate(record.date)) return false;
    const list = ctx.state().personal.appointments;
    const before=structuredClone(list);
    const index = list.findIndex(x => x.id === record.id);
    if (index >= 0) list[index] = record; else list.push(record);
    if(!persist(ctx,()=>{list.splice(0,list.length,...before);} ))return false;
    ctx.view.calendarDate = record.date; ctx.view.calendarMonth = record.date.slice(0, 7); ctx.render();
  });
}
function eventRow(ctx, event) {
  const palette = CALENDAR_PALETTE[event.type] || CALENDAR_PALETTE.citas;
  return `<button class="list-row calendar-event type-${event.type}" style="${colorStyle(event)}" data-action="calendar-event" data-id="${ctx.esc(event.id)}"><span class="event-symbol">${event.mood ? ctx.img('mood-' + event.mood) : ctx.icon(event.icon || palette.icon, 22)}</span><span><strong>${ctx.esc(event.title)}</strong><span class="small muted">${ctx.esc(event.time || 'Todo el día')}${event.note ? ' · ' + ctx.esc(event.note) : ''}</span></span>${ctx.icon('chevron-right', 18)}</button>`;
}
export function renderCalendar(ctx) {
  const month = ctx.view.calendarMonth || ctx.today().slice(0, 7);
  const date = ctx.view.calendarDate || ctx.today();
  const mode = ctx.view.calendarMode || 'month'; const filter = ctx.view.calendarFilter || 'all';
  const first = month + '-01'; const monthDate = dateObject(first);
  const last = today(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
  const start = addDays(first, -((monthDate.getDay() + 6) % 7));
  const all = deriveEvents(ctx.state(), start, addDays(last, 7)); ctx.view.calendarEvents = all;
  const list = filterEvents(all, filter); const selected = list.filter(event => event.date === date);
  const legend = `<div class="calendar-legend" aria-label="Colores del calendario">${Object.entries(CALENDAR_PALETTE).map(([type, palette]) => `<span><i style="background:${palette.color}"></i>${palette.label}</span>`).join('')}<small>Los hábitos conservan el color que elegiste.</small></div>`;
  const monthGrid = `<div class="month-grid">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(label => `<div class="weekday-label">${label}</div>`).join('')}${Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index); const items = list.filter(event => event.date === day);
    const markers = [...new Map(items.map(event => [event.type+eventColors(event).color, event])).values()];
    return `<button class="month-day ${day.slice(0, 7) !== month ? 'outside' : ''} ${day === date ? 'selected' : ''} ${day === ctx.today() ? 'today' : ''}" data-action="calendar-day" data-date="${day}" aria-label="${ctx.prettyDate(day)}, ${items.length} actividades"><span>${Number(day.slice(-2))}</span><div class="event-dots">${markers.map(event => `<i class="dot type-${event.type}" style="background:${eventColors(event).color}" title="${ctx.esc(event.title)}"></i>`).join('')}</div></button>`;
  }).join('')}</div><div class="day-detail"><div class="section-head"><h3>${ctx.prettyDate(date)}</h3>${ctx.btn(ctx.icon('plus', 17), 'calendar-new', `data-date="${date}" aria-label="Crear cita este día"`, 'icon-button')}</div>${selected.length ? selected.map(event => eventRow(ctx, event)).join('') : '<p class="muted">Nada programado para este día con este filtro.</p>'}</div>`;
  const monthItems = list.filter(event => event.date >= first && event.date <= last);
  const agenda = `<div class="agenda-list">${monthItems.length ? [...new Set(monthItems.map(event => event.date))].map(day => `<section class="agenda-day"><h3>${ctx.prettyDate(day)}</h3>${monthItems.filter(event => event.date === day).map(event => eventRow(ctx, event)).join('')}</section>`).join('') : ctx.empty('Este mes está en calma.', 'Crea una cita o registra un hábito, estado de ánimo, entrenamiento o cuidado.')}</div>`;
  return `<div class="page-heading"><div><span class="eyebrow">UN POCO DE ORDEN, MÁS TRANQUILIDAD</span><h1>Mi calendario</h1><p>Tus cuidados y tus planes, en el mismo lugar.</p></div>${ctx.btn('Crear cita', 'calendar-new')}</div><div class="toolbar calendar-toolbar"><div class="tabs"><button class="tab ${mode === 'month' ? 'active' : ''}" data-action="calendar-mode" data-mode="month">Mes</button><button class="tab ${mode === 'agenda' ? 'active' : ''}" data-action="calendar-mode" data-mode="agenda">Agenda</button></div>${ctx.btn(ctx.icon('download', 17) + ' Exportar al iPhone', 'calendar-export', '', 'secondary')}</div><div class="filter-pills">${Object.entries(typeLabels).map(([value, label]) => `<button class="filter-pill ${filter === value ? 'active' : ''}" data-action="calendar-filter" data-filter="${value}" ${value !== 'all' ? `style="--filter-color:${CALENDAR_PALETTE[value].color};--filter-soft:${CALENDAR_PALETTE[value].soft}"` : ''}>${value !== 'all' ? `<i style="background:${CALENDAR_PALETTE[value].color}"></i>` : ''}${label}</button>`).join('')}</div>${legend}<section class="panel"><div class="section-head calendar-month-head"><div class="row">${ctx.btn(ctx.icon('chevron-left', 20), 'calendar-month', 'data-step="-1" aria-label="Mes anterior"', 'icon-button')}<h2>${monthDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</h2>${ctx.btn(ctx.icon('chevron-right', 20), 'calendar-month', 'data-step="1" aria-label="Mes siguiente"', 'icon-button')}</div>${ctx.btn('Hoy', 'calendar-today', '', 'secondary')}</div>${mode === 'month' ? monthGrid : agenda}</section>`;
}
function openExport(ctx) {
  const filter = ctx.view.calendarFilter || 'all';
  const options = Object.entries(typeLabels).map(([value, label]) => ({ value, label: value === 'all' ? 'Todas las actividades' : 'Sólo ' + label.toLocaleLowerCase('es-MX') }));
  const select = ctx.select('¿Qué quieres exportar?', 'exportFilter', options, filter).replace('<select ', '<select data-change="calendar-export-filter" ');
  const moodsAllowed = ['all', 'habitos'].includes(filter);
  ctx.modal('Llévalo a Calendario de iPhone', `<p>Elige lo que quieres llevar: puedes exportar sólo mascotas o sólo hábitos sin cambiar el filtro de tu pantalla.</p><div class="form-grid">${select}${ctx.field('Mes a exportar', 'exportMonth', ctx.view.calendarMonth || ctx.today().slice(0, 7), 'month', 'required')}</div><div data-export-moods ${moodsAllowed ? '' : 'hidden'}><label class="check-label"><input type="checkbox" name="moods" data-change="calendar-export-moods" ${moodsAllowed ? '' : 'disabled'}> Incluir mis estados de ánimo (personal)</label><label class="check-label"><input type="checkbox" name="notes" disabled> Incluir también el texto de mis notas de estado de ánimo</label></div><p class="small muted">Los estados de ánimo y sus notas sólo se incluyen si los eliges, dentro de Hábitos o Todas. El archivo no activa sincronización continua. Los eventos con hora usan America/Mexico_City. En iPhone, abre el .ics y elige el calendario de destino; su color depende de ese calendario en Apple.</p>`, data => {
    if (!validDate(data.exportMonth+'-01') || !Object.hasOwn(typeLabels, data.exportFilter)) { ctx.toast('Elige un mes y un filtro válidos.'); return false; }
    const start = data.exportMonth + '-01';
    const month = dateObject(start); const end = today(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const events = deriveEvents(ctx.state(), start, end);
    const allow = ['all', 'habitos'].includes(data.exportFilter);
    downloadFile(`Wello-${data.exportFilter}-${data.exportMonth}.ics`, createICS(events, { filter: data.exportFilter, includeMoods: allow && !!data.moods, includeMoodNotes: allow && !!data.moods && !!data.notes }), 'text/calendar;charset=utf-8');
    ctx.toast('Archivo creado: ' + typeLabels[data.exportFilter] + '.');
  }, 'Descargar .ics');
}
export function registerCalendar(ctx) {
  ctx.action('calendar-mode', data => { ctx.view.calendarMode = data.mode; ctx.render(); });
  ctx.action('calendar-filter', data => { ctx.view.calendarFilter = data.filter; ctx.render(); });
  ctx.action('calendar-day', data => { ctx.view.calendarDate = data.date; ctx.render(); });
  ctx.action('calendar-month', data => { const date = dateObject((ctx.view.calendarMonth || ctx.today().slice(0, 7)) + '-01'); date.setMonth(date.getMonth() + Number(data.step)); ctx.view.calendarMonth = today(date).slice(0, 7); ctx.render(); });
  ctx.action('calendar-today', () => { ctx.view.calendarMonth = ctx.today().slice(0, 7); ctx.view.calendarDate = ctx.today(); ctx.render(); });
  ctx.action('calendar-new', data => openAppointment(ctx, null, data.date));
  ctx.action('calendar-delete', data => ctx.confirm('¿Eliminar esta cita? No se eliminará ningún otro registro.', () => { const before=structuredClone(ctx.state().personal.appointments); ctx.state().personal.appointments = ctx.state().personal.appointments.filter(appointment => appointment.id !== data.id); if(!persist(ctx,()=>{ctx.state().personal.appointments=before;}))return false; ctx.closeModal(); ctx.render(); }));
  ctx.action('calendar-event', data => {
    const event = ctx.view.calendarEvents.find(x => x.id === data.id); if (!event) return;
    if (event.source === 'mood') { openMood(ctx, event.date); return; }
    if (event.source === 'appointment') { openAppointment(ctx, event.sourceId); return; }
    if (event.source === 'habit') { openHabitDetails(ctx, event.sourceId, event.date); return; }
    ctx.modal(event.title, `<div class="calendar-detail-accent" style="${colorStyle(event)}"><p>${ctx.prettyDate(event.date)}${event.time ? ' · ' + ctx.esc(event.time) : ''}</p><p>${ctx.esc(event.note)}</p></div>${ctx.btn('Abrir registro para editar', 'calendar-source', `data-id="${ctx.esc(event.id)}"`)}`);
  });
  ctx.action('calendar-source', data => {
    const event = ctx.view.calendarEvents.find(x => x.id === data.id); if (!event) return;
    ctx.closeModal();
    if (event.source === 'habit') { ctx.view.habitDate = event.date; ctx.navigate('habitos'); openHabitDetails(ctx, event.sourceId, event.date); }
    else if (event.source === 'gym') { ctx.view.gymDate = event.date; ctx.view.gymRoutine = event.routineId; ctx.navigate('gym'); }
    else if (event.source === 'pet') { ctx.view.petId = event.sourceId; ctx.navigate('mascotas'); openPetActivity(ctx, event.sourceId, event.activityId); }
  });
  ctx.action('calendar-export', () => openExport(ctx));
  ctx.change('calendar-export-filter', (_data, _event, element) => {
    const form = element.closest('form'); const allowed = ['all', 'habitos'].includes(element.value);
    form.querySelector('[data-export-moods]').hidden = !allowed;
    for (const input of form.querySelectorAll('[name="moods"],[name="notes"]')) { input.checked = false; input.disabled = !allowed || input.name === 'notes'; }
  });
  ctx.change('calendar-export-moods', (_data, _event, element) => {
    const notes = element.closest('form').querySelector('[name="notes"]'); notes.disabled = !element.checked; if (!element.checked) notes.checked = false;
  });
}
