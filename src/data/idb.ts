/** A minimal promise wrapper over IndexedDB — no dependency needed. */

export type StoreName =
  | 'months'
  | 'expenses'
  | 'categories'
  | 'recurring'
  | 'buckets'
  | 'sessions'
  | 'settings';

const DB_NAME = 'budget-tracker';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('months')) {
        db.createObjectStore('months', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const store = db.createObjectStore('expenses', { keyPath: 'id' });
        store.createIndex('monthId', 'monthId', { unique: false });
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('recurring')) {
        db.createObjectStore('recurring', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('buckets')) {
        db.createObjectStore('buckets', { keyPath: 'id' });
      }
      // v2 → v3: the feature was called "events" when it shipped. Move the
      // rows over and re-tag the expenses inside the same version-change
      // transaction, so an interrupted upgrade can't half-rename the data.
      const tx = request.transaction;
      if (db.objectStoreNames.contains('events') && tx) {
        const legacy = tx.objectStore('events');
        const target = tx.objectStore('buckets');
        legacy.openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) {
            db.deleteObjectStore('events');
            return;
          }
          target.put(cursor.value);
          cursor.continue();
        };
      }
      if (tx && db.objectStoreNames.contains('expenses')) {
        const expenses = tx.objectStore('expenses');
        expenses.openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const row = cursor.value as Record<string, unknown>;
          if (row.eventId !== undefined || row.eventKind !== undefined) {
            const { eventId, eventKind, ...rest } = row;
            cursor.update({
              ...rest,
              ...(eventId ? { bucketId: eventId, bucketKind: eventKind ?? 'spend' } : {}),
            });
          }
          cursor.continue();
        };
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'monthId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open database.'));
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const rows = await promisify(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  return rows;
}

export async function getAllByIndex<T>(
  store: StoreName,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const request = tx.objectStore(store).index(index).getAll(key) as IDBRequest<T[]>;
  return promisify(request);
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const value = await promisify(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  return value ?? null;
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as unknown as IDBValidKey);
  await done(tx);
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const value of values) os.put(value as unknown as IDBValidKey);
  await done(tx);
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function clearStores(stores: StoreName[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(stores, 'readwrite');
  for (const store of stores) tx.objectStore(store).clear();
  await done(tx);
}
