import type { ThumbnailCache, ThumbnailCheckpoint } from './thumbnailJobs';

let database: Promise<IDBDatabase> | undefined;
function openCache() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ring-builder-thumbnail-progress', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('renders', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error('Browser storage is unavailable. Enable site storage to save thumbnail progress.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Close older admin tabs to update thumbnail storage.')); };
  });
}
export const thumbnailCache: ThumbnailCache = {
  async get(id) {
    const db = await openCache();
    return new Promise<ThumbnailCheckpoint | undefined>((resolve, reject) => {
      const transaction = db.transaction('renders', 'readonly'), request = transaction.objectStore('renders').get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Could not read saved thumbnail progress.'));
    });
  },
  async put(record) {
    const db = await openCache();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('renders', 'readwrite'); transaction.objectStore('renders').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error('Could not save thumbnail progress. Check available browser storage.'));
    });
  },
};
