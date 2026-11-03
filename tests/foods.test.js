import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addShoppingItem,
  consolidateShopping,
  estimateShopping,
  lookupNearby,
  normalizeProductName,
  recordPurchase,
  registerFoods,
  transferToInventory,
  unitsCompatible,
} from '../src/modules/foods.js';

test('estimateShopping usa el último precio compatible y no cuenta compras terminadas', () => {
  const home = {
    shopping: [
      { id: 'milk', name: 'Leche', quantity: 3, unit: 'piezas', status: 'pending' },
      { id: 'bread', name: 'Pan', quantity: 1, unit: 'pieza', status: 'pending' },
      { id: 'done', name: 'Leche', quantity: 2, unit: 'piezas', status: 'purchased' },
    ],
    purchases: [
      { id: 'old', date: '2026-01-01', lines: [{ name: 'Leche', quantity: 1, unit: 'pieza', amount: 20 }] },
      { id: 'latest', date: '2026-02-01', lines: [{ name: 'Leche', quantity: 2, unit: 'piezas', amount: 50 }] },
    ],
  };
  const estimate = estimateShopping(home);
  assert.equal(estimate.subtotal, 75);
  assert.equal(estimate.items.find((item) => item.id === 'milk').estimate, 75);
  assert.deepEqual(estimate.unpriced.map((item) => item.id), ['bread']);
  assert.equal(estimate.pendingCount, 2);
  assert.notEqual(estimate.unpriced[0].estimate, 0);
});

test('estimateShopping separa la falta de precio y unidades incompatibles', () => {
  const result = estimateShopping({
    shopping: [{ id: 'a', name: 'Arroz', quantity: 2, unit: 'kg', status: 'pending' }],
    purchases: [{ date: '2026-01-01', lines: [{ name: 'Arroz', quantity: 2, unit: 'piezas', amount: 40 }] }],
  });
  assert.equal(result.subtotal, null);
  assert.equal(result.knownSubtotal, 0);
  assert.equal(result.unpriced[0].price, null);
  assert.equal(unitsCompatible('pzas', 'pieza'), true);
  assert.equal(unitsCompatible('kg', 'pieza'), false);
});

test('consolidateShopping suma pendientes del mismo producto y unidad, pero no compras cerradas', () => {
  const result = consolidateShopping([
    { id: 'one', name: ' Leche ', quantity: 1, unit: 'pieza', status: 'pending' },
    { id: 'two', name: 'leche', quantity: 2, unit: 'piezas', status: 'pending' },
    { id: 'done', name: 'Leche', quantity: 4, unit: 'piezas', status: 'purchased' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.id === 'one').quantity, 3);
  assert.equal(result.find((item) => item.id === 'done').quantity, 4);
  assert.equal(normalizeProductName('Árbol  verde'), 'arbol verde');
});

test('pasar al inventario es explícito, conserva ubicación/caducidad y es idempotente', () => {
  const home = {
    shopping: [{ id: 'shop-1', name: 'Yogur', quantity: 2, unit: 'piezas', status: 'pending' }],
    inventory: [],
  };
  const first = transferToInventory(home, 'shop-1', { location: 'refri', expiration: '2026-11-10' });
  assert.equal(first.changed, true);
  assert.equal(first.home.inventory.length, 1);
  assert.equal(first.home.inventory[0].quantity, 2);
  assert.equal(first.home.inventory[0].location, 'refri');
  assert.equal(first.home.shopping[0].status, 'purchased');

  const repeated = transferToInventory(first.home, 'shop-1', { location: 'refri', expiration: '2026-11-10' });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.home.inventory.length, 1);
  assert.equal(repeated.home.inventory[0].quantity, 2);
});

test('transferencias consolidadas conservan cada fuente y sobreviven una recarga JSON', () => {
  const home = {
    shopping: [
      { id: 's1', name: 'Arroz', quantity: 2, unit: 'kg', status: 'pending' },
      { id: 's2', name: 'Arroz', quantity: 3, unit: 'kg', status: 'pending' },
    ],
    inventory: [],
  };
  const first = transferToInventory(home, 's1', { transferId: 't1' });
  const second = transferToInventory(first.home, 's2', { transferId: 't2' });
  const inventoryItem = second.home.inventory[0];

  assert.equal(second.home.inventory.length, 1);
  assert.equal(inventoryItem.quantity, 5);
  assert.deepEqual(inventoryItem.sourceShoppingIds, ['s1', 's2']);
  assert.deepEqual(inventoryItem.transferIds, ['t1', 't2']);
  assert.deepEqual(second.home.inventoryTransfers.map(({ transferId, sourceShoppingId }) => ({ transferId, sourceShoppingId })), [
    { transferId: 't1', sourceShoppingId: 's1' },
    { transferId: 't2', sourceShoppingId: 's2' },
  ]);

  const reloaded = JSON.parse(JSON.stringify(second.home));
  const repeated = transferToInventory(reloaded, 's1', { transferId: 't1' });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.home.inventory.length, 1);
  assert.equal(repeated.home.inventory[0].quantity, 5);
  assert.deepEqual(repeated.home.inventory[0].sourceShoppingIds, ['s1', 's2']);
  assert.equal(repeated.home.shopping.find((item) => item.id === 's1').inventoryTransferred, true);
});

test('migra metadatos singulares de transferencia de forma aditiva y bloquea la repetición', () => {
  const home = {
    shopping: [{ id: 'legacy-source', name: 'Frijol', quantity: 1, unit: 'kg', status: 'purchased', transferId: 'legacy-transfer' }],
    inventory: [{ id: 'legacy-inventory', name: 'Frijol', quantity: 1, stock: 1, unit: 'kg', location: 'despensa', sourceShoppingId: 'legacy-source', transferId: 'legacy-transfer' }],
  };
  const result = transferToInventory(home, 'legacy-source');

  assert.equal(result.idempotent, true);
  assert.equal(result.home.inventory[0].quantity, 1);
  assert.deepEqual(result.home.inventory[0].transferIds, ['legacy-transfer']);
  assert.deepEqual(result.home.inventory[0].sourceShoppingIds, ['legacy-source']);
  assert.deepEqual(result.home.inventoryTransfers.map(({ transferId, sourceShoppingId }) => ({ transferId, sourceShoppingId })), [
    { transferId: 'legacy-transfer', sourceShoppingId: 'legacy-source' },
  ]);
});

test('poner inventario en cero guarda antes de ofrecer el súper y no repite el renglón', () => {
  const home = { inventory: [{ id: 'inv-1', name: 'Leche', quantity: 2, stock: 2, unit: 'pieza' }] };
  const actions = new Map();
  const confirmations = [];
  let saves = 0;
  const ctx = {
    home,
    action(name, callback) { actions.set(name, callback); },
    save() { saves += 1; },
    render() {},
    confirm(message, callback) { confirmations.push({ message, callback }); },
  };
  registerFoods(ctx);
  const finish = actions.get('food-inventory-finish');
  finish({ id: 'inv-1' });

  assert.equal(home.inventory[0].quantity, 0);
  assert.equal(home.inventory[0].stock, 0);
  assert.deepEqual(home.shopping, []);
  assert.equal(confirmations.length, 1);
  assert.equal(saves, 1);

  confirmations.shift().callback();
  assert.equal(home.shopping.length, 1);
  assert.equal(saves, 2);

  finish({ id: 'inv-1' });
  assert.equal(home.shopping.length, 1);
  assert.equal(confirmations.length, 0);
  assert.equal(saves, 3);
});

test('recordPurchase conserva ticket, líneas, descuentos y diferencia sin inventar líneas', () => {
  const result = recordPurchase({ purchases: [] }, {
    id: 'ticket-1', date: '2026-11-03', store: 'Mercado', total: 110, discounts: 5,
    lines: [{ id: 'line-1', name: 'Pan', quantity: 2, unit: 'piezas', amount: 100, discount: 5 }],
  });
  assert.equal(result.purchase.total, 110);
  assert.equal(result.purchase.lines[0].amount, 100);
  assert.equal(result.purchase.difference, 10);
  assert.equal(result.home.purchases.length, 1);
  const estimate = estimateShopping({
    shopping: [{ id: 'bread', name: 'Pan', quantity: 2, unit: 'piezas', status: 'pending' }],
    purchases: [result.purchase],
  });
  assert.equal(estimate.subtotal, 100);

  const repeated = recordPurchase(result.home, { id: 'ticket-1', total: 999, lines: [] });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.home.purchases[0].total, 110);
});

test('el modal de ticket conserva total con step válido y contrato FormData superior', () => {
  const home = {
    purchases: [{
      id: 'ticket-view', date: '2026-11-03', store: 'Mercado', total: 50,
      lines: [{ name: 'Pan', quantity: 1, unit: 'pieza', amount: 50, discount: 5 }],
    }],
  };
  const actions = new Map();
  const modals = [];
  const ctx = {
    home,
    action(name, callback) { actions.set(name, callback); },
    modal(title, html, callback) { modals.push({ title, html, callback }); },
    save() {},
    render() {},
  };
  registerFoods(ctx);
  actions.get('food-purchase-edit')({ id: 'ticket-view' });
  assert.match(modals.at(-1).html, /name="total"[^>]*step="0\.01"/);
  assert.match(modals.at(-1).html, /Importe neto pagado de línea/);
  assert.match(modals.at(-1).html, /descuento capturado es informativo y no se resta dos veces/);

  actions.get('food-purchase-add')();
  const formData = new FormData();
  formData.set('date', '2026-11-04');
  formData.set('store', 'Mercado');
  formData.set('total', '50');
  formData.set('discounts', '5');
  formData.append('name', 'Pan');
  formData.append('quantity', '1');
  formData.append('unit', 'pieza');
  formData.append('amount', '50');
  formData.append('discount', '5');
  modals.at(-1).callback(formData, { querySelectorAll: () => [] });
  assert.equal(home.purchases.at(-1).total, 50);
  assert.equal(home.purchases.at(-1).store, 'Mercado');
});

test('lookupNearby transforma resultados Overpass a tiendas sin guardar coordenadas', async () => {
  let requestedUrl = '';
  const fetcher = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ elements: [
      { type: 'node', id: 1, lat: 19.4, lon: -99.1, tags: { name: 'Súper Centro', shop: 'supermarket' } },
      { type: 'way', id: 2, center: { lat: 19.4, lon: -99.1 }, tags: { name: 'Súper Centro', shop: 'supermarket' } },
    ] }) };
  };
  const result = await lookupNearby(19.4, -99.1, fetcher, { timeout: 100 });
  assert.equal(result.status, 'results');
  assert.equal(result.stores.length, 1);
  assert.equal(result.stores[0].name, 'Súper Centro');
  assert.equal('lat' in result.stores[0], false);
  assert.match(requestedUrl, /overpass-api/);
});

test('lookupNearby expone estado de sin resultados y no requiere red para coordenadas inválidas', async () => {
  const empty = await lookupNearby(19.4, -99.1, async () => ({ ok: true, json: async () => ({ elements: [] }) }), { timeout: 100 });
  assert.equal(empty.status, 'no-results');
  assert.deepEqual(empty.stores, []);
  const invalid = await lookupNearby('no', -99.1, async () => { throw new Error('no debe llamarse'); });
  assert.equal(invalid.status, 'invalid');
});

test('addShoppingItem consolida un pendiente sin cambiar colecciones personales', () => {
  const home = { shopping: [{ id: 'existing', name: 'Huevos', quantity: 6, unit: 'piezas', status: 'pending' }], personal: { moods: [{ date: '2026-11-03' }] } };
  const next = addShoppingItem(home, { name: 'Huevos', quantity: 6, unit: 'pieza' });
  assert.equal(next.shopping.length, 1);
  assert.equal(next.shopping[0].quantity, 12);
  assert.deepEqual(next.personal, home.personal);
  assert.equal(home.shopping[0].quantity, 6);
});
