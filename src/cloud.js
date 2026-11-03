import { createClient } from '@supabase/supabase-js';
import {
  CLOUD_STATE_VERSION,
  PERSONAL_RECORD_KEY,
  accountNamespace,
  applyRemoteBlobs,
  basePathFor,
  cacheStorageKey,
  canonicalRecordFromRow,
  callbackUrlFor,
  emptyCloudCache,
  householdRecordKey,
  isConflictError,
  isUuid,
  makeIdempotencyKey,
  mergeForReview,
  normalizeRevision,
  prepareCloudRecords,
  sanitizeNfcHash,
  savePendingNfcHash,
  stableStringify,
  takePendingNfcHash,
} from './cloud-domain.js';

export * from './cloud-domain.js';

const PRIVILEGED_KEY_RE = /service_role|sb_secret_/i;
const JWT_ROLE_RE = /"role"\s*:\s*"(service_role|supabase_admin|dashboard_user)"/i;
const PUBLISHABLE_KEY_RE = /^sb_publishable_[A-Za-z0-9._-]+$/;
const LOGGED_OUT_NAMESPACE = 'cloud:logged-out';
const DEFAULT_CONFIG = Object.freeze({ url: '', key: '', mode: 'preview' });

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
    const decoded = typeof atob === 'function'
      ? atob(padded)
      : '';
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

function cloneCloudCache(cache, userId) {
  const fallback = emptyCloudCache(userId);
  const source = cache && typeof cache === 'object' ? cache : {};
  return {
    ...fallback,
    ...source,
    userId,
    namespace: accountNamespace(userId),
    personal: source.personal ? { ...source.personal } : null,
    households: { ...(source.households || {}) },
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
  if (state.status === 'signed_in') return `Cuenta: ${state.email || 'usuario autenticado'}. ${state.syncStatus === 'synced' ? 'Sincronizado con esta cuenta.' : state.syncStatus === 'partial' ? 'Datos personales sincronizados; los hogares sin vincular siguen guardados solo en este dispositivo.' : state.syncStatus === 'conflict' ? 'Hay una edición concurrente; la versión local se conserva para revisión.' : state.syncStatus === 'review' ? 'Hay datos remotos para revisión explícita.' : 'Guardado en este dispositivo. Los datos remotos no se aplican automáticamente.'}`;
  if (state.status === 'signing_in') return 'Google devolverá la sesión a la ruta base de Pages. El destino NFC pendiente se conserva de forma temporal y segura.';
  if (state.syncStatus === 'conflict') return 'Hay una edición concurrente. Se conservaron los datos locales; revisa antes de volver a intentar.';
  if (state.syncStatus === 'review') return 'Hay datos remotos disponibles. Revisa e importa de forma explícita; no se reemplazó el estado local.';
  if (state.syncStatus === 'synced') return 'Sincronizado con la cuenta seleccionada.';
  return 'Puedes trabajar sin cuenta en modo local o iniciar sesión cuando exista configuración pública.';
}

export class WelloCloudController {
  constructor(options = {}) {
    const globalObject = browserGlobal();
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
    this.remote = null;
    this.conflict = null;
    this.state = {
      status: this.configResult.ok ? 'checking' : this.configResult.reason === 'missing' ? 'missing_config' : 'invalid_config',
      message: this.configResult.message,
      accountId: null,
      email: '',
      namespace: null,
      syncStatus: 'not-synced',
    };
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
        auth: {
          flowType: 'pkce',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      });
      this.subscription = this.client.auth.onAuthStateChange((event, session) => {
        // El SDK puede emitir dentro de su propio lock: posponer trabajo que
        // llama a otras APIs de auth para evitar una reentrada.
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
        try {
          void Promise.resolve(operation()).catch((error) => this.handleActionError(error));
        } catch (error) {
          this.handleActionError(error);
        }
      };
      if (action === 'open') run(() => this.open());
      if (action === 'close') run(() => this.close());
      if (action === 'google') run(() => this.signInWithGoogle());
      if (action === 'local') run(() => this.enterLocalMode());
      if (action === 'signout') run(() => this.signOut());
      if (action === 'sync') run(() => this.sync());
      if (action === 'import') run(() => this.importRemoteState({ confirm: true }));
      if (action === 'nfc') run(() => this.consumeNfcDestination());
    });
    this.ensureStyles();
  }

  handleActionError(error) {
    const message = error?.message || 'No se pudo completar la acción.';
    this.state = { ...this.state, status: 'error', message };
    this.render();
    try { this.app?.toast?.(message); } catch { /* el aviso visual es opcional */ }
  }

  ensureStyles() {
    if (!this.document?.head || this.document.getElementById('wello-cloud-styles')) return;
    const style = this.document.createElement('style');
    style.id = 'wello-cloud-styles';
    style.textContent = `
      #wello-cloud-root{font-family:inherit;position:relative;z-index:1000}
      .wello-cloud-toggle{position:fixed;right:1rem;bottom:1rem;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#283541;padding:.65rem .85rem;box-shadow:0 8px 24px #28354122;cursor:pointer;font:inherit;font-weight:700}
      .wello-cloud-panel{position:fixed;right:1rem;bottom:1rem;width:min(22rem,calc(100vw - 2rem));max-height:min(42rem,calc(100vh - 2rem));overflow:auto;background:#fff;color:#283541;border:1px solid #d9e2ec;border-radius:1.25rem;box-shadow:0 18px 54px #28354133;padding:1rem}
      .wello-cloud-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.wello-cloud-head h2{font-size:1.05rem;margin:0}.wello-cloud-close{border:0;background:transparent;font-size:1.25rem;cursor:pointer;color:inherit}
      .wello-cloud-banner{border-radius:.85rem;background:#f5f7fa;padding:.75rem;margin:.9rem 0}.wello-cloud-banner strong{display:block;margin-bottom:.3rem}.wello-cloud-muted{color:#5c6b78;font-size:.88rem;line-height:1.4}.wello-cloud-actions{display:grid;gap:.55rem;margin-top:.9rem}.wello-cloud-actions button{width:100%;border:1px solid #b8c5d0;border-radius:.7rem;background:#fff;color:#283541;padding:.65rem .75rem;cursor:pointer;font:inherit;font-weight:700}.wello-cloud-actions button[data-wello-cloud-action=google]{background:#48cfad;border-color:#48cfad}.wello-cloud-actions button:disabled{opacity:.52;cursor:not-allowed}.wello-cloud-note{font-size:.8rem;color:#657481;margin:.8rem 0 0;line-height:1.4}.wello-cloud-error{color:#9b2c2c}.wello-cloud-conflict{background:#fff4e5;border:1px solid #f2c078;border-radius:.75rem;padding:.65rem;font-size:.85rem;line-height:1.35}
    `;
    style.textContent += '@media(max-width:800px){.wello-cloud-toggle,.wello-cloud-panel{bottom:calc(80px + env(safe-area-inset-bottom))}.wello-cloud-panel{max-height:calc(100dvh - 160px)}}';
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
    const errorClass = this.state.status === 'error' || !configured ? 'wello-cloud-error' : '';
    this.root.innerHTML = `
      <aside class="wello-cloud-panel" aria-label="Cuenta en línea de Wello">
        <div class="wello-cloud-head"><h2>Cuenta en línea</h2><button type="button" class="wello-cloud-close" data-wello-cloud-action="close" aria-label="Cerrar">×</button></div>
        <div class="wello-cloud-banner ${errorClass}"><strong>${escapeHtml(statusLabel(this.state))}</strong><span class="wello-cloud-muted">${escapeHtml(statusDetail(this.state))}</span></div>
        ${this.state.syncStatus === 'conflict' ? `<div class="wello-cloud-conflict">Conflicto en <code>${escapeHtml(this.conflict?.recordKey || 'registro')}</code>. No se aplicó la versión remota ni se borró la local. Usa la revisión explícita antes de reintentar.</div>` : ''}
        ${signedIn ? `
          <div class="wello-cloud-actions">
            <button type="button" data-wello-cloud-action="sync">Sincronizar ahora</button>
            ${this.state.syncStatus === 'review' ? '<button type="button" data-wello-cloud-action="import">Revisar e importar datos remotos</button>' : ''}
            <button type="button" data-wello-cloud-action="nfc">Abrir acceso directo del súper</button>
            <button type="button" data-wello-cloud-action="local">Cambiar a modo local</button>
            <button type="button" data-wello-cloud-action="signout">Cerrar sesión</button>
          </div>
          <p class="wello-cloud-note">El hogar de la nube se identifica con un UUID de membresía. Un ID local no concede acceso y no se importa automáticamente.</p>
        ` : `
          <div class="wello-cloud-actions">
            <button type="button" data-wello-cloud-action="google" ${disabledGoogle ? 'disabled' : ''}>Continuar con Google</button>
            <button type="button" data-wello-cloud-action="local">Continuar en modo local</button>
          </div>
          <p class="wello-cloud-note">Google usa el SDK oficial de Supabase con PKCE. ${configured ? 'La configuración pública está presente.' : 'El botón de Google permanece deshabilitado porque falta configuración pública.'}</p>
        `}
      </aside>`;
  }

  open() { this.opened = true; this.render(); }
  close() { this.opened = false; this.render(); }

  async clearAuthenticatedView(message = 'Sesión cerrada.') {
    const oldUserId = this.user?.id;
    if (oldUserId) {
      try { this.localStorage?.removeItem(cacheStorageKey(oldUserId)); } catch { /* storage bloqueado */ }
    }
    // Un namespace único y vacío evita que una sesión expirada/revocada vea
    // la memoria de la cuenta anterior; WelloApp carga este namespace de forma atómica.
    try { await this.app?.switchNamespace?.(LOGGED_OUT_NAMESPACE); } catch { /* app opcional */ }
    this.user = null;
    this.remote = null;
    this.cache = null;
    this.conflict = null;
    this.state = { ...this.state, status: 'signed_out', accountId: null, email: '', namespace: null, syncStatus: 'not-synced', message };
    this.render();
  }

  async handleSession(event, session) {
    const nextUser = userFromSession(session);
    if (!nextUser) {
      await this.clearAuthenticatedView(event === 'SIGNED_OUT' ? 'Sesión cerrada.' : 'Sesión expirada o revocada. Los datos autenticados quedaron ocultos.');
      return;
    }
    const changedAccount = Boolean(this.user?.id && this.user.id !== nextUser.id);
    const namespace = accountNamespace(nextUser.id);
    this.user = nextUser;
    this.state = { ...this.state, status: 'signed_in', accountId: nextUser.id, email: nextUser.email, namespace, message: 'Cuenta conectada.' };
    this.cache = this.readCache(nextUser.id);
    if (changedAccount) {
      this.remote = null;
      this.conflict = null;
      this.state.syncStatus = 'not-synced';
    }
    let appNamespace;
    const canReadNamespace = typeof this.app?.getNamespace === 'function';
    try { if (canReadNamespace) appNamespace = this.app.getNamespace(); } catch { appNamespace = null; }
    const shouldSwitchNamespace = changedAccount
      || event === 'INITIAL_SESSION'
      || event === 'SIGNED_IN'
      || canReadNamespace && appNamespace !== namespace;
    // Cambiar el namespace es explícito para la cuenta; los refresh de token
    // no cierran formularios si la app ya está en el namespace correcto.
    if (shouldSwitchNamespace) {
      try { await this.app?.switchNamespace?.(namespace); } catch { /* la app puede no exponer persistencia en preview */ }
    }
    this.render();
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') this.consumeNfcDestination();
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
    this.state.status = 'signing_in';
    this.state.message = 'Abriendo Google…';
    this.render();
    try {
      const redirectTo = callbackUrlFor({ origin: this.location?.origin, pathname: this.location?.pathname });
      const result = await this.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
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
    try { if (this.client) await this.client.auth.signOut(); } catch (error) {
      this.state.message = error?.message || 'No se pudo cerrar la sesión remota.';
    }
    await this.clearAuthenticatedView('Sesión cerrada. No se muestran datos de otra cuenta.');
  }

  enterLocalMode() {
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
      return { ...fallback, ...parsed, revisions: { ...fallback.revisions, ...(parsed.revisions || {}) } };
    } catch { return fallback; }
  }

  saveCache() {
    if (!this.user?.id || !this.cache) return;
    this.cache.savedAt = new Date().toISOString();
    try { this.localStorage?.setItem(cacheStorageKey(this.user.id), JSON.stringify(this.cache)); } catch { /* no impedir sync remoto */ }
  }

  async query(builder) {
    const { data, error } = await builder;
    if (error) throw error;
    return data ?? [];
  }

  async fetchRemoteRecords() {
    if (!this.client || !this.user) throw new Error('Se requiere una sesión para consultar datos remotos.');
    const privateRows = await this.query(this.client.from('private_records').select('record_key,data,version,revision,updated_at').eq('user_id', this.user.id).eq('record_key', PERSONAL_RECORD_KEY).limit(1));
    const memberships = await this.query(this.client.from('household_members').select('household_id,role').eq('user_id', this.user.id));
    const householdIds = memberships.map((item) => item.household_id).filter((id) => isUuid(id));
    let householdRows = [];
    if (householdIds.length) {
      householdRows = await this.query(this.client.from('household_records').select('household_id,record_key,data,version,revision,updated_at').in('household_id', householdIds));
    }
    const households = {};
    for (const row of householdRows) {
      if (row?.household_id && row?.record_key === householdRecordKey(row.household_id)) {
        households[row.household_id] = canonicalRecordFromRow(row);
      }
    }
    return {
      personal: canonicalRecordFromRow(firstRow(privateRows)),
      households,
      memberships,
    };
  }

  remoteHasData(remote) {
    return Boolean(remote?.personal?.data?.personal && stateHasData({ personal: remote.personal.data.personal })) || Object.keys(remote?.households || {}).length > 0;
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
      this.cache.personal = remoteRow;
      this.cache.revisions.personal = normalizeRevision(remoteRow.revision);
    } else {
      this.cache.households[record.remoteId] = remoteRow;
      this.cache.revisions.households[record.remoteId] = normalizeRevision(remoteRow.revision);
    }
  }

  async upsertRecord(record, expectedRevision) {
    const subject = record.scope === 'personal' ? this.user.id : record.remoteId;
    const operationId = makeIdempotencyKey('state-upsert', `${record.recordKey}:${stableStringify(record.data)}`);
    const params = {
      p_record_key: record.recordKey,
      p_data: record.data,
      p_version: record.version ?? CLOUD_STATE_VERSION,
      p_expected_revision: expectedRevision,
      p_operation_id: operationId,
    };
    const result = record.scope === 'personal'
      ? await this.client.rpc('upsert_private_record', params)
      : await this.client.rpc('upsert_household_record', { ...params, p_household_id: record.remoteId });
    if (result.error) throw result.error;
    const row = firstRow(result.data);
    const revision = normalizeRevision(row?.revision ?? expectedRevision + 1);
    if (record.scope === 'personal') {
      this.cache.personal = { recordKey: record.recordKey, data: record.data, version: record.version, revision };
      this.cache.revisions.personal = revision;
    } else {
      this.cache.households[record.remoteId] = { recordKey: record.recordKey, data: record.data, version: record.version, revision };
      this.cache.revisions.households[record.remoteId] = revision;
    }
    return { ...record, revision };
  }

  async sync({ direction = 'auto', state = null, householdMappings = this.householdMappings } = {}) {
    if (!this.user || !this.client) return { status: 'signed_out', message: 'Inicia sesión para sincronizar.' };
    const localState = state ?? this.app?.getState?.() ?? {};
    const prepared = prepareCloudRecords(localState, householdMappings);
    const previousCache = cloneCloudCache(this.cache, this.user.id);
    const remote = await this.fetchRemoteRecords();
    this.remote = remote;

    if (direction === 'pull' || (direction === 'auto' && this.remoteHasData(remote) && !stateHasData(localState))) {
      this.state.syncStatus = 'review';
      this.state.message = 'Hay datos remotos disponibles para revisión.';
      this.render();
      return { status: 'review', remote, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
    }
    if (direction === 'pull') return { status: 'review', remote };

    // Se trabaja sobre una copia: previousCache conserva las revisiones CAS
    // confiables y nunca se sustituye por el snapshot remoto antes de resolver.
    this.cache = cloneCloudCache(previousCache, this.user.id);
    const conflicts = [];
    const saved = [];
    for (const record of prepared.records) {
      const remoteRow = record.scope === 'personal' ? remote.personal : remote.households[record.remoteId];
      const oldRevision = record.scope === 'personal'
        ? normalizeRevision(previousCache.revisions?.personal)
        : normalizeRevision(previousCache.revisions?.households?.[record.remoteId]);
      if (remoteRow && stableStringify(rowData(remoteRow)) === stableStringify(record.data)) {
        this.adoptRemoteBaseline(record, remoteRow);
        continue;
      }
      if (remoteRow && oldRevision !== normalizeRevision(remoteRow.revision)) {
        conflicts.push({
          recordKey: record.recordKey,
          local: record.data,
          remote: rowData(remoteRow),
          base: record.scope === 'personal' ? previousCache.personal?.data : previousCache.households?.[record.remoteId]?.data,
          review: mergeForReview({ base: record.scope === 'personal' ? previousCache.personal?.data : previousCache.households?.[record.remoteId]?.data, local: record.data, remote: rowData(remoteRow) }),
        });
        continue;
      }
      try {
        saved.push(await this.upsertRecord(record, remoteRow ? normalizeRevision(remoteRow.revision) : 0));
      } catch (error) {
        if (isConflictError(error)) {
          conflicts.push({ recordKey: record.recordKey, local: record.data, remote: rowData(remoteRow), error });
          continue;
        }
        throw error;
      }
    }
    if (conflicts.length) {
      this.conflict = conflicts[0];
      this.state.syncStatus = 'conflict';
      this.state.message = 'Se rechazó el guardado por una revisión concurrente.';
      this.render();
      return { status: 'conflict', conflicts, saved, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
    }
    this.cache.savedAt = new Date().toISOString();
    this.saveCache();
    this.state.syncStatus = prepared.unmappedLocalHouseholds.length ? 'partial' : 'synced';
    this.state.message = prepared.unmappedLocalHouseholds.length ? 'Datos personales sincronizados; hay hogares locales sin vincular.' : 'Sincronizado de forma explícita.';
    this.render();
    return { status: 'synced', saved, unmappedLocalHouseholds: prepared.unmappedLocalHouseholds };
  }

  async importRemoteState({ confirm = false, householdMappings = this.householdMappings } = {}) {
    if (!this.user || !this.client) return { status: 'signed_out' };
    const remote = this.remote ?? await this.fetchRemoteRecords();
    const current = this.app?.getState?.() ?? {};
    const preview = applyRemoteBlobs(current, remote, householdMappings);
    if (!confirm) return { status: 'confirmation_required', ...preview };
    if (preview.unmappedRemoteHouseholds.length) return { status: 'mapping_required', ...preview };
    await this.app?.setState?.(preview.state);
    this.state.syncStatus = 'synced';
    this.state.message = 'Datos remotos importados por confirmación explícita.';
    this.render();
    return { status: 'imported', state: preview.state };
  }

  async importLocalState(localState, { confirm = false, householdMappings = this.householdMappings } = {}) {
    const preview = prepareCloudRecords(localState, householdMappings);
    if (!confirm) return { status: 'confirmation_required', ...preview };
    return this.sync({ direction: 'push', state: localState, householdMappings });
  }

  setHouseholdMapping(localId, remoteId) {
    if (!String(localId || '').trim() || !isUuid(remoteId)) throw new TypeError('El mapeo requiere un id local y el UUID real del hogar.');
    this.householdMappings = { ...this.householdMappings, [String(localId).trim()]: remoteId };
    return { ...this.householdMappings };
  }

  isAuthenticated() {
    return Boolean(this.user && this.state.status === 'signed_in');
  }

  async createHousehold(name) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para crear un hogar.');
    const cleanName = String(name ?? '').trim();
    if (!cleanName) throw new TypeError('El hogar necesita un nombre.');
    const { data, error } = await this.client.rpc('create_household', { p_name: cleanName });
    if (error) throw error;
    const householdId = typeof data === 'string' ? data : firstRow(data)?.id ?? firstRow(data);
    if (!isUuid(householdId)) throw new Error('Supabase no devolvió el UUID del hogar creado.');
    return { id: householdId, name: cleanName, requiresExplicitLocalMapping: true };
  }

  async createInvite({ householdId, email, expiresAt = null } = {}) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para proponer una invitación.');
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) throw new TypeError('Escribe un correo válido para la propuesta.');
    const { data, error } = await this.client.rpc('create_household_invite', { p_household_id: householdId, p_email: cleanEmail, p_expires_at: expiresAt });
    if (error) throw error;
    return { proposal: true, invite: firstRow(data) ?? data, note: 'La migración no envía correos; la entrega externa requiere una decisión y proveedor.' };
  }

  async revokeInvite(inviteId) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para revocar una propuesta.');
    const { data, error } = await this.client.rpc('revoke_household_invite', { p_invite_id: inviteId });
    if (error) throw error;
    return { proposal: true, revoked: data === true || data?.revoked === true };
  }

  async recordPurchaseAndInventory({ householdId, inventory, purchase, expectedInventoryRevision = 0, expectedPurchaseRevision = 0, operationId } = {}) {
    if (!this.client || !this.user) throw new Error('Inicia sesión para guardar una compra compartida.');
    if (!isUuid(householdId)) throw new TypeError('El hogar debe ser un UUID de membresía.');
    const operation = operationId || makeIdempotencyKey('purchase-inventory', `${householdId}:${stableStringify({ inventory, purchase })}`);
    const { data, error } = await this.client.rpc('record_purchase_and_inventory', {
      p_household_id: householdId,
      p_inventory_data: inventory ?? {},
      p_purchase_data: purchase ?? {},
      p_expected_inventory_revision: expectedInventoryRevision,
      p_expected_purchase_revision: expectedPurchaseRevision,
      p_operation_id: operation,
    });
    if (error) throw error;
    return { atomic: true, idempotent: true, data };
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

  getState() {
    return { ...this.state, user: this.user ? { ...this.user } : null, config: { ...this.configResult, config: { ...this.configResult.config } } };
  }

  destroy() {
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
