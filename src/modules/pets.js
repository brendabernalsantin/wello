/* Wello · Mascotas
 * El módulo sólo lee y escribe ctx.home().pets. Los datos personales nunca se tocan aquí.
 */

const PET_ACTIVITY_TYPES = [
  ['vaccine', 'Vacuna'],
  ['walk', 'Paseo'],
  ['training', 'Entrenamiento'],
  ['feeding', 'Alimentación'],
  ['bath', 'Baño'],
];

const CARE_ACTIVITY_TYPES = new Set(['medication']);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function esc(ctx, value) {
  return typeof ctx?.esc === 'function' ? ctx.esc(value ?? '') : escapeHtml(value);
}

function getHome(ctx) {
  const home = typeof ctx?.home === 'function' ? ctx.home() : ctx?.home;
  return home && typeof home === 'object' ? home : {};
}

function petsOf(home) {
  return Array.isArray(home.pets) ? home.pets : [];
}

function idFor(ctx, prefix = 'pet') {
  if (typeof ctx?.id === 'function') return ctx.id();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function today(ctx) {
  if (typeof ctx?.today === 'function') return ctx.today();
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(ctx, value) {
  if (!value) return 'Sin fecha';
  return typeof ctx?.prettyDate === 'function' ? ctx.prettyDate(value) : value;
}

function formValue(fields, name, fallback = '') {
  if (fields && typeof fields.get === 'function') {
    const value = fields.get(name);
    return value == null ? fallback : String(value);
  }
  if (fields && fields.formData && typeof fields.formData.get === 'function') {
    const value = fields.formData.get(name);
    return value == null ? fallback : String(value);
  }
  return fields && fields[name] != null ? String(fields[name]) : fallback;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function makeId(ctx, prefix) {
  return idFor(ctx, prefix);
}

function button(ctx, label, action, id, kind = 'secondary', extra = '') {
  if (typeof ctx?.btn === 'function') {
    return ctx.btn(label, action, `data-id="${esc(ctx, id)}" ${extra}`, kind);
  }
  return `<button type="button" class="btn ${kind}" data-action="${esc(ctx, action)}" data-id="${esc(ctx, id)}" ${extra}>${esc(ctx, label)}</button>`;
}

function field(ctx, label, name, value = '', type = 'text', extra = '') {
  if (typeof ctx?.field === 'function') return ctx.field(label, name, value ?? '', type, extra);
  return `<label class="field"><span>${esc(ctx, label)}</span><input name="${esc(ctx, name)}" type="${esc(ctx, type)}" value="${esc(ctx, value ?? '')}" ${extra}></label>`;
}

function select(ctx, label, name, options, value = '') {
  if (typeof ctx?.select === 'function') return ctx.select(label, name, options, value);
  const list = options.map((option) => {
    const item = typeof option === 'string' ? { value: option, label: option } : option;
    return `<option value="${esc(ctx, item.value)}" ${String(item.value) === String(value) ? 'selected' : ''}>${esc(ctx, item.label)}</option>`;
  }).join('');
  return `<label class="field"><span>${esc(ctx, label)}</span><select name="${esc(ctx, name)}">${list}</select></label>`;
}

function changeableSelect(ctx, label, name, options, value, changeName) {
  const html = select(ctx, label, name, options, value);
  return html.includes('<select ')
    ? html.replace('<select ', `<select data-change="${esc(ctx, changeName)}" `)
    : html;
}

function saveAndRender(ctx, message) {
  if (typeof ctx?.save === 'function') ctx.save();
  if (message && typeof ctx?.toast === 'function') ctx.toast(message);
  if (typeof ctx?.render === 'function') ctx.render();
}

function confirm(ctx, message, callback) {
  if (typeof ctx?.confirm === 'function') return ctx.confirm(message, callback);
  callback();
}

function findPet(home, id) {
  return petsOf(home).find((pet) => String(pet.id) === String(id));
}

function normalizePet(ctx, input = {}) {
  return {
    id: input.id || makeId(ctx, 'pet'),
    name: String(input.name || '').trim(),
    type: String(input.type || '').trim(),
    birthday: input.birthday || '',
    needsCare: Boolean(input.needsCare),
    activities: Array.isArray(input.activities) ? input.activities : [],
    tricks: Array.isArray(input.tricks) ? input.tricks : [],
  };
}

function activityLabel(type) {
  return PET_ACTIVITY_TYPES.find(([key]) => key === type)?.[1] || 'Actividad';
}

function activityDetails(ctx, activity) {
  const details = [];
  if (activity.type === 'vaccine' && activity.nextDate) details.push(`Próxima: ${prettyDate(ctx, activity.nextDate)}`);
  if (activity.type === 'walk' && activity.duration != null && activity.duration !== '') details.push(`${activity.duration} min`);
  if (activity.type === 'training' && (activity.trickName || activity.trick)) details.push(activity.trickName || activity.trick);
  if (activity.type === 'feeding' && activity.food) details.push(`${activity.food}${activity.quantity ? ` · ${activity.quantity}${activity.unit ? ` ${activity.unit}` : ''}` : ''}`);
  if (activity.type === 'bath' && activity.status) details.push(activity.status === 'done' || activity.status === 'completed' ? 'Realizado' : 'Pendiente');
  if (activity.type === 'medication' && activity.medication) details.push(activity.medication);
  return details;
}

function renderActivity(ctx, pet, activity) {
  const details = activityDetails(ctx, activity);
  const date = activity.date ? prettyDate(ctx, activity.date) : 'Sin fecha';
  const time = activity.time ? ` · ${esc(ctx, activity.time)}` : '';
  return `<article class="list-row pet-activity" data-pet-id="${esc(ctx, pet.id)}" data-activity-id="${esc(ctx, activity.id)}">
    <div class="pet-activity-main"><span class="chip">${esc(ctx, activityLabel(activity.type))}</span><strong>${esc(ctx, activity.title || activityLabel(activity.type))}</strong><span class="muted small">${esc(ctx, date)}${time}</span>${details.length ? `<span class="small">${esc(ctx, details.join(' · '))}</span>` : ''}${activity.note ? `<p class="muted small">${esc(ctx, activity.note)}</p>` : ''}</div>
    <div class="row pet-activity-actions">${button(ctx, 'Editar', 'pet-activity-edit', activity.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}${button(ctx, 'Eliminar', 'pet-activity-delete', activity.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}</div>
  </article>`;
}

function renderTricks(ctx, pet) {
  const tricks = Array.isArray(pet.tricks) ? pet.tricks : [];
  return `<section class="soft pet-tricks"><div class="section-head"><div><p class="eyebrow">Catálogo</p><h3 class="section-title">Trucos</h3></div>${button(ctx, 'Nuevo truco', 'pet-trick-add', pet.id, 'secondary', 'data-pet-id="' + esc(ctx, pet.id) + '"')}</div>${tricks.length ? `<div class="stack">${tricks.map((trick) => `<div class="list-row"><div><strong>${esc(ctx, trick.name)}</strong><p class="muted small">${esc(ctx, trick.description || 'Sin descripción')}</p></div><div class="row">${button(ctx, 'Editar', 'pet-trick-edit', trick.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}${button(ctx, 'Eliminar', 'pet-trick-delete', trick.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}</div></div>`).join('')}</div>` : `<p class="muted small">Agrega trucos para vincularlos a sesiones de entrenamiento.</p>`}</section>`;
}

function renderPetCard(ctx, pet) {
  const activities = Array.isArray(pet.activities) ? pet.activities : [];
  const sorted = [...activities].sort((a, b) => `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`));
  return `<article class="card pet-card" data-pet-id="${esc(ctx, pet.id)}">
    <div class="section-head"><div class="row"><div class="pet-avatar">${typeof ctx?.img === 'function' ? ctx.img('dog', 'pet-art') : ''}</div><div><p class="eyebrow">Perfil</p><h2 class="section-title">${esc(ctx, pet.name || 'Sin nombre')}</h2><p class="muted">${esc(ctx, pet.type || 'Tipo sin registrar')}${pet.birthday ? ` · Cumpleaños ${esc(ctx, prettyDate(ctx, pet.birthday))}` : ''}</p></div></div><div class="row">${pet.needsCare ? '<span class="pill">Necesita cuidados</span>' : ''}${button(ctx, 'Editar', 'pet-edit', pet.id, 'secondary')}${button(ctx, 'Eliminar', 'pet-delete', pet.id, 'ghost')}</div></div>
    <div class="toolbar"><span class="muted small">${activities.length} registro${activities.length === 1 ? '' : 's'}</span>${button(ctx, pet.needsCare ? 'Desactivar cuidados' : 'Necesita cuidados', 'pet-care-toggle', pet.id, pet.needsCare ? 'secondary' : 'primary')}${button(ctx, 'Agregar actividad', 'pet-activity-add', pet.id, 'primary')}</div>
    ${pet.needsCare ? `<section class="note"><strong>Cuidados activos</strong><span class="small">Registra medicamentos y conserva el historial aunque desactives este estado.</span>${button(ctx, 'Registrar medicamento', 'pet-medication-add', pet.id, 'secondary')}</section>` : ''}
    <section class="pet-history"><div class="section-head"><div><p class="eyebrow">Historial aislado</p><h3 class="section-title">Actividades de ${esc(ctx, pet.name || 'esta mascota')}</h3></div></div>${sorted.length ? `<div class="stack">${sorted.map((activity) => renderActivity(ctx, pet, activity)).join('')}</div>` : `<div class="empty"><strong>Aún no hay actividades</strong><p>Vacunas, paseos, entrenamientos, alimentación, baños y medicamentos aparecerán aquí.</p></div>`}</section>
    ${renderTricks(ctx, pet)}
  </article>`;
}

export function renderPets(ctx) {
  const home = getHome(ctx);
  const pets = petsOf(home);
  const image = typeof ctx?.img === 'function' ? ctx.img('dog', 'module-hero-art') : '';
  return `<main class="module pets-module" data-page="mascotas" style="--accent:#FFCE54;--soft:#FFF4CC">
    <section class="panel module-hero"><div><p class="eyebrow">Mascotas</p><h1 class="section-title">Cuidados con cariño</h1><p class="muted">Perfiles, actividades y tratamientos de cada animal, separados por mascota y por hogar.</p><div class="row">${button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')}</div></div>${image}</section>
    ${pets.length ? `<section class="grid-two pets-grid">${pets.map((pet) => renderPetCard(ctx, normalizePet(ctx, pet))).join('')}</section>` : (typeof ctx?.empty === 'function' ? ctx.empty('Todavía no hay mascotas', 'Crea el primer perfil para comenzar a llevar su historial.', button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')) : `<section class="empty"><h2>Todavía no hay mascotas</h2><p>Crea el primer perfil para comenzar.</p>${button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')}</section>`)}
  </main>`;
}

function openPetModal(ctx, pet = null) {
  const editing = Boolean(pet);
  const html = `<div class="form-grid">${field(ctx, 'Nombre', 'name', pet?.name || '', 'text', 'required maxlength="80"')}${field(ctx, 'Tipo de mascota', 'type', pet?.type || '', 'text', 'required maxlength="50"')}${field(ctx, 'Cumpleaños', 'birthday', pet?.birthday || '', 'date')}</div><p class="muted small">Puedes agregar el historial después. Los registros se quedan dentro de este perfil.</p>`;
  if (typeof ctx?.modal !== 'function') return;
  ctx.modal(editing ? 'Editar mascota' : 'Nueva mascota', html, (fields) => {
    const name = formValue(fields, 'name').trim();
    const type = formValue(fields, 'type').trim();
    if (!name || !type) {
      if (typeof ctx.toast === 'function') ctx.toast('Escribe el nombre y el tipo de mascota.');
      return false;
    }
    const home = getHome(ctx);
    const pets = petsOf(home);
    if (editing) {
      const target = findPet(home, pet.id);
      if (!target) return false;
      target.name = name;
      target.type = type;
      target.birthday = formValue(fields, 'birthday');
      target.activities = Array.isArray(target.activities) ? target.activities : [];
      target.tricks = Array.isArray(target.tricks) ? target.tricks : [];
    } else {
      pets.push(normalizePet(ctx, { name, type, birthday: formValue(fields, 'birthday') }));
      home.pets = pets;
    }
    saveAndRender(ctx, editing ? 'Perfil actualizado.' : 'Mascota agregada.');
  });
}

function activityFields(ctx, type, html, currentType) {
  const hidden = type === currentType ? '' : ' hidden';
  return `<div class="form-grid pet-activity-fields" data-activity-type="${esc(ctx, type)}"${hidden}>${html}</div>`;
}

function activityForm(ctx, pet, activity = null, fixedType = '') {
  const currentType = fixedType || activity?.type || 'walk';
  const trickOptions = [{ value: '', label: 'Sin truco vinculado' }, ...(Array.isArray(pet.tricks) ? pet.tricks.map((trick) => ({ value: trick.id, label: trick.name })) : [])];
  const typeOptions = PET_ACTIVITY_TYPES.map(([value, label]) => ({ value, label }));
  const vaccineFields = `${field(ctx, 'Nombre de vacuna', 'vaccineName', activity?.vaccineName || (currentType === 'vaccine' ? activity?.title || '' : ''), 'text', 'maxlength="100"')}${field(ctx, 'Próxima fecha de vacuna', 'nextDate', activity?.nextDate || '', 'date')}`;
  const walkFields = field(ctx, 'Duración del paseo (min)', 'duration', activity?.duration ?? '', 'number', 'min="0" step="1"');
  const trainingFields = select(ctx, 'Truco practicado', 'trickId', trickOptions, activity?.trickId || '');
  const feedingFields = `${field(ctx, 'Alimento', 'food', activity?.food || '', 'text', 'maxlength="100"')}${field(ctx, 'Cantidad', 'quantity', activity?.quantity ?? '', 'number', 'min="0" step="any"')}${field(ctx, 'Unidad', 'unit', activity?.unit || '', 'text', 'maxlength="30"')}`;
  const bathFields = select(ctx, 'Estado del baño', 'status', [{ value: 'pending', label: 'Pendiente' }, { value: 'done', label: 'Realizado' }], activity?.status || 'pending');
  return `<div class="form-grid">${changeableSelect(ctx, 'Tipo de actividad', 'type', typeOptions, currentType, 'pet-activity-type')}${field(ctx, 'Título', 'title', activity?.title || '', 'text', 'maxlength="100" required')}${field(ctx, 'Fecha', 'date', activity?.date || today(ctx), 'date', 'required')}${field(ctx, 'Hora', 'time', activity?.time || '', 'time')}${field(ctx, 'Nota', 'note', activity?.note || '', 'text', 'maxlength="1000"')}</div>${activityFields(ctx, 'vaccine', vaccineFields, currentType)}${activityFields(ctx, 'walk', walkFields, currentType)}${activityFields(ctx, 'training', trainingFields, currentType)}${activityFields(ctx, 'feeding', feedingFields, currentType)}${activityFields(ctx, 'bath', bathFields, currentType)}`;
}

function updateActivityFields(target, type = target?.value) {
  const form = typeof target?.closest === 'function' ? target.closest('form') : null;
  if (!form || typeof form.querySelectorAll !== 'function') return;
  form.querySelectorAll('[data-activity-type]').forEach((group) => {
    const visible = group.dataset.activityType === type;
    group.hidden = !visible;
    group.setAttribute('aria-hidden', String(!visible));
  });
}

function openActivityModal(ctx, pet, activity = null, fixedType = '') {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(activity);
  ctx.modal(editing ? 'Editar actividad' : 'Nueva actividad', activityForm(ctx, pet, activity, fixedType), (fields) => {
    const type = fixedType || formValue(fields, 'type', activity?.type || 'walk');
    if (!PET_ACTIVITY_TYPES.some(([value]) => value === type)) {
      if (typeof ctx.toast === 'function') ctx.toast('Los medicamentos se registran desde Cuidados activos.');
      return false;
    }
    const title = formValue(fields, 'title').trim() || (type === 'vaccine' ? formValue(fields, 'vaccineName').trim() : '');
    const date = formValue(fields, 'date');
    if (!date || !title) {
      if (typeof ctx.toast === 'function') ctx.toast('Completa el título y la fecha.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.activities = Array.isArray(targetPet.activities) ? targetPet.activities : [];
    const selectedTrickId = formValue(fields, 'trickId');
    const selectedTrick = (targetPet.tricks || []).find((trick) => String(trick.id) === String(selectedTrickId));
    const next = {
      ...(activity || {}),
      id: activity?.id || makeId(ctx, 'pet-activity'),
      type,
      title,
      date,
      time: formValue(fields, 'time'),
      note: formValue(fields, 'note').slice(0, 1000),
    };
    if (type === 'vaccine') {
      next.vaccineName = formValue(fields, 'vaccineName').trim() || title;
      next.nextDate = formValue(fields, 'nextDate') || '';
    }
    if (type === 'walk') next.duration = numberOrNull(formValue(fields, 'duration'));
    if (type === 'training') {
      next.trickId = selectedTrickId || '';
      next.trickName = selectedTrick?.name || '';
      next.trickDescription = selectedTrick?.description || '';
    }
    if (type === 'feeding') {
      next.food = formValue(fields, 'food').trim();
      next.quantity = numberOrNull(formValue(fields, 'quantity'));
      next.unit = formValue(fields, 'unit').trim();
    }
    if (type === 'bath') next.status = formValue(fields, 'status', 'pending');
    const index = targetPet.activities.findIndex((item) => String(item.id) === String(next.id));
    if (index === -1) targetPet.activities.push(next); else targetPet.activities[index] = next;
    saveAndRender(ctx, editing ? 'Actividad actualizada.' : 'Actividad registrada.');
  });
}

function openMedicationModal(ctx, pet, activity = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(activity);
  ctx.modal(editing ? 'Editar medicamento' : 'Registrar medicamento', `<div class="form-grid">${field(ctx, 'Medicamento indicado', 'medication', activity?.medication || activity?.title || '', 'text', 'required maxlength="120"')}${field(ctx, 'Fecha', 'date', activity?.date || today(ctx), 'date', 'required')}${field(ctx, 'Hora', 'time', activity?.time || '', 'time')}${field(ctx, 'Anotaciones', 'note', activity?.note || '', 'text', 'maxlength="1000"')}</div><p class="muted small">Este registro sólo conserva lo que captures; no sustituye indicaciones veterinarias.</p>`, (fields) => {
    const medication = formValue(fields, 'medication').trim();
    const date = formValue(fields, 'date');
    if (!medication || !date) {
      if (typeof ctx.toast === 'function') ctx.toast('Escribe el medicamento y la fecha.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.activities = Array.isArray(targetPet.activities) ? targetPet.activities : [];
    if (!editing && !targetPet.needsCare) {
      if (typeof ctx.toast === 'function') ctx.toast('Activa los cuidados para registrar un medicamento nuevo.');
      return false;
    }
    const next = {
      ...(activity || {}),
      id: activity?.id || makeId(ctx, 'pet-medication'),
      type: 'medication',
      title: medication,
      medication,
      date,
      time: formValue(fields, 'time'),
      note: formValue(fields, 'note').slice(0, 1000),
    };
    const index = targetPet.activities.findIndex((item) => String(item.id) === String(next.id));
    if (editing && index === -1) return false;
    if (index === -1) targetPet.activities.push(next); else targetPet.activities[index] = next;
    saveAndRender(ctx, editing ? 'Medicamento actualizado.' : 'Medicamento registrado.');
  });
}

function openTrickModal(ctx, pet, trick = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(trick);
  ctx.modal(editing ? 'Editar truco' : 'Nuevo truco', `${field(ctx, 'Nombre del truco', 'name', trick?.name || '', 'text', 'required maxlength="80"')}${field(ctx, 'Descripción', 'description', trick?.description || '', 'text', 'maxlength="500"')}`, (fields) => {
    const name = formValue(fields, 'name').trim();
    if (!name) {
      if (typeof ctx.toast === 'function') ctx.toast('Escribe el nombre del truco.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.tricks = Array.isArray(targetPet.tricks) ? targetPet.tricks : [];
    const next = { id: trick?.id || makeId(ctx, 'pet-trick'), name, description: formValue(fields, 'description').slice(0, 500) };
    const index = targetPet.tricks.findIndex((item) => String(item.id) === String(next.id));
    if (index === -1) targetPet.tricks.push(next); else targetPet.tricks[index] = next;
    saveAndRender(ctx, editing ? 'Truco actualizado.' : 'Truco agregado.');
  });
}

function registerAction(ctx, name, callback) {
  if (typeof ctx?.action === 'function') ctx.action(name, callback);
}

export function openPetActivity(ctx, petId, activityId) {
  const pet = findPet(getHome(ctx), petId);
  if (!pet) return;
  if (activityId == null || activityId === '') {
    openPetModal(ctx, pet);
    return;
  }
  const activity = (Array.isArray(pet.activities) ? pet.activities : []).find((item) => String(item.id) === String(activityId));
  if (!activity) return;
  if (CARE_ACTIVITY_TYPES.has(activity.type)) openMedicationModal(ctx, pet, activity);
  else openActivityModal(ctx, pet, activity);
}

export function registerPets(ctx) {
  if (typeof ctx?.change === 'function') {
    ctx.change('pet-activity-type', (_data, _event, element) => updateActivityFields(element));
  }
  registerAction(ctx, 'pet-add', () => openPetModal(ctx));
  registerAction(ctx, 'pet-edit', (data) => openPetModal(ctx, findPet(getHome(ctx), data?.id || data?.petId)));
  registerAction(ctx, 'pet-delete', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.id || data?.petId);
    if (!pet) return;
    confirm(ctx, `¿Eliminar a ${pet.name || 'esta mascota'} y su historial?`, () => {
      home.pets = petsOf(home).filter((item) => String(item.id) !== String(pet.id));
      saveAndRender(ctx, 'Mascota eliminada.');
    });
  });
  registerAction(ctx, 'pet-care-toggle', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (!pet) return;
    pet.needsCare = !Boolean(pet.needsCare);
    saveAndRender(ctx, pet.needsCare ? 'Cuidados activados.' : 'Cuidados desactivados; el historial se conserva.');
  });
  registerAction(ctx, 'pet-activity-add', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (pet) openActivityModal(ctx, pet);
  });
  registerAction(ctx, 'pet-medication-add', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (pet && pet.needsCare) openMedicationModal(ctx, pet);
  });
  registerAction(ctx, 'pet-activity-edit', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.petId || data?.id);
    const activityId = data?.activityId || data?.id;
    const activity = pet?.activities?.find((item) => String(item.id) === String(activityId));
    if (pet && activity) {
      if (CARE_ACTIVITY_TYPES.has(activity.type)) openMedicationModal(ctx, pet, activity);
      else openActivityModal(ctx, pet, activity);
    }
  });
  registerAction(ctx, 'pet-activity-delete', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.petId);
    if (!pet) return;
    const activity = pet.activities?.find((item) => String(item.id) === String(data?.id));
    if (!activity) return;
    confirm(ctx, '¿Eliminar este registro del historial?', () => {
      pet.activities = (pet.activities || []).filter((item) => String(item.id) !== String(activity.id));
      saveAndRender(ctx, 'Registro eliminado.');
    });
  });
  registerAction(ctx, 'pet-trick-add', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (pet) openTrickModal(ctx, pet);
  });
  registerAction(ctx, 'pet-trick-edit', (data) => {
    const pet = findPet(getHome(ctx), data?.petId);
    const trick = pet?.tricks?.find((item) => String(item.id) === String(data?.id));
    if (pet && trick) openTrickModal(ctx, pet, trick);
  });
  registerAction(ctx, 'pet-trick-delete', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.petId);
    const trick = pet?.tricks?.find((item) => String(item.id) === String(data?.id));
    if (!pet || !trick) return;
    confirm(ctx, `¿Eliminar el truco ${trick.name}?`, () => {
      pet.tricks = (pet.tricks || []).filter((item) => String(item.id) !== String(trick.id));
      saveAndRender(ctx, 'Truco eliminado.');
    });
  });
}

export { PET_ACTIVITY_TYPES };
