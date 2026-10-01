const NUTRITION_DB_NAME = 'hometasks-nutrition-v11';
const NUTRITION_DB_VERSION = 2;
const NUTRITION_STORES = ['foods', 'targets', 'mealTypes', 'entries', 'chatMessages'];

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

export async function nutritionPut(storeName, value) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  db.close();
}

export async function nutritionPutMany(storeName, values) {
  if (!values.length) return;
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  values.forEach(value => store.put(value));
  await transactionDone(tx);
  db.close();
}

export async function nutritionRemove(storeName, id) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await transactionDone(tx);
  db.close();
}

export async function nutritionClear(storeName) {
  const db = await openNutritionDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await transactionDone(tx);
  db.close();
}

export async function resetNutritionDatabase() {
  for (const storeName of NUTRITION_STORES) await nutritionClear(storeName);
}
