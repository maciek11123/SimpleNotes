// ─── Firebase Auth, Firestore & Storage ──────────────────────────────────
// SDK v10+ via CDN ESM imports. Replace placeholder config with your project.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

// ─── CONFIG (replace with your Firebase project) ─────────────────────────

const firebaseConfig = {
  apiKey:            'YOUR_FIREBASE_API_KEY',
  authDomain:        'YOUR_PROJECT.firebaseapp.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};

let app, auth, firestore, storage, provider;
let _unsubFirestore = null;

// ─── INIT ────────────────────────────────────────────────────────────────

export function initFirebase() {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    firestore = getFirestore(app);
    storage = getStorage(app);
    provider = new GoogleAuthProvider();
    console.log('[Firebase] Initialized');
    return true;
  } catch (e) {
    console.warn('[Firebase] Init failed — running in local-only mode:', e.message);
    return false;
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  if (!auth) return null;
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (e) {
    console.error('[Auth] Sign-in failed:', e.message);
    return null;
  }
}

export async function signOutUser() {
  if (!auth) return;
  if (_unsubFirestore) {
    _unsubFirestore();
    _unsubFirestore = null;
  }
  try {
    await signOut(auth);
  } catch (e) {
    console.error('[Auth] Sign-out failed:', e.message);
  }
}

export function onAuthChange(callback) {
  if (!auth) return;
  onAuthStateChanged(auth, (user) => callback(user || null));
}

// ─── FIRESTORE SYNC ──────────────────────────────────────────────────────

export function listenToFirestore(userId, callback) {
  if (!firestore) return;

  // Unsubscribe previous listener
  if (_unsubFirestore) _unsubFirestore();

  const notesRef = collection(firestore, 'users', userId, 'notes');
  const q = query(notesRef, orderBy('updatedAt', 'desc'));

  _unsubFirestore = onSnapshot(q, (snapshot) => {
    const notes = [];
    snapshot.forEach((docSnap) => {
      notes.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(notes);
  }, (error) => {
    console.error('[Firestore] Listener error:', error);
  });
}

export async function syncNoteToFirestore(userId, noteData) {
  if (!firestore) return;
  const noteRef = doc(firestore, 'users', userId, 'notes', noteData.id);

  // Strip non-serializable fields and audioBlob (stored in Storage)
  const cleanData = { ...noteData };
  delete cleanData.audioBlob;
  delete cleanData._syncTimeout;
  cleanData._serverTimestamp = serverTimestamp();

  await setDoc(noteRef, cleanData, { merge: true });
}

export async function deleteNoteFromFirestore(userId, noteId) {
  if (!firestore) return;
  const noteRef = doc(firestore, 'users', userId, 'notes', noteId);
  await deleteDoc(noteRef);
}

// ─── FIREBASE STORAGE (Audio) ────────────────────────────────────────────

export async function uploadAudioToStorage(userId, noteId, arrayBuffer) {
  if (!storage) return null;
  const audioRef = ref(storage, `users/${userId}/audio/${noteId}.webm`);
  const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
  await uploadBytes(audioRef, blob);
  return getDownloadURL(audioRef);
}

export async function deleteAudioFromStorage(userId, noteId) {
  if (!storage) return;
  try {
    const audioRef = ref(storage, `users/${userId}/audio/${noteId}.webm`);
    await deleteObject(audioRef);
  } catch (e) {
    // Ignore if file doesn't exist
    if (e.code !== 'storage/object-not-found') {
      console.warn('[Storage] Delete failed:', e.message);
    }
  }
}
