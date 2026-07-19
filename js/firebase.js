import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, query, orderBy, onSnapshot, where }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getBytes, deleteObject }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Verbatim Firebase Configuration from Budget App
const fbApp = initializeApp({
  apiKey:            ['AIzaSyASbcr_P6BC', '-HFUGyv7QXXoKwOSx4yDGPk'].join(''),
  authDomain:        'dad-app-c3920.firebaseapp.com',
  projectId:         'dad-app-c3920',
  storageBucket:     'dad-app-c3920.firebasestorage.app',
  messagingSenderId: '64907277674',
  appId:             '1:64907277674:web:6f4629695384cf78c1e113'
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
