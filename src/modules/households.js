const INVITE_HASH_RE = /^#?invitacion\?token=([0-9a-f]{64})$/i;

function cloud() {
  return globalThis.window?.WelloCloud || globalThis.WelloCloud || null;
}

function viewFor(ctx) {
  if (!ctx.view || typeof ctx.view !== 'object') ctx.view = {};
  return ctx.view;
}

function isPromise(value) {
  return Boolean(value && typeof value.then === 'function');
}

function cloudAuthenticated(api) {
  if (!api) return false;
  try {
    if (typeof api.isAuthenticated === 'function') {
      const result = api.isAuthenticated();
      return !isPromise(result) && Boolean(result);
    }
    if (typeof api.auth === 'function') {
      const result = api.auth();
      return !isPromise(result) && Boolean(result);
    }
    if (typeof api.auth === 'boolean') return api.auth;
    if (api.auth && typeof api.auth === 'object') return api.auth.status === 'signed_in' || api.auth.authenticated === true;
    const state = typeof api.getState === 'function' ? api.getState() : api.state;
    return Boolean(state?.authenticated || state?.status === 'signed_in' || state?.status === 'authenticated');
  } catch {
    return false;
  }
}

function cloudEmail(api) {
  try {
    const state = typeof api?.getState === 'function' ? api.getState() : api?.state;
    return String(state?.email || state?.user?.email || api?.email || '').trim();
  } catch {
    return '';
  }
}

function cleanError(error) {
  const message = String(error?.message || error || 'No se pudo completar la acción.');
  return message.replace(/[0-9a-f]{64}/gi, 'el token de invitación');
}

function showError(ctx, error) {
  ctx.toast?.(cleanError(error));
}

function normaliseList(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function inviteTokenFromHash(hash = globalThis.location?.hash || '') {
  const match = INVITE_HASH_RE.exec(String(hash));
  return match ? match[1].toLowerCase() : '';
}

function tokenFromDestination(value) {
  if (typeof value === 'string') return inviteTokenFromHash(value) || (/^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : '');
  return inviteTokenFromHash(value?.hash || '') || tokenFromDestination(value?.token || '');
}

function pendingInviteToken(ctx) {
  const view = viewFor(ctx);
  const current = inviteTokenFromHash(globalThis.location?.hash || '');
  if (current) {
    view.pendingInviteToken = current;
    try { globalThis.sessionStorage?.setItem('wello:invite-pending', current); } catch { /* almacenamiento opcional */ }
  }
  if (!view.pendingInviteToken) {
    try { view.pendingInviteToken = tokenFromDestination(globalThis.sessionStorage?.getItem('wello:invite-pending') || ''); } catch { /* almacenamiento opcional */ }
  }
  if (!view.pendingInviteToken) {
    try { view.pendingInviteToken = tokenFromDestination(cloud()?.inviteDestinationFromHash?.()); } catch { /* el destino es opcional */ }
  }
  return view.pendingInviteToken || '';
}

function roleName(role) {
  return String(role || '').toLowerCase() === 'owner' ? 'owner' : String(role || '').toLowerCase() === 'member' ? 'member' : '';
}

function homeFromResult(result) {
  const home = result?.household || result?.home || result?.shared || result;
  if (!home || typeof home !== 'object') return null;
  const id = String(home.id || home.household_id || home.homeUuid || home.uuid || '').trim();
  if (!id) return null;
  return { id, name: String(home.name || 'Hogar compartido'), role: roleName(home.role) || 'owner', localId: home.localId || home.local_id || '' };
}

function inviteExpiry(value, ctx) {
  if (!value) return 'Válido durante 7 días';
  const date = String(value).slice(0, 10);
  return date ? `Válido durante 7 días (hasta ${ctx.prettyDate?.(date) || date})` : 'Válido durante 7 días';
}

function setBusy(form, busy) {
  const button = form?.querySelector?.('button[type="submit"]');
  if (!button) return { button: null, alreadyBusy: false };
  const alreadyBusy = button.dataset.householdBusy === 'true';
  if (busy) {
    if (!alreadyBusy) {
      button.dataset.householdBusy = 'true';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
  } else {
    button.dataset.householdBusy = '';
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
  return { button, alreadyBusy };
}

async function runForm(form, operation) {
  const state = setBusy(form, true);
  if (state.alreadyBusy) return false;
  try {
    return await operation();
  } finally {
    setBusy(form, false);
  }
}

function actionButton(ctx, label, action, extra = '', kind = 'secondary') {
  return ctx.btn ? ctx.btn(label, action, extra, kind) : `<button type="button" class="btn ${kind}" data-action="${ctx.esc(action)}" ${extra}>${label}</button>`;
}

function localCard(ctx, home, view, authenticated) {
  const mapped = view.cloudHomes?.find(item => item.localId && item.localId === home.id);
  const shared = mapped || ((view.publishedLocalIds || []).includes(home.id) ? { id: home.id } : null);
  const publish = authenticated && !shared
    ? actionButton(ctx, 'Compartir este hogar', 'household-publish', `data-local-id="${ctx.esc(home.id)}"`, 'primary')
    : shared
      ? '<span class="pill household-shared-label">Compartido en la nube</span>'
      : '';
  return `<article class="panel household-card household-local-card"><div class="household-card-head"><span class="household-mark">${ctx.icon?.('house', 30) || ''}</span><span class="pill household-local-label">Solo en este dispositivo</span></div><h2>${ctx.esc(home.name)}</h2><p class="muted">Mascotas, alimentos y hábitos de este hogar. Tus Gym, mood, citas y hábitos personales siguen fuera de este espacio.</p><div class="row wrap household-actions">${actionButton(ctx, home.id === ctx.state().activeHousehold ? 'Hogar activo' : 'Cambiar a este hogar', 'home-switch', `data-id="${ctx.esc(home.id)}"`, 'secondary')}${actionButton(ctx, ctx.icon?.('pencil', 17) || 'Renombrar', 'home-rename', `data-id="${ctx.esc(home.id)}" aria-label="Cambiar nombre"`, 'icon-button')}${publish}</div></article>`;
}

function sharedCard(ctx, item) {
  const role = roleName(item.role);
  const owner = role === 'owner';
  const member = role === 'member';
  const controls = owner
    ? `${actionButton(ctx, 'Miembros e invitaciones', 'household-members', `data-household-id="${ctx.esc(item.id)}"`, 'secondary')}${actionButton(ctx, ctx.icon?.('pencil', 17) || 'Renombrar', 'household-shared-rename', `data-household-id="${ctx.esc(item.id)}" aria-label="Renombrar hogar compartido"`, 'icon-button')}`
    : member
      ? actionButton(ctx, 'Salir del hogar', 'household-leave', `data-household-id="${ctx.esc(item.id)}"`, 'danger')
      : '';
  return `<article class="panel household-card household-shared-card"><div class="household-card-head"><span class="household-mark household-shared-mark">${ctx.icon?.('users', 30) || ''}</span><span class="pill household-role household-role-${ctx.esc(role || 'unknown')}">${role === 'owner' ? 'Propietaria' : role === 'member' ? 'Miembro' : 'Membresía en revisión'}</span></div><h2>${ctx.esc(item.name || 'Hogar compartido')}</h2><p class="muted">Hogar compartido por membresía. Solo sus registros familiares se sincronizan en este espacio.</p><div class="row wrap household-actions">${actionButton(ctx, (item.localId || item.id) === ctx.state().activeHousehold ? 'Hogar activo' : 'Elegir este hogar', 'home-switch', `data-id="${ctx.esc(item.localId || item.id)}"`, 'primary')}${controls}</div></article>`;
}

function inviteBanner(ctx, authenticated) {
  const token = pendingInviteToken(ctx);
  if (!token) return '';
  const api = cloud();
  if (!authenticated) {
    return `<section class="household-invite-banner household-invite-pending"><span class="household-invite-icon">${ctx.icon?.('mail-plus', 24) || ''}</span><div><h2>Tienes una invitación pendiente</h2><p>Continúa con Google en Cuenta en línea. Antes de aceptar verás el correo de la cuenta que quedará ligado al hogar.</p></div>${actionButton(ctx, 'Abrir Cuenta en línea', 'household-invite-auth', '', 'primary')}</section>`;
  }
  const email = cloudEmail(api);
  return `<section class="household-invite-banner household-invite-pending"><span class="household-invite-icon">${ctx.icon?.('mail-plus', 24) || ''}</span><div><h2>Revisa tu invitación</h2><p>Se aceptará con la cuenta <strong>${ctx.esc(email || 'autenticada en Google')}</strong>. No se acepta automáticamente.</p></div>${actionButton(ctx, 'Revisar y aceptar', 'household-accept-invite', '', 'primary')}</section>`;
}

export function renderHouseholds(ctx) {
  const state = ctx.state();
  const view = viewFor(ctx);
  const api = cloud();
  const authenticated = cloudAuthenticated(api);
  const shared = authenticated && Array.isArray(view.cloudHomes) ? view.cloudHomes : [];
  const status = authenticated
    ? (view.cloudLoading ? '<span class="small muted">Actualizando membresías…</span>' : '<span class="small muted">La cuenta en línea está separada de tus hogares locales.</span>')
    : '<span class="small muted">Modo local: nada se publica sin una acción explícita.</span>';
  const sharedSection = authenticated
    ? `<section class="households-cloud-section"><div class="section-head"><div><span class="eyebrow">CUENTA EN LÍNEA</span><h2>Hogares compartidos</h2></div><div class="row wrap">${status}${actionButton(ctx, ctx.icon?.('refresh-cw', 16) || 'Actualizar', 'household-cloud-refresh', 'aria-label="Actualizar hogares compartidos"', 'ghost')}</div></div>${view.cloudLoading ? '<div class="soft household-loading">Revisando tus membresías…</div>' : shared.length ? `<div class="grid-two households-grid">${shared.map(item => sharedCard(ctx, item)).join('')}</div>` : '<div class="empty household-empty"><span class="empty-icon">'+(ctx.icon?.('users', 30) || '')+'</span><h3>Aún no tienes hogares compartidos</h3><p>Publica un hogar local de forma explícita o acepta una invitación. Tus datos personales nunca forman parte de la publicación.</p></div>'}</section>`
    : `<section class="households-cloud-section household-offline-card"><div class="section-head"><div><span class="eyebrow">CUENTA EN LÍNEA</span><h2>Comparte cuando tú decidas</h2></div></div><p class="muted">Puedes seguir en modo local. Iniciar sesión no publica mascotas, alimentos ni hábitos automáticamente; el hogar que elijas se revisa antes de compartirlo.</p></section>`;
  const sharedLocalIds = new Set(shared.flatMap(item => [item.id,item.localId].filter(Boolean)));
  const localHomes = (Array.isArray(state.households) ? state.households : []).filter(home => !sharedLocalIds.has(home.id));
  return `<div class="page-heading households-heading"><div><span class="eyebrow">LO QUE COMPARTIMOS</span><h1>Mis hogares</h1><p>Un lugar para cuidar lo cotidiano, en tu dispositivo o con personas invitadas.</p></div>${actionButton(ctx, 'Crear hogar', 'home-new', '', 'primary')}</div>${inviteBanner(ctx, authenticated)}<div class="note households-local-note">${ctx.icon?.('monitor', 22) || ''}<span>Los hogares locales se guardan en este dispositivo. Gym, mood, citas y hábitos «Para mí» son personales y no se publican al compartir un hogar.</span></div><section class="households-local-section"><div class="section-head"><div><span class="eyebrow">ESPACIOS LOCALES</span><h2>Tus hogares en este dispositivo</h2></div><span class="small muted">${localHomes.length} ${localHomes.length === 1 ? 'hogar' : 'hogares'}</span></div><div class="grid-two households-grid">${localHomes.map(home => localCard(ctx, home, view, authenticated)).join('')}</div></section>${sharedSection}<section class="panel household-privacy-card"><h2>Lo tuyo sigue contigo</h2><p class="muted">Gym, tu mood, tus citas personales y los hábitos «Para mí» no cambian al elegir otro hogar. Cada hogar conserva sus propias mascotas, alimentos, súper, compras y hábitos familiares.</p></section></div>`;
}

async function accountAction(api, operation) {
  const tag = accountTag(api);
  const result = await operation();
  if (cloud() !== api || !cloudAuthenticated(api) || accountTag(api) !== tag || result?.status === 'stale') {
    throw new Error('Cambió la sesión. Revisa la cuenta antes de reintentar.');
  }
  return result;
}

function accountTag(api) {
  const state = api?.getState?.() || {};
  return String(state.user?.id || state.email || state.user?.email || '') + ':' + String(globalThis.window?.WelloApp?.getNamespace?.() || '');
}

async function refreshHouseholds(ctx, { silent = false, useCloudRefresh = true } = {}) {
  const api = cloud();
  const view = viewFor(ctx);
  const accountAtStart = accountTag(api);
  const stillCurrent = () => api === cloud() && cloudAuthenticated(api) && accountTag(api) === accountAtStart;
  if (!api || !cloudAuthenticated(api) || typeof api.listHouseholds !== 'function') {
    view.cloudHomes = [];
    view.cloudLoading = false;
    return [];
  }
  if (view.cloudRequest) return view.cloudRequest;
  view.cloudLoading = true;
  if (!silent) ctx.render?.();
  view.cloudRequest = (async () => {
    try {
      if (useCloudRefresh && typeof api.refresh === 'function') await api.refresh();
      const result = await api.listHouseholds();
      const list = (await Promise.all(normaliseList(result, 'households').map(async item => {
        const id = String(item.id || item.household_id || item.uuid || '').trim();
        if (!id) return null;
        let role = roleName(item.role);
        if (!role && typeof api.getRole === 'function') {
          try { role = roleName(await api.getRole(id)); } catch { role = ''; }
        }
        return { id, name: String(item.name || 'Hogar compartido'), role, localId: String(item.localId || item.local_id || '').trim() };
      }))).filter(Boolean);
      if (!stillCurrent()) return [];
      view.cloudHomes = list;
      view.cloudLoadedAt = Date.now();
      return list;
    } catch (error) {
      if (!silent && stillCurrent()) showError(ctx, error);
      return null;
    } finally {
      if (stillCurrent()) {
        view.cloudLoading = false;
        view.cloudRequest = null;
        if (!silent) ctx.render?.();
      }
    }
  })();
  return view.cloudRequest;
}

async function getRole(api, id, fallback = '') {
  if (fallback) return roleName(fallback);
  if (typeof api?.getRole !== 'function') return '';
  return roleName(await api.getRole(id));
}

async function publishLocal(ctx, localId) {
  const api = cloud();
  if (!api || !cloudAuthenticated(api) || typeof api.createShared !== 'function') {
    ctx.toast?.('Inicia sesión para compartir un hogar.');
    return;
  }
  const home = ctx.state().households?.find(item => item.id === localId);
  if (!home) return;
  ctx.modal('Compartir este hogar', `<div class="household-confirm-copy"><p>Se compartirá <strong>${ctx.esc(home.name)}</strong> como un hogar familiar. Incluye sus mascotas, hábitos del hogar, inventario, lista del súper, compras y tiendas.</p><p><strong>No incluye</strong> Gym, mood, citas ni hábitos marcados «Para mí». El hogar no se publica hasta que confirmes.</p></div>`, async (_values, form) => runForm(form, async () => {
    const result = await accountAction(api, () => api.createShared(home.name, { localId: home.id }));
    const created = homeFromResult(result);
    const view = viewFor(ctx);
    if (created) {
      view.cloudHomes = [...(view.cloudHomes || []).filter(item => item.id !== created.id), { ...created, localId: home.id }];
      view.publishedLocalIds = [...new Set([...(view.publishedLocalIds || []), home.id])];
    }
    ctx.render?.();
    ctx.toast?.('Hogar compartido.');
    if (created) {
      ctx.modal('Hogar compartido', `<p><strong>${ctx.esc(created.name)}</strong> ya está listo. Ahora puedes invitar a una persona por un enlace de 7 días; Wello no envía correos automáticamente.</p><div class="row wrap">${actionButton(ctx, 'Invitar a alguien', 'household-invite', `data-household-id="${ctx.esc(created.id)}"`, 'primary')}${actionButton(ctx, 'Administrar miembros', 'household-members', `data-household-id="${ctx.esc(created.id)}"`, 'secondary')}</div>`);
    }
  }), 'Compartir hogar');
}

async function renameShared(ctx, householdId) {
  const api = cloud();
  const rename = api?.renameHousehold || api?.rename;
  if (!api || typeof rename !== 'function') return;
  const view = viewFor(ctx);
  const item = view.cloudHomes?.find(home => home.id === householdId);
  const role = await getRole(api, householdId, item?.role);
  if (role !== 'owner') {
    ctx.toast?.('Solo la propietaria puede renombrar este hogar.');
    return;
  }
  ctx.modal('Renombrar hogar compartido', ctx.field('Nombre', 'name', item?.name || '', 'text', 'required maxlength="80"'), async (values, form) => runForm(form, async () => {
    const name = String(values.name || '').trim();
    if (!name) return false;
    await accountAction(api, () => rename.call(api, householdId, name));
    view.cloudHomes = (view.cloudHomes || []).map(home => home.id === householdId ? { ...home, name } : home);
    ctx.render?.();
    ctx.toast?.('Nombre actualizado.');
  }));
}

function openInvite(ctx, householdId) {
  const api = cloud();
  if (!api || typeof api.createInvite !== 'function') return;
  const view = viewFor(ctx);
  const item = view.cloudHomes?.find(home => home.id === householdId);
  ctx.modal('Crear invitación', `<p>Escribe el correo confirmado de la persona que quieres invitar. Wello no envía correos: copiarás el enlace y lo entregarás por el canal que prefieras.</p>${ctx.field('Correo de la persona invitada', 'email', '', 'email', 'required maxlength="320" autocomplete="email"')}<p class="small muted">El enlace queda ligado a ese correo, dura 7 días y se puede revocar. El token solo aparece dentro del enlace para copiarlo.</p>`, async (values, form) => runForm(form, async () => {
    const email = String(values.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return false;
    const result = await accountAction(api, () => api.createInvite({ householdId, email }));
    const url = String(result?.url || result?.invite?.url || '').trim();
    if (!url) throw new Error('La invitación no devolvió un enlace para compartir.');
    const expiry = result?.invite?.expires_at || result?.expires_at;
    ctx.modal('Enlace de invitación listo', `<p>Invitación para <strong>${ctx.esc(email)}</strong>. ${ctx.esc(inviteExpiry(expiry, ctx))}</p><label class="field household-token-field">Enlace para copiar<input id="household-invite-url" readonly value="${ctx.esc(url)}" autocomplete="off"></label><div class="row wrap">${actionButton(ctx, 'Copiar enlace', 'household-copy-invite', '', 'primary')}${actionButton(ctx, 'Ver invitaciones', 'household-invites', `data-household-id="${ctx.esc(householdId)}"`, 'ghost')}</div><p class="small muted">No se envió ningún correo automáticamente.</p>`);
  }), 'Crear enlace');
}

async function openMembers(ctx, householdId) {
  const api = cloud();
  if (!api || typeof api.getMembers !== 'function') return;
  const view = viewFor(ctx);
  const item = view.cloudHomes?.find(home => home.id === householdId);
  try {
    const role = await getRole(api, householdId, item?.role);
    if (role !== 'owner') {
      ctx.toast?.('Solo la propietaria puede administrar miembros e invitaciones.');
      return;
    }
    const members = normaliseList(await accountAction(api, () => api.getMembers(householdId)), 'members');
    const rows = members.length ? members.map(member => {
      const memberRole = roleName(member.role);
      const remove = memberRole === 'owner' ? '' : actionButton(ctx, 'Quitar', 'household-remove-member', `data-household-id="${ctx.esc(householdId)}" data-user-id="${ctx.esc(member.user_id || member.id || '')}"`, 'danger');
      return `<div class="list-row household-member-row"><span><strong>${ctx.esc(member.email || 'Cuenta autenticada')}</strong><span class="small muted">${memberRole === 'owner' ? 'Propietaria' : 'Miembro'}${member.joined_at ? ` · Desde ${ctx.esc(String(member.joined_at).slice(0, 10))}` : ''}</span></span>${remove}</div>`;
    }).join('') : '<div class="empty household-inline-empty"><h3>No hay miembros todavía</h3><p>Invita a alguien con un enlace ligado a su correo.</p></div>';
    ctx.modal(`Miembros de ${item?.name || 'este hogar'}`, `<div class="household-members-list">${rows}</div><div class="row wrap household-member-actions">${actionButton(ctx, 'Crear invitación', 'household-invite', `data-household-id="${ctx.esc(householdId)}"`, 'primary')}${actionButton(ctx, 'Invitaciones activas', 'household-invites', `data-household-id="${ctx.esc(householdId)}"`, 'secondary')}</div>`);
  } catch (error) {
    showError(ctx, error);
  }
}

async function openInvites(ctx, householdId) {
  const api = cloud();
  if (!api || typeof api.listInvites !== 'function') return;
  const view = viewFor(ctx);
  const item = view.cloudHomes?.find(home => home.id === householdId);
  try {
    const role = await getRole(api, householdId, item?.role);
    if (role !== 'owner') {
      ctx.toast?.('Solo la propietaria puede administrar invitaciones.');
      return;
    }
    const invites = normaliseList(await accountAction(api, () => api.listInvites(householdId)), 'invites');
    const rows = invites.length ? invites.map(invite => `<div class="list-row household-invite-row"><span><strong>${ctx.esc(invite.email || 'Correo invitado')}</strong><span class="small muted">${invite.expires_at ? `Expira ${ctx.esc(String(invite.expires_at).slice(0, 10))}` : 'Válida 7 días'}</span></span>${invite.revoked_at ? '<span class="pill">Revocada</span>' : actionButton(ctx, 'Revocar', 'household-revoke-invite', `data-invite-id="${ctx.esc(invite.id || invite.invite_id || '')}" data-household-id="${ctx.esc(householdId)}"`, 'danger')}</div>`).join('') : '<div class="empty household-inline-empty"><h3>No hay invitaciones activas</h3><p>Los enlaces expiran en 7 días y no se envían automáticamente.</p></div>';
    ctx.modal(`Invitaciones de ${item?.name || 'este hogar'}`, `<div class="household-invites-list">${rows}</div><div class="row wrap household-member-actions">${actionButton(ctx, 'Crear invitación', 'household-invite', `data-household-id="${ctx.esc(householdId)}"`, 'primary')}${actionButton(ctx, 'Volver a miembros', 'household-members', `data-household-id="${ctx.esc(householdId)}"`, 'ghost')}</div>`);
  } catch (error) {
    showError(ctx, error);
  }
}

function confirmAction(ctx, message, operation) {
  const run = async form => runForm(form, async () => {
    try {
      await operation();
      ctx.render?.();
    } catch (error) {
      showError(ctx, error);
    }
  });
  if (typeof ctx.confirm === 'function') ctx.confirm(message, run);
  else ctx.modal('¿Confirmamos?', `<p>${ctx.esc(message)}</p>`, run, 'Sí, continuar');
}

function removeMember(ctx, data) {
  const api = cloud();
  const remove = api?.removeMember || api?.remove;
  if (!api || typeof remove !== 'function') return;
  confirmAction(ctx, 'Quitar a esta persona del hogar compartido? Ya no podrá consultar ni editar sus registros.', async () => {
    await accountAction(api, () => remove.call(api, data.householdId, data.userId));
    ctx.toast?.('Miembro retirado.');
    await refreshHouseholds(ctx, { silent: true });
  });
}

function revokeInvite(ctx, data) {
  const api = cloud();
  const revoke = api?.revokeInvite || api?.revoke;
  if (!api || typeof revoke !== 'function') return;
  confirmAction(ctx, 'Revocar este enlace de invitación? Dejará de funcionar para la persona invitada.', async () => {
    await accountAction(api, () => revoke.call(api, data.inviteId));
    ctx.toast?.('Invitación revocada.');
    await openInvites(ctx, data.householdId);
  });
}

async function leaveShared(ctx, householdId) {
  const api = cloud();
  const leave = api?.leaveHousehold || api?.leave;
  if (!api || typeof leave !== 'function') return;
  const view = viewFor(ctx);
  const item = view.cloudHomes?.find(home => home.id === householdId);
  const role = await getRole(api, householdId, item?.role);
  if (role === 'owner') {
    ctx.toast?.('La propietaria no puede salir de este hogar.');
    return;
  }
  confirmAction(ctx, `Salir de ${item?.name || 'este hogar'}? Perderás el acceso a sus registros compartidos.`, async () => {
    await accountAction(api, () => leave.call(api, householdId));
    view.cloudHomes = (view.cloudHomes || []).filter(home => home.id !== householdId);
    ctx.toast?.('Saliste del hogar compartido.');
  });
}

async function acceptInvite(ctx) {
  const api = cloud();
  const token = pendingInviteToken(ctx);
  if (!token) return;
  if (!api || !cloudAuthenticated(api) || typeof api.acceptInvite !== 'function') {
    ctx.toast?.('Primero inicia sesión con Google para aceptar la invitación.');
    return;
  }
  const email = cloudEmail(api);
  const run = async () => {
    try {
      const result = await accountAction(api, () => api.acceptInvite(token));
      viewFor(ctx).pendingInviteToken = '';
      try { globalThis.sessionStorage?.removeItem('wello:invite-pending'); } catch { /* almacenamiento opcional */ }
      if (globalThis.history?.replaceState && globalThis.location) globalThis.history.replaceState({}, globalThis.document?.title || 'Wello', `${globalThis.location.pathname}${globalThis.location.search}#hogares`);
      await refreshHouseholds(ctx, { silent: true });
      ctx.render?.();
      ctx.toast?.(`Invitación aceptada${result?.homeUuid ? '. Hogar agregado.' : '.'}`);
    } catch (error) {
      showError(ctx, error);
    }
  };
  confirmAction(ctx, `Aceptar esta invitación con la cuenta ${email || 'autenticada en Google'}?`, run);
}

async function importLocal(ctx) {
  const api = cloud();
  if (!api || !cloudAuthenticated(api) || typeof api.importFromLocal !== 'function') {
    ctx.toast?.('Inicia sesión para revisar una importación local.');
    return;
  }
  const local = ctx.readLocalState?.() || ctx.state();
  const homes = Array.isArray(local.households) ? local.households.length : 0;
  ctx.modal('Revisar importación local', `<p>Tu copia local contiene <strong>${homes}</strong> hogar${homes === 1 ? '' : 'es'} y registros personales.</p><p>La importación es explícita: no se ejecutará ahora sin tu confirmación. Gym, mood, citas y hábitos personales se revisan por separado; los hogares locales no conceden acceso a nadie automáticamente.</p>`, async (_values, form) => runForm(form, async () => {
    const result = await accountAction(api, () => api.importFromLocal({ confirm: true }));
    ctx.toast?.(result?.status === 'partial' ? 'Importación parcial: algunos hogares siguen locales.' : 'Copia importada en tu cuenta. Los hogares locales no se comparten automáticamente.');
    ctx.render?.();
  }), 'Confirmar importación');
}

export function registerHouseholds(ctx) {
  const view = viewFor(ctx);
  view.pendingInviteToken = inviteTokenFromHash(globalThis.location?.hash || '') || view.pendingInviteToken || '';
  ctx.action?.('household-cloud-refresh', () => refreshHouseholds(ctx));
  ctx.action?.('household-publish', data => publishLocal(ctx, data.localId));
  ctx.action?.('household-shared-rename', data => renameShared(ctx, data.householdId));
  ctx.action?.('household-members', data => openMembers(ctx, data.householdId));
  ctx.action?.('household-invite', data => openInvite(ctx, data.householdId));
  ctx.action?.('household-invites', data => openInvites(ctx, data.householdId));
  ctx.action?.('household-remove-member', data => removeMember(ctx, data));
  ctx.action?.('household-revoke-invite', data => revokeInvite(ctx, data));
  ctx.action?.('household-leave', data => leaveShared(ctx, data.householdId));
  ctx.action?.('household-accept-invite', () => acceptInvite(ctx));
  ctx.action?.('household-invite-auth', () => cloud()?.open?.());
  ctx.action?.('household-copy-invite', async () => {
    const url = globalThis.document?.getElementById('household-invite-url')?.value || '';
    if (!url) return;
    try {
      await globalThis.navigator?.clipboard?.writeText(url);
      ctx.toast?.('Enlace copiado.');
    } catch {
      globalThis.document?.getElementById('household-invite-url')?.select?.();
      ctx.toast?.('Selecciona el enlace para copiarlo.');
    }
  });
  ctx.action?.('data-import-local', () => importLocal(ctx));
  view.refreshHouseholds = (options = {}) => refreshHouseholds(ctx, options);
  if (cloudAuthenticated(cloud()) && typeof cloud()?.listHouseholds === 'function') void refreshHouseholds(ctx, { silent: true });
}

export { inviteTokenFromHash };
