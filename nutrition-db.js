const NUTRITION_DB_NAME = 'hometasks-nutrition-v11';
const NUTRITION_DB_VERSION = 3;
export const NUTRITION_DATA_STORES = ['foods', 'targets', 'mealTypes', 'entries', 'chatMessages'];
const NUTRITION_STORES = [...NUTRITION_DATA_STORES, 'sync'];
const LS_DEVICE_ID = 'hometasks-device-id';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function nutritionEntityId(storeName, value) {
  if (!value) return '';
  return storeName === 'targets' ? String(value.personId || '') : String(value.id || '');
}

function getDeviceId() {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

function notifyNutritionChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('hometasks:nutrition-changed', { detail }));
  } catch (_) {}
}

export function openNutritionDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NUTRITION_DB_NAME, NUTRITION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of NUTRITION_STORES) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const options = storeName === 'targets' ? { keyPath: 'personId' } : { keyPath: 'id' };
        db.createObjectStore(storeName, options);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function nutritionGetAll(storeName) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const rows = await requestToPromise(tx.objectStore(storeName).getAll());
  db.close();
  return rows;
}

export async function nutritionPut(storeName, value, options = {}) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  db.close();
  if (!options.silent && storeName !== 'sync') notifyNutritionChanged({ store: storeName, entityId: nutritionEntityId(storeName, value), type: 'put' });
}

export async function nutritionPutMany(storeName, values, options = {}) {
  if (!values.length) return;
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  values.forEach(value => store.put(value));
  await transactionDone(tx);
  db.close();
  if (!options.silent && storeName !== 'sync') notifyNutritionChanged({ store: storeName, count: values.length, type: 'putMany' });
}

export async function nutritionRemove(storeName, id, options = {}) {
  const createTombstone = options.tombstone !== false && NUTRITION_DATA_STORES.includes(storeName);
  const stores = createTombstone ? [storeName, 'sync'] : [storeName];
  const db = await openNutritionDatabase();
  const tx = db.transaction(stores, 'readwrite');
  tx.objectStore(storeName).delete(id);
  if (createTombstone) {
    const deletedAt = Number(options.deletedAt || Date.now());
    tx.objectStore('sync').put({
      id: `tombstone:${storeName}:${id}`,
      kind: 'tombstone',
      store: storeName,
      entityId: String(id),
      deletedAt,
      deviceId: getDeviceId(),
    });
  }
  await transactionDone(tx);
  db.close();
  if (!options.silent && storeName !== 'sync') notifyNutritionChanged({ store: storeName, entityId: String(id), type: 'remove' });
}

export async function nutritionClear(storeName, options = {}) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await transactionDone(tx);
  db.close();
  if (!options.silent && storeName !== 'sync') notifyNutritionChanged({ store: storeName, type: 'clear' });
}

export async function resetNutritionDatabase() {
  for (const storeName of NUTRITION_STORES) await nutritionClear(storeName, { silent: true });
  notifyNutritionChanged({ type: 'reset' });
}
