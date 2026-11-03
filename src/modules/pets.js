/* Wello · Mascotas
 * El módulo sólo lee y escribe ctx.home().pets. Los datos personales nunca se tocan aquí.
 * Las fotos se transforman localmente en el navegador: nunca se suben ni se envían por red.
 */

const PET_ACTIVITY_TYPES = [
  ['vaccine', 'Vacuna'],
  ['walk', 'Paseo'],
  ['training', 'Entrenamiento'],
  ['feeding', 'Alimentación'],
  ['bath', 'Baño'],
];

const PET_SEX_VALUES = ['female', 'male', 'unknown'];
const PET_SEX_OPTIONS = [
  { value: 'female', label: 'Hembra' },
  { value: 'male', label: 'Macho' },
  { value: 'unknown', label: 'No especificado' },
];
const CARE_ACTIVITY_TYPES = new Set(['medication']);
const MAX_PHOTO_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_PHOTO_BYTES = 350000;
const PHOTO_MAX_SIDE = 640;

const ACTIVITY_META = {
  vaccine: { label: 'Vacuna', icon: 'syringe', description: 'Anota aplicación y próxima fecha, si la conoces.' },
  walk: { label: 'Paseo', icon: 'footprints', description: 'Registra una salida y su duración.' },
  training: { label: 'Entrenamiento', icon: 'sparkles', description: 'Guarda una sesión o practica un truco.' },
  feeding: { label: 'Alimentación', icon: 'utensils', description: 'Anota alimento, cantidad y unidad.' },
  bath: { label: 'Baño', icon: 'droplets', description: 'Marca un baño pendiente o realizado.' },
  medication: { label: 'Medicamento', icon: 'pill', description: 'Disponible cuando Cuidados está activo.' },
  heat: { label: 'Celo', icon: 'heart', description: 'Registra fechas observadas, sin pronósticos.' },
};

let activePhotoDraft = null;

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
  return `<button type="button" class="btn ${kind}" data-action="${esc(ctx, action)}" data-id="${esc(ctx, id)}" ${extra}>${label}</button>`;
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

function petIcon(ctx, name, size = 20) {
  if (typeof ctx?.icon === 'function') {
    try {
      const rendered = ctx.icon(name, size);
      if (rendered) return rendered;
    } catch {
      // La interfaz sigue siendo usable aunque un catálogo de iconos no tenga este nombre.
    }
  }
  const safeName = String(name || 'circle').replace(/[^a-z0-9-]/gi, '-');
  return `<span class="pet-icon-fallback pet-icon-${safeName}" aria-hidden="true"></span>`;
}

function saveAndRender(ctx, message, rollback) {
  let saved = true;
  try {
    if (typeof ctx?.save === 'function') saved = ctx.save();
  } catch {
    saved = false;
  }
  if (saved === false) {
    if (typeof rollback === 'function') rollback();
    return false;
  }
  if (message && typeof ctx?.toast === 'function') ctx.toast(message);
  if (typeof ctx?.render === 'function') ctx.render();
  return true;
}

function confirm(ctx, message, callback) {
  if (typeof ctx?.confirm === 'function') return ctx.confirm(message, callback);
  callback();
}

function findPet(home, id) {
  return petsOf(home).find((pet) => String(pet.id) === String(id));
}

function cloneValue(value) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    // Fall through to the JSON copy for the plain state objects used by Wello.
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return Array.isArray(value) ? value.slice() : { ...(value || {}) };
  }
}

function normalizeSex(value) {
  return PET_SEX_VALUES.includes(value) ? value : 'unknown';
}

export function normalizePet(ctx, input = {}) {
  const normalized = {
    ...input,
    id: input.id || makeId(ctx, 'pet'),
    name: String(input.name || '').trim(),
    type: String(input.type || '').trim(),
    birthday: input.birthday || '',
    sex: normalizeSex(input.sex),
    needsCare: Boolean(input.needsCare),
    activities: Array.isArray(input.activities) ? input.activities : [],
    tricks: Array.isArray(input.tricks) ? input.tricks : [],
  };
  if (input.photo === '') delete normalized.photo;
  return normalized;
}

function activityLabel(type) {
  return ACTIVITY_META[type]?.label || 'Actividad';
}

function isPhotoDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

function dataUrlBytes(value) {
  if (!isPhotoDataUrl(value)) return Infinity;
  const base64 = value.slice(value.indexOf(',') + 1);
  return Math.ceil((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

function validPhoto(value) {
  return isPhotoDataUrl(value) && value.length <= MAX_PHOTO_BYTES;
}

function heatDateDiff(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const from = Date.UTC(sy, sm - 1, sd);
  const to = Date.UTC(ey, em - 1, ed);
  const difference = Math.round((to - from) / 86400000);
  return Number.isFinite(difference) ? difference : null;
}

function heatRecords(pet) {
  return (Array.isArray(pet?.activities) ? pet.activities : [])
    .filter((activity) => activity?.type === 'heat' && activity.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function heatSummary(pet, activity) {
  const details = [];
  const duration = activity.endDate ? heatDateDiff(activity.date, activity.endDate) : null;
  if (duration != null && duration >= 0) details.push(`Duración observada: ${duration + 1} días`);
  const starts = heatRecords(pet);
  const index = starts.findIndex((item) => String(item.id) === String(activity.id));
  if (index > 0) {
    const interval = heatDateDiff(starts[index - 1].date, activity.date);
    if (interval != null && interval >= 0) details.push(`Intervalo observado: ${interval} días desde el inicio anterior`);
  }
  return details;
}

function activityDetails(ctx, pet, activity) {
  const details = [];
  if (activity.type === 'vaccine' && activity.nextDate) details.push(`Próxima: ${prettyDate(ctx, activity.nextDate)}`);
  if (activity.type === 'walk' && activity.duration != null && activity.duration !== '') details.push(`${activity.duration} min`);
  if (activity.type === 'training' && (activity.trickName || activity.trick)) details.push(activity.trickName || activity.trick);
  if (activity.type === 'training' && activity.duration != null && activity.duration !== '') details.push(`${activity.duration} min`);
  if (activity.type === 'feeding' && activity.food) details.push(`${activity.food}${activity.quantity != null && activity.quantity !== '' ? ` · ${activity.quantity}${activity.unit ? ` ${activity.unit}` : ''}` : ''}`);
  if (activity.type === 'bath' && activity.status) details.push(activity.status === 'done' || activity.status === 'completed' ? 'Realizado' : 'Pendiente');
  if (activity.type === 'medication' && activity.medication) details.push(activity.medication);
  if (activity.type === 'heat') {
    if (activity.endDate) details.push(`Hasta ${prettyDate(ctx, activity.endDate)}`);
    else details.push('Sin fecha final registrada');
    details.push(...heatSummary(pet, activity));
  }
  return details;
}

function renderActivity(ctx, pet, activity) {
  const details = activityDetails(ctx, pet, activity);
  const date = activity.date ? prettyDate(ctx, activity.date) : 'Sin fecha';
  const time = activity.time ? ` · ${esc(ctx, activity.time)}` : '';
  return `<article class="list-row pet-activity" data-pet-id="${esc(ctx, pet.id)}" data-activity-id="${esc(ctx, activity.id)}">
    <div class="pet-activity-main"><span class="chip">${esc(ctx, activityLabel(activity.type))}</span><strong>${esc(ctx, activity.title || activityLabel(activity.type))}</strong><span class="muted small">${esc(ctx, date)}${time}</span>${details.length ? `<span class="small">${esc(ctx, details.join(' · '))}</span>` : ''}${activity.note ? `<p class="muted small">${esc(ctx, activity.note)}</p>` : ''}</div>
    <div class="row pet-activity-actions">${button(ctx, 'Editar', 'pet-activity-edit', activity.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}${button(ctx, 'Eliminar', 'pet-activity-delete', activity.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}</div>
  </article>`;
}

function trainingPractices(pet, trick) {
  return (Array.isArray(pet?.activities) ? pet.activities : [])
    .filter((activity) => activity?.type === 'training' && (
      String(activity.trickId || '') === String(trick.id) ||
      (!activity.trickId && activity.trickName && String(activity.trickName) === String(trick.name))
    ))
    .sort((a, b) => `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`));
}

function renderTricks(ctx, pet) {
  const tricks = Array.isArray(pet.tricks) ? pet.tricks : [];
  const rows = tricks.map((trick) => {
    const practices = trainingPractices(pet, trick);
    const latest = practices[0];
    const stats = practices.length
      ? `<span class="pet-trick-stats">${practices.length} práctica${practices.length === 1 ? '' : 's'}${latest?.date ? ` · Última: ${esc(ctx, prettyDate(ctx, latest.date))}` : ''}</span>`
      : '<span class="pet-trick-stats">Sin prácticas registradas</span>';
    return `<div class="list-row pet-trick-row"><div><strong>${esc(ctx, trick.name)}</strong><p class="muted small">${esc(ctx, trick.description || 'Sin descripción')}</p>${stats}</div><div class="row">${button(ctx, 'Registrar práctica', 'pet-trick-practice', trick.id, 'secondary', `data-pet-id="${esc(ctx, pet.id)}"`)}${button(ctx, 'Editar', 'pet-trick-edit', trick.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}${button(ctx, 'Eliminar', 'pet-trick-delete', trick.id, 'ghost', `data-pet-id="${esc(ctx, pet.id)}"`)}</div></div>`;
  }).join('');
  return `<section class="soft pet-tricks"><div class="section-head"><div><p class="eyebrow">Catálogo</p><h3 class="section-title">Trucos</h3></div>${button(ctx, 'Nuevo truco', 'pet-trick-add', pet.id, 'secondary', `data-pet-id="${esc(ctx, pet.id)}"`)}</div>${tricks.length ? `<div class="stack">${rows}</div>` : '<p class="muted small">Agrega trucos para registrar prácticas desde cada fila.</p>'}</section>`;
}

function petAvatar(ctx, pet) {
  if (validPhoto(pet.photo)) return `<img class="pet-photo pet-art" src="${esc(ctx, pet.photo)}" alt="Foto de ${esc(ctx, pet.name || 'la mascota')}" loading="lazy">`;
  if (typeof ctx?.img === 'function') return ctx.img('dog', 'pet-art');
  return petIcon(ctx, 'paw-print', 34);
}

function sexLabel(sex) {
  return PET_SEX_OPTIONS.find((option) => option.value === sex)?.label || 'No especificado';
}

function renderPetCard(ctx, pet) {
  const activities = Array.isArray(pet.activities) ? pet.activities : [];
  const sorted = [...activities].sort((a, b) => `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`));
  return `<article class="card pet-card" data-pet-id="${esc(ctx, pet.id)}">
    <div class="section-head"><div class="row"><div class="pet-avatar">${petAvatar(ctx, pet)}</div><div><p class="eyebrow">Perfil</p><h2 class="section-title">${esc(ctx, pet.name || 'Sin nombre')}</h2><p class="muted">${esc(ctx, pet.type || 'Tipo sin registrar')} · ${esc(ctx, sexLabel(pet.sex))}${pet.birthday ? ` · Cumpleaños ${esc(ctx, prettyDate(ctx, pet.birthday))}` : ''}</p></div></div><div class="row">${pet.needsCare ? '<span class="pill">Necesita cuidados</span>' : ''}${button(ctx, 'Editar', 'pet-edit', pet.id, 'secondary')}${button(ctx, 'Eliminar', 'pet-delete', pet.id, 'ghost')}</div></div>
    <div class="toolbar"><span class="muted small">${activities.length} registro${activities.length === 1 ? '' : 's'}</span>${button(ctx, pet.needsCare ? 'Desactivar cuidados' : 'Necesita cuidados', 'pet-care-toggle', pet.id, pet.needsCare ? 'secondary' : 'primary')}${button(ctx, 'Agregar actividad', 'pet-activity-add', pet.id, 'primary')}</div>
    ${pet.needsCare ? `<section class="note"><strong>Cuidados activos</strong><span class="small">Registra medicamentos y conserva el historial aunque desactives este estado.</span>${button(ctx, 'Registrar medicamento', 'pet-medication-add', pet.id, 'secondary')}</section>` : ''}
    <section class="pet-history"><div class="section-head"><div><p class="eyebrow">Historial aislado</p><h3 class="section-title">Actividades de ${esc(ctx, pet.name || 'esta mascota')}</h3></div></div>${sorted.length ? `<div class="stack">${sorted.map((activity) => renderActivity(ctx, pet, activity)).join('')}</div>` : `<div class="empty"><strong>Aún no hay actividades</strong><p>Vacunas, paseos, entrenamientos, alimentación, baños y registros de celo aparecerán aquí.</p></div>`}</section>
    ${renderTricks(ctx, pet)}
  </article>`;
}

export function renderPets(ctx) {
  const home = getHome(ctx);
  const pets = petsOf(home);
  const image = typeof ctx?.img === 'function' ? ctx.img('dog', 'module-hero-art') : petIcon(ctx, 'paw-print', 80);
  return `<main class="module pets-module" data-page="mascotas" style="--accent:#FFCE54;--soft:#FFF4CC">
    <section class="panel module-hero"><div><p class="eyebrow">Mascotas</p><h1 class="section-title">Cuidados con cariño</h1><p class="muted">Perfiles, actividades y tratamientos de cada animal, separados por mascota y por hogar.</p><div class="row">${button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')}</div></div>${image}</section>
    ${pets.length ? `<section class="grid-two pets-grid">${pets.map((pet) => renderPetCard(ctx, normalizePet(ctx, pet))).join('')}</section>` : (typeof ctx?.empty === 'function' ? ctx.empty('Todavía no hay mascotas', 'Crea el primer perfil para comenzar a llevar su historial.', button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')) : `<section class="empty"><h2>Todavía no hay mascotas</h2><p>Crea el primer perfil para comenzar.</p>${button(ctx, 'Nueva mascota', 'pet-add', '', 'primary')}</section>`)}
  </main>`;
}

function photoPreview(ctx, photo) {
  return validPhoto(photo)
    ? `<img id="pet-photo-preview" class="pet-photo-preview" src="${esc(ctx, photo)}" alt="Vista previa de la mascota">`
    : `<span id="pet-photo-preview" class="pet-photo-placeholder">${petIcon(ctx, 'image', 25)}<span>Aún no hay foto</span></span>`;
}

function petPhotoEditor(ctx, photo) {
  return `<section class="pet-photo-editor"><div class="pet-photo-preview-wrap">${photoPreview(ctx, photo)}</div><div class="pet-photo-controls"><label class="btn secondary pet-photo-file-label">${petIcon(ctx, 'upload', 17)}<span>Cargar o cambiar foto</span><input id="pet-photo-file" type="file" accept="image/jpeg,image/png,image/webp" data-change="pet-photo-file" aria-label="Cargar foto de mascota"></label>${button(ctx, 'Quitar foto', 'pet-photo-remove', '', 'ghost', 'data-pet-photo-remove="true"')}<p class="muted small">JPG, PNG o WebP · máximo 12 MB de archivo. Se guarda una copia local optimizada.</p></div><input id="pet-photo-value" name="photo" type="hidden" value="${esc(ctx, validPhoto(photo) ? photo : '')}"></section>`;
}

function createPhotoDraft(ctx, pet) {
  const draft = {
    photo: validPhoto(pet?.photo) ? pet.photo : '',
    processing: null,
    busy: false,
    fileToken: 0,
    closed: false,
  };
  activePhotoDraft = draft;
  return draft;
}

function updatePhotoPreview(draft) {
  if (!photoDraftIsOpen(draft) || typeof document === 'undefined') return;
  const input = document.getElementById('pet-photo-value');
  if (input) input.value = draft.photo || '';
  const preview = document.getElementById('pet-photo-preview');
  if (!preview) return;
  if (validPhoto(draft.photo)) {
    if (preview.tagName === 'IMG') {
      preview.src = draft.photo;
    } else {
      preview.outerHTML = `<img id="pet-photo-preview" class="pet-photo-preview" src="${escapeHtml(draft.photo)}" alt="Vista previa de la mascota">`;
    }
  } else if (preview.tagName === 'IMG') {
    preview.outerHTML = `<span id="pet-photo-preview" class="pet-photo-placeholder"><span class="pet-icon-fallback pet-icon-image" aria-hidden="true"></span><span>Aún no hay foto</span></span>`;
  }
}

function photoDraftIsOpen(draft) {
  if (activePhotoDraft !== draft || draft.closed) return false;
  if (typeof document === 'undefined') return true;
  const dialog = document.getElementById('dialog');
  return (!dialog || dialog.open !== false) && (!draft.form || document.getElementById('modal-form') === draft.form);
}

function photoFileError(ctx, error) {
  if (typeof ctx?.toast === 'function') ctx.toast(error?.message || 'No se pudo procesar la foto.');
}

function startPhotoProcessing(ctx, file, draft) {
  const token = ++draft.fileToken;
  draft.busy = true;
  const pending = processPetPhoto(file)
    .then((photo) => {
      if (photoDraftIsOpen(draft) && token === draft.fileToken) {
        draft.photo = photo;
        draft.busy = false;
        updatePhotoPreview(draft);
      }
      return photo;
    })
    .catch((error) => {
      if (photoDraftIsOpen(draft) && token === draft.fileToken) draft.busy = false;
      photoFileError(ctx, error);
      return null;
    });
  draft.processing = pending;
  return pending;
}

function handlePetSubmit(ctx, pet, editing, draft, fields) {
  const name = formValue(fields, 'name').trim();
  const type = formValue(fields, 'type').trim();
  const sex = normalizeSex(formValue(fields, 'sex', pet?.sex || 'unknown'));
  if (!name || !type) {
    if (typeof ctx?.toast === 'function') ctx.toast('Escribe el nombre y el tipo de mascota.');
    return false;
  }
  const formPhoto = formValue(fields, 'photo', draft.photo);
  if (formPhoto === '' || validPhoto(formPhoto)) draft.photo = formPhoto;
  else if (formPhoto) {
    if (typeof ctx?.toast === 'function') ctx.toast('La foto no tiene un formato local válido.');
    return false;
  }
  const home = getHome(ctx);
  const pets = petsOf(home);
  const beforePets = cloneValue(pets);
  if (editing) {
    const target = findPet(home, pet.id);
    if (!target) return false;
    const before = cloneValue(target);
    target.name = name;
    target.type = type;
    target.birthday = formValue(fields, 'birthday');
    target.sex = sex;
    target.activities = Array.isArray(target.activities) ? target.activities : [];
    target.tricks = Array.isArray(target.tricks) ? target.tricks : [];
    if (draft.photo) target.photo = draft.photo; else delete target.photo;
    const saved = saveAndRender(ctx, 'Perfil actualizado.', () => {
      Object.keys(target).forEach((key) => delete target[key]);
      Object.assign(target, before);
    });
    if (saved) draft.closed = true;
    return saved;
  }
  const newPet = normalizePet(ctx, { name, type, birthday: formValue(fields, 'birthday'), sex });
  if (draft.photo) newPet.photo = draft.photo;
  pets.push(newPet);
  home.pets = pets;
  const saved = saveAndRender(ctx, 'Mascota agregada.', () => { home.pets = beforePets; });
  if (saved) draft.closed = true;
  return saved;
}

function openPetModal(ctx, pet = null) {
  const editing = Boolean(pet);
  const draft = createPhotoDraft(ctx, pet || {});
  const sex = normalizeSex(pet?.sex);
  const html = `<div class="form-grid">${field(ctx, 'Nombre', 'name', pet?.name || '', 'text', 'required maxlength="80"')}${field(ctx, 'Tipo de mascota', 'type', pet?.type || '', 'text', 'required maxlength="50"')}${select(ctx, 'Sexo', 'sex', PET_SEX_OPTIONS, sex)}${field(ctx, 'Cumpleaños', 'birthday', pet?.birthday || '', 'date')}</div>${petPhotoEditor(ctx, draft.photo)}<p class="muted small">Puedes agregar el historial después. Los registros se quedan dentro de este perfil.</p>`;
  if (typeof ctx?.modal !== 'function') return;
  ctx.modal(editing ? 'Editar mascota' : 'Nueva mascota', html, (fields) => {
    const run = () => photoDraftIsOpen(draft) ? handlePetSubmit(ctx, pet, editing, draft, fields) : false;
    if (draft.busy && draft.processing) {
      return draft.processing.then(() => {
        if (!photoDraftIsOpen(draft)) {
          draft.closed = true;
          return false;
        }
        if (draft.busy) {
          if (typeof ctx?.toast === 'function') ctx.toast('Espera a que termine de procesarse la foto.');
          return false;
        }
        return handlePetSubmit(ctx, pet, editing, draft, { ...fields, photo: draft.photo });
      });
    }
    return run();
  });
  if(typeof document !== 'undefined') draft.form=document.getElementById('modal-form');
}

function commonActivityFields(ctx, activity, includeEndDate = false) {
  return `${field(ctx, 'Fecha', 'date', activity?.date || today(ctx), 'date', 'required')}${includeEndDate ? field(ctx, 'Fecha final observada', 'endDate', activity?.endDate || '', 'date') : ''}${field(ctx, 'Hora', 'time', activity?.time || '', 'time')}${field(ctx, 'Nota', 'note', activity?.note || '', 'text', 'maxlength="1000"')}`;
}

function activityForm(ctx, pet, activity = null, fixedType = '', practiceTrick = null) {
  const currentType = fixedType || activity?.type || 'walk';
  const selectedTrickId = activity?.trickId || practiceTrick?.id || '';
  const trickOptions = [...(practiceTrick ? [] : [{ value: '', label: 'Sin truco vinculado' }]), ...(Array.isArray(pet.tricks) ? pet.tricks.map((trick) => ({ value: trick.id, label: trick.name })) : [])];
  let specific = '';
  if (currentType === 'vaccine') specific = `${field(ctx, 'Nombre de vacuna', 'vaccineName', activity?.vaccineName || activity?.title || '', 'text', 'required maxlength="100"')}${field(ctx, 'Próxima fecha anotada', 'nextDate', activity?.nextDate || '', 'date')}`;
  if (currentType === 'walk') specific = field(ctx, 'Duración del paseo (min)', 'duration', activity?.duration ?? '', 'number', 'min="0" step="1"');
  if (currentType === 'training') specific = `${select(ctx, 'Truco practicado', 'trickId', trickOptions, selectedTrickId)}${field(ctx, 'Duración (min, opcional)', 'duration', activity?.duration ?? '', 'number', 'min="0" step="1"')}`;
  if (currentType === 'feeding') specific = `${field(ctx, 'Alimento', 'food', activity?.food || '', 'text', 'required maxlength="100"')}${field(ctx, 'Cantidad', 'quantity', activity?.quantity ?? '', 'number', 'min="0" step="any"')}${field(ctx, 'Unidad', 'unit', activity?.unit || '', 'text', 'maxlength="30"')}`;
  if (currentType === 'bath') specific = select(ctx, 'Estado del baño', 'status', [{ value: 'pending', label: 'Pendiente' }, { value: 'done', label: 'Realizado' }], activity?.status || 'pending');
  if (currentType === 'heat') specific = commonActivityFields(ctx, activity, true);
  const common = currentType === 'heat' ? '' : commonActivityFields(ctx, activity);
  const heatHint = currentType === 'heat' ? '<p class="muted small">Sólo guarda fechas observadas. No calcula pronósticos ni indicaciones clínicas.</p>' : '';
  return `<div class="form-grid pet-fixed-activity-form">${specific}${common}</div>${heatHint}`;
}

function activityTitle(type, fields, selectedTrick, previous = null) {
  if (type === 'vaccine') return formValue(fields, 'vaccineName').trim();
  if (type === 'training') return selectedTrick?.name || previous?.trickName || 'Entrenamiento';
  if (type === 'feeding') return formValue(fields, 'food').trim();
  if (type === 'heat') return 'Celo';
  return previous?.title || activityLabel(type);
}

function openActivityModal(ctx, pet, activity = null, fixedType = '', practiceTrick = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(activity);
  const type = fixedType || activity?.type || 'walk';
  if (type === 'medication') return openMedicationModal(ctx, pet, activity);
  if (!ACTIVITY_META[type]) return;
  ctx.modal(editing ? `Editar ${activityLabel(type).toLowerCase()}` : `Registrar ${activityLabel(type).toLowerCase()}`, activityForm(ctx, pet, activity, type, practiceTrick), (fields) => {
    const date = formValue(fields, 'date');
    if (!date) {
      if (typeof ctx?.toast === 'function') ctx.toast('Completa la fecha.');
      return false;
    }
    if (!editing && type === 'heat' && normalizeSex(pet.sex) !== 'female') {
      if (typeof ctx?.toast === 'function') ctx.toast('El registro de celo nuevo sólo está disponible para hembras.');
      return false;
    }
    const endDate = formValue(fields, 'endDate');
    if (type === 'heat' && endDate) {
      const difference = heatDateDiff(date, endDate);
      if (difference == null || difference < 0) {
        if (typeof ctx?.toast === 'function') ctx.toast('La fecha final debe ser igual o posterior al inicio.');
        return false;
      }
    }
    if (type === 'vaccine' && !formValue(fields, 'vaccineName').trim()) {
      if (typeof ctx?.toast === 'function') ctx.toast('Escribe el nombre de la vacuna.');
      return false;
    }
    if (type === 'feeding' && !formValue(fields, 'food').trim()) {
      if (typeof ctx?.toast === 'function') ctx.toast('Escribe el alimento.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.activities = Array.isArray(targetPet.activities) ? targetPet.activities : [];
    const selectedTrickId = formValue(fields, 'trickId');
    const selectedTrick = (targetPet.tricks || []).find((trick) => String(trick.id) === String(selectedTrickId)) || practiceTrick;
    const next = {
      ...(activity || {}),
      id: activity?.id || makeId(ctx, 'pet-activity'),
      type,
      title: activityTitle(type, fields, selectedTrick, activity),
      date,
      time: formValue(fields, 'time'),
      note: formValue(fields, 'note').slice(0, 1000),
    };
    if (type === 'vaccine') {
      next.vaccineName = formValue(fields, 'vaccineName').trim();
      next.nextDate = formValue(fields, 'nextDate') || '';
    }
    if (type === 'walk' || type === 'training') next.duration = numberOrNull(formValue(fields, 'duration'));
    if (type === 'training') {
      next.trickId = selectedTrickId || practiceTrick?.id || '';
      next.trickName = selectedTrick?.name || activity?.trickName || '';
      next.trickDescription = selectedTrick?.description || activity?.trickDescription || '';
    }
    if (type === 'feeding') {
      next.food = formValue(fields, 'food').trim();
      next.quantity = numberOrNull(formValue(fields, 'quantity'));
      next.unit = formValue(fields, 'unit').trim();
    }
    if (type === 'bath') next.status = formValue(fields, 'status', 'pending');
    if (type === 'heat') {
      next.endDate = endDate || '';
      next.title = 'Celo';
    }
    const before = cloneValue(targetPet.activities);
    const index = targetPet.activities.findIndex((item) => String(item.id) === String(next.id));
    if (index === -1) targetPet.activities.push(next); else targetPet.activities[index] = next;
    return saveAndRender(ctx, editing ? 'Registro actualizado.' : 'Registro guardado.', () => { targetPet.activities = before; });
  });
}

function activityChooser(ctx, pet) {
  const categories = PET_ACTIVITY_TYPES.map(([type]) => type);
  if (pet.needsCare) categories.push('medication');
  if (normalizeSex(pet.sex) === 'female') categories.push('heat');
  const cards = categories.map((type) => {
    const meta = ACTIVITY_META[type];
    return `<button type="button" class="pet-category-card" data-action="pet-activity-type-select" data-pet-id="${esc(ctx, pet.id)}" data-type="${esc(ctx, type)}"><span class="pet-category-icon">${petIcon(ctx, meta.icon, 23)}</span><strong>${esc(ctx, meta.label)}</strong><span class="muted small">${esc(ctx, meta.description)}</span></button>`;
  }).join('');
  return `<div class="pet-category-grid" aria-label="Categorías de actividad">${cards}</div><p class="muted small">Elige una categoría para abrir sólo los campos que corresponden a ese registro.</p>`;
}

function openActivityChooser(ctx, pet) {
  if (typeof ctx?.modal !== 'function') return;
  ctx.modal('Agregar actividad', activityChooser(ctx, pet));
}

function openMedicationModal(ctx, pet, activity = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(activity);
  ctx.modal(editing ? 'Editar medicamento' : 'Registrar medicamento', `<div class="form-grid">${field(ctx, 'Medicamento indicado', 'medication', activity?.medication || activity?.title || '', 'text', 'required maxlength="120"')}${field(ctx, 'Fecha', 'date', activity?.date || today(ctx), 'date', 'required')}${field(ctx, 'Hora', 'time', activity?.time || '', 'time')}${field(ctx, 'Anotaciones', 'note', activity?.note || '', 'text', 'maxlength="1000"')}</div><p class="muted small">Este registro sólo conserva lo que captures; no sustituye indicaciones veterinarias.</p>`, (fields) => {
    const medication = formValue(fields, 'medication').trim();
    const date = formValue(fields, 'date');
    if (!medication || !date) {
      if (typeof ctx?.toast === 'function') ctx.toast('Escribe el medicamento y la fecha.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.activities = Array.isArray(targetPet.activities) ? targetPet.activities : [];
    if (!editing && !targetPet.needsCare) {
      if (typeof ctx?.toast === 'function') ctx.toast('Activa los cuidados para registrar un medicamento nuevo.');
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
    const before = cloneValue(targetPet.activities);
    const index = targetPet.activities.findIndex((item) => String(item.id) === String(next.id));
    if (editing && index === -1) return false;
    if (index === -1) targetPet.activities.push(next); else targetPet.activities[index] = next;
    return saveAndRender(ctx, editing ? 'Medicamento actualizado.' : 'Medicamento registrado.', () => { targetPet.activities = before; });
  });
}

export function openTrainingForm(ctx, pet, trick = null, activity = null) {
  openActivityModal(ctx, pet, activity, 'training', trick);
}

function openTrickModal(ctx, pet, trick = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(trick);
  ctx.modal(editing ? 'Editar truco' : 'Nuevo truco', `${field(ctx, 'Nombre del truco', 'name', trick?.name || '', 'text', 'required maxlength="80"')}${field(ctx, 'Descripción', 'description', trick?.description || '', 'text', 'maxlength="500"')}`, (fields) => {
    const name = formValue(fields, 'name').trim();
    if (!name) {
      if (typeof ctx?.toast === 'function') ctx.toast('Escribe el nombre del truco.');
      return false;
    }
    const home = getHome(ctx);
    const targetPet = findPet(home, pet.id);
    if (!targetPet) return false;
    targetPet.tricks = Array.isArray(targetPet.tricks) ? targetPet.tricks : [];
    const before = cloneValue(targetPet.tricks);
    const next = { id: trick?.id || makeId(ctx, 'pet-trick'), name, description: formValue(fields, 'description').slice(0, 500) };
    const index = targetPet.tricks.findIndex((item) => String(item.id) === String(next.id));
    if (index === -1) targetPet.tricks.push(next); else targetPet.tricks[index] = next;
    return saveAndRender(ctx, editing ? 'Truco actualizado.' : 'Truco agregado.', () => { targetPet.tricks = before; });
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
  else openActivityModal(ctx, pet, activity, activity.type);
}

export function registerPets(ctx) {
  registerAction(ctx, 'pet-add', () => openPetModal(ctx));
  registerAction(ctx, 'pet-edit', (data) => openPetModal(ctx, findPet(getHome(ctx), data?.id || data?.petId)));
  registerAction(ctx, 'pet-delete', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.id || data?.petId);
    if (!pet) return;
    confirm(ctx, `¿Eliminar a ${pet.name || 'esta mascota'} y su historial?`, () => {
      const before = cloneValue(petsOf(home));
      home.pets = petsOf(home).filter((item) => String(item.id) !== String(pet.id));
      saveAndRender(ctx, 'Mascota eliminada.', () => { home.pets = before; });
    });
  });
  registerAction(ctx, 'pet-care-toggle', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (!pet) return;
    const before = Boolean(pet.needsCare);
    pet.needsCare = !before;
    saveAndRender(ctx, pet.needsCare ? 'Cuidados activados.' : 'Cuidados desactivados; el historial se conserva.', () => { pet.needsCare = before; });
  });
  registerAction(ctx, 'pet-activity-add', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (pet) openActivityChooser(ctx, pet);
  });
  registerAction(ctx, 'pet-activity-type-select', (data) => {
    const pet = findPet(getHome(ctx), data?.petId || data?.id);
    const type = data?.type;
    if (!pet || !ACTIVITY_META[type]) return;
    if (typeof ctx?.closeModal === 'function') ctx.closeModal();
    if (type === 'medication') {
      if (pet.needsCare) openMedicationModal(ctx, pet);
      return;
    }
    if (type === 'heat' && normalizeSex(pet.sex) !== 'female') return;
    openActivityModal(ctx, pet, null, type);
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
      else openActivityModal(ctx, pet, activity, activity.type);
    }
  });
  registerAction(ctx, 'pet-activity-delete', (data) => {
    const home = getHome(ctx);
    const pet = findPet(home, data?.petId);
    if (!pet) return;
    const activity = pet.activities?.find((item) => String(item.id) === String(data?.id));
    if (!activity) return;
    confirm(ctx, '¿Eliminar este registro del historial?', () => {
      const before = cloneValue(pet.activities || []);
      pet.activities = (pet.activities || []).filter((item) => String(item.id) !== String(activity.id));
      saveAndRender(ctx, 'Registro eliminado.', () => { pet.activities = before; });
    });
  });
  registerAction(ctx, 'pet-trick-add', (data) => {
    const pet = findPet(getHome(ctx), data?.id || data?.petId);
    if (pet) openTrickModal(ctx, pet);
  });
  registerAction(ctx, 'pet-trick-practice', (data) => {
    const pet = findPet(getHome(ctx), data?.petId || data?.id);
    const trick = pet?.tricks?.find((item) => String(item.id) === String(data?.id));
    if (pet && trick) openTrainingForm(ctx, pet, trick);
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
      const before = cloneValue(pet.tricks || []);
      pet.tricks = (pet.tricks || []).filter((item) => String(item.id) !== String(trick.id));
      saveAndRender(ctx, 'Truco eliminado.', () => { pet.tricks = before; });
    });
  });
  registerAction(ctx, 'pet-photo-remove', () => {
    if (!activePhotoDraft) return;
    activePhotoDraft.fileToken += 1;
    activePhotoDraft.processing = null;
    activePhotoDraft.busy = false;
    activePhotoDraft.photo = '';
    updatePhotoPreview(activePhotoDraft);
  });
  if (typeof ctx?.change === 'function') {
    ctx.change('pet-photo-file', (_data, _event, element) => {
      const draft = activePhotoDraft;
      const file = element?.files?.[0] || _event?.target?.files?.[0];
      if (!draft || !file) return;
      return startPhotoProcessing(ctx, file, draft);
    });
  }
}

function imageRuntime(runtime = {}) {
  return {
    createImageBitmap: runtime.createImageBitmap || globalThis.createImageBitmap?.bind(globalThis),
    document: runtime.document || globalThis.document,
    Image: runtime.Image || globalThis.Image,
    URL: runtime.URL || globalThis.URL,
    OffscreenCanvas: runtime.OffscreenCanvas || globalThis.OffscreenCanvas,
  };
}

function imageType(file) {
  const type = String(file?.type || '').toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? type : '';
}

function loadImageElement(file, runtime) {
  if (!runtime.Image || !runtime.URL?.createObjectURL) return Promise.reject(new Error('Este navegador no puede decodificar la imagen.'));
  return new Promise((resolve, reject) => {
    const image = new runtime.Image();
    const url = runtime.URL.createObjectURL(file);
    image.onload = () => { runtime.URL.revokeObjectURL?.(url); resolve(image); };
    image.onerror = () => { runtime.URL.revokeObjectURL?.(url); reject(new Error('La foto no es una imagen raster válida.')); };
    image.src = url;
  });
}

function makeCanvas(width, height, runtime) {
  if (runtime.document?.createElement) {
    const canvas = runtime.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (runtime.OffscreenCanvas) return new runtime.OffscreenCanvas(width, height);
  throw new Error('Este navegador no puede preparar la foto.');
}

function imageDataUrlBytes(dataUrl) {
  return String(dataUrl || '').length;
}

export async function processPetPhoto(file, runtime = {}) {
  if (!file || Number(file.size) > MAX_PHOTO_INPUT_BYTES) throw new Error('La foto original debe pesar 12 MB o menos.');
  if (!imageType(file)) throw new Error('Elige una imagen JPG, PNG o WebP.');
  const env = imageRuntime(runtime);
  let source;
  if (env.createImageBitmap) {
    try {
      source = await env.createImageBitmap(file);
    } catch {
      throw new Error('La foto no es una imagen raster válida.');
    }
  } else {
    source = await loadImageElement(file, env);
  }
  const sourceWidth = Number(source.width || source.naturalWidth);
  const sourceHeight = Number(source.height || source.naturalHeight);
  if (!sourceWidth || !sourceHeight) {
    source.close?.();
    throw new Error('No se pudo leer el tamaño de la foto.');
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / sourceWidth, PHOTO_MAX_SIDE / sourceHeight);
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));
  let result = null;
  try {
    for (let pass = 0; pass < 8 && !result; pass += 1) {
      const canvas = makeCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), env);
      const context = canvas.getContext?.('2d');
      if (!context) throw new Error('No se pudo preparar la foto.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (let quality = 0.92; quality >= 0.32; quality -= 0.06) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (imageDataUrlBytes(dataUrl) <= MAX_PHOTO_BYTES) {
          result = dataUrl;
          break;
        }
      }
      if (!result) {
        width = Math.max(1, Math.floor(width * 0.84));
        height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
      }
    }
  } finally {
    source.close?.();
  }
  if (!result || !validPhoto(result)) throw new Error('No se pudo reducir la foto a 350 KB.');
  return result;
}

export { PET_ACTIVITY_TYPES, PET_SEX_VALUES, MAX_PHOTO_INPUT_BYTES, MAX_PHOTO_BYTES };
