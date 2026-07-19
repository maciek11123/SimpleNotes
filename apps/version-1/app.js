import { toggleRecording } from '../../shared/src/api/audio.js';
import { auth, onAuthStateChanged, signOut, signInWithPopup, GoogleAuthProvider } from '../../shared/js/firebase.js';
// Load custom Gemini API keys if present, otherwise default to fallback key
window.GEMINI_KEYS = [];
let currentKeyIndex = 0;

function initGeminiKeys() {
  const saved = localStorage.getItem('pixel-keep-gemini-keys');
  if (saved) {
    try {
      window.GEMINI_KEYS = JSON.parse(saved);
    } catch(e) {
      window.GEMINI_KEYS = saved.split(/[\s,;]+/).map(k => k.trim()).filter(Boolean);
    }
  } else {
    // Look for legacy single key
    const legacy = localStorage.getItem('pixel-keep-gemini-key');
    if (legacy) {
      window.GEMINI_KEYS = [legacy.trim()];
    } else {
      window.GEMINI_KEYS = [
        ['AQ.Ab8RN6LCzD-Iab9Bi-VibTbnxmKOHlZQEjTs8_', 'brmYptbGbtgQ'].join('')
      ];
    }
  }
}
initGeminiKeys();

window.getGeminiKey = function() {
  if (window.GEMINI_KEYS.length === 0) return '';
  return window.GEMINI_KEYS[currentKeyIndex % window.GEMINI_KEYS.length];
};

window.rotateGeminiKey = function() {
  if (window.GEMINI_KEYS.length > 1) {
    currentKeyIndex = (currentKeyIndex + 1) % window.GEMINI_KEYS.length;
    console.log(`Rotated to Gemini API key index ${currentKeyIndex}: ${window.getGeminiKey().substring(0, 8)}...`);
    return true;
  }
  return false;
};





window.fetchGemini = async function(body) {
  let attempts = 0;
  const maxAttempts = Math.max(1, window.GEMINI_KEYS.length);
  
  while (attempts < maxAttempts) {
    const key = window.getGeminiKey();
    const url = `${window.GEMINI_URL}?key=${key}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429) {
        console.warn(`API key index ${currentKeyIndex} rate limited (429). Attempting rotation...`);
        const rotated = window.rotateGeminiKey();
        if (!rotated) {
          return response;
        }
        attempts++;
        continue;
      }
      
      return response;
    } catch (err) {
      console.error("Gemini fetch attempt error:", err);
      const rotated = window.rotateGeminiKey();
      if (!rotated) {
        throw err;
      }
      attempts++;
    }
  }
  
  throw new Error("All available Gemini API keys are rate limited (429).");
};

let notes = [];
try {
  notes = JSON.parse(localStorage.getItem('pixel-keep-notes')) || [];
} catch(e) {}

let isListMode = false;
let currentUser = null;
let unsubscribeNotesSync = null;

let showAllNotes = false;
let currentPage = 0;
const NOTES_PER_PAGE = 2;
let showArchivedOnly = false;

window.nextPage = function() {
  const filteredNotes = notes.filter(note => showArchivedOnly ? (note.archived === true) : !note.archived);
  if ((currentPage + 1) * NOTES_PER_PAGE < filteredNotes.length) {
    currentPage++;
    renderNotes();
    window.scrollTo({ top: document.getElementById('notes-list-container').offsetTop, behavior: 'smooth' });
  }
};

window.prevPage = function() {
  if (currentPage > 0) {
    currentPage--;
    renderNotes();
    window.scrollTo({ top: document.getElementById('notes-list-container').offsetTop, behavior: 'smooth' });
  }
};

window.viewAllNotes = function() {
  showAllNotes = true;
  currentPage = 0;
  renderNotes();
};

window.viewPaginatedNotes = function() {
  showAllNotes = false;
  currentPage = 0;
  renderNotes();
};

async function saveNoteToCloud(note) {
  if (currentUser && window._firestore) {
    try {
      await window._firestoreSetDoc(
        window._firestoreDoc(window._firestore, 'notes', String(note.id)),
        { ...note, userId: currentUser.uid }
      );
    } catch(e) {
      console.error("Cloud save failed:", e);
    }
  }
}

async function deleteNoteFromCloud(id) {
  if (currentUser && window._firestore) {
    try {
      await window._firestoreDeleteDoc(
        window._firestoreDoc(window._firestore, 'notes', String(id))
      );
    } catch(e) {
      console.error("Cloud delete failed:", e);
    }
  }
}

function startNotesSync(user) {
  if (unsubscribeNotesSync) unsubscribeNotesSync();
  
  const q = window._firestoreQuery(
    window._firestoreCollection(window._firestore, 'notes'),
    window._firestoreWhere('userId', '==', user.uid),
    window._firestoreOrderBy('id', 'desc')
  );
  
  unsubscribeNotesSync = window._firestoreOnSnapshot(q, (snapshot) => {
    notes = [];
    snapshot.forEach(doc => {
      notes.push(doc.data());
    });
    localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
    renderNotes();
  }, err => {
    console.error("Notes Firestore sync error:", err);
  });
}

function stopNotesSync() {
  if (unsubscribeNotesSync) {
    unsubscribeNotesSync();
    unsubscribeNotesSync = null;
  }
  try {
    notes = JSON.parse(localStorage.getItem('pixel-keep-notes')) || [];
  } catch (e) {
    notes = [];
  }
  renderNotes();
}

onAuthStateChanged(auth, (user) => {
  const statusEl = document.getElementById("auth-status");
  const btnEl = document.getElementById("auth-btn");
  
  if (user) {
    currentUser = user;
    if (statusEl) statusEl.textContent = `> LOGGED IN AS ${user.email.toUpperCase()}`;
    if (btnEl) btnEl.textContent = "LOGOUT";
    startNotesSync(user);
  } else {
    currentUser = null;
    if (statusEl) statusEl.textContent = "> OFFLINE MODE (LOCAL)";
    if (btnEl) btnEl.textContent = "SIGN IN";
    stopNotesSync();
  }
});

window.handleAuthAction = async function() {
  if (currentUser) {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Sign out error:", e);
    }
  } else {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      console.error("Sign in error:", e);
    }
  }
};


function saveNotes() {
  localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
  renderNotes();
}

function renderNotes() {
  const container = document.getElementById('notes-list-container');
  if (!container) return;
  container.innerHTML = '';

  const filteredNotes = notes.filter(note => showArchivedOnly ? (note.archived === true) : !note.archived);

  if (filteredNotes.length === 0) {
    const emptyMsg = showArchivedOnly ? "> NO ARCHIVED MEMOS FOUND." : "> NO MEMOS ARCHIVED. CREATE ONE ABOVE.";
    container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }

  // Cap currentPage if notes count decreased
  const maxPage = Math.max(0, Math.ceil(filteredNotes.length / NOTES_PER_PAGE) - 1);
  if (currentPage > maxPage) {
    currentPage = maxPage;
  }

  // Determine pagination slice
  let visibleNotes = filteredNotes;
  if (!showAllNotes && filteredNotes.length > NOTES_PER_PAGE) {
    const start = currentPage * NOTES_PER_PAGE;
    const end = start + NOTES_PER_PAGE;
    visibleNotes = filteredNotes.slice(start, end);
  }

  visibleNotes.forEach(note => {
    const wrapper = document.createElement('div');
    wrapper.className = 'note-container';

    // Format output insight
    const formattedInsight = note.insight ? note.insight.replace(/\n/g, '<br>') : 'Processing insight...';

    // Check if the body of the note is a list or plain text
    let noteContentHtml = '';
    if (note.isList && Array.isArray(note.body)) {
      noteContentHtml = note.body.map((item, idx) => `
        <div class="check-item">
          <input type="checkbox" class="note-chk" ${item.checked ? 'checked' : ''} onchange="window.toggleCheck(${note.id}, ${idx})">
          <span style="${item.checked ? 'text-decoration: line-through; opacity: 0.5' : ''}">${item.text}</span>
        </div>
      `).join('');
    } else {
      noteContentHtml = `<div class="note-text">${note.body || ''}</div>`;
    }

    const displayTitle = note.title ? note.title.toUpperCase() : 'UNTITLED NOTE';

    wrapper.innerHTML = `
      <div class="note-card">
        <div class="note-card-header">
          <div class="note-title-text">${displayTitle}</div>
        </div>
        <div class="note-body-wrapper">${noteContentHtml}</div>
        <div class="note-meta">> ${note.date}</div>
      </div>
    `;

    container.appendChild(wrapper);

    // Get note card element
    const cardElement = wrapper.querySelector('.note-card');

    // Expand to fullscreen detail modal on click
    cardElement.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox' || e.target.closest('input')) return;
      window.openNoteModal(note.id);
    });
  });

  // Render pagination bar if total notes > 10
  if (filteredNotes.length > NOTES_PER_PAGE) {
    const pagBar = document.createElement('div');
    pagBar.className = 'pagination-bar';
    
    if (showAllNotes) {
      pagBar.innerHTML = `
        <span class="pagination-status">> SHOWN: ALL ${filteredNotes.length} MEMOS</span>
        <div class="pagination-actions">
          <button class="btn-terminal" onclick="window.viewPaginatedNotes()">PAGE VIEW</button>
        </div>
      `;
    } else {
      const startIdx = currentPage * NOTES_PER_PAGE + 1;
      const endIdx = Math.min((currentPage + 1) * NOTES_PER_PAGE, filteredNotes.length);
      const hasPrev = currentPage > 0;
      const hasNext = (currentPage + 1) * NOTES_PER_PAGE < filteredNotes.length;
      
      pagBar.innerHTML = `
        <span class="pagination-status">> SHOWN: ${startIdx}-${endIdx} OF ${filteredNotes.length} MEMOS</span>
        <div class="pagination-actions">
          ${hasPrev ? `<button class="btn-terminal" onclick="window.prevPage()">PREV</button>` : ''}
          ${hasNext ? `<button class="btn-terminal" onclick="window.nextPage()">NEXT</button>` : ''}
          <button class="btn-terminal primary" onclick="window.viewAllNotes()">VIEW ALL</button>
        </div>
      `;
    }
    container.appendChild(pagBar);
  }
}

function toggleInputMode() {
  isListMode = !isListMode;
  const textArea = document.getElementById("note-body");
  const listBuilder = document.getElementById("list-builder");
  const toggleBtn = document.getElementById("mode-toggle-btn");
  
  if (isListMode) {
    textArea.classList.add("hidden");
    listBuilder.classList.add("active");
    toggleBtn.textContent = "📝";
    
    if (document.getElementById("list-items-container").children.length === 0) {
      const lines = textArea.value.split('\n').filter(l => l.trim() !== '');
      if(lines.length > 0) {
        lines.forEach(l => addListInputRow(false, l.trim()));
      } else {
        addListInputRow();
      }
    }
  } else {
    textArea.classList.remove("hidden");
    listBuilder.classList.remove("active");
    toggleBtn.textContent = "☑️";
    
    if (textArea.value.trim() === '') {
      const rows = document.querySelectorAll(".list-item-val");
      let text = Array.from(rows).map(r => r.value.trim()).filter(v => v).join('\n');
      textArea.value = text;
    }
  }
}

function addListInputRow(checked = false, text = '') {
  const container = document.getElementById("list-items-container");
  const rowId = 'list-row-' + Date.now() + Math.floor(Math.random() * 1000);
  const row = document.createElement("div");
  row.className = "list-input-row";
  row.id = rowId;
  row.innerHTML = `
    <input type="checkbox" class="note-chk" ${checked ? 'checked' : ''} style="flex-shrink:0;">
    <input type="text" class="finput list-item-val" placeholder="List item..." value="${text.replace(/"/g, '&quot;')}">
    <button class="btn-icon remove" onclick="document.getElementById('${rowId}').remove()">✕</button>
  `;
  container.appendChild(row);
  if(!text) row.querySelector('.list-item-val').focus();
}



let editingNoteId = null;

async function handleSaveNote() {
  const title = document.getElementById("note-title").value.trim();
  let noteItems = null, hasContent = false;
  
  if (isListMode) {
    const rows = document.querySelectorAll(".list-input-row");
    noteItems = [];
    rows.forEach(row => {
      const input = row.querySelector(".list-item-val");
      const chk = row.querySelector(".note-chk");
      if (input && input.value.trim() !== "") { 
        noteItems.push({ text: input.value.trim(), checked: chk ? chk.checked : false }); 
        hasContent = true; 
      }
    });
  } else {
    const body = document.getElementById("note-body").value.trim();
    if (body !== "") { noteItems = body; hasContent = true; }
  }
  
  if (!title && !hasContent) return;

  const dateStr = new Date().toLocaleString();

  // Combine title and body text for classification routing
  let fullText = `Title: ${title}\nContent: `;
  if (isListMode) {
    fullText += noteItems.map(i => i.text).join('\n');
  } else {
    fullText += noteItems || '';
  }

  let targetId;
  if (editingNoteId) {
    targetId = editingNoteId;
    const index = notes.findIndex(n => n.id === targetId);
    if (index > -1) {
      notes[index].title = title || 'UNTITLED NOTE';
      notes[index].body = noteItems;
      notes[index].isList = isListMode;
      notes[index].date = dateStr;
      saveNoteToCloud(notes[index]); // FIX: sync edited note immediately
    }
    editingNoteId = null;
    document.getElementById("cancel-edit-btn").style.display = "none";
    document.getElementById("save-btn").textContent = "SAVE NOTE";
  } else {
    targetId = Date.now();
    const newNote = {
      id: targetId,
      title: title || 'UNTITLED NOTE',
      body: noteItems,
      isList: isListMode,
      intent: 'NOTES',
      status: '',
      insight: '',
      date: dateStr
    };
    notes.unshift(newNote);
    saveNoteToCloud(newNote);
  }

  saveNotes();

  // Clear inputs
  document.getElementById("note-title").value = "";
  document.getElementById("note-body").value = "";
  document.getElementById("list-items-container").innerHTML = "";
  if (isListMode) addListInputRow();
}

// Audio Recording Callback
function onAudioTranscribed(text) {
  const noteBody = document.getElementById('note-body');
  if (noteBody) {
    if (isListMode) {
      addListInputRow(false, text);
    } else {
      noteBody.value = (noteBody.value + '\n' + text).trim();
      noteBody.focus();
    }
  }
}

window.editNote = function(id) {
  const note = notes.find(n => String(n.id) === String(id));
  if (!note) return;

  editingNoteId = id;
  document.getElementById("note-title").value = note.title || "";
  
  const textArea = document.getElementById("note-body");
  const listBuilder = document.getElementById("list-builder");
  const toggleBtn = document.getElementById("mode-toggle-btn");
  
  if (note.isList) {
    isListMode = true;
    textArea.classList.add("hidden");
    listBuilder.classList.add("active");
    toggleBtn.textContent = "📝";
    
    const container = document.getElementById("list-items-container");
    container.innerHTML = "";
    if (Array.isArray(note.body)) {
      note.body.forEach(item => addListInputRow(item.checked, item.text));
    } else {
      addListInputRow();
    }
  } else {
    isListMode = false;
    textArea.classList.remove("hidden");
    listBuilder.classList.remove("active");
    toggleBtn.textContent = "☑️";
    textArea.value = note.body || "";
  }

  document.getElementById("cancel-edit-btn").style.display = "inline-block";
  document.getElementById("save-btn").textContent = "UPDATE NOTE";
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById("note-title").focus();
};

window.cancelEdit = function() {
  editingNoteId = null;
  document.getElementById("note-title").value = "";
  document.getElementById("note-body").value = "";
  document.getElementById("list-items-container").innerHTML = "";
  
  document.getElementById("cancel-edit-btn").style.display = "none";
  document.getElementById("save-btn").textContent = "SAVE NOTE";
  
  if (isListMode) addListInputRow();
};

window.deleteNote = function(id) {
  notes = notes.filter(n => String(n.id) !== String(id));
  if (editingNoteId === id) {
    window.cancelEdit();
  }
  saveNotes();
  deleteNoteFromCloud(id);
};

window.toggleCheck = function(noteId, itemIndex) {
  const note = notes.find(n => String(n.id) === String(noteId));
  if (note && note.isList) { 
    note.body[itemIndex].checked = !note.body[itemIndex].checked; 
    saveNotes();
    saveNoteToCloud(note);
  }
};

let currentModalNoteId = null;

window.openNoteModal = function(id) {
  const note = notes.find(n => String(n.id) === String(id));
  if (!note) return;

  currentModalNoteId = id;
  
  const archiveBtn = document.getElementById("modal-btn-archive");
  if (archiveBtn) {
    archiveBtn.textContent = note.archived ? "UNARCHIVE" : "ARCHIVE";
  }

  const typeToggleBtn = document.getElementById("modal-btn-type-toggle");
  if (typeToggleBtn) {
    typeToggleBtn.textContent = note.isList ? "TO TEXT" : "TO LIST";
  }
  
  const titleEl = document.getElementById("modal-note-title");
  titleEl.textContent = note.title || "";
  
  const contentWrapper = document.getElementById("modal-note-content-wrapper");
  contentWrapper.innerHTML = "";
  
  if (note.isList && Array.isArray(note.body)) {
    note.body.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "check-item";
      row.innerHTML = `
        <input type="checkbox" class="note-chk" ${item.checked ? 'checked' : ''} onchange="window.toggleCheckFromModal(${idx})">
        <span contenteditable="true" onblur="window.updateListItemFromModal(${idx}, this.innerText)" style="${item.checked ? 'text-decoration: line-through; opacity: 0.5' : ''}">${item.text}</span>
      `;
      contentWrapper.appendChild(row);
    });
    const addRow = document.createElement("div");
    addRow.className = "check-item";
    addRow.style.marginTop = "8px";
    addRow.style.paddingLeft = "4px";
    addRow.innerHTML = `
      <span style="font-size: 11px; opacity: 0.6; cursor: pointer; font-weight: 700; letter-spacing: 0.05em; color: var(--highlight);" onclick="window.addListItemFromModal()">+ ADD ITEM</span>
    `;
    contentWrapper.appendChild(addRow);
  } else {
    const bodyEl = document.createElement("div");
    bodyEl.className = "note-text";
    bodyEl.contentEditable = "true";
    bodyEl.textContent = note.body || "";
    bodyEl.addEventListener('blur', (e) => {
      window.updateNoteBodyFromModal(e.target.innerText);
    });
    contentWrapper.appendChild(bodyEl);
  }

  document.getElementById("note-modal").classList.add("active");
};

window.closeNoteModal = function() {
  document.getElementById("note-modal").classList.remove("active");
  currentModalNoteId = null;
  renderNotes();
};

window.deleteNoteFromModal = function() {
  if (currentModalNoteId) {
    window.deleteNote(currentModalNoteId);
    window.closeNoteModal();
  }
};

window.archiveNoteFromModal = function() {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note) {
      note.archived = !note.archived;
      saveNotes();
      saveNoteToCloud(note);
      window.closeNoteModal();
    }
  }
};

window.toggleNoteTypeFromModal = function() {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note) {
      if (note.isList) {
        // Convert checklist array to newline separated text
        const textBody = (note.body || []).map(item => item.text).join('\n');
        note.isList = false;
        note.body = textBody;
      } else {
        // Convert text string to checklist items
        const listBody = (note.body || "").split('\n').map(line => ({ text: line.trim(), checked: false })).filter(item => item.text);
        note.isList = true;
        note.body = listBody;
      }
      saveNotes();
      saveNoteToCloud(note);
      window.openNoteModal(currentModalNoteId);
    }
  }
};

window.toggleArchivesView = function() {
  showArchivedOnly = !showArchivedOnly;
  currentPage = 0;
  const toggleBtn = document.getElementById("archive-toggle-btn");
  if (toggleBtn) {
    toggleBtn.textContent = showArchivedOnly ? "ACTIVE MEMOS" : "ARCHIVES";
    if (showArchivedOnly) {
      toggleBtn.style.backgroundColor = "var(--highlight)";
      toggleBtn.style.color = "var(--bg)";
      toggleBtn.style.borderColor = "var(--highlight)";
    } else {
      toggleBtn.style.backgroundColor = "";
      toggleBtn.style.color = "";
      toggleBtn.style.borderColor = "";
    }
  }
  renderNotes();
};

window.toggleCheckFromModal = function(idx) {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note && note.isList) {
      note.body[idx].checked = !note.body[idx].checked;
      localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
      saveNoteToCloud(note);
      window.openNoteModal(currentModalNoteId);
    }
  }
};

window.updateListItemFromModal = function(itemIdx, newText) {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note && note.isList && Array.isArray(note.body)) {
      note.body[itemIdx].text = newText.trim();
      localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
      saveNoteToCloud(note);
    }
  }
};

window.addListItemFromModal = function() {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note && note.isList && Array.isArray(note.body)) {
      note.body.push({ text: "NEW ITEM", checked: false });
      localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
      saveNoteToCloud(note);
      window.openNoteModal(currentModalNoteId);
    }
  }
};

window.updateNoteBodyFromModal = function(newText) {
  if (currentModalNoteId) {
    const note = notes.find(n => String(n.id) === String(currentModalNoteId));
    if (note) {
      note.body = newText.trim();
      localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
      saveNoteToCloud(note);
    }
  }
};

window.toggleInputMode = toggleInputMode;
window.addListInputRow = addListInputRow;

window.toggleSettings = function() {
  const authBar = document.querySelector(".auth-bar");
  if (authBar) {
    authBar.classList.toggle("hidden");
    const settingsBtn = document.getElementById("settings-toggle-btn");
    if (settingsBtn) {
      settingsBtn.style.opacity = authBar.classList.contains("hidden") ? "0.5" : "1";
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const micBtn = document.getElementById('mic-btn');
  const saveBtn = document.getElementById('save-btn');

  if (micBtn) micBtn.addEventListener('click', () => toggleRecording(onAudioTranscribed));
  if (saveBtn) saveBtn.addEventListener('click', handleSaveNote);

  // Bind modal title edit blur
  const modalTitleEl = document.getElementById("modal-note-title");
  if (modalTitleEl) {
    modalTitleEl.addEventListener('blur', (e) => {
      if (currentModalNoteId) {
        const note = notes.find(n => String(n.id) === String(currentModalNoteId));
        if (note) {
          note.title = e.target.innerText.replace(/\n/g, '').trim() || 'UNTITLED NOTE';
          localStorage.setItem('pixel-keep-notes', JSON.stringify(notes));
          saveNoteToCloud(note);
        }
      }
    });
  }



  if (isListMode) addListInputRow();
  renderNotes();
});
