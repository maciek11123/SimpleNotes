// ─── IndexedDB Local Persistence Layer ───────────────────────────────────
// Zero external dependencies. Raw IndexedDB API for maximum offline resilience.

const DB_NAME = 'simplenotes-db';
const DB_VERSION = 1;
const STORE = 'notes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
}

// ─── READ ────────────────────────────────────────────────────────────────

export async function dbGetAllNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const notes = req.result.sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      resolve(notes);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbGetNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbGetUnsyncedNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('synced');
    const req = idx.getAll(IDBKeyRange.only(false));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── WRITE ───────────────────────────────────────────────────────────────

export async function dbSaveNote(note) {
  note.updatedAt = new Date().toISOString();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(note);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbDeleteNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── FACTORY ─────────────────────────────────────────────────────────────

export function createNote(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    title: '',
    content: '',
    isChecklist: false,
    checklistItems: [],
    tags: [],
    audioBlob: null,
    audioUrl: null,
    transcription: '',
    reminder: null,
    createdAt: now,
    updatedAt: now,
    synced: false,
    ...overrides,
  };
}
