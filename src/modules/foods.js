/* Wello · Alimentos
 * Dominio puro para inventario, súper, precios y compras, más la vista del hogar activo.
 * Las coordenadas de ubicación sólo viven durante una búsqueda y nunca se persisten.
 */

const LOCATIONS = [
  { value: 'refri', label: 'Refri' },
  { value: 'congelador', label: 'Congelador' },
  { value: 'despensa', label: 'Despensa' },
];

const SHOPPING_STATES = new Set(['pending', 'purchased', 'completed', 'bought', 'done']);

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

function readArray(home, key) {
  return Array.isArray(home?.[key]) ? home[key] : [];
}

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* JSON fallback for plain state */ }
  }
  return JSON.parse(JSON.stringify(value));
}

function newId(prefix = 'food') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function idFor(ctx, prefix = 'food') {
  return typeof ctx?.id === 'function' ? ctx.id() : newId(prefix);
}

function today(ctx) {
  if (typeof ctx?.today === 'function') return ctx.today();
  return new Date().toISOString().slice(0, 10);
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

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Product comparison intentionally ignores case, spaces and accents, not units. */
export function normalizeProductName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-MX')
    .replace(/\s+/g, ' ');
}

const UNIT_ALIASES = new Map([
  ['pieza', 'pieza'], ['piezas', 'pieza'], ['pza', 'pieza'], ['pzas', 'pieza'], ['unidad', 'pieza'], ['unidades', 'pieza'],
  ['kilogramo', 'kg'], ['kilogramos', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'], ['kg', 'kg'],
  ['gramo', 'g'], ['gramos', 'g'], ['gr', 'g'], ['g', 'g'],
  ['litro', 'l'], ['litros', 'l'], ['lt', 'l'], ['l', 'l'],
  ['mililitro', 'ml'], ['mililitros', 'ml'], ['ml', 'ml'],
]);

export function normalizeUnit(value) {
  const clean = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-MX');
  return UNIT_ALIASES.get(clean) || clean;
}

export function unitsCompatible(left, right) {
  const a = normalizeUnit(left);
  const b = normalizeUnit(right);
  return Boolean(a && b && a === b);
}

function productKey(name, unit) {
  return `${normalizeProductName(name)}|${normalizeUnit(unit)}`;
}

function quantityOf(item) {
  const value = item?.quantity ?? item?.stock;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function shoppingIsPending(item) {
  if (!item) return false;
  if (item.purchased === true || item.completed === true) return false;
  const status = String(item.status || 'pending').toLocaleLowerCase('es-MX');
  return !SHOPPING_STATES.has(status) || status === 'pending';
}

function lineAmount(line) {
  const amount = positiveNumber(line?.amount ?? line?.total ?? line?.lineTotal);
  if (amount != null) return amount;
  const price = positiveNumber(line?.price ?? line?.unitPrice);
  const quantity = positiveNumber(line?.quantity);
  return price != null && quantity != null ? price * quantity : null;
}

function purchaseDate(purchase, fallbackIndex) {
  const value = purchase?.date || purchase?.createdAt;
  return value ? String(value) : `0000-00-00-${String(fallbackIndex).padStart(8, '0')}`;
}

function flattenPriceHistory(purchases) {
  const entries = [];
  (Array.isArray(purchases) ? purchases : []).forEach((purchase, purchaseIndex) => {
    (Array.isArray(purchase?.lines) ? purchase.lines : []).forEach((line, lineIndex) => {
      const amount = lineAmount(line);
      const quantity = positiveNumber(line?.quantity);
      if (amount == null || quantity == null) return;
      const unit = line.unit || line.measure || '';
      const name = line.name || line.product || '';
      if (!normalizeProductName(name) || !normalizeUnit(unit)) return;
      const unitPrice = amount / quantity;
      if (!(unitPrice > 0)) return;
      entries.push({
        name,
        unit,
        unitPrice,
        date: purchaseDate(purchase, purchaseIndex),
        purchaseId: purchase?.id,
        lineId: line?.id || `${purchase?.id || purchaseIndex}-${lineIndex}`,
      });
    });
  });
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function sourceCollections(source, maybePurchases, maybeInventory) {
  if (Array.isArray(source)) return { shopping: source, purchases: Array.isArray(maybePurchases) ? maybePurchases : [], inventory: Array.isArray(maybeInventory) ? maybeInventory : [] };
  const state = source || {};
  return {
    shopping: Array.isArray(state.shopping) ? state.shopping : [],
    purchases: Array.isArray(state.purchases) ? state.purchases : (Array.isArray(maybePurchases) ? maybePurchases : []),
    inventory: Array.isArray(state.inventory) ? state.inventory : (Array.isArray(maybeInventory) ? maybeInventory : []),
  };
}

/**
 * Estimate only pending lines. A missing compatible price stays in unpriced and
 * never becomes zero. The result contains aliases useful to callers of older Wello builds.
 */
export function estimateShopping(source, maybePurchases, maybeInventory) {
  const { shopping, purchases } = sourceCollections(source, maybePurchases, maybeInventory);
  const prices = flattenPriceHistory(purchases);
  const pending = shopping.filter(shoppingIsPending);
  const items = pending.map((item) => {
    const quantity = quantityOf(item);
    const history = [...prices].reverse().find((entry) => normalizeProductName(entry.name) === normalizeProductName(item.name) && unitsCompatible(entry.unit, item.unit));
    const estimate = history && quantity > 0 ? roundMoney(quantity * history.unitPrice) : null;
    return {
      ...item,
      pendingQuantity: quantity,
      unitPrice: history?.unitPrice ?? null,
      price: history?.unitPrice ?? null,
      estimate,
      estimated: estimate != null,
      priceSource: history ? { purchaseId: history.purchaseId, lineId: history.lineId, date: history.date } : null,
    };
  });
  const estimated = items.filter((item) => item.estimated);
  const unpriced = items.filter((item) => !item.estimated);
  const knownSubtotal = roundMoney(estimated.reduce((sum, item) => sum + item.estimate, 0));
  const subtotal = estimated.length ? knownSubtotal : null;
  return {
    items,
    lines: items,
    estimated,
    priced: estimated,
    unpriced,
    unknown: unpriced,
    subtotal,
    knownSubtotal,
    estimatedTotal: subtotal,
    total: subtotal,
    currency: 'MXN',
    pendingCount: pending.length,
    unpricedCount: unpriced.length,
    hasKnownSubtotal: estimated.length > 0,
  };
}

/** Consolidate pending products only; purchased history is intentionally untouched. */
export function consolidateShopping(items) {
  const result = [];
  const byKey = new Map();
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const item = { ...raw };
    if (!item.id) item.id = newId('shopping');
    if (!shoppingIsPending(item) || !normalizeProductName(item.name) || !normalizeUnit(item.unit)) {
      result.push(item);
      return;
    }
    const key = productKey(item.name, item.unit);
    const existing = byKey.get(key);
    if (!existing) {
      item.status = item.status || 'pending';
      item.quantity = quantityOf(item);
      result.push(item);
      byKey.set(key, item);
      return;
    }
    existing.quantity = quantityOf(existing) + quantityOf(item);
    if (!existing.note && item.note) existing.note = item.note;
    if (!existing.createdAt && item.createdAt) existing.createdAt = item.createdAt;
  });
  return result;
}

export function addShoppingItem(home, item) {
  const next = clone(home || {});
  next.shopping = consolidateShopping([...readArray(next, 'shopping'), {
    id: item?.id || newId('shopping'),
    name: String(item?.name || '').trim(),
    quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 1,
    unit: String(item?.unit || 'pieza').trim(),
    status: item?.status || 'pending',
    note: item?.note || '',
  }]);
  return next;
}

function sameInventoryProduct(left, right) {
  return normalizeProductName(left?.name) === normalizeProductName(right?.name)
    && unitsCompatible(left?.unit, right?.unit)
    && String(left?.location || 'despensa') === String(right?.location || 'despensa');
}

function transferValues(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return values.map((entry) => String(entry)).filter(Boolean);
}

function appendTransferValue(item, key, value) {
  if (value == null || value === '') return;
  const current = transferValues(item[key]);
  const normalized = String(value);
  if (!current.includes(normalized)) current.push(normalized);
  item[key] = current;
}

function transferMetadata(item) {
  const transferIds = [...new Set([...transferValues(item?.transferIds), ...transferValues(item?.transferId)])];
  const sourceShoppingIds = [...new Set([...transferValues(item?.sourceShoppingIds), ...transferValues(item?.sourceShoppingId)])];
  return { transferIds, sourceShoppingIds };
}

function transferLedgerKey(entry) {
  return `${String(entry?.transferId || '')}|${String(entry?.sourceShoppingId || '')}`;
}

/**
 * Normalize old singular transfer fields without discarding them. The arrays and
 * ledger are the durable identity of every source, even when inventory products
 * are consolidated later.
 */
function normalizeTransferState(home) {
  if (!home || typeof home !== 'object') return home;
  home.inventory = readArray(home, 'inventory');
  home.shopping = readArray(home, 'shopping');
  const ledger = [];
  const known = new Set();
  (Array.isArray(home.inventoryTransfers) ? home.inventoryTransfers : []).forEach((rawEntry) => {
    const entry = { ...rawEntry };
    if (entry.transferId != null && entry.transferId !== '') entry.transferId = String(entry.transferId);
    if (entry.sourceShoppingId != null && entry.sourceShoppingId !== '') entry.sourceShoppingId = String(entry.sourceShoppingId);
    const key = transferLedgerKey(entry);
    if ((!entry.transferId && !entry.sourceShoppingId) || known.has(key)) return;
    ledger.push(entry);
    known.add(key);
  });

  home.inventory.forEach((item) => {
    const metadata = transferMetadata(item);
    if (metadata.transferIds.length) item.transferIds = metadata.transferIds;
    if (metadata.sourceShoppingIds.length) item.sourceShoppingIds = metadata.sourceShoppingIds;
    const count = Math.max(metadata.transferIds.length, metadata.sourceShoppingIds.length);
    for (let index = 0; index < count; index += 1) {
      const entry = {
        inventoryId: item.id || '',
        transferId: metadata.transferIds[index] || '',
        sourceShoppingId: metadata.sourceShoppingIds[index] || '',
      };
      if ((!entry.transferId && !entry.sourceShoppingId) || known.has(transferLedgerKey(entry))) continue;
      ledger.push(entry);
      known.add(transferLedgerKey(entry));
    }
  });

  // A legacy inventory record may contain the source id but the shopping item
  // may not yet have received its source-side lock. Rebuild that lock too.
  home.shopping.forEach((source) => {
    const sourceId = String(source?.id || '');
    if (!sourceId) return;
    appendTransferValue(source, 'transferIds', source.transferId);
    ledger.filter((entry) => String(entry.sourceShoppingId || '') === sourceId).forEach((entry) => {
      appendTransferValue(source, 'transferIds', entry.transferId);
      if (!source.transferId && entry.transferId) source.transferId = entry.transferId;
      source.inventoryTransferred = true;
      source.status = 'purchased';
      source.purchased = true;
    });
  });
  home.inventoryTransfers = ledger;
  return home;
}

function inventoryHasTransfer(item, transferId, sourceShoppingId) {
  const metadata = transferMetadata(item);
  return (transferId && metadata.transferIds.includes(String(transferId)))
    || (sourceShoppingId && metadata.sourceShoppingIds.includes(String(sourceShoppingId)));
}

function ledgerHasTransfer(home, transferId, sourceShoppingId) {
  return readArray(home, 'inventoryTransfers').some((entry) => (
    (transferId && String(entry?.transferId || '') === String(transferId))
    || (sourceShoppingId && String(entry?.sourceShoppingId || '') === String(sourceShoppingId))
  ));
}

function shoppingItemTransferred(item) {
  return Boolean(item?.inventoryTransferred || item?.transferId || transferValues(item?.transferIds).length);
}

function markSourceTransferred(source, transferId) {
  appendTransferValue(source, 'transferIds', transferId);
  if (!source.transferId) source.transferId = transferValues(source.transferIds)[0] || transferId;
  source.inventoryTransferred = true;
  source.status = 'purchased';
  source.purchased = true;
}

/**
 * Transfer a shopping line explicitly to inventory. The operation is idempotent:
 * every source transfer is retained in the ledger, even when products consolidate.
 * Returns a state-like object plus metadata so callers can use either result.home or result.inventory.
 */
export function transferToInventory(home, shoppingIdOrItem, options = {}) {
  const next = clone(home || {});
  next.inventory = readArray(next, 'inventory');
  next.shopping = readArray(next, 'shopping');
  normalizeTransferState(next);
  const requestedId = typeof shoppingIdOrItem === 'object' ? shoppingIdOrItem?.id : shoppingIdOrItem;
  const source = next.shopping.find((item) => String(item.id) === String(requestedId)) || (typeof shoppingIdOrItem === 'object' ? shoppingIdOrItem : null);
  const result = { ...next, home: next, changed: false, idempotent: false, inventoryItem: null };
  if (!source) return result;
  const sourceId = source.id || requestedId;
  const transferId = source.transferId || transferValues(source.transferIds)[0] || options.transferId || `shopping-transfer:${sourceId}`;
  const sourceAlreadyTransferred = source.inventoryTransferred === true
    || transferValues(source.transferId).length > 0
    || transferValues(source.transferIds).length > 0;
  const existingTransfer = next.inventory.find((item) => inventoryHasTransfer(item, transferId, sourceId))
    || next.inventory.find((item) => String(item.id || '') === String(next.inventoryTransfers.find((entry) => (
      String(entry?.transferId || '') === String(transferId)
      || String(entry?.sourceShoppingId || '') === String(sourceId)
    ))?.inventoryId || ''));
  if (sourceAlreadyTransferred || existingTransfer || ledgerHasTransfer(next, transferId, sourceId)) {
    markSourceTransferred(source, transferId);
    const target = next.shopping.find((item) => String(item.id) === String(sourceId));
    if (target) markSourceTransferred(target, transferId);
    result.inventoryItem = existingTransfer || next.inventory.find((item) => inventoryHasTransfer(item, transferId, sourceId)) || null;
    result.idempotent = true;
    return result;
  }
  const quantity = positiveNumber(options.quantity) ?? positiveNumber(source.quantity) ?? 0;
  if (!(quantity > 0)) return result;
  const location = LOCATIONS.some((item) => item.value === options.location) ? options.location : 'despensa';
  const inventoryInput = {
    id: options.inventoryId || newId('inventory'),
    name: String(source.name || '').trim(),
    quantity,
    stock: quantity,
    unit: String(options.unit || source.unit || 'pieza').trim(),
    location,
    expiration: options.expiration || options.expiry || '',
    sourceShoppingId: sourceId,
    transferId,
    sourceShoppingIds: [String(sourceId)],
    transferIds: [String(transferId)],
  };
  const existing = next.inventory.find((item) => sameInventoryProduct(item, inventoryInput));
  let inventoryItem;
  if (existing) {
    const total = quantityOf(existing) + quantity;
    existing.quantity = total;
    existing.stock = total;
    if (inventoryInput.expiration) existing.expiration = inventoryInput.expiration;
    existing.transferId = transferId;
    existing.sourceShoppingId = sourceId;
    appendTransferValue(existing, 'transferIds', transferId);
    appendTransferValue(existing, 'sourceShoppingIds', sourceId);
    inventoryItem = existing;
  } else {
    next.inventory.push(inventoryInput);
    inventoryItem = inventoryInput;
  }
  next.inventoryTransfers.push({ inventoryId: inventoryItem.id || '', transferId: String(transferId), sourceShoppingId: String(sourceId), quantity });
  const target = next.shopping.find((item) => String(item.id) === String(sourceId));
  if (target) {
    target.purchasedAt = options.purchasedAt || new Date().toISOString();
    markSourceTransferred(target, transferId);
  }
  result.inventoryItem = inventoryItem;
  result.changed = true;
  result.idempotent = false;
  return result;
}

export function transferShoppingToInventory(home, shoppingIdOrItem, options = {}) {
  return transferToInventory(home, shoppingIdOrItem, options).home;
}

/** Add an actual ticket without inventing line prices; duplicate ids are ignored. */
export function recordPurchase(home, purchaseInput = {}) {
  const next = clone(home || {});
  next.purchases = readArray(next, 'purchases');
  const id = purchaseInput.id || newId('purchase');
  const existing = next.purchases.find((purchase) => String(purchase.id) === String(id));
  if (existing) return { ...next, home: next, purchase: existing, idempotent: true, changed: false };
  const lines = (Array.isArray(purchaseInput.lines) ? purchaseInput.lines : []).map((line) => ({
    id: line.id || newId('line'),
    name: String(line.name || '').trim(),
    quantity: numberOrNull(line.quantity),
    unit: String(line.unit || '').trim(),
    amount: positiveNumber(line.amount) ?? null,
    discount: numberOrNull(line.discount) ?? 0,
  }));
  const lineSum = lines.reduce((sum, line) => sum + (line.amount || 0), 0);
  const total = positiveNumber(purchaseInput.total) ?? (lineSum > 0 ? roundMoney(lineSum) : null);
  const purchase = {
    id,
    date: purchaseInput.date || new Date().toISOString().slice(0, 10),
    store: String(purchaseInput.store || '').trim(),
    storeId: purchaseInput.storeId || '',
    total,
    lines,
    discounts: numberOrNull(purchaseInput.discounts) ?? lines.reduce((sum, line) => sum + (line.discount || 0), 0),
    lineTotal: roundMoney(lineSum),
    difference: total == null ? null : roundMoney(total - lineSum),
    note: String(purchaseInput.note || '').trim(),
  };
  next.purchases.push(purchase);
  return { ...next, home: next, purchase, idempotent: false, changed: true };
}

export function purchaseDifference(purchase) {
  if (!purchase || !Number.isFinite(Number(purchase.total))) return null;
  const linesTotal = (Array.isArray(purchase.lines) ? purchase.lines : []).reduce((sum, line) => sum + (positiveNumber(line?.amount) || 0), 0);
  return roundMoney(Number(purchase.total) - linesTotal);
}

function nearbyQuery(lat, lng, radius = 5000) {
  return `[out:json][timeout:10];(nwr["shop"="supermarket"](around:${radius},${Number(lat)},${Number(lng)});nwr["shop"="convenience"](around:${radius},${Number(lat)},${Number(lng)}););out center tags;`;
}

/** Query Overpass only when called by the explicit location action. Coordinates are not in the returned stores. */
export async function lookupNearby(lat, lng, fetcher = globalThis.fetch, options = {}) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return { ok: false, status: 'invalid', stores: [], results: [], error: 'Coordenadas inválidas.' };
  }
  if (typeof fetcher !== 'function') return { ok: false, status: 'unavailable', stores: [], results: [], error: 'No hay proveedor de búsqueda.' };
  const endpoint = options.endpoint || 'https://overpass-api.de/api/interpreter';
  const url = `${endpoint}?data=${encodeURIComponent(nearbyQuery(lat, lng, options.radius || 5000))}`;
  const timeout = Number(options.timeout ?? 8000);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    const request = fetcher(url, controller ? { signal: controller.signal, headers: { Accept: 'application/json' } } : undefined);
    const response = await Promise.race([
      Promise.resolve(request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeout); }),
    ]);
    if (!response || response.ok === false) throw new Error(`HTTP ${response?.status || 'error'}`);
    const payload = typeof response.json === 'function' ? await response.json() : response;
    const stores = [];
    const seen = new Set();
    for (const element of Array.isArray(payload?.elements) ? payload.elements : []) {
      const tags = element?.tags || {};
      const name = String(tags.name || tags.brand || '').trim();
      if (!name) continue;
      const key = normalizeProductName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      stores.push({ id: `osm-${element.type || 'place'}-${element.id || stores.length}`, name, source: 'openstreetmap' });
    }
    return { ok: true, status: stores.length ? 'results' : 'no-results', stores, results: stores };
  } catch (error) {
    return { ok: false, status: error?.message === 'timeout' ? 'timeout' : 'error', stores: [], results: [], error: error?.message || 'No se pudo consultar lugares cercanos.' };
  } finally {
    if (timer) clearTimeout(timer);
    if (controller) controller.abort();
  }
}

function button(ctx, label, action, id = '', kind = 'secondary', extra = '') {
  if (typeof ctx?.btn === 'function') return ctx.btn(label, action, `data-id="${esc(ctx, id)}" ${extra}`, kind);
  return `<button type="button" class="btn ${kind}" data-action="${esc(ctx, action)}" data-id="${esc(ctx, id)}" ${extra}>${esc(ctx, label)}</button>`;
}

function field(ctx, label, name, value = '', type = 'text', extra = '') {
  if (typeof ctx?.field === 'function') return ctx.field(label, name, value ?? '', type, extra);
  return `<label class="field"><span>${esc(ctx, label)}</span><input name="${esc(ctx, name)}" type="${esc(ctx, type)}" value="${esc(ctx, value ?? '')}" ${extra}></label>`;
}

function select(ctx, label, name, options, value = '') {
  if (typeof ctx?.select === 'function') return ctx.select(label, name, options, value);
  const html = options.map((option) => {
    const item = typeof option === 'string' ? { value: option, label: option } : option;
    return `<option value="${esc(ctx, item.value)}" ${String(item.value) === String(value) ? 'selected' : ''}>${esc(ctx, item.label)}</option>`;
  }).join('');
  return `<label class="field"><span>${esc(ctx, label)}</span><select name="${esc(ctx, name)}">${html}</select></label>`;
}

function changeableSelect(ctx, label, name, options, value = '', changeName = name) {
  const html = select(ctx, label, name, options, value);
  return html.replace('<select ', `<select data-change="${esc(ctx, changeName)}" `);
}

function saveAndRender(ctx, message) {
  normalizeTransferState(getHome(ctx));
  if (typeof ctx?.save === 'function') ctx.save();
  if (message && typeof ctx?.toast === 'function') ctx.toast(message);
  if (typeof ctx?.render === 'function') ctx.render();
}

function confirm(ctx, message, callback) {
  if (typeof ctx?.confirm === 'function') return ctx.confirm(message, callback);
  callback();
}

function view(ctx) {
  if (!ctx.view || typeof ctx.view !== 'object') ctx.view = {};
  return ctx.view;
}

function inventoryQuantityInput(item) {
  return quantityOf(item);
}

function money(ctx, value) {
  if (typeof ctx?.money === 'function') return ctx.money(value);
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value)) : 'Sin precio';
}

function inventoryItemId(item) {
  return item?.id || '';
}

function getStoreName(store) {
  return typeof store === 'string' ? store : String(store?.name || '');
}

function storeOptions(home, selected = '') {
  const options = [{ value: '', label: 'Escribe o elige una tienda' }];
  readArray(home, 'stores').forEach((store) => {
    const name = getStoreName(store);
    if (name) options.push({ value: name, label: name });
  });
  return options.map((item) => ({ ...item, selected: item.value === selected }));
}

function storeByName(home, name, ctx) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  const stores = readArray(home, 'stores');
  const found = stores.find((store) => normalizeProductName(getStoreName(store)) === normalizeProductName(clean));
  if (found) return getStoreName(found);
  stores.push({ id: idFor(ctx, 'store'), name: clean });
  home.stores = stores;
  return clean;
}

function formatDate(ctx, date) {
  if (!date) return 'Sin fecha';
  return typeof ctx?.prettyDate === 'function' ? ctx.prettyDate(date) : date;
}

function renderInventoryTab(ctx, home) {
  const currentFilter = view(ctx).foodFilter || 'all';
  const inventory = readArray(home, 'inventory').filter((item) => currentFilter === 'all' || String(item.location || 'despensa') === currentFilter);
  const filterButtons = [{ value: 'all', label: 'Todo' }, ...LOCATIONS].map((item) => `<button type="button" class="tab ${currentFilter === item.value ? 'active' : ''}" data-action="food-filter" data-filter="${esc(ctx, item.value)}">${esc(ctx, item.label)}</button>`).join('');
  return `<section class="stack"><div class="tabs" role="tablist">${filterButtons}</div><div class="section-head"><div><p class="eyebrow">Existencias</p><h2 class="section-title">${inventory.length} alimento${inventory.length === 1 ? '' : 's'}</h2></div>${button(ctx, 'Agregar alimento', 'food-inventory-add', '', 'primary')}</div>${inventory.length ? `<div class="stack">${inventory.map((item) => `<article class="list-row food-inventory-row"><div><strong>${esc(ctx, item.name || 'Sin nombre')}</strong><p class="muted small">${esc(ctx, String(inventoryQuantityInput(item)))} ${esc(ctx, item.unit || '')} · ${esc(ctx, LOCATIONS.find((location) => location.value === item.location)?.label || item.location || 'Despensa')}${item.expiration ? ` · Caduca ${esc(ctx, formatDate(ctx, item.expiration))}` : ''}</p></div><div class="row">${button(ctx, 'Se terminó', 'food-inventory-finish', inventoryItemId(item), 'ghost')}${button(ctx, 'Editar', 'food-inventory-edit', inventoryItemId(item), 'secondary')}${button(ctx, 'Eliminar', 'food-inventory-delete', inventoryItemId(item), 'ghost')}</div></article>`).join('')}</div>` : `<div class="empty"><strong>No hay alimentos en este filtro</strong><p>Agrega existencias para mantener tu refri, congelador y despensa al día.</p></div>`}</section>`;
}

function renderSuperTab(ctx, home) {
  const estimate = estimateShopping(home);
  const pendingItems = estimate.items;
  const subtotal = estimate.hasKnownSubtotal ? money(ctx, estimate.subtotal) : 'Sin precio';
  const completed = readArray(home, 'shopping').filter((item) => !shoppingIsPending(item));
  const pendingHtml = pendingItems.length
    ? `<div class="stack">${pendingItems.map((item) => `<article class="list-row food-shopping-row"><div><strong>${esc(ctx, item.name || 'Sin nombre')}</strong><p class="muted small">${esc(ctx, String(item.pendingQuantity))} ${esc(ctx, item.unit || '')}${item.estimated ? ` · ${esc(ctx, money(ctx, item.estimate))}` : ' · Sin precio'}</p></div><div class="row">${button(ctx, 'Editar', 'food-shopping-edit', item.id, 'ghost')}${button(ctx, 'Pasar a inventario', 'food-transfer', item.id, 'secondary')}${button(ctx, 'Marcar comprado', 'food-shopping-toggle', item.id, 'ghost')}${button(ctx, 'Eliminar', 'food-shopping-delete', item.id, 'ghost')}</div></article>`).join('')}</div>`
    : `<div class="empty"><strong>El súper está al día</strong><p>Agrega un producto cuando haga falta. El estimado usa el último precio compatible.</p></div>`;
  const completedHtml = completed.length
    ? `<section class="soft"><div class="section-head"><div><p class="eyebrow">Estado</p><h3 class="section-title">Comprados</h3></div></div><div class="stack">${completed.map((item) => { const transferred = shoppingItemTransferred(item); return `<article class="list-row"><div><strong>${esc(ctx, item.name || 'Sin nombre')}</strong><p class="muted small">${esc(ctx, String(quantityOf(item)))} ${esc(ctx, item.unit || '')} · Comprado${transferred ? ' · En inventario' : ''}</p></div><div class="row">${!transferred ? button(ctx, 'Pasar a inventario', 'food-transfer', item.id, 'secondary') : ''}${button(ctx, 'Eliminar', 'food-shopping-delete', item.id, 'ghost')}</div></article>`; }).join('')}</div></section>`
    : '';
  return `<section class="stack"><div class="section-head"><div><p class="eyebrow">Súper</p><h2 class="section-title">Lo que gastaríamos</h2><p class="muted small">Subtotal conocido: <strong>${esc(ctx, subtotal)}</strong>${estimate.unpricedCount ? ` · ${estimate.unpricedCount} sin precio` : ''}</p></div>${button(ctx, 'Agregar al súper', 'food-add-shopping', '', 'primary')}</div><div class="metric soft"><span class="muted small">Pendientes estimados</span><strong>${esc(ctx, estimate.hasKnownSubtotal ? money(ctx, estimate.subtotal) : 'Sin precio')}</strong><span class="muted small">No se cuentan renglones ya comprados.</span></div>${pendingHtml}${completedHtml}<p class="muted small">Unidades incompatibles y productos nuevos se mantienen aparte como “Sin precio”; nunca se estiman como $0.</p></section>`;
}

function renderPurchaseTab(ctx, home) {
  const currentMonth = view(ctx).foodPurchaseMonth || '';
  const currentStore = view(ctx).foodPurchaseStore || '';
  const purchases = readArray(home, 'purchases').filter((purchase) => (!currentMonth || String(purchase.date || '').slice(0, 7) === currentMonth) && (!currentStore || getStoreName(purchase.store) === currentStore));
  const monthOptions = [{ value: '', label: 'Todos los meses' }, ...[...new Set(readArray(home, 'purchases').map((purchase) => String(purchase.date || '').slice(0, 7)).filter(Boolean))].sort().reverse().map((month) => ({ value: month, label: month }))];
  const storeNames = [...new Set(readArray(home, 'stores').map(getStoreName).filter(Boolean))].sort();
  return `<section class="stack"><div class="section-head"><div><p class="eyebrow">Historial real</p><h2 class="section-title">Compras y tickets</h2></div>${button(ctx, 'Registrar compra', 'food-purchase-add', '', 'primary')}</div><div class="form-grid compact-filters">${changeableSelect(ctx, 'Mes', 'purchase-month', monthOptions, currentMonth, 'food-purchase-month')}${changeableSelect(ctx, 'Tienda', 'purchase-store', [{ value: '', label: 'Todas las tiendas' }, ...storeNames.map((name) => ({ value: name, label: name }))], currentStore, 'food-purchase-store')}</div>${purchases.length ? `<div class="stack">${purchases.map((purchase) => { const difference = purchaseDifference(purchase); return `<article class="list-row"><div><strong>${esc(ctx, purchase.store || 'Tienda no indicada')}</strong><p class="muted small">${esc(ctx, formatDate(ctx, purchase.date))} · ${purchase.total == null ? 'Total no indicado' : esc(ctx, money(ctx, purchase.total))} · ${(purchase.lines || []).length} línea${(purchase.lines || []).length === 1 ? '' : 's'}</p>${difference != null && Math.abs(difference) > 0.009 ? `<p class="small">Diferencia ticket/desglose: ${esc(ctx, money(ctx, difference))}</p>` : ''}</div><div class="row">${button(ctx, 'Editar', 'food-purchase-edit', purchase.id, 'ghost')}${button(ctx, 'Eliminar', 'food-purchase-delete', purchase.id, 'ghost')}</div></article>`; }).join('')}</div>` : `<div class="empty"><strong>No hay compras con estos filtros</strong><p>Registra un ticket o una compra por producto para formar precios reales.</p></div>`}<p class="muted small">Los precios se guardan por línea y se usan sólo cuando el producto y la unidad son compatibles.</p></section>`;
}

export function renderFoods(ctx) {
  const home = getHome(ctx);
  const tab = view(ctx).foodTab || 'inventory';
  const image = typeof ctx?.img === 'function' ? ctx.img('food', 'module-hero-art') : '';
  const tabs = [['inventory', 'Inventario'], ['shopping', 'Súper'], ['purchases', 'Compras']].map(([value, label]) => `<button type="button" class="tab ${tab === value ? 'active' : ''}" data-action="food-tab" data-tab="${value}">${esc(ctx, label)}</button>`).join('');
  const content = tab === 'shopping' ? renderSuperTab(ctx, home) : tab === 'purchases' ? renderPurchaseTab(ctx, home) : renderInventoryTab(ctx, home);
  return `<main class="module foods-module" data-page="alimentos" style="--accent:#4FC1E9;--soft:#E8F8FD"><section class="panel module-hero"><div><p class="eyebrow">Alimentos</p><h1 class="section-title">Tu hogar, bien abastecido</h1><p class="muted">Inventario, súper y compras reales en un mismo lugar.</p><div class="row">${button(ctx, 'Dónde compramos', 'food-store-near', '', 'secondary')}${button(ctx, 'Agregar al súper', 'food-add-shopping', '', 'primary')}</div></div>${image}</section><section class="panel"><div class="tabs" role="tablist">${tabs}</div>${content}</section></main>`;
}

function inventoryForm(ctx, item = null) {
  return `<div class="form-grid">${field(ctx, 'Alimento', 'name', item?.name || '', 'text', 'required maxlength="100"')}${field(ctx, 'Cantidad', 'quantity', item ? inventoryQuantityInput(item) : '', 'number', 'min="0" step="any" required')}${field(ctx, 'Unidad', 'unit', item?.unit || 'pieza', 'text', 'required maxlength="30"')}${select(ctx, 'Ubicación', 'location', LOCATIONS, item?.location || 'despensa')}${field(ctx, 'Caducidad (opcional)', 'expiration', item?.expiration || '', 'date')}</div>`;
}

function openInventoryModal(ctx, item = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(item);
  ctx.modal(editing ? 'Editar alimento' : 'Agregar alimento', inventoryForm(ctx, item), (fields) => {
    const name = formValue(fields, 'name').trim();
    const quantity = numberOrNull(formValue(fields, 'quantity'));
    const unit = formValue(fields, 'unit').trim();
    if (!name || quantity == null || quantity < 0 || !unit) {
      if (typeof ctx.toast === 'function') ctx.toast('Completa alimento, cantidad y unidad.');
      return false;
    }
    const home = getHome(ctx);
    home.inventory = readArray(home, 'inventory');
    const next = { id: item?.id || idFor(ctx, 'inventory'), name, quantity, stock: quantity, unit, location: formValue(fields, 'location', 'despensa'), expiration: formValue(fields, 'expiration') };
    if (editing) {
      const index = home.inventory.findIndex((entry) => String(entry.id) === String(item.id));
      if (index >= 0) home.inventory[index] = { ...home.inventory[index], ...next };
    } else {
      const existing = home.inventory.find((entry) => sameInventoryProduct(entry, next));
      if (existing) {
        const total = quantityOf(existing) + quantity;
        existing.quantity = total;
        existing.stock = total;
        if (next.expiration) existing.expiration = next.expiration;
      } else home.inventory.push(next);
    }
    saveAndRender(ctx, editing ? 'Inventario actualizado.' : 'Alimento agregado al inventario.');
  });
}

function shoppingForm(ctx, item = null) {
  return `<div class="form-grid">${field(ctx, 'Producto', 'name', item?.name || '', 'text', 'required maxlength="100"')}${field(ctx, 'Cantidad', 'quantity', item?.quantity ?? 1, 'number', 'min="0.01" step="any" required')}${field(ctx, 'Unidad', 'unit', item?.unit || 'pieza', 'text', 'required maxlength="30"')}${field(ctx, 'Nota', 'note', item?.note || '', 'text', 'maxlength="300"')}</div><p class="muted small">Si ya existe un pendiente con el mismo producto y unidad, se consolida en un solo renglón.</p>`;
}

function openShoppingModal(ctx, item = null) {
  if (typeof ctx?.modal !== 'function') return;
  const editing = Boolean(item);
  ctx.modal(editing ? 'Editar producto del súper' : 'Agregar al súper', shoppingForm(ctx, item), (fields) => {
    const name = formValue(fields, 'name').trim();
    const quantity = numberOrNull(formValue(fields, 'quantity'));
    const unit = formValue(fields, 'unit').trim();
    if (!name || quantity == null || quantity <= 0 || !unit) {
      if (typeof ctx.toast === 'function') ctx.toast('Completa producto, cantidad y unidad.');
      return false;
    }
    const home = getHome(ctx);
    home.shopping = readArray(home, 'shopping');
    if (editing) {
      const target = home.shopping.find((entry) => String(entry.id) === String(item.id));
      if (target) Object.assign(target, { name, quantity, unit, note: formValue(fields, 'note'), status: target.status || 'pending' });
    } else {
      const next = addShoppingItem(home, { id: idFor(ctx, 'shopping'), name, quantity, unit, note: formValue(fields, 'note') });
      home.shopping = next.shopping;
    }
    saveAndRender(ctx, editing ? 'Producto actualizado.' : 'Producto agregado al súper.');
  });
}

function transferForm(ctx, item) {
  return `<div class="form-grid">${field(ctx, 'Producto', 'name', item?.name || '', 'text', 'readonly')}${field(ctx, 'Cantidad a pasar', 'quantity', item?.quantity ?? 1, 'number', 'min="0.01" step="any" required')}${select(ctx, 'Ubicación', 'location', LOCATIONS, 'despensa')}${field(ctx, 'Caducidad (opcional)', 'expiration', '', 'date')}</div><p class="muted small">Pasar al inventario es una acción explícita. Repetirla no duplica el renglón comprado.</p>`;
}

function openTransferModal(ctx, item) {
  if (typeof ctx?.modal !== 'function') return;
  ctx.modal('Pasar compra a inventario', transferForm(ctx, item), (fields) => {
    const quantity = numberOrNull(formValue(fields, 'quantity'));
    if (quantity == null || quantity <= 0) {
      if (typeof ctx.toast === 'function') ctx.toast('Indica una cantidad mayor a cero.');
      return false;
    }
    const home = getHome(ctx);
    const result = transferToInventory(home, item.id, { quantity, location: formValue(fields, 'location'), expiration: formValue(fields, 'expiration') });
    home.inventory = result.home.inventory;
    home.shopping = result.home.shopping;
    home.inventoryTransfers = result.home.inventoryTransfers;
    saveAndRender(ctx, result.idempotent ? 'Esta compra ya estaba en inventario.' : 'Compra pasada a inventario.');
  });
}

function lineForm(ctx, line = null) {
  return `<div class="form-grid">${field(ctx, 'Producto', 'name', line?.name || '', 'text', 'required maxlength="100"')}${field(ctx, 'Cantidad', 'quantity', line?.quantity ?? '', 'number', 'min="0.01" step="any"')}${field(ctx, 'Unidad', 'unit', line?.unit || 'pieza', 'text', 'maxlength="30"')}${field(ctx, 'Importe neto pagado de línea', 'amount', line?.amount ?? '', 'number', 'min="0.01" step="0.01"')}${field(ctx, 'Descuento de línea', 'discount', line?.discount ?? 0, 'number', 'min="0" step="0.01"')}</div>`;
}

function purchaseForm(ctx, home, purchase = null) {
  const lines = Array.isArray(purchase?.lines) ? purchase.lines : [];
  const lineHtml = lines.length ? lines.map((line, index) => `<div class="soft purchase-line-editor" data-line-index="${index}"><div class="section-head"><strong>${esc(ctx, line.name || `Línea ${index + 1}`)}</strong>${button(ctx, 'Quitar', 'food-purchase-line-remove', String(index), 'ghost')}</div>${lineForm(ctx, line)}</div>`).join('') : '<p class="muted small">Agrega el desglose disponible. Un ticket sin desglose sí se guarda, pero no inventa precios.</p>';
  const selectedStore = purchase?.store || view(ctx).foodStoreDraft || '';
  return `<div class="form-grid">${field(ctx, 'Fecha', 'date', purchase?.date || today(ctx), 'date', 'required')}${field(ctx, 'Tienda', 'store', selectedStore, 'text', 'maxlength="100" required')}${field(ctx, 'Total del ticket', 'total', purchase?.total ?? '', 'number', 'min="0.01" step="0.01"')} ${field(ctx, 'Descuentos del ticket', 'discounts', purchase?.discounts ?? 0, 'number', 'min="0" step="0.01')}</div><div class="section-head"><div><p class="eyebrow">Desglose</p><h3 class="section-title">Líneas reales</h3></div>${button(ctx, 'Agregar línea', 'food-purchase-line-add', '', 'secondary')}</div><div class="stack">${lineHtml}</div>${field(ctx, 'Nota', 'note', purchase?.note || '', 'text', 'maxlength="500"')}<p class="muted small">El importe neto pagado de línea ya incluye el descuento; el descuento capturado es informativo y no se resta dos veces. Los ajustes del ticket no se asignan a líneas. El total y la suma de líneas se guardan por separado para mostrar cualquier diferencia.</p>`;
}

function collectPurchaseFields(fields) {
  const lines = [];
  const form = fields?.form || fields?.element || null;
  const roots = form?.querySelectorAll ? [...form.querySelectorAll('[data-line-index]')] : [];
  roots.forEach((root) => {
    const get = (name) => root.querySelector(`[name="${name}"]`)?.value ?? '';
    lines.push({ name: get('name'), quantity: get('quantity'), unit: get('unit'), amount: get('amount'), discount: get('discount') });
  });
  if (!roots.length && Array.isArray(fields?.lines)) return fields.lines;
  return lines;
}

function openPurchaseModal(ctx, purchase = null) {
  if (typeof ctx?.modal !== 'function') return;
  const home = getHome(ctx);
  const editing = Boolean(purchase);
  ctx.modal(editing ? 'Editar compra' : 'Registrar compra', purchaseForm(ctx, home, purchase), (fields, form) => {
    const date = formValue(fields, 'date');
    const store = formValue(fields, 'store').trim();
    if (!date || !store) {
      if (typeof ctx.toast === 'function') ctx.toast('Completa la fecha y la tienda.');
      return false;
    }
    const lines = collectPurchaseFields({ ...fields, form: form || fields?.form });
    const nextPurchase = { id: purchase?.id || idFor(ctx, 'purchase'), date, store: storeByName(home, store, ctx), total: numberOrNull(formValue(fields, 'total')), discounts: numberOrNull(formValue(fields, 'discounts')) || 0, lines, note: formValue(fields, 'note') };
    if (editing) {
      const target = readArray(home, 'purchases').find((entry) => String(entry.id) === String(purchase.id));
      if (target) Object.assign(target, recordPurchase({}, nextPurchase).purchase);
    } else {
      const result = recordPurchase(home, nextPurchase);
      home.purchases = result.home.purchases;
    }
    view(ctx).foodStoreDraft = '';
    saveAndRender(ctx, editing ? 'Compra actualizada.' : 'Compra registrada.');
  });
}

function openStoreModal(ctx, status = 'idle', stores = []) {
  if (typeof ctx?.modal !== 'function') return;
  const message = status === 'permission-denied'
    ? 'No diste permiso de ubicación. Puedes escribir la tienda manualmente.'
    : status === 'no-results'
      ? 'No encontramos establecimientos cercanos. Escribe la tienda manualmente.'
      : status === 'error' || status === 'timeout'
        ? 'La búsqueda no estuvo disponible. Escribe la tienda manualmente.'
        : 'Puedes buscar establecimientos cercanos o escribir la tienda manualmente.';
  const suggestions = stores.length ? `<div class="stack"><p class="eyebrow">Sugerencias cercanas</p>${stores.map((store) => button(ctx, store.name, 'food-store-use', store.id, 'secondary', `data-store-name="${esc(ctx, store.name)}"`)).join('')}</div>` : '';
  ctx.modal('Dónde compramos', `<p class="muted small">${esc(ctx, message)}</p>${suggestions}${field(ctx, 'Tienda', 'store', view(ctx).foodStoreDraft || '', 'text', 'maxlength="100" required')}<p class="muted small">Siempre puedes capturarla manualmente. Wello no guarda tus coordenadas.</p>`, (fields) => {
    const name = formValue(fields, 'store').trim();
    if (!name) {
      if (typeof ctx.toast === 'function') ctx.toast('Escribe el nombre de la tienda.');
      return false;
    }
    view(ctx).foodStoreDraft = name;
    if (typeof ctx?.closeModal === 'function') ctx.closeModal();
    openPurchaseModal(ctx);
  });
}

async function findNearbyFromAction(ctx) {
  if (!globalThis.navigator?.geolocation?.getCurrentPosition) {
    openStoreModal(ctx, 'unavailable');
    return;
  }
  openStoreModal(ctx, 'searching');
  globalThis.navigator.geolocation.getCurrentPosition(async (position) => {
    const result = await lookupNearby(position.coords.latitude, position.coords.longitude);
    if (typeof ctx?.closeModal === 'function') ctx.closeModal();
    openStoreModal(ctx, result.status, result.stores);
  }, () => {
    openStoreModal(ctx, 'permission-denied');
  }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
}

function actionData(data, element) {
  const source = data || element?.dataset || {};
  return { ...source, id: source.id || element?.dataset?.id, filter: source.filter || element?.dataset?.filter, tab: source.tab || element?.dataset?.tab };
}

function registerAction(ctx, name, callback) {
  if (typeof ctx?.action === 'function') ctx.action(name, callback);
}

function registerChange(ctx, name, callback) {
  if (typeof ctx?.change === 'function') ctx.change(name, callback);
}

export function openShopping(ctx) {
  openShoppingModal(ctx);
}

export function registerFoods(ctx) {
  registerAction(ctx, 'food-tab', (data, event, element) => { view(ctx).foodTab = actionData(data, element).tab || 'inventory'; if (typeof ctx.render === 'function') ctx.render(); });
  registerAction(ctx, 'food-filter', (data, event, element) => { view(ctx).foodFilter = actionData(data, element).filter || 'all'; if (typeof ctx.render === 'function') ctx.render(); });
  registerAction(ctx, 'food-inventory-add', () => openInventoryModal(ctx));
  registerAction(ctx, 'food-inventory-edit', (data, event, element) => { const item = readArray(getHome(ctx), 'inventory').find((entry) => String(entry.id) === String(actionData(data, element).id)); if (item) openInventoryModal(ctx, item); });
  registerAction(ctx, 'food-inventory-delete', (data, event, element) => { const home = getHome(ctx); const id = actionData(data, element).id; const item = readArray(home, 'inventory').find((entry) => String(entry.id) === String(id)); if (!item) return; confirm(ctx, `¿Eliminar ${item.name || 'este alimento'} del inventario?`, () => { home.inventory = readArray(home, 'inventory').filter((entry) => String(entry.id) !== String(id)); saveAndRender(ctx, 'Alimento eliminado.'); }); });
  registerAction(ctx, 'food-inventory-finish', (data, event, element) => { const home = getHome(ctx); const id = actionData(data, element).id; const item = readArray(home, 'inventory').find((entry) => String(entry.id) === String(id)); if (!item) return; const wasAlreadyZero = quantityOf(item) <= 0; item.quantity = 0; item.stock = 0; saveAndRender(ctx, wasAlreadyZero ? 'El alimento ya estaba en cero.' : 'Inventario actualizado a cero.'); if (wasAlreadyZero) return; confirm(ctx, `¿Agregar ${item.name || 'este alimento'} al súper?`, () => { home.shopping = addShoppingItem(home, { name: item.name, quantity: 1, unit: item.unit, note: 'Se terminó del inventario.' }).shopping; saveAndRender(ctx, 'Alimento agregado al súper.'); }); });
  registerAction(ctx, 'food-add-shopping', () => openShoppingModal(ctx));
  registerAction(ctx, 'food-shopping-add', () => openShoppingModal(ctx));
  registerAction(ctx, 'food-shopping-edit', (data, event, element) => { const item = readArray(getHome(ctx), 'shopping').find((entry) => String(entry.id) === String(actionData(data, element).id)); if (item) openShoppingModal(ctx, item); });
  registerAction(ctx, 'food-shopping-toggle', (data, event, element) => { const home = getHome(ctx); const id = actionData(data, element).id; const item = readArray(home, 'shopping').find((entry) => String(entry.id) === String(id)); if (!item) return; const purchased = !item.purchased && String(item.status || 'pending') === 'pending'; item.purchased = purchased; item.status = purchased ? 'purchased' : 'pending'; item.purchasedAt = purchased ? new Date().toISOString() : ''; saveAndRender(ctx, purchased ? 'Renglón marcado como comprado.' : 'Renglón regresó a pendientes.'); });
  registerAction(ctx, 'food-shopping-delete', (data, event, element) => { const home = getHome(ctx); const id = actionData(data, element).id; confirm(ctx, '¿Eliminar este renglón del súper?', () => { home.shopping = readArray(home, 'shopping').filter((entry) => String(entry.id) !== String(id)); saveAndRender(ctx, 'Renglón eliminado.'); }); });
  registerAction(ctx, 'food-transfer', (data, event, element) => { const item = readArray(getHome(ctx), 'shopping').find((entry) => String(entry.id) === String(actionData(data, element).id)); if (item) openTransferModal(ctx, item); });
  registerAction(ctx, 'food-purchase-add', () => openPurchaseModal(ctx));
  registerAction(ctx, 'food-purchase-edit', (data, event, element) => { const purchase = readArray(getHome(ctx), 'purchases').find((entry) => String(entry.id) === String(actionData(data, element).id)); if (purchase) openPurchaseModal(ctx, purchase); });
  registerAction(ctx, 'food-purchase-delete', (data, event, element) => { const home = getHome(ctx); const id = actionData(data, element).id; confirm(ctx, '¿Eliminar este ticket del historial?', () => { home.purchases = readArray(home, 'purchases').filter((entry) => String(entry.id) !== String(id)); saveAndRender(ctx, 'Compra eliminada.'); }); });
  registerAction(ctx, 'food-purchase-line-add', (data, event, element) => {
    const form = element?.closest?.('form');
    const container = form?.querySelector?.('.purchase-line-editor')?.parentElement || form?.querySelector?.('.stack');
    if (container && typeof container.insertAdjacentHTML === 'function') {
      const index = container.querySelectorAll('[data-line-index]').length;
      container.insertAdjacentHTML('beforeend', `<div class="soft purchase-line-editor" data-line-index="${index}"><div class="section-head"><strong>Línea ${index + 1}</strong>${button(ctx, 'Quitar', 'food-purchase-line-remove', String(index), 'ghost')}</div>${lineForm(ctx)}</div>`);
      const placeholder = container.querySelector?.(':scope > .muted');
      if (placeholder) placeholder.remove();
    } else if (typeof ctx.toast === 'function') {
      ctx.toast('Agrega la línea al ticket antes de guardar.');
    }
  });
  registerAction(ctx, 'food-purchase-line-remove', (data, event, element) => {
    const row = element?.closest?.('[data-line-index]');
    if (row) row.remove();
  });
  registerAction(ctx, 'food-store-near', () => findNearbyFromAction(ctx));
  registerAction(ctx, 'food-store-use', (data, event, element) => { const item = actionData(data, element); view(ctx).foodStoreDraft = item.storeName || element?.dataset?.storeName || ''; if (typeof ctx.closeModal === 'function') ctx.closeModal(); openPurchaseModal(ctx); });
  registerChange(ctx, 'food-purchase-month', (data, event, element) => { view(ctx).foodPurchaseMonth = actionData(data, element).value || element?.value || ''; if (typeof ctx.render === 'function') ctx.render(); });
  registerChange(ctx, 'food-purchase-store', (data, event, element) => { view(ctx).foodPurchaseStore = actionData(data, element).value || element?.value || ''; if (typeof ctx.render === 'function') ctx.render(); });
}

export { LOCATIONS, nearbyQuery };
