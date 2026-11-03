/**
 * Dominio de la variante en línea de Wello.
 *
 * Este archivo no importa Supabase, no toca el DOM y no lee el almacenamiento
 * local de la aplicación. Sirve para que la integración y sus pruebas sean
 * deterministas aun cuando no exista una cuenta configurada.
 */

export const CLOUD_STATE_VERSION = 3;
export const PERSONAL_RECORD_KEY = 'wello:state:personal';
export const HOUSEHOLD_RECORD_PREFIX = 'wello:state:household:';
export const CACHE_KEY_PREFIX = 'wello:cloud-cache:';
export const PENDING_NFC_KEY = 'wello:pending-nfc-hash';
export const LEGACY_PENDING_NFC_KEY = 'wello:nfc-pending';
export const NFC_HASH = '#super?accion=agregar';
export const DEFAULT_BASE_PATH = '/primera-app/';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_USER_ID_RE = /^[A-Za-z0-9._:@-]{1,256}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

/** JSON determinista para comparar blobs y fabricar claves idempotentes. */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** Digest pequeño, no criptográfico: solo sirve para igualdad/idempotencia local. */
export function stableDigest(value) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeUserId(userId) {
  const value = String(userId ?? '').trim();
  return SAFE_USER_ID_RE.test(value) ? value : null;
}

export function isUuid(value) {
  return UUID_RE.test(String(value ?? '').trim());
}

/** Namespace de la app para una cuenta; nunca utiliza el namespace local. */
export function accountNamespace(userId) {
  const normalized = normalizeUserId(userId);
  if (!normalized) throw new TypeError('La cuenta no tiene un identificador válido.');
  return `cloud:${encodeURIComponent(normalized)}`;
}

export function cacheStorageKey(userId) {
  const normalized = normalizeUserId(userId);
  if (!normalized) throw new TypeError('La cuenta no tiene un identificador válido.');
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(normalized)}`;
}

export function householdRecordKey(householdId) {
  if (!isUuid(householdId)) throw new TypeError('El hogar remoto debe tener un UUID.');
  return `${HOUSEHOLD_RECORD_PREFIX}${householdId}`;
}

export function emptyCloudCache(userId) {
  const normalized = normalizeUserId(userId);
  if (!normalized) throw new TypeError('La cuenta no tiene un identificador válido.');
  return {
    version: CLOUD_STATE_VERSION,
    userId: normalized,
    namespace: accountNamespace(normalized),
    personal: null,
    households: {},
    revisions: { personal: 0, households: {} },
    savedAt: null,
  };
}

export function normalizeRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function buildPersonalBlob(state) {
  const source = isObject(state) ? state : {};
  return {
    version: Number.isInteger(source.version) ? source.version : CLOUD_STATE_VERSION,
    personal: cloneJson(isObject(source.personal) ? source.personal : {}),
  };
}

export function buildHouseholdBlob(household, remoteHouseholdId) {
  if (!isUuid(remoteHouseholdId)) throw new TypeError('Se requiere el UUID del hogar creado en la nube.');
  const source = isObject(household) ? household : {};
  return {
    version: CLOUD_STATE_VERSION,
    household: { ...cloneJson(source), id: remoteHouseholdId },
  };
}

/**
 * Convierte el estado local en registros remotos únicamente para hogares con
 * un mapeo explícito localId -> UUID remoto. Un id local no es autorización.
 */
export function prepareCloudRecords(state, householdMappings = {}) {
  const source = isObject(state) ? state : {};
  const records = [{
    scope: 'personal',
    recordKey: PERSONAL_RECORD_KEY,
    data: buildPersonalBlob(source),
    version: Number.isInteger(source.version) ? source.version : CLOUD_STATE_VERSION,
    localId: null,
    remoteId: null,
  }];
  const unmappedLocalHouseholds = [];
  for (const household of Array.isArray(source.households) ? source.households : []) {
    const localId = String(household?.id ?? '').trim();
    const remoteId = householdMappings?.[localId];
    if (!isUuid(remoteId)) {
      if (localId) unmappedLocalHouseholds.push(localId);
      continue;
    }
    records.push({
      scope: 'household',
      recordKey: householdRecordKey(remoteId),
      data: buildHouseholdBlob(household, remoteId),
      version: CLOUD_STATE_VERSION,
      localId,
      remoteId,
    });
  }
  return { records, unmappedLocalHouseholds };
}

/**
 * Aplica blobs remotos solo cuando la persona confirmó una importación y dio
 * el mapeo de cada hogar. No crea hogares locales ni mezcla ids implícitamente.
 */
export function applyRemoteBlobs(baseState, remote, householdMappings = {}) {
  const state = cloneJson(isObject(baseState) ? baseState : {});
  const personal = remote?.personal?.data ?? remote?.personal ?? null;
  if (personal && isObject(personal.personal)) state.personal = cloneJson(personal.personal);

  const localByRemoteId = new Map(
    Object.entries(householdMappings)
      .filter(([localId, remoteId]) => localId && isUuid(remoteId))
      .map(([localId, remoteId]) => [remoteId, localId]),
  );
  const households = Array.isArray(state.households) ? state.households : [];
  const byLocalId = new Map(households.map((item) => [String(item?.id ?? ''), item]));
  const unmappedRemoteHouseholds = [];
  const remoteHouseholdEntries = remote?.households && !Array.isArray(remote.households)
    ? Object.entries(remote.households)
    : [];
  for (const [remoteId, value] of remoteHouseholdEntries) {
    const localId = localByRemoteId.get(remoteId);
    const remoteHousehold = value?.data?.household ?? value?.household ?? value?.data;
    if (!localId || !isObject(remoteHousehold)) {
      unmappedRemoteHouseholds.push(remoteId);
      continue;
    }
    const current = byLocalId.get(localId);
    if (current) Object.assign(current, cloneJson({ ...remoteHousehold, id: localId }));
    else unmappedRemoteHouseholds.push(remoteId);
  }
  state.households = households;
  return { state, unmappedRemoteHouseholds };
}

function equalValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

/**
 * Fusión de revisión para la pantalla de conflicto. Sin base común no se
 * elige ganador; con base, solo se combinan cambios en claves distintas.
 */
export function mergeForReview({ base, local, remote } = {}) {
  if (equalValue(local, remote)) return { status: 'same', state: cloneJson(local), conflicts: [] };
  if (!isObject(base) || !isObject(local) || !isObject(remote)) {
    return { status: 'conflict', state: null, local: cloneJson(local), remote: cloneJson(remote), conflicts: ['blob'] };
  }
  const merged = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of [...keys].sort()) {
    const fromBase = base[key];
    const fromLocal = local[key];
    const fromRemote = remote[key];
    if (equalValue(fromLocal, fromRemote)) merged[key] = cloneJson(fromLocal);
    else if (equalValue(fromLocal, fromBase)) merged[key] = cloneJson(fromRemote);
    else if (equalValue(fromRemote, fromBase)) merged[key] = cloneJson(fromLocal);
    else {
      conflicts.push(key);
      merged[key] = cloneJson(fromLocal);
    }
  }
  return conflicts.length
    ? { status: 'conflict', state: merged, local: cloneJson(local), remote: cloneJson(remote), conflicts }
    : { status: 'merged', state: merged, conflicts: [] };
}

export function makeIdempotencyKey(operation, subject = '') {
  const normalizedOperation = String(operation ?? '').trim();
  const normalizedSubject = String(subject ?? '').trim();
  if (!normalizedOperation || !normalizedSubject) throw new TypeError('Una operación idempotente requiere operación y sujeto.');
  return `wello-${stableDigest({ operation: normalizedOperation, subject: normalizedSubject })}`;
}

export function isConflictError(error) {
  const code = String(error?.code ?? error?.status ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  return code === 'wello_revision_conflict'
    || code === '409'
    || code === 'p0001' && message.includes('revision')
    || message.includes('wello_revision_conflict')
    || message.includes('revision conflict');
}

export function sanitizeNfcHash(rawHash) {
  let value = String(rawHash ?? '').trim();
  if (!value) return '';
  if (!value.startsWith('#')) value = `#${value}`;
  const [path, query = ''] = value.slice(1).split('?');
  if (path !== 'super') return '';
  const params = new URLSearchParams(query);
  if (params.get('accion') !== 'agregar') return '';
  for (const key of params.keys()) if (key !== 'accion') return '';
  return NFC_HASH;
}

export function pendingNfcHash(storage) {
  if (!storage) return '';
  try {
    return sanitizeNfcHash(storage.getItem(PENDING_NFC_KEY))
      || sanitizeNfcHash(storage.getItem(LEGACY_PENDING_NFC_KEY));
  } catch { return ''; }
}

export function savePendingNfcHash(storage, rawHash) {
  const sanitized = sanitizeNfcHash(rawHash);
  if (!storage) return sanitized;
  try {
    if (sanitized) {
      storage.setItem(PENDING_NFC_KEY, sanitized);
      storage.setItem(LEGACY_PENDING_NFC_KEY, sanitized);
    } else if (String(rawHash ?? '').trim()) {
      storage.removeItem(PENDING_NFC_KEY);
      storage.removeItem(LEGACY_PENDING_NFC_KEY);
    }
  } catch { /* storage bloqueado: el retorno sigue siendo seguro */ }
  return sanitized;
}

export function takePendingNfcHash(storage) {
  const hash = pendingNfcHash(storage);
  if (storage) {
    try {
      storage.removeItem(PENDING_NFC_KEY);
      storage.removeItem(LEGACY_PENDING_NFC_KEY);
    } catch { /* noop */ }
  }
  return hash;
}

export function basePathFor(pathname = DEFAULT_BASE_PATH) {
  const value = String(pathname || '/');
  if (value.includes(DEFAULT_BASE_PATH)) return DEFAULT_BASE_PATH;
  if (!value.startsWith('/')) return '/';
  if (value.endsWith('/')) return value;
  const lastSlash = value.lastIndexOf('/');
  return lastSlash > 0 ? value.slice(0, lastSlash + 1) : '/';
}

export function callbackUrlFor({ origin, pathname } = {}) {
  const safeOrigin = String(origin || '').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(safeOrigin)) throw new TypeError('El retorno OAuth requiere un origen HTTPS o de preview válido.');
  return `${safeOrigin}${basePathFor(pathname)}`;
}

export function canonicalRecordFromRow(row) {
  if (!row || !row.record_key) return null;
  return {
    recordKey: String(row.record_key),
    data: cloneJson(row.data ?? {}),
    version: Number.isInteger(row.version) ? row.version : CLOUD_STATE_VERSION,
    revision: normalizeRevision(row.revision),
    updatedAt: row.updated_at ?? null,
  };
}
