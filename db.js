const DB_NAME = 'hometasks-v0';
const DB_VERSION = 4;
const STORES = ['rooms', 'tasks', 'history', 'settings', 'users', 'templates', 'sync'];

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

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const data = await requestToPromise(tx.objectStore(storeName).getAll());
  db.close();
  return data;
}

export async function getOne(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const data = await requestToPromise(tx.objectStore(storeName).get(id));
  db.close();
  return data;
}

export async function put(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  db.close();
}

export async function putMany(storeName, values) {
  if (!values.length) return;
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  values.forEach(value => store.put(value));
  await transactionDone(tx);
  db.close();
}

export async function remove(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await transactionDone(tx);
  db.close();
}

export async function clearStore(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await transactionDone(tx);
  db.close();
}

export async function resetDatabase() {
  for (const store of STORES) await clearStore(store);
}
