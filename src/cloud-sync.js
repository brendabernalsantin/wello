import { accountNamespace, cacheStorageKey, cloneJson, stableStringify } from './cloud-domain.js';

export const CLOUD_SYNC_DEBOUNCE_MS = 450;
export const CLOUD_SYNC_INTERVAL_MS = 15_000;
export const CLOUD_CONFLICT_BACKUP_PREFIX = 'wello:cloud-conflict-backup:';

function browserGlobal() {
  return typeof window !== 'undefined' ? window : null;
}

function visible(documentObject) {
  return !documentObject || documentObject.visibilityState === 'visible' || documentObject.hidden !== true;
}

function online(globalObject) {
  return !globalObject?.navigator || globalObject.navigator.onLine !== false;
}

/** Snapshot mínimo que debe seguir siendo válido antes de tocar el namespace. */
export function captureNamespaceSnapshot(controller) {
  const app = controller?.app;
  let namespace = null;
  try { namespace = app?.getNamespace?.() ?? null; } catch { namespace = null; }
  return {
    generation: Number(controller?.generation ?? 0),
    accountId: controller?.user?.id ?? null,
    namespace,
  };
}

export function namespaceSnapshotMatches(controller, snapshot) {
  if (!snapshot || !controller) return false;
  const current = captureNamespaceSnapshot(controller);
  const namespaceMatches = snapshot.namespace == null ? current.namespace == null : current.namespace === snapshot.namespace;
  return current.generation === snapshot.generation
    && current.accountId === snapshot.accountId
    && namespaceMatches;
}

/**
 * Guarda una copia JSON antes de cualquier resolución destructiva. Se escribe
 * con una clave por cuenta y timestamp; nunca altera el estado de la app.
 */
export function createAutomaticBackup(storage, userId, state, conflict = null) {
  const normalized = String(userId ?? '').trim();
  if (!storage || !normalized) return null;
  const savedAt = new Date().toISOString();
  const key = `${CLOUD_CONFLICT_BACKUP_PREFIX}${encodeURIComponent(normalized)}:${Date.now()}`;
  const payload = { version: 1, savedAt, userId: normalized, state: cloneJson(state), conflict: cloneJson(conflict) };
  try { storage.setItem(key, JSON.stringify(payload)); } catch { return null; }
  return { key, savedAt, payload };
}

export function latestAutomaticBackupKey(storage, userId) {
  if (!storage || !userId) return null;
  const prefix = `${CLOUD_CONFLICT_BACKUP_PREFIX}${encodeURIComponent(String(userId))}:`;
  let latest = null;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && (!latest || key > latest)) latest = key;
    }
  } catch { return null; }
  return latest;
}

/**
 * Escucha cambios locales, visibilidad, foco y conectividad. Solo arranca
 * cuando el controlador está autenticado; al cerrar sesión se detiene y
 * cancela todos los timers para que el modo local nunca publique datos.
 */
export class CloudSyncCoordinator {
  constructor(controller, options = {}) {
    this.controller = controller;
    this.eventTarget = options.eventTarget ?? browserGlobal();
    this.document = options.document ?? this.eventTarget?.document ?? null;
    this.debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : CLOUD_SYNC_DEBOUNCE_MS;
    this.intervalMs = Number.isFinite(options.intervalMs) ? Math.max(1000, options.intervalMs) : CLOUD_SYNC_INTERVAL_MS;
    this.started = false;
    this.timer = null;
    this.interval = null;
    this.running = false;
    this.pending = false;
    this.listeners = [];
  }

  listen(type, handler, target = this.eventTarget) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    this.listeners.push(() => target.removeEventListener?.(type, handler));
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.listen('wello:changed', (event) => {
      const namespace = event?.detail?.namespace;
      if (namespace && namespace !== this.currentNamespace()) return;
      this.schedule('changed', this.debounceMs);
    });
    this.listen('visibilitychange', () => {
      if (visible(this.document)) this.schedule('visible', 0);
    }, this.document);
    this.listen('focus', () => this.schedule('focus', 0));
    this.listen('online', () => this.schedule('online', 0));
    this.interval = setInterval(() => {
      if (visible(this.document) && online(this.eventTarget)) this.schedule('timer', 0);
    }, this.intervalMs);
    // Un intervalo de respaldo no debe impedir que terminen pruebas o una
    // página estática; en el navegador continúa activo normalmente.
    this.interval?.unref?.();
    return this;
  }

  stop() {
    this.started = false;
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
    for (const remove of this.listeners.splice(0)) remove();
    return this;
  }

  currentNamespace() {
    try { return this.controller?.app?.getNamespace?.() ?? null; } catch { return null; }
  }

  schedule(reason = 'manual', delay = 0) {
    if (!this.started || !this.controller?.isAuthenticated?.()) return Promise.resolve({ status: 'signed_out' });
    if (!visible(this.document) || !online(this.eventTarget)) return Promise.resolve({ status: 'offline' });
    if (this.timer) clearTimeout(this.timer);
    return new Promise((resolve) => {
      this.timer = setTimeout(async () => {
        this.timer = null;
        resolve(await this.run(reason));
      }, Math.max(0, delay));
    });
  }

  async run(reason = 'manual') {
    if (!this.started || !this.controller?.isAuthenticated?.()) return { status: 'signed_out' };
    if (this.running) {
      this.pending = true;
      return { status: 'queued' };
    }
    this.running = true;
    try {
      return await this.controller.sync({ direction: 'auto', trigger: reason, fromCoordinator: true });
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        void this.schedule('queued', 0);
      }
    }
  }
}

export function createCloudSyncCoordinator(controller, options = {}) {
  return new CloudSyncCoordinator(controller, options);
}

/** Evita reportar cambios remotos como una edición local. */
export function changedStateFingerprint(state) {
  return stableStringify(state);
}

// Mantener este import visible para consumidores que ya calculan el namespace
// o la clave de cache desde el módulo de coordinación.
export { accountNamespace, cacheStorageKey };
