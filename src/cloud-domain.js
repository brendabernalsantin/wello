/**
 * Dominio puro de la variante en línea de Wello.
 *
 * No importa Supabase ni toca el DOM. Aquí viven las reglas de identidad,
 * snapshots, fusiones conservadoras y datos temporales de OAuth para que la
 * capa de red pueda probarse sin una cuenta real.
 */

export const CLOUD_STATE_VERSION = 3;
export const PERSONAL_RECORD_KEY = 'wello:state:personal';
export const HOUSEHOLD_RECORD_PREFIX = 'wello:state:household:';
export const CACHE_KEY_PREFIX = 'wello:cloud-cache:';
export const PENDING_NFC_KEY = 'wello:pending-nfc-hash';
export const LEGACY_PENDING_NFC_KEY = 'wello:nfc-pending';
export const PENDING_INVITE_KEY = 'wello:pending-invite-token';
export const LEGACY_PENDING_INVITE_KEY = 'wello:invite-pending';
export const PENDING_ACTION_PREFIX = 'wello:cloud-pending-action:';
export const NFC_HASH = '#super?accion=agregar';
export const DEFAULT_BASE_PATH = '/primera-app/';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_USER_ID_RE = /^[A-Za-z0-9._:@-]{1,256}$/;
const INVITE_TOKEN_RE = /^[0-9a-f]{64}$/i;
const MISSING = Symbol('wello-missing');

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function cloneJson(value) {
  if (value === undefined || typeof value === 'symbol') return value;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

/** JSON determinista para comparar blobs y fabricar claves locales. */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** Digest pequeño, no criptográfico: solo sirve para igualdad local. */
export function stableDigest(value) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function randomToken() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint8Array(16);
      globalThis.crypto.getRandomValues(values);
      return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* use the non-secret fallback below */ }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
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
    mappings: {},
    memberships: [],
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

function equalValue(left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  return stableStringify(left) === stableStringify(right);
}

function pathFor(path, key) {
  if (!path) return String(key);
  if (String(key).startsWith('[')) return `${path}${key}`;
  return `${path}.${key}`;
}

function hasStableIds(list) {
  return Array.isArray(list) && list.every((item) => isObject(item) && typeof item.id === 'string' && item.id.length > 0);
}

function mergeArray(base, local, remote, path, conflicts) {
  if (!hasStableIds(local) || !hasStableIds(remote)
      || (base !== MISSING && base !== undefined && !hasStableIds(base))) {
    conflicts.push(path || 'array');
    return { value: cloneJson(local === MISSING ? remote : local) };
  }
  const baseMap = new Map((base === MISSING || !Array.isArray(base) ? [] : base).map((item) => [item.id, item]));
  const localMap = new Map((local === MISSING || !Array.isArray(local) ? [] : local).map((item) => [item.id, item]));
  const remoteMap = new Map((remote === MISSING || !Array.isArray(remote) ? [] : remote).map((item) => [item.id, item]));
  const order = [];
  for (const item of [...(base === MISSING || !Array.isArray(base) ? [] : base), ...(local === MISSING ? [] : local), ...(remote === MISSING ? [] : remote)]) {
    if (item?.id && !order.includes(item.id)) order.push(item.id);
  }
  const output = [];
  for (const id of order) {
    const nested = mergeNode(baseMap.has(id) ? baseMap.get(id) : MISSING, localMap.has(id) ? localMap.get(id) : MISSING, remoteMap.has(id) ? remoteMap.get(id) : MISSING, pathFor(path, `[${id}]`), conflicts);
    if (nested.value !== MISSING) output.push(nested.value);
  }
  return { value: output };
}

function mergeObject(base, local, remote, path, conflicts) {
  const baseObject = base !== MISSING && isObject(base) ? base : {};
  const localObject = local !== MISSING && isObject(local) ? local : {};
  const remoteObject = remote !== MISSING && isObject(remote) ? remote : {};
  const keys = new Set([...Object.keys(baseObject), ...Object.keys(localObject), ...Object.keys(remoteObject)]);
  const output = {};
  for (const key of [...keys].sort()) {
    const nested = mergeNode(
      Object.prototype.hasOwnProperty.call(baseObject, key) ? baseObject[key] : MISSING,
      Object.prototype.hasOwnProperty.call(localObject, key) ? localObject[key] : MISSING,
      Object.prototype.hasOwnProperty.call(remoteObject, key) ? remoteObject[key] : MISSING,
      pathFor(path, key),
      conflicts,
    );
    if (nested.value !== MISSING) output[key] = nested.value;
  }
  return { value: output };
}

function mergeNode(base, local, remote, path, conflicts) {
  if (equalValue(local, remote)) return { value: cloneJson(local) };
  if (equalValue(local, base)) return { value: cloneJson(remote) };
  if (equalValue(remote, base)) return { value: cloneJson(local) };

  // La ausencia de un registro frente a una edición del mismo registro es
  // siempre un conflicto (delete-vs-edit), nunca last-wins.
  if (local === MISSING || remote === MISSING) {
    conflicts.push(path || 'blob');
    return { value: cloneJson(local === MISSING ? remote : local) };
  }
  if (Array.isArray(base) || Array.isArray(local) || Array.isArray(remote)) {
    if (Array.isArray(local) && Array.isArray(remote)) return mergeArray(base, local, remote, path, conflicts);
    conflicts.push(path || 'array');
    return { value: cloneJson(local) };
  }
  if (isObject(base) || isObject(local) || isObject(remote)) {
    if (isObject(local) && isObject(remote)) return mergeObject(base, local, remote, path, conflicts);
    conflicts.push(path || 'blob');
    return { value: cloneJson(local) };
  }
  conflicts.push(path || 'blob');
  return { value: cloneJson(local) };
}

/**
 * Merge 3-way conservador. Las listas de registros se fusionan por id; la
 * edición y borrado concurrentes del mismo id se reportan como conflicto.
 */
export function deepMerge3way({ base, local, remote } = {}) {
  if (equalValue(local, remote)) return { status: 'same', state: cloneJson(local), conflicts: [] };
  const conflicts = [];
  const result = mergeNode(base === undefined ? MISSING : base, local === undefined ? MISSING : local, remote === undefined ? MISSING : remote, '', conflicts);
  return conflicts.length
    ? { status: 'conflict', state: result.value === MISSING ? null : result.value, local: cloneJson(local), remote: cloneJson(remote), conflicts: [...new Set(conflicts)] }
    : { status: 'merged', state: result.value === MISSING ? null : result.value, conflicts: [] };
}

export const deepThreeWayMerge = deepMerge3way;

/** Compatible con el nombre que usa la pantalla de revisión existente. */
export function mergeForReview({ base, local, remote } = {}) {
  const result = deepMerge3way({ base, local, remote });
  return {
    ...result,
    ...(result.status === 'same' ? {} : { local: cloneJson(local), remote: cloneJson(remote) }),
  };
}

/**
 * Clave estable de compatibilidad para llamadas antiguas. Las escrituras CAS
 * nuevas deben usar makeFreshOperationId: una operación A->B->A jamás debe
 * reutilizar el resultado de la primera A.
 */
export function makeIdempotencyKey(operation, subject = '') {
  const normalizedOperation = String(operation ?? '').trim();
  const normalizedSubject = String(subject ?? '').trim();
  if (!normalizedOperation || !normalizedSubject) throw new TypeError('Una operación idempotente requiere operación y sujeto.');
  return `wello-${stableDigest({ operation: normalizedOperation, subject: normalizedSubject })}`;
}

/** Id único por intento, ligado a sujeto y revisión esperada para CAS. */
export function makeFreshOperationId(operation, subject = '', expectedRevision = 0) {
  const normalizedOperation = String(operation ?? '').trim();
  const normalizedSubject = String(subject ?? '').trim();
  if (!normalizedOperation || !normalizedSubject) throw new TypeError('Una operación idempotente requiere operación y sujeto.');
  const revision = normalizeRevision(expectedRevision);
  return `wello-${normalizedOperation}-${stableDigest(normalizedSubject)}-r${revision}-${randomToken()}`;
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

function remoteHouseholdData(value) {
  return value?.data?.household ?? value?.household ?? value?.data ?? null;
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
    const remoteHousehold = remoteHouseholdData(value);
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

/**
 * Primer arranque de cuenta: solo sustituye el placeholder vacío por hogares
 * descubiertos como miembro. Un hogar local con datos nunca se pisa aquí.
 */
export function bootstrapRemoteState(baseState, remote, householdMappings = {}) {
  const state = cloneJson(isObject(baseState) ? baseState : {});
  const currentHouseholds = Array.isArray(state.households) ? state.households : [];
  const remoteEntries = Object.entries(remote?.households || {}).filter(([id, value]) => isUuid(id) && isObject(remoteHouseholdData(value)));
  const mappedByRemote = new Map(Object.entries(householdMappings).filter(([, remoteId]) => isUuid(remoteId)).map(([localId, remoteId]) => [remoteId, localId]));
  const meaningful = (home) => ['habits', 'pets', 'inventory', 'shopping', 'purchases', 'stores'].some((key) => Array.isArray(home?.[key]) && home[key].length > 0);
  const homePlaceholder = currentHouseholds.length === 1 && !meaningful(currentHouseholds[0]);
  const currentPersonal = isObject(state.personal) ? state.personal : {};
  const personalHasData = Object.entries(currentPersonal).some(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
  const resultMappings = { ...householdMappings };
  const next = homePlaceholder ? [] : currentHouseholds;
  const unmappedRemoteHouseholds = [];
  for (const [remoteId, value] of remoteEntries) {
    const localId = mappedByRemote.get(remoteId) || (homePlaceholder ? remoteId : null);
    const remoteHome = remoteHouseholdData(value);
    if (!localId) {
      unmappedRemoteHouseholds.push(remoteId);
      continue;
    }
    resultMappings[localId] = remoteId;
    const existing = next.find((home) => String(home?.id) === localId);
    const home = { ...cloneJson(remoteHome), id: localId };
    if (existing) Object.assign(existing, home);
    else next.push(home);
  }
  if (!next.length && currentHouseholds.length) next.push(...currentHouseholds);
  if (next.length) state.households = next;
  const personal = remote?.personal?.data ?? remote?.personal;
  const remotePersonal = isObject(personal?.personal) ? personal.personal : null;
  const personalEqual = remotePersonal && stableStringify(currentPersonal) === stableStringify(remotePersonal);
  // A placeholder household must not make a meaningful local personal record
  // disappear. An empty personal namespace may adopt the remote baseline; an
  // equal record is safe to normalize as well.
  const adoptedPersonal = Boolean(remotePersonal && (!personalHasData || personalEqual));
  if (adoptedPersonal) state.personal = cloneJson(remotePersonal);
  if (state.households?.[0] && !state.activeHousehold) state.activeHousehold = state.households[0].id;
  return {
    state,
    mappings: resultMappings,
    unmappedRemoteHouseholds,
    adopted: Boolean((homePlaceholder && next.length > 0) || adoptedPersonal),
    adoptedPersonal,
    homePlaceholder,
  };
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

export function sanitizeInviteToken(rawToken) {
  const token = String(rawToken ?? '').trim();
  return INVITE_TOKEN_RE.test(token) ? token.toLowerCase() : '';
}

export function sanitizeInviteHash(rawHash) {
  let value = String(rawHash ?? '').trim();
  if (!value) return '';
  if (!value.startsWith('#')) value = `#${value}`;
  const [path, query = ''] = value.slice(1).split('?');
  if (path !== 'invitacion') return '';
  const params = new URLSearchParams(query);
  const token = sanitizeInviteToken(params.get('token'));
  if (!token || [...params.keys()].some((key) => key !== 'token')) return '';
  return `#invitacion?token=${token}`;
}

export function pendingInviteToken(storage) {
  if (!storage) return '';
  try {
    return sanitizeInviteToken(storage.getItem(PENDING_INVITE_KEY))
      || sanitizeInviteToken(storage.getItem(LEGACY_PENDING_INVITE_KEY));
  } catch { return ''; }
}

export function savePendingInviteToken(storage, rawToken) {
  const token = sanitizeInviteToken(rawToken);
  if (!storage) return token;
  try {
    if (token) {
      storage.setItem(PENDING_INVITE_KEY, token);
      storage.setItem(LEGACY_PENDING_INVITE_KEY, token);
    } else {
      storage.removeItem(PENDING_INVITE_KEY);
      storage.removeItem(LEGACY_PENDING_INVITE_KEY);
    }
  } catch { /* storage bloqueado */ }
  return token;
}

export function takePendingInviteToken(storage) {
  const token = pendingInviteToken(storage);
  savePendingInviteToken(storage, '');
  return token;
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
