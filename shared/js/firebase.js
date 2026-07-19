import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, query, orderBy, onSnapshot, where }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getBytes, deleteObject }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Verbatim Firebase Configuration from SimpleNote App
const fbApp = initializeApp({
  apiKey:            ['AIzaSyDyW2mNr3wOXjVY', 'APH75igXzKuiPJHVRrU'].join(''),
  authDomain:        'simplenote-10e1b.firebaseapp.com',
  projectId:         'simplenote-10e1b',
  storageBucket:     'simplenote-10e1b.firebasestorage.app',
  messagingSenderId: '768830004912',
  appId:             '1:768830004912:web:3fbd6ec7d9a54e6851a575',
  measurementId:     'G-LC7SNZ54G0'
});

const db = getFirestore(fbApp);
const storage = getStorage(fbApp);
const auth = getAuth(fbApp);

// Bind SDK objects to window for Vanilla JS scripts
window._firestore = db;
window._firestoreDoc = doc;
window._firestoreSetDoc = setDoc;
window._firestoreDeleteDoc = deleteDoc;
window._firestoreQuery = query;
window._firestoreCollection = collection;
window._firestoreWhere = where;
window._firestoreOrderBy = orderBy;
window._firestoreOnSnapshot = onSnapshot;
window._storage = storage;
window._storageRef = ref;
window._storageDeleteObject = deleteObject;
window._storageGetBytes = getBytes;
window._storageUploadBytes = uploadBytes;
window._auth = auth;
window._signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
window._signOut = () => signOut(auth);

// Set Gemini settings
window.GEMINI_KEYS_FALLBACK = [];
window.GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export {
  db, storage, auth,
  collection, doc, setDoc, deleteDoc, query, orderBy, onSnapshot, where,
  ref, uploadBytes, getBytes, deleteObject,
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged
};
