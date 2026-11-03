import { createClient } from '@supabase/supabase-js';
import {
  CLOUD_STATE_VERSION,
  PERSONAL_RECORD_KEY,
  accountNamespace,
  applyRemoteBlobs,
  basePathFor,
  bootstrapRemoteState,
  buildHouseholdBlob,
  cacheStorageKey,
  canonicalRecordFromRow,
  callbackUrlFor,
  cloneJson,
  deepMerge3way,
  emptyCloudCache,
  householdRecordKey,
  isConflictError,
  isObject,
  isUuid,
  makeFreshOperationId,
  normalizeRevision,
  PENDING_ACTION_PREFIX,
  pendingInviteToken,
  prepareCloudRecords,
  sanitizeInviteHash,
  sanitizeInviteToken,
  sanitizeNfcHash,
  savePendingInviteToken,
  savePendingNfcHash,
  stableStringify,
  takePendingNfcHash,
} from './cloud-domain.js';
import {
  captureNamespaceSnapshot,
  createAutomaticBackup,
  createCloudSyncCoordinator,
  namespaceSnapshotMatches,
} from './cloud-sync.js';
import { importBackup } from './core.js';

export * from './cloud-domain.js';
export * from './cloud-sync.js';

const PRIVILEGED_KEY_RE = /service_role|sb_secret_/i;
const JWT_ROLE_RE = /"role"\s*:\s*"(service_role|supabase_admin|dashboard_user)"/i;
const PUBLISHABLE_KEY_RE = /^sb_publishable_[A-Za-z0-9._-]+$/;
const LOGGED_OUT_NAMESPACE = 'cloud:logged-out';
const DEFAULT_CONFIG = Object.freeze({ url: '', key: '', mode: 'preview' });
const MAX_LIST_ROWS = 500;
const MAX_RECORD_ROWS = 500;

function browserGlobal() {
  return typeof window !== 'undefined' ? window : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeJwtRole(key) {
  const parts = String(key ?? '').split('.');
  if (parts.length !== 3) return '';
  try {
    const encoded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const decoded = typeof atob === 'function' ? atob(padded) : '';
    const payload = JSON.parse(decoded);
    return String(payload?.role ?? '');
  } catch {
    return '';
  }
}

export function isPrivilegedSupabaseKey(key) {
  const value = String(key ?? '').trim();
  return PRIVILEGED_KEY_RE.test(value) || JWT_ROLE_RE.test(value) || /^(service_role|supabase_admin)$/i.test(decodeJwtRole(value));
}

/** Acepta únicamente la clave publishable nueva o un JWT anon legado real. */
export function isAllowedPublicSupabaseKey(key) {
  const value = String(key ?? '').trim();
  return PUBLISHABLE_KEY_RE.test(value) || decodeJwtRole(value).toLowerCase() === 'anon';
}

/** Valida únicamente la configuración pública que puede llegar al navegador. */
export function readWelloConfig(rawConfig = browserGlobal()?.WELLO_CONFIG) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return { ok: false, reason: 'missing', message: 'Falta window.WELLO_CONFIG para activar el modo en línea.', config: DEFAULT_CONFIG };
  }
  const url = String(rawConfig.url ?? '').trim();
  const key = String(rawConfig.key ?? '').trim();
  const mode = String(rawConfig.mode ?? '').trim();
  if (!['preview', 'production'].includes(mode)) {
    return { ok: false, reason: 'invalid_mode', message: 'WELLO_CONFIG.mode debe ser preview o production.', config: { url, key, mode } };
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    return { ok: false, reason: 'invalid_url', message: 'La URL pública de Supabase no es válida.', config: { url, key, mode } };
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) {
    return { ok: false, reason: 'invalid_url', message: 'La URL de Supabase debe usar HTTPS (HTTP solo para preview local).', config: { url, key, mode } };
  }
  if (mode === 'production' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'insecure_production_url', message: 'La producción requiere una URL HTTPS de Supabase.', config: { url, key, mode } };
  }
  if (!key || key.length < 16) {
    return { ok: false, reason: 'missing_key', message: 'Falta la clave publicable de Supabase.', config: { url, key: '', mode } };
  }
  if (isPrivilegedSupabaseKey(key)) {
    return { ok: false, reason: 'privileged_key', message: 'Se rechazó una credencial privilegiada: usa solo la publishable/anon key en el frontend.', config: { url, key: '', mode } };
  }
  if (!isAllowedPublicSupabaseKey(key)) {
    return { ok: false, reason: 'invalid_key', message: 'La clave pública debe ser sb_publishable o un JWT anon válido de Supabase.', config: { url, key: '', mode } };
  }
  return {
    ok: true,
    reason: 'ok',
    message: mode === 'production' ? 'Configuración de producción válida.' : 'Configuración de preview válida.',
    config: { url: parsed.toString().replace(/\/$/, ''), key, mode },
  };
}

function stateHasData(state) {
  if (!state || typeof state !== 'object') return false;
  const personal = state.personal && typeof state.personal === 'object' ? state.personal : {};
  const personalCollections = ['sessions', 'habits', 'moods', 'appointments'];
  if (personalCollections.some((key) => Array.isArray(personal[key]) && personal[key].length > 0)) return true;
  if (Object.keys(personal).some((key) => !personalCollections.includes(key) && personal[key] != null)) return true;
  return Array.isArray(state.households) && state.households.some((household) => {
    if (!household || typeof household !== 'object') return false;
    return ['habits', 'pets', 'inventory', 'shopping', 'purchases', 'stores'].some((key) => Array.isArray(household[key]) && household[key].length > 0);
  });
}

function recordHasData(record) {
  if (!record?.data || typeof record.data !== 'object') return false;
  if (record.scope === 'personal') return stateHasData({ personal: record.data.personal });
  const home = record.data.household;
  return ['habits', 'pets', 'inventory', 'shopping', 'purchases', 'stores'].some((key) => Array.isArray(home?.[key]) && home[key].length > 0);
}

function equalJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function cloneCloudCache(cache, userId) {
  const fallback = emptyCloudCache(userId);
  const source = cache && typeof cache === 'object' ? cache : {};
  return {
    ...fallback,
    ...cloneJson(source),
    userId,
    namespace: accountNamespace(userId),
    personal: source.personal ? cloneJson(source.personal) : null,
    households: { ...(source.households || {}) },
    mappings: { ...(source.mappings || {}) },
    memberships: Array.isArray(source.memberships) ? cloneJson(source.memberships) : [],
    revisions: {
      personal: normalizeRevision(source.revisions?.personal),
      households: { ...(source.revisions?.households || {}) },
    },
  };
}

function rowData(row) {
  return row?.data ?? null;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

function userFromSession(session) {
  const user = session?.user;
  if (!user?.id) return null;
  return { id: String(user.id), email: user.email ? String(user.email) : '', user_metadata: user.user_metadata ?? {} };
}

function statusLabel(state) {
  switch (state.status) {
    case 'missing_config': return 'Modo en línea pendiente de configuración';
    case 'invalid_config': return 'Modo en línea no disponible';
    case 'checking': return 'Revisando la sesión…';
    case 'signing_in': return 'Abriendo Google…';
    case 'signed_in': return 'Cuenta conectada';
    case 'error': return 'No se pudo completar la acción';
    case 'local': return 'Modo local elegido';
    default: return 'Sin sesión en línea';
  }
}

function statusDetail(state) {
  if (state.status === 'missing_config' || state.status === 'invalid_config') return state.message;
  if (state.status === 'error') return state.message;
  if (state.status === 'signed_in' && state.syncStatus === 'error') return state.message || 'No se pudo completar la acción; puedes volver a intentarlo.';
  if (state.status === 'signed_in') return `Cuenta: ${state.email || 'usuario autenticado'}. ${state.syncStatus === 'synced' ? 'Sincronizado con esta cuenta.' : state.syncStatus === 'partial' ? 'Datos personales sincronizados; los hogares sin vincular siguen guardados solo en este dispositivo.' : state.syncStatus === 'conflict' ? 'Hay una edición concurrente; la versión local se conserva para revisión.' : state.syncStatus === 'review' ? 'Hay datos remotos o locales pendientes de revisión explícita.' : 'Guardado en este dispositivo.'}`;
  if (state.status === 'signing_in') return 'Google devolverá la sesión a la ruta base de Pages. El destino pendiente se conserva de forma temporal y segura.';
  if (state.syncStatus === 'conflict') return 'Hay una edición concurrente. Se conservaron los datos locales; revisa antes de volver a intentar.';
  if (state.syncStatus === 'review') return 'Hay datos pendientes de revisión explícita; no se reemplazó el estado local.';
  if (state.syncStatus === 'synced') return 'Sincronizado con la cuenta seleccionada.';
  return 'Puedes trabajar sin cuenta en modo local o iniciar sesión cuando exista configuración pública.';
}

function householdFromRemote(remoteRow) {
  return remoteRow?.data?.household ?? remoteRow?.household ?? remoteRow?.data ?? null;
}

function parseUuidResult(data) {
  const value = typeof data === 'string' ? data : firstRow(data)?.id ?? firstRow(data)?.household_id ?? firstRow(data);
  return String(value ?? '');
}

class StaleNamespaceError extends Error {
  constructor() {
    super('La sesión o el namespace cambió durante la operación.');
    this.name = 'StaleNamespaceError';
    this.code = 'WELLO_STALE_NAMESPACE';
    this.stale = true;
  }
}

function isStaleNamespaceError(error) {
  return Boolean(error?.stale || error?.code === 'WELLO_STALE_NAMESPACE');
}

function assertNamespaceSnapshot(controller, snapshot) {
  if (!namespaceSnapshotMatches(controller, snapshot)) throw new StaleNamespaceError();
}

function tokenSubject(accessToken) {
  const parts = String(accessToken ?? '').split('.');
  if (parts.length !== 3) return '';
  try {
    const encoded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const decoded = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return String(JSON.parse(decoded)?.sub ?? '');
  } catch {
    return '';
  }
}

function pendingActionKey(userId, action = 'create-household') {
  return `${PENDING_ACTION_PREFIX}${encodeURIComponent(String(userId))}:${action}`;
}

function readPendingAction(storage, userId, action = 'create-household') {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(pendingActionKey(userId, action));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.userId === String(userId) && parsed.action === action ? parsed : null;
  } catch {
    return null;
  }
}

function savePendingAction(storage, action) {
  if (!storage || !action?.userId || !action?.operationId) return;
  try { storage.setItem(pendingActionKey(action.userId, action.action), JSON.stringify(action)); } catch { /* storage bloqueado */ }
}

function clearPendingAction(storage, userId, action = 'create-household') {
  if (!storage || !userId) return;
  try { storage.removeItem(pendingActionKey(userId, action)); } catch { /* storage bloqueado */ }
}

function canonicalNameMap(memberships) {
  return new Map((Array.isArray(memberships) ? memberships : [])
    .filter((membership) => isUuid(membership?.household_id ?? membership?.id) && String(membership?.name ?? '').trim())
    .map((membership) => [String(membership.household_id ?? membership.id), String(membership.name).trim()]));
}

function stateWithCanonicalHouseholdNames(state, memberships, mappings = {}) {
  const next = cloneJson(state);
  if (!Array.isArray(next?.households)) return next;
  const names = canonicalNameMap(memberships);
  for (const home of next.households) {
    const localId = String(home?.id ?? '');
    const remoteId = isUuid(localId) ? localId : mappings?.[localId];
    const name = names.get(String(remoteId ?? ''));
    if (name && home && home.name !== name) home.name = name;
  }
  return next;
}

function remoteWithCanonicalHouseholdNames(remote) {
  const next = cloneJson(remote);
  const names = canonicalNameMap(next?.memberships);
  for (const [remoteId, row] of Object.entries(next?.households || {})) {
    const name = names.get(String(remoteId));
    const home = householdFromRemote(row);
    if (name && isObject(home)) {
      const normalized = cloneJson(row);
      if (normalized?.data?.household) normalized.data.household.name = name;
      else if (normalized?.household) normalized.household.name = name;
      else if (normalized?.data) normalized.data.name = name;
      next.households[remoteId] = normalized;
    }
  }
  return next;
}

function cacheWithCanonicalHouseholdNames(cache, memberships) {
  const next = cloneJson(cache);
  const names = canonicalNameMap(memberships);
  for (const [remoteId, row] of Object.entries(next?.households || {})) {
    const name = names.get(String(remoteId));
    const home = householdFromRemote(row);
    if (!name || !isObject(home)) continue;
    if (next.households[remoteId]?.data?.household) next.households[remoteId].data.household.name = name;
    else if (next.households[remoteId]?.household) next.households[remoteId].household.name = name;
    else if (next.households[remoteId]?.data) next.households[remoteId].data.name = name;
  }
  return next;
}

export class WelloCloudController {
  constructor(options = {}) {
    const globalObject = browserGlobal();
    this.globalObject = options.globalObject ?? globalObject;
    this.app = options.app ?? globalObject?.WelloApp ?? null;
    this.document = options.document ?? globalObject?.document ?? null;
    this.location = options.location ?? globalObject?.location ?? null;
    this.history = options.history ?? globalObject?.history ?? null;
    this.sessionStorage = options.sessionStorage ?? globalObject?.sessionStorage ?? null;
    this.localStorage = options.localStorage ?? globalObject?.localStorage ?? null;
    this.createClient = options.createClient ?? createClient;
    this.configResult = options.configResult ?? readWelloConfig(options.config ?? globalObject?.WELLO_CONFIG);
    this.client = null;
    this.subscription = null;
    this.root = null;
    this.initialized = false;
    this.opened = true;
    this.user = null;
    this.cache = null;
    this.householdMappings = {};
    this.memberships = [];
    this.remote = null;
    this.conflict = null;
    this.generation = 0;
    this.state = {
      status: this.configResult.ok ? 'checking' : this.configResult.reason === 'missing' ? 'missing_config' : 'invalid_config',
      message: this.configResult.message,
      accountId: null,
      email: '',
      namespace: null,
      syncStatus: 'not-synced',
      memberships: [],
      pendingInvite: false,
    };
    this.syncLoop = createCloudSyncCoordinator(this, {
      eventTarget: options.eventTarget ?? globalObject,
      document: this.document,
      debounceMs: options.debounceMs,
      intervalMs: options.intervalMs,
    });
  }

  async init() {
    if (this.initialized) return this;
    this.initialized = true;
    this.mount();
    if (!this.configResult.ok) {
      this.render();
      return this;
    }
    try {
      this.client = this.createClient(this.configResult.config.url, this.configResult.config.key, {
        auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      });
      this.subscription = this.client.auth.onAuthStateChange((event, session) => {
        queueMicrotask(() => this.handleSession(event, session));
      })?.data?.subscription ?? null;
      await this.handleAuthCallback();
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      await this.handleSession('INITIAL_SESSION', data?.session ?? null);
    } catch (error) {
      this.state.status = 'error';
      this.state.message = error?.message || 'No se pudo inicializar Auth de Supabase.';
      this.render();
    }
    return this;
  }

  mount() {
    if (!this.document?.body) return;
    this.root = this.document.getElementById('wello-cloud-root');
    if (!this.root) {
      this.root = this.document.createElement('div');
      this.root.id = 'wello-cloud-root';
      this.document.body.appendChild(this.root);
    }
    this.root.addEventListener('click', (event) => {
      const element = event.target?.closest?.('[data-wello-cloud-action]');
      if (!element) return;
      const action = element.getAttribute('data-wello-cloud-action');
      const run = (operation) => {
        try { void Promise.resolve(operation()).catch((error) => this.handleActionError(error)); } catch (error) { this.handleActionError(error); }
      };
      if (action === 'open') run(() => this.open());
      if (action === 'close') run(() => this.close());
      if (action === 'google') run(() => this.signInWithGoogle());
      if (action === 'local') run(() => this.enterLocalMode());
      if (action === 'signout') run(() => this.signOut());
      if (action === 'sync') run(() => this.sync());
      if (action === 'import') run(() => this.importRemoteState({ confirm: true }));
      if (action === 'import-local') run(() => this.importFromLocal({ confirm: true }));
      if (action === 'nfc') run(() => this.consumeNfcDestination());
      if (action === 'accept-invite') run(() => this.acceptInvite(this.peekPendingInvite(), { explicit: true }));
      if (action === 'resolve-remote') run(() => this.resolveConflict('remote', { confirm: true }));
      if (action === 'resolve-local') run(() => this.resolveConflict('local', { confirm: true }));
    });
    this.ensureStyles();
  }

  handleActionError(error) {
    if (isStaleNamespaceError(error)) return { status: 'stale' };
    const message = error?.message || 'No se pudo completar la acción.';
    const accountId = this.user?.id ?? null;
    const accountValid = Boolean(accountId)
      && this.state.accountId === accountId
      && this.state.namespace === accountNamespace(accountId)
      && namespaceSnapshotMatches(this, captureNamespaceSnapshot(this));
    this.state = accountValid
      ? { ...this.state, status: 'signed_in', syncStatus: 'error', message }
      : { ...this.state, status: 'error', message };
    this.render();
    try { this.app?.toast?.(message); } catch { /* el aviso visual es opcional */ }
    return { status: 'error', message };
  }

  ensureStyles() {
    if (!this.document?.head || this.document.getElementById('wello-cloud-styles')) return;
    const style = this.document.createElement('style');
    style.id = 'wello-cloud-styles';
    style.textContent = `#wello-cloud-root{font-family:inherit;position:relative;z-index:1000}.wello-cloud-toggle{position:fixed;right:1rem;bottom:1rem;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#283541;padding:.65rem .85rem;box-shadow:0 8px 24px #28354122;cursor:pointer;font:inherit;font-weight:700}.wello-cloud-panel{position:fixed;right:1rem;bottom:1rem;width:min(22rem,calc(100vw - 2rem));max-height:min(42rem,calc(100vh - 2rem));overflow:auto;background:#fff;color:#283541;border:1px solid #d9e2ec;border-radius:1.25rem;box-shadow:0 18px 54px #28354133;padding:1rem}.wello-cloud-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.wello-cloud-head h2{font-size:1.05rem;margin:0}.wello-cloud-close{border:0;background:transparent;font-size:1.25rem;cursor:pointer;color:inherit}.wello-cloud-banner{border-radius:.85rem;background:#f5f7fa;padding:.75rem;margin:.9rem 0}.wello-cloud-banner strong{display:block;margin-bottom:.3rem}.wello-cloud-muted{color:#5c6b78;font-size:.88rem;line-height:1.4}.wello-cloud-actions{display:grid;gap:.55rem;margin-top:.9rem}.wello-cloud-actions button{width:100%;border:1px solid #b8c5d0;border-radius:.7rem;background:#fff;color:#283541;padding:.65rem .75rem;cursor:pointer;font:inherit;font-weight:700}.wello-cloud-actions button[data-wello-cloud-action=google]{background:#48cfad;border-color:#48cfad}.wello-cloud-actions button:disabled{opacity:.52;cursor:not-allowed}.wello-cloud-note{font-size:.8rem;color:#657481;margin:.8rem 0 0;line-height:1.4}.wello-cloud-error{color:#9b2c2c}.wello-cloud-conflict{background:#fff4e5;border:1px solid #f2c078;border-radius:.75rem;padding:.65rem;font-size:.85rem;line-height:1.35}.wello-cloud-conflict-actions{display:flex;gap:.4rem;margin-top:.55rem}.wello-cloud-conflict-actions button{flex:1;padding:.4rem;border:1px solid #c98d38;border-radius:.5rem;background:#fff;cursor:pointer}`;
    this.document.head.appendChild(style);
  }

  render() {
    if (!this.root) return;
    if (!this.opened) {
      this.root.innerHTML = '<button type="button" class="wello-cloud-toggle" data-wello-cloud-action="open" aria-label="Abrir cuenta en línea">Cuenta</button>';
      return;
    }
    const configured = this.configResult.ok;
    const signedIn = this.state.status === 'signed_in';
    const disabledGoogle = !configured || this.state.status === 'signing_in';
    const errorClass = this.state.status === 'error' || this.state.syncStatus === 'error' || !configured ? 'wello-cloud-error' : '';
    const conflictHtml = this.state.syncStatus === 'conflict' ? `<div class="wello-cloud-conflict">Conflicto en <code>${escapeHtml(this.conflict?.recordKey || 'registro')}</code>. La versión local sigue intacta. <div class="wello-cloud-conflict-actions"><button type="button" data-wello-cloud-action="resolve-remote">Usar remota</button><button type="button" data-wello-cloud-action="resolve-local">Conservar local</button></div></div>` : '';
    const inviteHtml = signedIn && this.state.pendingInvite ? '<div class="wello-cloud-conflict">Hay una invitación pendiente. Google no la acepta automáticamente.<div class="wello-cloud-actions"><button type="button" data-wello-cloud-action="accept-invite">Aceptar invitación</button></div></div>' : '';
    this.root.innerHTML = `<aside class="wello-cloud-panel" aria-label="Cuenta en línea de Wello"><div class="wello-cloud-head"><h2>Cuenta en línea</h2><button type="button" class="wello-cloud-close" data-wello-cloud-action="close" aria-label="Cerrar">×</button></div><div class="wello-cloud-banner ${errorClass}"><strong>${escapeHtml(statusLabel(this.state))}</strong><span class="wello-cloud-muted">${escapeHtml(statusDetail(this.state))}</span></div>${conflictHtml}${inviteHtml}${signedIn ? `<div class="wello-cloud-actions"><button type="button" data-wello-cloud-action="sync">Sincronizar ahora</button>${this.state.syncStatus === 'review' ? '<button type="button" data-wello-cloud-action="import">Revisar e importar datos remotos</button><button type="button" data-wello-cloud-action="import-local">Revisar datos locales para importar</button>' : ''}<button type="button" data-wello-cloud-action="nfc">Abrir acceso directo del súper</button><button type="button" data-wello-cloud-action="local">Cambiar a modo local</button><button type="button" data-wello-cloud-action="signout">Cerrar sesión</button></div><p class="wello-cloud-note">Los hogares remotos solo aparecen por membresía vigente. Un ID local no concede acceso.</p>` : `<div class="wello-cloud-actions"><button type="button" data-wello-cloud-action="google" ${disabledGoogle ? 'disabled' : ''}>Continuar con Google</button><button type="button" data-wello-cloud-action="local">Continuar en modo local</button></div><p class="wello-cloud-note">Google usa el SDK oficial de Supabase con PKCE. ${configured ? 'La configuración pública está presente.' : 'El botón de Google permanece deshabilitado porque falta configuración pública.'}</p>`}</aside>`;
  }

  open() { this.opened = true; this.render(); }
  close() { this.opened = false; this.render(); }

  async clearAuthenticatedView(message = 'Sesión cerrada.', { clearCache = true } = {}) {
    const oldUserId = this.user?.id;
    this.generation += 1;
    this.syncLoop.stop();
    if (oldUserId && clearCache) {
      try { this.localStorage?.removeItem(cacheStorageKey(oldUserId)); } catch { /* storage bloqueado */ }
    }
    try { await this.app?.switchNamespace?.(LOGGED_OUT_NAMESPACE); } catch { /* app opcional */ }
    this.user = null;
    this.remote = null;
    this.cache = null;
    this.householdMappings = {};
    this.memberships = [];
    this.conflict = null;
    this.state = { ...this.state, status: 'signed_out', accountId: null, email: '', namespace: null, syncStatus: 'not-synced', memberships: [], pendingInvite: Boolean(this.peekPendingInvite()), message };
    this.render();
  }

  async handleSession(event, session) {
    const nextUser = userFromSession(session);
    if (!nextUser) {
      await this.clearAuthenticatedView(event === 'SIGNED_OUT' ? 'Sesión cerrada.' : 'Sesión expirada o revocada. Los datos autenticados quedaron ocultos.');
      return;
    }
    const changedAccount = Boolean(this.user?.id && this.user.id !== nextUser.id);
    if (!this.user || changedAccount) this.generation += 1;
    const namespace = accountNamespace(nextUser.id);
    this.user = nextUser;
    this.state = { ...this.state, status: 'signed_in', accountId: nextUser.id, email: nextUser.email, namespace, message: 'Cuenta conectada.' };
    this.cache = this.readCache(nextUser.id);
    this.householdMappings = { ...(this.cache.mappings || {}) };
    this.memberships = Array.isArray(this.cache.memberships) ? cloneJson(this.cache.memberships) : [];
    if (changedAccount) {
      this.remote = null;
      this.conflict = null;
      this.state.syncStatus = 'not-synced';
    }
    let appNamespace;
    const canReadNamespace = typeof this.app?.getNamespace === 'function';
    try { if (canReadNamespace) appNamespace = this.app.getNamespace(); } catch { appNamespace = null; }
    const shouldSwitchNamespace = changedAccount || event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || canReadNamespace && appNamespace !== namespace;
    if (shouldSwitchNamespace) {
      try { await this.app?.switchNamespace?.(namespace); } catch { /* la app puede no exponer persistencia en preview */ }
    }
    this.syncLoop.start();
    this.inviteDestinationFromHash();
    this.render();
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      this.consumeNfcDestination();
      if (this.client) void this.sync({ direction: 'auto', trigger: 'bootstrap', fromCoordinator: true }).catch((error) => this.handleActionError(error));
    }
  }

  async handleAuthCallback() {
    if (!this.client || !this.location) return;
    const query = new URLSearchParams(this.location.search || '');
    const code = query.get('code');
    const oauthError = query.get('error_description') || query.get('error');
    if (oauthError) {
      this.state.status = 'error';
      this.state.message = `Google no completó el acceso: ${oauthError}`;
      this.cleanAuthUrl();
      this.render();
      return;
    }
    if (code) {
      const { error } = await this.client.auth.exchangeCodeForSession(code);
      this.cleanAuthUrl();
      if (error) throw error;
    }
  }

  cleanAuthUrl() {
    if (!this.history?.replaceState || !this.location) return;
    const base = basePathFor(this.location.pathname);
    this.history.replaceState({}, this.document?.title || 'Wello', base);
  }

  async signInWithGoogle() {
    if (!this.configResult.ok || !this.client) {
      this.state.status = this.configResult.reason === 'missing' ? 'missing_config' : 'invalid_config';
      this.state.message = this.configResult.message;
      this.render();
      return { error: new Error(this.state.message) };
    }
    const currentHash = sanitizeNfcHash(this.location?.hash || '');
    savePendingNfcHash(this.sessionStorage, currentHash);
    this.inviteDestinationFromHash();
    this.state.status = 'signing_in';
    this.state.message = 'Abriendo Google…';
    this.render();
    try {
      const redirectTo = callbackUrlFor({ origin: this.location?.origin, pathname: this.location?.pathname });
      const result = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } } });
      if (result.error) throw result.error;
      return result;
    } catch (error) {
      this.state.status = 'error';
      this.state.message = error?.message || 'No se pudo iniciar Google.';
      this.render();
      return { error };
    }
  }

  async signOut() {
    try { if (this.client) await this.client.auth.signOut(); } catch (error) { this.state.message = error?.message || 'No se pudo cerrar la sesión remota.'; }
    await this.clearAuthenticatedView('Sesión cerrada. No se muestran datos de otra cuenta.');
  }

  enterLocalMode() {
    this.generation += 1;
    this.syncLoop.stop();
    try { this.app?.switchNamespace?.('local'); } catch { /* la app local sigue siendo independiente */ }
    try { this.app?.toast?.('Modo local activo. Los datos no se sincronizan sin una acción explícita.'); } catch { /* noop */ }
    this.state = { ...this.state, status: 'local', syncStatus: 'not-synced', message: 'Modo local activo.' };
    this.consumeNfcDestination();
    this.close();
  }

  readCache(userId) {
    const fallback = emptyCloudCache(userId);
    try {
      const raw = this.localStorage?.getItem(cacheStorageKey(userId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.userId !== userId) return fallback;
      return cloneCloudCache(parsed, userId);
    } catch { return fallback; }
  }

  saveCache() {
    if (!this.user?.id || !this.cache) return;
    this.cache.mappings = { ...this.householdMappings };
    this.cache.memberships = cloneJson(this.memberships);
    this.cache.savedAt = new Date().toISOString();
    try { this.localStorage?.setItem(cacheStorageKey(this.user.id), JSON.stringify(this.cache)); } catch { /* no impedir sync remoto */ }
  }

  async query(builder, snapshot = null) {
    if (snapshot) assertNamespaceSnapshot(this, snapshot);
    const result = await builder;
    if (snapshot) assertNamespaceSnapshot(this, snapshot);
    const { data, error } = result;
    if (error) throw error;
    return data ?? [];
  }

  async getBoundWriteClient(snapshot) {
    assertNamespaceSnapshot(this, snapshot);
    if (!this.client?.auth?.getSession) throw new Error('No se pudo validar la sesión para escribir.');
    const { data, error } = await this.client.auth.getSession();
    assertNamespaceSnapshot(this, snapshot);
    if (error) throw error;
    const session = data?.session;
    const sessionUserId = String(session?.user?.id ?? '');
    const accessToken = String(session?.access_token ?? '');
    const subject = tokenSubject(accessToken);
    if (!accessToken || sessionUserId !== String(snapshot.accountId) || subject && subject !== String(snapshot.accountId)) {
      throw new StaleNamespaceError();
    }
    assertNamespaceSnapshot(this, snapshot);
    const config = this.configResult?.config;
    if (!config?.url || !config?.key) throw new Error('Falta la configuración pública para escribir.');
    const boundClient = this.createClient(config.url, config.key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    if (!boundClient?.rpc) throw new Error('No se pudo preparar la solicitud autenticada.');
    return boundClient;
  }

  async writeRpc(name, params, snapshot) {
    const boundClient = await this.getBoundWriteClient(snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const result = await boundClient.rpc(name, params);
    assertNamespaceSnapshot(this, snapshot);
    if (result?.error) throw result.error;
    return result ?? { data: null, error: null };
  }

  async fetchMemberships(snapshot = null) {
    if (!this.client || !this.user) throw new Error('Se requiere una sesión para consultar membresías.');
    const expectedUserId = snapshot?.accountId ?? this.user.id;
    if (snapshot) assertNamespaceSnapshot(this, snapshot);
    return this.query(this.client.from('household_members').select('household_id,role,joined_at').eq('user_id', expectedUserId).limit(MAX_LIST_ROWS), snapshot);
  }

  async fetchRemoteRecords(snapshot = null) {
    if (!this.client || !this.user) throw new Error('Se requiere una sesión para consultar datos remotos.');
    if (snapshot) assertNamespaceSnapshot(this, snapshot);
    const expectedUserId = snapshot?.accountId ?? this.user.id;
    const privateRows = await this.query(this.client.from('private_records').select('record_key,data,version,revision,updated_at').eq('user_id', expectedUserId).eq('record_key', PERSONAL_RECORD_KEY).limit(1), snapshot);
    const memberships = await this.fetchMemberships(snapshot);
    const householdIds = memberships.map((item) => item?.household_id).filter((id) => isUuid(id));
    let householdRows = [];
    if (householdIds.length) {
      householdRows = await this.query(this.client.from('household_records').select('household_id,record_key,data,version,revision,updated_at').in('household_id', householdIds).limit(MAX_RECORD_ROWS), snapshot);
    }
    const canonicalRows = householdIds.length
      ? await this.query(this.client.from('households').select('id,name').in('id', householdIds).limit(MAX_LIST_ROWS), snapshot)
      : [];
    const canonicalNames = new Map(canonicalRows.map((row) => [String(row?.id), String(row?.name ?? '')]));
    const namedMemberships = memberships.map((membership) => ({
      ...membership,
      ...(canonicalNames.has(String(membership.household_id)) ? { name: canonicalNames.get(String(membership.household_id)) } : {}),
    }));
    const households = {};
    for (const row of householdRows) {
      if (row?.household_id && row?.record_key === householdRecordKey(row.household_id)) households[row.household_id] = canonicalRecordFromRow(row);
    }
    if (snapshot) assertNamespaceSnapshot(this, snapshot);
    return { personal: canonicalRecordFromRow(firstRow(privateRows)), households, memberships: namedMemberships };
  }

  async listHouseholds() {
    if (!this.client || !this.user) return [];
    const snapshot = captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    const memberships = await this.fetchMemberships(snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const ids = memberships.map((row) => row?.household_id).filter((id) => isUuid(id));
    if (!ids.length) {
      assertNamespaceSnapshot(this, snapshot);
      this.memberships = [];
      this.state.memberships = [];
      this.saveCache();
      return [];
    }
    const households = await this.query(this.client.from('households').select('id,name').in('id', ids).limit(MAX_LIST_ROWS), snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const byId = new Map(households.map((row) => [String(row.id), row]));
    const result = memberships.map((membership) => {
      const id = membership.household_id;
      const localId = Object.entries(this.householdMappings).find(([, remoteId]) => String(remoteId) === String(id))?.[0] ?? null;
      return { id, name: String(byId.get(String(id))?.name ?? 'Hogar'), role: membership.role === 'owner' ? 'owner' : 'member', ...(localId ? { localId } : {}) };
    });
    this.memberships = cloneJson(result);
    this.state.memberships = cloneJson(result);
    assertNamespaceSnapshot(this, snapshot);
    this.saveCache();
    return result;
  }

  getHouseholdRole(localOrRemoteId) {
    const id = String(localOrRemoteId ?? '').trim();
    if (!id) return null;
    const remoteId = isUuid(id) ? id : this.householdMappings[id];
    const found = this.memberships.find((item) => String(item?.id ?? item?.household_id) === String(remoteId));
    return found?.role === 'owner' ? 'owner' : found?.role === 'member' ? 'member' : null;
  }

  remoteHasData(remote) {
    return Boolean(remote?.personal?.data?.personal && stateHasData({ personal: remote.personal.data.personal })) || Object.values(remote?.households || {}).some((row) => recordHasData({ scope: 'household', data: householdFromRemote(row) }));
  }

  previousRevision(record) {
    if (record.scope === 'personal') return normalizeRevision(this.cache?.revisions?.personal);
    return normalizeRevision(this.cache?.revisions?.households?.[record.remoteId]);
  }

  previousData(record) {
    if (record.scope === 'personal') return this.cache?.personal?.data ?? null;
    return this.cache?.households?.[record.remoteId]?.data ?? null;
  }

  adoptRemoteBaseline(record, remoteRow) {
    if (!remoteRow || !this.cache) return;
    if (record.scope === 'personal') {
      this.cache.personal = cloneJson(remoteRow);
      this.cache.revisions.personal = normalizeRevision(remoteRow.revision);
    } else {
      this.cache.households[record.remoteId] = cloneJson(remoteRow);
      this.cache.revisions.households[record.remoteId] = normalizeRevision(remoteRow.revision);
    }
  }

  updateCacheAfterUpsert(record, row) {
    const canonical = row?.recordKey ? row : { recordKey: record.recordKey, data: cloneJson(record.data), version: record.version, revision: normalizeRevision(row?.revision) };
    if (record.scope === 'personal') {
      this.cache.personal = cloneJson(canonical);
      this.cache.revisions.personal = normalizeRevision(canonical.revision);
    } else {
      this.cache.households[record.remoteId] = cloneJson(canonical);
      this.cache.revisions.households[record.remoteId] = normalizeRevision(canonical.revision);
    }
  }

  async upsertRecord(record, expectedRevision, expectedSnapshot = null, expectedOperationId = null) {
    if (!this.client || !this.user) throw new Error('Se requiere una sesión para guardar.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    const normalizedExpected = normalizeRevision(expectedRevision);
    const operationId = expectedOperationId || makeFreshOperationId('state-upsert', `${record.scope}:${record.recordKey}`, normalizedExpected);
    const params = {
      p_record_key: record.recordKey,
      p_data: cloneJson(record.data),
      p_version: record.version ?? CLOUD_STATE_VERSION,
      p_expected_revision: normalizedExpected,
      p_operation_id: operationId,
    };
    const result = record.scope === 'personal'
      ? await this.writeRpc('upsert_private_record', params, snapshot)
      : await this.writeRpc('upsert_household_record', { ...params, p_household_id: record.remoteId }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    if (!this.cache) this.cache = emptyCloudCache(snapshot.accountId);
    const row = canonicalRecordFromRow(firstRow(result.data)) || { recordKey: record.recordKey, data: cloneJson(record.data), version: record.version, revision: normalizedExpected + 1 };
    this.updateCacheAfterUpsert(record, row);
    return { ...record, data: cloneJson(row.data ?? record.data), revision: normalizeRevision(row.revision) };
  }

  currentAppState() {
    try { return cloneJson(this.app?.getState?.() ?? {}); } catch { return {}; }
  }

  localAppState() {
    try { return cloneJson(this.app?.readLocalState?.() ?? this.app?.getState?.() ?? {}); } catch { return {}; }
  }

  async setRemoteState(state, snapshot = null) {
    if (snapshot && !namespaceSnapshotMatches(this, snapshot)) return false;
    if (!this.app?.setState) return false;
    // El segundo argumento es parte del contrato: no emite wello:changed ni
    // cierra el diálogo que la persona pueda tener abierto.
    await this.app.setState(cloneJson(state), { source: 'remote' });
    if (snapshot && !namespaceSnapshotMatches(this, snapshot)) return false;
    return true;
  }

  applyRecordToState(state, record, data) {
    const next = cloneJson(state);
    if (record.scope === 'personal') next.personal = cloneJson(data.personal ?? data);
    else {
      const localId = record.localId || record.remoteId;
      const household = cloneJson(data.household ?? data);
      household.id = localId;
      const list = Array.isArray(next.households) ? next.households : [];
      const index = list.findIndex((item) => String(item?.id) === String(localId));
      if (index >= 0) list[index] = household;
      else list.push(household);
      next.households = list;
      if (!next.activeHousehold) next.activeHousehold = localId;
    }
    return next;
  }

  async cleanupRevokedMemberships(remote, snapshot) {
    const active = new Set((remote?.memberships || []).map((item) => String(item?.household_id)).filter(isUuid));
    const staleRemoteIds = new Set(Object.keys(this.cache?.households || {}).filter((id) => !active.has(id)));
    for (const [localId, remoteId] of Object.entries(this.householdMappings)) if (!active.has(remoteId)) staleRemoteIds.add(remoteId);
    if (!staleRemoteIds.size) return { removed: [] };
    const current = this.currentAppState();
    const nextCache = cloneCloudCache(this.cache, snapshot.accountId);
    const nextMappings = { ...this.householdMappings };
    const removed = [];
    for (const remoteId of staleRemoteIds) {
      delete nextCache.households?.[remoteId];
      delete nextCache.revisions?.households?.[remoteId];
      for (const [localId, mappedRemoteId] of Object.entries(nextMappings)) {
        if (mappedRemoteId === remoteId) {
          delete nextMappings[localId];
          if (Array.isArray(current.households)) {
            const kept = current.households.filter((home) => String(home?.id) !== String(localId));
            if (kept.length !== current.households.length) { current.households = kept; removed.push(localId); }
          }
        }
      }
    }
    if (removed.length && namespaceSnapshotMatches(this, snapshot)) {
      if (current.households?.length && !current.households.some((home) => home.id === current.activeHousehold)) current.activeHousehold = current.households[0].id;
      await this.setRemoteState(current, snapshot);
      if (!namespaceSnapshotMatches(this, snapshot)) return { removed, stale: true };
    }
    assertNamespaceSnapshot(this, snapshot);
    this.householdMappings = nextMappings;
    this.cache = nextCache;
    this.saveCache();
    return { removed, stale: false };
  }

  async sync({ direction = 'auto', state = null, householdMappings = this.householdMappings, trigger = 'manual' } = {}) {
    if (!this.user || !this.client) return { status: 'signed_out', message: 'Inicia sesión para sincronizar.' };
    if (!this.cache) this.cache = emptyCloudCache(this.user.id);
    const snapshot = captureNamespaceSnapshot(this);
    let localState = cloneJson(state ?? this.currentAppState());
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    let remote;
    try {
      remote = remoteWithCanonicalHouseholdNames(await this.fetchRemoteRecords(snapshot));
    } catch (error) {
      if (isStaleNamespaceError(error)) return { status: 'stale' };
      throw error;
    }
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    this.remote = remote;
    this.memberships = cloneJson(remote.memberships || []);
    this.state.memberships = cloneJson(this.memberships);
    this.cache.memberships = cloneJson(this.memberships);
    const cleanup = await this.cleanupRevokedMemberships(remote, snapshot);
    if (cleanup.stale || !namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };

    // No reconstruir desde el estado anterior a cleanup: eso volvería a
    // introducir un hogar revocado si hubo otra modificación remota.
    localState = cloneJson(state ?? this.currentAppState());
    const removedLocalIds = new Set(cleanup.removed || []);
    if (removedLocalIds.size && Array.isArray(localState.households)) {
      localState.households = localState.households.filter((home) => !removedLocalIds.has(String(home?.id)));
      if (localState.activeHousehold && removedLocalIds.has(String(localState.activeHousehold))) {
        localState.activeHousehold = localState.households[0]?.id ?? null;
      }
    }
    const visibleLocalState = cloneJson(localState);
    const effectiveMappings = { ...this.householdMappings, ...householdMappings };
    for (const [localId, remoteId] of Object.entries(effectiveMappings)) {
      if (!remote.memberships.some((membership) => String(membership?.household_id) === String(remoteId))) delete effectiveMappings[localId];
    }
    localState = stateWithCanonicalHouseholdNames(localState, remote.memberships, effectiveMappings);
    this.cache = cacheWithCanonicalHouseholdNames(this.cache, remote.memberships);
    const previousCache = cacheWithCanonicalHouseholdNames(cloneCloudCache(this.cache, snapshot.accountId), remote.memberships);
    const prepared = prepareCloudRecords(localState, effectiveMappings);

    const meaningfulHome = (home) => ['habits', 'pets', 'inventory', 'shopping', 'purchases', 'stores'].some((key) => Array.isArray(home?.[key]) && home[key].length > 0);
    const onlyHomePlaceholder = localState.households?.length === 1 && !meaningfulHome(localState.households[0]);
    const boot = this.remoteHasData(remote) && direction !== 'push' && (!stateHasData(localState) || onlyHomePlaceholder);
    if (boot) {
      const bootstrapped = bootstrapRemoteState(localState, remote, effectiveMappings);
      if (bootstrapped.adopted && namespaceSnapshotMatches(this, snapshot)) {
        const nextMappings = { ...this.householdMappings, ...bootstrapped.mappings };
        const applied = await this.setRemoteState(bootstrapped.state, snapshot);
        if (!applied) return { status: 'stale' };
        if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
        this.householdMappings = nextMappings;
        this.cache.mappings = { ...this.householdMappings };
        const bootRecords = prepareCloudRecords(bootstrapped.state, nextMappings).records;
        for (const record of bootRecords) {
          const remoteRow = record.scope === 'personal' ? remote.personal : remote.households[record.remoteId];
          if (remoteRow) this.adoptRemoteBaseline(record, remoteRow);
        }
        for (const [remoteId, row] of Object.entries(remote.households || {})) if (row) {
          this.cache.households[remoteId] = cloneJson(row);
          this.cache.revisions.households[remoteId] = normalizeRevision(row.revision);
        }
        assertNamespaceSnapshot(this, snapshot);
        this.saveCache();
        this.state.syncStatus = 'synced';
        this.state.message = 'Se adoptó el espacio remoto porque este namespace no tenía datos.';
        this.dispatchCloudUpdated();
        this.render();
        return { status: 'bootstrapped', state: bootstrapped.state, remote, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
      }
    }

    if (direction === 'pull') return { status: 'review', remote, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
    const conflicts = [];
    const saved = [];
    const remoteState = cloneJson(localState);
    const pendingPush = [];
    const localOnly = [];
    for (const record of prepared.records) {
      const remoteRow = record.scope === 'personal' ? remote.personal : remote.households[record.remoteId];
      const oldRevision = record.scope === 'personal' ? normalizeRevision(previousCache.revisions?.personal) : normalizeRevision(previousCache.revisions?.households?.[record.remoteId]);
      const base = record.scope === 'personal' ? previousCache.personal?.data ?? null : previousCache.households?.[record.remoteId]?.data ?? null;
      const localChanged = base ? !equalJson(base, record.data) : recordHasData(record);
      const remoteChanged = Boolean(remoteRow && normalizeRevision(remoteRow.revision) !== oldRevision) || Boolean(remoteRow && !base && oldRevision === 0);
      if (remoteRow && equalJson(rowData(remoteRow), record.data)) {
        this.adoptRemoteBaseline(record, remoteRow);
        continue;
      }
      if (remoteChanged && localChanged) {
        if (!base) {
          conflicts.push({ recordKey: record.recordKey, local: cloneJson(record.data), remote: rowData(remoteRow), base: null, expectedRevision: normalizeRevision(remoteRow?.revision), review: deepMerge3way({ base: null, local: record.data, remote: rowData(remoteRow) }) });
          continue;
        }
        const merged = deepMerge3way({ base, local: record.data, remote: rowData(remoteRow) });
        if (merged.status === 'conflict') {
          conflicts.push({ recordKey: record.recordKey, local: cloneJson(record.data), remote: rowData(remoteRow), base: cloneJson(base), expectedRevision: normalizeRevision(remoteRow?.revision), review: merged });
          continue;
        }
        const mergedRecord = { ...record, data: merged.state };
        pendingPush.push({ record: mergedRecord, expectedRevision: normalizeRevision(remoteRow.revision) });
        Object.assign(remoteState, this.applyRecordToState(remoteState, record, merged.state));
        continue;
      }
      if (remoteChanged && !localChanged) {
        if (remoteRow) Object.assign(remoteState, this.applyRecordToState(remoteState, record, rowData(remoteRow)));
        if (remoteRow) this.adoptRemoteBaseline(record, remoteRow);
        continue;
      }
      if (localChanged) {
        if (!remoteRow && direction !== 'push' && !recordHasData(record)) continue;
        if (!remoteRow && direction !== 'push' && recordHasData(record)) {
          localOnly.push(record.recordKey);
          continue;
        }
        pendingPush.push({ record, expectedRevision: normalizeRevision(remoteRow?.revision) });
      }
    }
    if (conflicts.length) {
      this.cache = previousCache;
      this.conflict = conflicts[0];
      this.state.syncStatus = 'conflict';
      this.state.message = 'Se rechazó el guardado por una revisión concurrente.';
      this.render();
      return { status: 'conflict', conflicts, saved, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
    }
    for (const item of pendingPush) {
      try {
        const result = await this.upsertRecord(item.record, item.expectedRevision, snapshot);
        saved.push(result);
      } catch (error) {
        if (isStaleNamespaceError(error)) return { status: 'stale' };
        if (isConflictError(error)) {
          if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
          this.cache = previousCache;
          let fresh;
          try { fresh = remoteWithCanonicalHouseholdNames(await this.fetchRemoteRecords(snapshot)); } catch (freshError) {
            if (isStaleNamespaceError(freshError)) return { status: 'stale' };
            fresh = remote;
          }
          if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
          this.conflict = { recordKey: item.record.recordKey, local: cloneJson(item.record.data), remote: rowData(item.record.scope === 'personal' ? fresh.personal : fresh.households[item.record.remoteId]), base: this.previousData(item.record), expectedRevision: normalizeRevision(item.expectedRevision), error };
          this.state.syncStatus = 'conflict';
          this.state.message = 'Se rechazó el guardado por una revisión concurrente.';
          this.render();
          return { status: 'conflict', conflicts: [this.conflict], saved, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
        }
        throw error;
      }
    }
    if (!equalJson(remoteState, visibleLocalState)) {
      if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
      const applied = await this.setRemoteState(remoteState, snapshot);
      if (!applied || !namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
      this.dispatchCloudUpdated();
    }
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    this.cache.savedAt = new Date().toISOString();
    this.saveCache();
    if (localOnly.length) {
      this.state.syncStatus = 'review';
      this.state.message = 'Hay datos locales sin publicar. Confirma importFromLocal para conservarlos y después decide qué sincronizar.';
    } else {
      this.state.syncStatus = prepared.unmappedLocalHouseholds.length ? 'partial' : 'synced';
      this.state.message = prepared.unmappedLocalHouseholds.length ? 'Datos sincronizados; hay hogares locales sin vincular.' : `Sincronizado (${trigger}).`;
    }
    this.conflict = null;
    this.render();
    return { status: localOnly.length ? 'review' : 'synced', saved, localOnly, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds, remote };
  }

  async refresh(options = {}) { return this.sync({ direction: 'auto', ...options }); }

  async importRemoteState({ confirm = false, householdMappings = this.householdMappings } = {}) {
    if (!this.user || !this.client) return { status: 'signed_out' };
    const snapshot = captureNamespaceSnapshot(this);
    const remote = this.remote ?? await this.fetchRemoteRecords(snapshot);
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    const current = this.currentAppState();
    const preview = applyRemoteBlobs(current, remote, householdMappings);
    if (!confirm) return { status: 'confirmation_required', ...preview };
    if (preview.unmappedRemoteHouseholds.length) return { status: 'mapping_required', ...preview };
    if (!(await this.setRemoteState(preview.state, snapshot))) return { status: 'stale' };
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    for (const record of prepareCloudRecords(preview.state, householdMappings).records) {
      const row = record.scope === 'personal' ? remote.personal : remote.households[record.remoteId];
      if (row) this.adoptRemoteBaseline(record, row);
    }
    this.saveCache();
    this.state.syncStatus = 'synced';
    this.state.message = 'Datos remotos importados por confirmación explícita.';
    this.dispatchCloudUpdated();
    this.render();
    return { status: 'imported', state: preview.state };
  }

  async importFromLocal({ confirm = false } = {}) {
    if (!this.user || !this.client) return { status: 'signed_out' };
    const localState = this.localAppState();
    const current = this.currentAppState();
    const imported = importBackup(current, { format: 'wello-backup-v3', data: localState });
    if (!confirm) return { status: 'confirmation_required', state: imported.state, report: imported.report, originalLocalState: localState };
    const snapshot = captureNamespaceSnapshot(this);
    if (!(await this.setRemoteState(imported.state, snapshot))) return { status: 'stale' };
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    // La importación queda local al namespace autenticado: no se publica por
    // este método y los hogares conservan sus ids, por lo que siguen unmapped.
    this.state.syncStatus = 'review';
    this.state.message = 'Datos locales importados para revisión; aún no se publicaron.';
    this.render();
    return { status: 'imported-local', state: imported.state, report: imported.report, unmappedLocalHouseholds: prepareCloudRecords(imported.state, this.householdMappings).unmappedLocalHouseholds };
  }

  async importLocalState(localState, { confirm = false, householdMappings = this.householdMappings } = {}) {
    const preview = prepareCloudRecords(localState, householdMappings);
    if (!confirm) return { status: 'confirmation_required', ...preview };
    return this.sync({ direction: 'push', state: localState, householdMappings });
  }

  setHouseholdMapping(localId, remoteId) {
    const cleanLocalId = String(localId || '').trim();
    if (!cleanLocalId || !isUuid(remoteId)) throw new TypeError('El mapeo requiere un id local y el UUID real del hogar.');
    this.householdMappings = { ...this.householdMappings, [cleanLocalId]: remoteId };
    if (this.cache) this.cache.mappings = { ...this.householdMappings };
    this.saveCache();
    return { ...this.householdMappings };
  }

  async createSharedHousehold(name, { localId = null, confirm = false, expectedSnapshot = null } = {}) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para crear un hogar.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    const cleanName = String(name ?? '').trim();
    if (!cleanName) throw new TypeError('El hogar necesita un nombre.');
    const cleanLocalId = localId == null ? null : String(localId).trim();
    let localState = null;
    let localHome = null;
    if (cleanLocalId) {
      localState = this.localAppState();
      localHome = localState.households?.find((home) => String(home?.id) === cleanLocalId) || this.currentAppState().households?.find((home) => String(home?.id) === cleanLocalId);
      if (!localHome) throw new Error('No se encontró el hogar local elegido.');
    }
    const pending = readPendingAction(this.localStorage, snapshot.accountId, 'create-household');
    const reusable = pending
      && pending.localId === cleanLocalId
      && pending.name === cleanName;
    const operationId = reusable ? pending.operationId : makeFreshOperationId('create-household', `${cleanLocalId ?? ''}:${cleanName}`, 0);
    savePendingAction(this.localStorage, {
      userId: snapshot.accountId,
      action: 'create-household',
      localId: cleanLocalId,
      name: cleanName,
      operationId,
    });
    const { data } = await this.writeRpc('create_household', { p_name: cleanName, p_operation_id: operationId }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const householdId = parseUuidResult(data);
    if (!isUuid(householdId)) throw new Error('Supabase no devolvió el UUID del hogar creado.');
    const pendingPublishOperationId = (reusable && pending?.publishOperationId) || makeFreshOperationId('state-upsert', `household:${householdId}`, 0);
    savePendingAction(this.localStorage, {
      userId: snapshot.accountId,
      action: 'create-household',
      localId: cleanLocalId,
      name: cleanName,
      operationId,
      householdId,
      publishOperationId: pendingPublishOperationId,
    });
    if (!cleanLocalId) {
      this.memberships = [...this.memberships, { id: householdId, name: cleanName, role: 'owner' }];
      this.state.memberships = cloneJson(this.memberships);
      assertNamespaceSnapshot(this, snapshot);
      this.saveCache();
      clearPendingAction(this.localStorage, snapshot.accountId, 'create-household');
      return { id: householdId, homeUuid: householdId, name: cleanName, role: 'owner', requiresExplicitLocalMapping: true };
    }
    const publishedHome = buildHouseholdBlob(localHome, householdId);
    const record = { scope: 'household', recordKey: householdRecordKey(householdId), data: publishedHome, version: CLOUD_STATE_VERSION, localId: householdId, remoteId: householdId };
    const saved = await this.upsertRecord(record, 0, snapshot, pendingPublishOperationId);
    assertNamespaceSnapshot(this, snapshot);
    const current = this.currentAppState();
    const next = cloneJson(current);
    const source = next.households?.find((home) => String(home?.id) === cleanLocalId);
    if (source) {
      source.id = householdId;
      source.name = cleanName;
      if (next.activeHousehold === cleanLocalId) next.activeHousehold = householdId;
    } else {
      next.households = [...(next.households || []), { ...cloneJson(localHome), id: householdId, name: cleanName }];
      if (!next.activeHousehold) next.activeHousehold = householdId;
    }
    next.households = (next.households || []).filter((home, index, list) => index === list.findIndex((item) => item.id === home.id));
    const applied = await this.setRemoteState(next, snapshot);
    if (!applied || !namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    this.householdMappings = { ...this.householdMappings, [cleanLocalId]: householdId, [householdId]: householdId };
    this.memberships = [...this.memberships, { id: householdId, name: cleanName, role: 'owner' }];
    this.state.memberships = cloneJson(this.memberships);
    this.cache.mappings = { ...this.householdMappings };
    this.saveCache();
    clearPendingAction(this.localStorage, snapshot.accountId, 'create-household');
    this.state.syncStatus = 'synced';
    this.render();
    return { id: householdId, homeUuid: householdId, name: cleanName, role: 'owner', localId: cleanLocalId, saved, mapping: { [cleanLocalId]: householdId, [householdId]: householdId } };
  }

  async createHousehold(name) { return this.createSharedHousehold(name); }

  // Aliases de compatibilidad con el módulo de hogares ya desplegado.
  async createShared(name, options = {}) { return this.createSharedHousehold(name, options); }
  getRole(localOrRemoteId) { return this.getHouseholdRole(localOrRemoteId); }

  async renameHousehold(householdId, name, expectedSnapshot = null) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para renombrar un hogar.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const cleanName = String(name ?? '').trim();
    if (!cleanName) throw new TypeError('El hogar necesita un nombre.');
    const role = this.getHouseholdRole(householdId);
    if (role && role !== 'owner') throw new Error('Solo la persona propietaria puede renombrar este hogar.');
    const { data } = await this.writeRpc('rename_household', { p_household_id: householdId, p_name: cleanName }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    this.memberships = this.memberships.map((item) => String(item.id ?? item.household_id) === String(householdId) ? { ...item, id: item.id ?? householdId, name: cleanName } : item);
    this.state.memberships = cloneJson(this.memberships);
    const current = this.currentAppState();
    const next = stateWithCanonicalHouseholdNames(current, this.memberships, this.householdMappings);
    if (!equalJson(current, next)) {
      const applied = await this.setRemoteState(next, snapshot);
      if (!applied || !namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    }
    assertNamespaceSnapshot(this, snapshot);
    this.saveCache();
    this.render();
    return { id: householdId, name: cleanName, data };
  }

  async getMembers(householdId) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para consultar miembros.');
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const { data, error } = await this.client.rpc('list_household_members', { p_household_id: householdId });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : data ? [data] : []).slice(0, MAX_LIST_ROWS);
    return rows.map((row) => ({ user_id: row.user_id, email: row.email ?? '', role: row.role === 'owner' ? 'owner' : 'member', joined_at: row.joined_at ?? null }));
  }

  async removeMember(householdId, userId, expectedSnapshot = null) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para administrar miembros.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    if (!isUuid(householdId) || !userId) throw new TypeError('Hogar o usuario inválido.');
    const { data } = await this.writeRpc('remove_household_member', { p_household_id: householdId, p_user_id: userId }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    return { householdId, userId, removed: data === true || data?.removed === true || data == null };
  }

  async leaveHousehold(householdId, expectedSnapshot = null) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para salir de un hogar.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const { data } = await this.writeRpc('leave_household', { p_household_id: householdId }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const refreshed = await this.refresh({ trigger: 'leave' });
    if (refreshed?.status === 'stale' || isStaleNamespaceError(refreshed)) return { status: 'stale' };
    if (!namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
    return { householdId, left: data === true || data?.left === true || data == null };
  }

  async listInvites(householdId) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para consultar invitaciones.');
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const { data, error } = await this.client.rpc('list_household_invites', { p_household_id: householdId });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : data ? [data] : []).slice(0, MAX_LIST_ROWS);
    return rows.map((row) => ({ id: row.id, household_id: row.household_id ?? householdId, email: row.email ?? '', role: row.role === 'member' ? 'member' : row.role, expires_at: row.expires_at ?? null, consumed_at: row.consumed_at ?? null, revoked_at: row.revoked_at ?? null, created_at: row.created_at ?? null }));
  }

  async createInvite({ householdId, email, expiresAt = null, expectedSnapshot = null } = {}) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para proponer una invitación.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) throw new TypeError('Escribe un correo válido para la propuesta.');
    const { data } = await this.writeRpc('create_household_invite', { p_household_id: householdId, p_email: cleanEmail, p_expires_at: expiresAt }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const invite = firstRow(data) ?? data;
    const token = sanitizeInviteToken(invite?.token);
    const safeInvite = { id: invite?.id, token: token || undefined, expires_at: invite?.expires_at ?? null };
    const url = token && this.location?.origin ? `${callbackUrlFor({ origin: this.location.origin, pathname: this.location.pathname })}#invitacion?token=${token}` : null;
    return { invite: safeInvite, url, proposal: true };
  }

  async revokeInvite(inviteId, expectedSnapshot = null) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para revocar una propuesta.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    const { data } = await this.writeRpc('revoke_household_invite', { p_invite_id: inviteId }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    return { proposal: true, revoked: data === true || data?.revoked === true };
  }

  inviteDestinationFromHash() {
    const hash = sanitizeInviteHash(this.location?.hash || '');
    if (!hash) {
      this.state.pendingInvite = Boolean(this.peekPendingInvite());
      return this.state.pendingInvite ? { status: 'confirmation_required' } : false;
    }
    const token = hash.split('token=')[1] || '';
    savePendingInviteToken(this.sessionStorage, token);
    this.state.pendingInvite = Boolean(this.peekPendingInvite());
    if (this.history?.replaceState && this.location) this.history.replaceState({}, this.document?.title || 'Wello', basePathFor(this.location.pathname));
    this.render();
    return { status: 'confirmation_required' };
  }

  peekPendingInvite() { return pendingInviteToken(this.sessionStorage); }
  getPendingInvite() { return this.peekPendingInvite(); }

  async acceptInvite(token = this.peekPendingInvite(), { explicit = true, expectedSnapshot = null } = {}) {
    const cleanToken = sanitizeInviteToken(token);
    if (!explicit) return { status: 'confirmation_required' };
    if (!cleanToken) throw new TypeError('La invitación no contiene un token válido.');
    if (!this.client || !this.user) throw new Error('Inicia sesión para aceptar una invitación.');
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    if (!this.cache) this.cache = emptyCloudCache(this.user.id);
    const { data } = await this.writeRpc('accept_household_invite', { p_token: cleanToken }, snapshot);
    assertNamespaceSnapshot(this, snapshot);
    const homeUuid = parseUuidResult(data);
    if (!isUuid(homeUuid)) throw new Error('Supabase no devolvió el UUID del hogar invitado.');
    const inviteMappings = { ...this.householdMappings, [homeUuid]: homeUuid };
    const remote = remoteWithCanonicalHouseholdNames(await this.fetchRemoteRecords(snapshot));
    assertNamespaceSnapshot(this, snapshot);
    const current = this.currentAppState();
    const bootstrapped = bootstrapRemoteState(current, remote, inviteMappings);
    if (bootstrapped.adopted || bootstrapped.state.households?.some((home) => String(home.id) === homeUuid)) {
      const applied = await this.setRemoteState(bootstrapped.state, snapshot);
      if (!applied || !namespaceSnapshotMatches(this, snapshot)) return { status: 'stale' };
      this.householdMappings = { ...inviteMappings, ...bootstrapped.mappings };
      const appliedRecords = prepareCloudRecords(bootstrapped.state, this.householdMappings).records;
      const remotePersonal = remote.personal?.data?.personal ?? remote.personal?.data ?? null;
      const personalApplied = Boolean(remotePersonal && equalJson(bootstrapped.state.personal, remotePersonal));
      for (const record of appliedRecords) {
        const row = record.scope === 'personal' ? remote.personal : remote.households[record.remoteId];
        if (!row || record.scope === 'personal' && !personalApplied) continue;
        this.adoptRemoteBaseline(record, row);
      }
    }
    assertNamespaceSnapshot(this, snapshot);
    savePendingInviteToken(this.sessionStorage, '');
    this.state.pendingInvite = false;
    this.memberships = cloneJson(remote.memberships || this.memberships);
    this.state.memberships = cloneJson(this.memberships);
    this.cache.mappings = { ...this.householdMappings };
    this.saveCache();
    this.dispatchCloudUpdated();
    this.render();
    return { homeUuid };
  }

  async resolveConflict(choice, { confirm = false, expectedSnapshot = null } = {}) {
    if (!['remote', 'local'].includes(choice)) throw new TypeError('La resolución debe ser remote o local.');
    if (!confirm) return { status: 'confirmation_required', conflict: cloneJson(this.conflict) };
    if (!this.conflict || !this.user || !this.client) return { status: 'no-conflict' };
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    assertNamespaceSnapshot(this, snapshot);
    const current = this.currentAppState();
    const backup = createAutomaticBackup(this.localStorage, this.user.id, current, this.conflict);
    const fresh = remoteWithCanonicalHouseholdNames(await this.fetchRemoteRecords(snapshot));
    assertNamespaceSnapshot(this, snapshot);
    const recordKey = this.conflict.recordKey;
    const record = recordKey === PERSONAL_RECORD_KEY
      ? { scope: 'personal', recordKey, data: prepareCloudRecords(current, this.householdMappings).records.find((item) => item.scope === 'personal')?.data, localId: null, remoteId: null, version: CLOUD_STATE_VERSION }
      : prepareCloudRecords(current, this.householdMappings).records.find((item) => item.recordKey === recordKey);
    const remoteRow = record?.scope === 'personal' ? fresh.personal : fresh.households[record?.remoteId];
    if (normalizeRevision(remoteRow?.revision) !== normalizeRevision(this.conflict.expectedRevision)) {
      this.conflict = { ...this.conflict, remote: rowData(remoteRow), expectedRevision: normalizeRevision(remoteRow?.revision) };
      this.render();
      return { status: 'conflict', stale: true, backup };
    }
    if (choice === 'remote') {
      if (!remoteRow || !record) return { status: 'conflict', backup };
      const next = this.applyRecordToState(current, record, rowData(remoteRow));
      if (!(await this.setRemoteState(next, snapshot))) return { status: 'stale', backup };
      assertNamespaceSnapshot(this, snapshot);
      this.adoptRemoteBaseline(record, remoteRow);
    } else {
      if (!record) return { status: 'conflict', backup };
      try { await this.upsertRecord(record, normalizeRevision(remoteRow?.revision), snapshot); } catch (error) {
        if (isStaleNamespaceError(error)) return { status: 'stale', backup };
        if (isConflictError(error)) { this.conflict = { ...this.conflict, error }; this.render(); return { status: 'conflict', backup, error }; }
        throw error;
      }
    }
    assertNamespaceSnapshot(this, snapshot);
    this.conflict = null;
    this.state.syncStatus = 'synced';
    this.state.message = choice === 'remote' ? 'Se conservó la versión remota después de crear una copia local.' : 'Se conservó la versión local con CAS actualizado.';
    this.saveCache();
    this.dispatchCloudUpdated();
    this.render();
    return { status: 'resolved', choice, backup };
  }

  recordPurchaseAndInventory({ householdId, inventory, purchase, expectedInventoryRevision = 0, expectedPurchaseRevision = 0, operationId, expectedSnapshot = null } = {}) {
    if (!this.client || !this.user) return Promise.reject(new Error('Inicia sesión para guardar una compra compartida.'));
    if (!isUuid(householdId)) return Promise.reject(new TypeError('El hogar debe ser un UUID de membresía.'));
    const snapshot = expectedSnapshot ?? captureNamespaceSnapshot(this);
    try { assertNamespaceSnapshot(this, snapshot); } catch (error) { return Promise.reject(error); }
    const operation = operationId || makeFreshOperationId('purchase-inventory', householdId, Math.max(expectedInventoryRevision, expectedPurchaseRevision));
    return this.writeRpc('record_purchase_and_inventory', { p_household_id: householdId, p_inventory_data: inventory ?? {}, p_purchase_data: purchase ?? {}, p_expected_inventory_revision: expectedInventoryRevision, p_expected_purchase_revision: expectedPurchaseRevision, p_operation_id: operation }, snapshot)
      .then(({ data }) => ({ atomic: true, idempotent: true, data }));
  }

  consumeNfcDestination() {
    const current = sanitizeNfcHash(this.location?.hash || '');
    const pending = takePendingNfcHash(this.sessionStorage);
    const destination = current || pending;
    if (destination !== '#super?accion=agregar') return false;
    const base = basePathFor(this.location?.pathname || '/');
    try {
      if (typeof this.app?.openSuper === 'function') this.app.openSuper();
      else this.app?.navigate?.('alimentos');
    } finally {
      if (this.history?.replaceState) this.history.replaceState({}, this.document?.title || 'Wello', `${base}#alimentos`);
    }
    return true;
  }

  dispatchCloudUpdated() {
    try {
      const EventCtor = this.globalObject?.CustomEvent ?? globalThis.CustomEvent;
      this.globalObject?.dispatchEvent?.(new EventCtor('wello:cloud-updated', { detail: { accountId: this.user?.id ?? null, memberships: cloneJson(this.memberships) } }));
    } catch { /* eventos de UI son opcionales en pruebas */ }
  }

  isAuthenticated() { return Boolean(this.user && this.state.status === 'signed_in'); }

  getState() {
    return {
      ...cloneJson(this.state),
      user: this.user ? { ...this.user } : null,
      memberships: cloneJson(this.memberships),
      pendingInvite: Boolean(this.peekPendingInvite()),
      config: { ...this.configResult, config: { ...this.configResult.config } },
    };
  }

  destroy() {
    this.generation += 1;
    this.syncLoop.stop();
    try { this.subscription?.unsubscribe?.(); } catch { /* noop */ }
    this.subscription = null;
    this.root?.remove?.();
    this.root = null;
    this.initialized = false;
  }
}

export function installWelloCloud(options = {}) {
  const cloud = new WelloCloudController(options);
  const globalObject = browserGlobal();
  if (globalObject) globalObject.WelloCloud = cloud;
  void cloud.init();
  return cloud;
}

// La variante online se incluye después del bundle de la app. El HTML local
// no importa este módulo, por lo que nunca carga el SDK ni abre este panel.
if (typeof window !== 'undefined' && window.WelloApp && !window.WelloCloud) installWelloCloud();
