const DATABASE_NAME = 'little-archive-memories';
const STORE_NAME = 'exports';
const LIFETIME_MS = 60 * 60 * 1000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('expiresAt', 'expiresAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMemory(blob, filename) {
  if (!('indexedDB' in window)) throw new Error('This browser cannot temporarily save memories.');
  const database = await openDatabase();
  const now = Date.now();
  const record = { id: crypto.randomUUID(), filename, blob, createdAt: now, expiresAt: now + LIFETIME_MS };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
  return record;
}

export async function getMemories() {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  const records = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const now = Date.now();
      const active = request.result.filter((record) => record.expiresAt > now);
      request.result.filter((record) => record.expiresAt <= now).forEach((record) => store.delete(record.id));
      resolve(active.sort((a, b) => b.createdAt - a.createdAt));
    };
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return records;
}

export async function deleteMemory(id) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
