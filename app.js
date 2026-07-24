// ─── SimpleNotes · Main Application ──────────────────────────────────────
// State management, UI rendering, audio recording, sync orchestration.

import { dbGetAllNotes, dbSaveNote, dbDeleteNote, createNote } from './db.js';
import {
  initFirebase,
  signInWithGoogle,
  signOutUser,
  onAuthChange,
  listenToFirestore,
  syncNoteToFirestore,
  deleteNoteFromFirestore,
  uploadAudioToStorage,
  deleteAudioFromStorage,
} from './firebase-config.js';
import { transcribeAudio } from './gemini-service.js';

// ─── STATE ───────────────────────────────────────────────────────────────

const state = {
  notes: [],
  theme: localStorage.getItem('sn-theme') || 'light',
  user: null,
  recordingState: 'idle', // 'idle' | 'recording' | 'processing'
  syncStatus: 'local',    // 'local' | 'syncing' | 'synced'
  audioMode: 'audio+text', // 'text' | 'audio+text' | 'audio'
  currentAudioBlob: null,
  activeDraftId: null,
  fontSize: parseInt(localStorage.getItem('sn-font-size')) || 16,
  fontFamily: localStorage.getItem('sn-font-family') || 'Inter',
};

// ─── DOM REFS ────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ─── INIT ────────────────────────────────────────────────────────────────

async function init() {
  applyTheme();
  applyTypography();

  const firebaseOk = initFirebase();

  try {
    state.notes = await dbGetAllNotes();
  } catch (e) {
    console.warn('[Init] IndexedDB read failed:', e);
    state.notes = [];
  }

  renderNotes();
  setupEventListeners();

  // Auto-focus for frictionless creation
  $('note-input')?.focus();

  if (firebaseOk) {
    onAuthChange(handleAuthChange);
  }

  registerServiceWorker();
  scheduleActiveReminders();
}

// ─── THEME ───────────────────────────────────────────────────────────────

function applyTheme() {
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === 'dark' ? '#1C1B1A' : '#EAE5D9';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('sn-theme', state.theme);
  applyTheme();
}

// ─── TYPOGRAPHY ──────────────────────────────────────────────────────────

function applyTypography() {
  document.documentElement.style.setProperty('--base-size', `${state.fontSize}px`);
  document.documentElement.style.setProperty('--font-family', `"${state.fontFamily}"`);
  
  const slider = $('font-size-slider');
  const display = $('font-size-display');
  if (slider) slider.value = state.fontSize;
  if (display) display.textContent = `${state.fontSize}px`;

  document.querySelectorAll('.font-btn').forEach(btn => {
    if (btn.dataset.font === state.fontFamily) {
      btn.classList.add('bg-paper-text', 'text-paper-bg', 'dark:bg-ink-text', 'dark:text-ink-bg');
    } else {
      btn.classList.remove('bg-paper-text', 'text-paper-bg', 'dark:bg-ink-text', 'dark:text-ink-bg');
    }
  });
}

function updateFontSize(e) {
  state.fontSize = e.target.value;
  localStorage.setItem('sn-font-size', state.fontSize);
  applyTypography();
}

function updateFontFamily(font) {
  state.fontFamily = font;
  localStorage.setItem('sn-font-family', state.fontFamily);
  applyTypography();
}

// ─── MENU ─────────────────────────────────────────────────────────────────

function toggleMenu() {
  const modal = $('menu-modal');
  if (!modal) return;
  const isHidden = modal.classList.contains('hidden');
  
  if (isHidden) {
    modal.classList.remove('hidden');
    // slight delay to allow display block to apply before animating transform
    setTimeout(() => {
      modal.querySelector('.modal-card')?.classList.remove('translate-y-full');
    }, 10);
  } else {
    modal.querySelector('.modal-card')?.classList.add('translate-y-full');
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 300); // match transition duration
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────

function handleAuthChange(user) {
  state.user = user || null;
  updateAuthUI();
  if (user) {
    state.syncStatus = 'syncing';
    updateSyncUI();
    listenToFirestore(user.uid, handleFirestoreUpdate);
    syncLocalToFirestore();
  } else {
    state.syncStatus = 'local';
    updateSyncUI();
  }
}

function updateAuthUI() {
  const btn = $('auth-btn');
  if (!btn) return;

  if (state.user) {
    if (state.user.photoURL) {
      btn.innerHTML = `<img src="${state.user.photoURL}" class="w-6 h-6 rounded-full" alt="${state.user.displayName || 'avatar'}" referrerpolicy="no-referrer">`;
    } else {
      btn.textContent = 'OUT';
    }
    btn.title = `Sign out (${state.user.email || ''})`;
  } else {
    btn.textContent = 'SIGN IN';
    btn.title = 'Sign in with Google';
  }
}

async function handleAuth() {
  if (state.user) {
    await signOutUser();
  } else {
    await signInWithGoogle();
  }
}

// ─── SYNC ────────────────────────────────────────────────────────────────

function updateSyncUI() {
  const dot = $('sync-dot');
  const label = $('sync-label');
  if (!dot || !label) return;

  switch (state.syncStatus) {
    case 'synced':
      dot.className = 'w-1.5 h-1.5 rounded-full bg-paper-text dark:bg-ink-text opacity-40';
      label.textContent = 'SYNCED';
      break;
    case 'syncing':
      dot.className = 'w-1.5 h-1.5 rounded-full bg-paper-text dark:bg-ink-text animate-pulse';
      label.textContent = 'SYNC';
      break;
    default:
      dot.className = 'w-1.5 h-1.5 rounded-full bg-paper-dim dark:bg-ink-dim';
      label.textContent = 'LOCAL';
  }
}

async function handleFirestoreUpdate(remoteNotes) {
  let changed = false;

  for (const remote of remoteNotes) {
    const local = state.notes.find((n) => n.id === remote.id);
    if (!local) {
      await dbSaveNote({ ...remote, synced: true });
      changed = true;
    } else if (new Date(remote.updatedAt) > new Date(local.updatedAt)) {
      await dbSaveNote({ ...remote, audioBlob: local.audioBlob, synced: true });
      changed = true;
    }
  }

  if (changed) {
    state.notes = await dbGetAllNotes();
    renderNotes();
  }

  state.syncStatus = 'synced';
  updateSyncUI();
}

async function syncLocalToFirestore() {
  if (!state.user) return;

  const unsynced = state.notes.filter((n) => !n.synced);

  for (const note of unsynced) {
    try {
      // Upload audio to Storage if present
      if (note.audioBlob && !note.audioUrl) {
        const url = await uploadAudioToStorage(state.user.uid, note.id, note.audioBlob);
        note.audioUrl = url;
      }

      // Sync note document (strip audioBlob — too large for Firestore)
      const { audioBlob, _syncTimeout, ...data } = note;
      await syncNoteToFirestore(state.user.uid, data);
      note.synced = true;
      await dbSaveNote(note);
    } catch (e) {
      console.warn('[Sync] Failed for note', note.id, e);
    }
  }

  state.syncStatus = 'synced';
  updateSyncUI();
}

// ─── NOTE CRUD ───────────────────────────────────────────────────────────

// ─── AUTO-SAVE DRAFT ─────────────────────────────────────────────────────

let _autoSaveTimer = null;

function autoSaveDraftNote() {
  const titleEl = $('note-title-input');
  const bodyEl = $('note-input');
  const title = titleEl ? titleEl.textContent.trim() : '';
  const content = bodyEl ? bodyEl.innerHTML.trim() : '';
  const textContent = bodyEl ? bodyEl.textContent.trim() : '';

  const hasData = title || textContent || state.currentAudioBlob;

  if (!hasData) {
    if (state.activeDraftId) {
      handleDeleteNote(state.activeDraftId);
      state.activeDraftId = null;
    }
    return;
  }

  const tags = extractTags(title + ' ' + textContent);

  if (!state.activeDraftId) {
    const note = createNote({
      title,
      content,
      tags,
      audioBlob: state.currentAudioBlob || null,
    });
    state.activeDraftId = note.id;
    state.notes.unshift(note);
    renderNotes();
  } else {
    const note = state.notes.find((n) => n.id === state.activeDraftId);
    if (note) {
      note.title = title;
      note.content = content;
      note.tags = tags;
      note.updatedAt = new Date().toISOString();
      note.synced = false;
      updateCardDOM(note);
    }
  }

  // Debounce DB & Cloud sync
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(async () => {
    if (!state.activeDraftId) return;
    const note = state.notes.find((n) => n.id === state.activeDraftId);
    if (note) {
      await dbSaveNote(note);
      if (state.user) syncLocalToFirestore();
    }
  }, 400);
}

function updateCardDOM(note) {
  const card = document.querySelector(`[data-note-id="${note.id}"]`);
  if (!card) {
    renderNotes();
    return;
  }
  const titleEl = card.querySelector('.note-title');
  if (titleEl && titleEl !== document.activeElement) {
    titleEl.innerHTML = note.title || '';
  }
  const contentEl = card.querySelector('.note-content');
  if (contentEl && contentEl !== document.activeElement && !note.isChecklist) {
    contentEl.innerHTML = note.content || '';
  }
}

async function handleDeleteNote(noteId) {
  await dbDeleteNote(noteId);
  state.notes = state.notes.filter((n) => n.id !== noteId);

  if (state.user) {
    try {
      await deleteNoteFromFirestore(state.user.uid, noteId);
      await deleteAudioFromStorage(state.user.uid, noteId);
    } catch (e) {
      console.warn('[Delete] Remote cleanup failed:', e);
    }
  }

  renderNotes();
}

// Debounce map for inline edits
const _editTimers = {};

function handleNoteEdit(noteId, field, value) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;

  note[field] = value;
  note.synced = false;
  note.updatedAt = new Date().toISOString();

  if (field === 'content') {
    note.tags = extractTags(
      (note.title || '') + ' ' + value.replace(/<[^>]*>/g, '')
    );
  }

  // Debounce IndexedDB write
  clearTimeout(_editTimers[noteId]);
  _editTimers[noteId] = setTimeout(async () => {
    await dbSaveNote(note);
    if (state.user) syncLocalToFirestore();
  }, 800);
}

function extractTags(text) {
  const matches = text.match(/#[a-zA-Z]\w*/g);
  return matches ? [...new Set(matches.map((t) => t.toLowerCase()))] : [];
}

// ─── AUDIO RECORDING ────────────────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];

async function toggleRecording() {
  if (state.recordingState === 'idle') {
    // Reset active draft so recording creates a fresh note
    state.activeDraftId = null;
    const titleEl = $('note-title-input');
    const bodyEl = $('note-input');
    if (titleEl) titleEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = '';
    state.currentAudioBlob = null;
    hideAudioPreview();
    await startRecording();
  } else if (state.recordingState === 'recording') {
    stopRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pick best supported mime type
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: mimeType });
      stream.getTracks().forEach((t) => t.stop());
      await processRecording(blob);
    };

    mediaRecorder.start(250);
    state.recordingState = 'recording';
    updateRecordingUI();
  } catch (e) {
    console.error('[Mic] Access denied:', e);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    state.recordingState = 'processing';
    updateRecordingUI();
  }
}

async function processRecording(blob) {
  const mode = state.audioMode;
  const bodyEl = $('note-input');

  try {
    const transcription = await transcribeAudio(blob);
    if (transcription) {
      const existing = bodyEl.innerHTML.trim();
      bodyEl.innerHTML = existing ? existing + '<br><br>' + transcription : transcription;
      // Transcription succeeded, discard the audio player
      state.currentAudioBlob = null;
      hideAudioPreview();
      state.recordingState = 'idle';
      updateRecordingUI();
      autoSaveDraftNote();
      return;
    }
  } catch (e) {
    console.error('[Transcription] Failed:', e);
  }

  // Fallback: keep audio if transcription failed or was empty
  state.currentAudioBlob = await blobToArrayBuffer(blob);
  showAudioPreview(blob);

  state.recordingState = 'idle';
  updateRecordingUI();
  autoSaveDraftNote();
}

function createMinimalAudioPlayer(src) {
  const player = document.createElement('div');
  player.className =
    'flex items-center gap-2.5 py-1 px-0 w-fit select-none text-[10px] md:text-xs font-bold tracking-widest uppercase text-paper-dim dark:text-ink-dim hover:text-paper-text dark:hover:text-ink-text transition-colors my-1.5';

  const audio = new Audio(src);

  // Play / Pause button
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className =
    'text-paper-text dark:text-ink-text hover:opacity-70 focus:outline-none flex items-center justify-center w-3.5 h-3.5 shrink-0';
  playBtn.innerHTML = `▶`;

  // Thin 2px progress bar container
  const progressTrack = document.createElement('div');
  progressTrack.className =
    'w-20 md:w-28 h-[2px] bg-paper-border dark:bg-ink-border rounded-full cursor-pointer relative overflow-hidden shrink-0';

  const progressBar = document.createElement('div');
  progressBar.className =
    'h-full bg-paper-text dark:bg-ink-text rounded-full transition-all duration-75 w-0';
  progressTrack.appendChild(progressBar);

  // Time display label
  const timeLabel = document.createElement('span');
  timeLabel.className = 'tabular-nums text-[10px] shrink-0';
  timeLabel.textContent = '0:00';

  function formatSecs(sec) {
    if (!sec || !isFinite(sec) || isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateProgress() {
    const dur = audio.duration;
    const cur = audio.currentTime;
    if (dur && isFinite(dur) && !isNaN(dur)) {
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      progressBar.style.width = `${pct}%`;
      timeLabel.textContent = `${formatSecs(cur)} / ${formatSecs(dur)}`;
    } else {
      timeLabel.textContent = formatSecs(cur);
    }
  }

  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('durationchange', updateProgress);
  audio.addEventListener('timeupdate', updateProgress);

  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    progressBar.style.width = '0%';
    updateProgress();
  });

  playBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (audio.paused) {
      document.querySelectorAll('audio').forEach((a) => a.pause());
      audio.play();
      playBtn.textContent = '❚❚';
    } else {
      audio.pause();
      playBtn.textContent = '▶';
    }
  };

  // Click on thin bar to seek
  progressTrack.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = progressTrack.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    if (audio.duration && isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, Math.max(0, pos * audio.duration));
      updateProgress();
    }
  };

  player.appendChild(playBtn);
  player.appendChild(progressTrack);
  player.appendChild(timeLabel);
  return player;
}

function showAudioPreview(blob) {
  const container = $('audio-preview');
  if (!container) return;
  container.innerHTML = '';
  const url = URL.createObjectURL(blob);
  const player = createMinimalAudioPlayer(url);
  container.appendChild(player);
  container.classList.remove('hidden');
}

function hideAudioPreview() {
  const container = $('audio-preview');
  if (container) {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function updateRecordingUI() {
  const dot = $('mic-dot');
  const text = $('mic-text');
  if (!dot || !text) return;

  switch (state.recordingState) {
    case 'recording':
      text.textContent = 'STOP';
      dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-red-500 recording-pulse';
      break;
    case 'processing':
      text.textContent = 'AI...';
      dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-paper-dim dark:bg-ink-dim animate-pulse';
      break;
    default:
      text.textContent = 'REC';
      dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-paper-text dark:bg-ink-text';
  }
}

// ─── LIST ↔ TEXT TOGGLE ──────────────────────────────────────────────────

function toggleChecklist(noteId, btn) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;

  const card = document.querySelector(`[data-note-id="${noteId}"]`);
  if (!card) return;
  const content = card.querySelector('.note-content');

  if (!note.isChecklist) {
    // → Checklist
    const lines = content.innerText.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return;

    note.isChecklist = true;
    note.checklistItems = lines.map((t) => ({
      text: t.trim(),
      checked: false,
    }));

    renderChecklistDOM(content, note);
    btn.textContent = 'TEXT';
  } else {
    // → Text
    const text = (note.checklistItems || []).map((i) => i.text);
    note.isChecklist = false;
    note.content = text
      .map((line, i) => (i === 0 ? line : `<div>${line}</div>`))
      .join('');

    content.innerHTML = note.content;
    content.setAttribute('contenteditable', 'true');
    content.classList.add('cursor-text');
    btn.textContent = 'LIST';
  }

  note.synced = false;
  note.updatedAt = new Date().toISOString();
  dbSaveNote(note);
  if (state.user) syncLocalToFirestore();
}

function renderChecklistDOM(container, note) {
  container.removeAttribute('contenteditable');
  container.classList.remove('cursor-text');

  let html = '<div class="flex flex-col gap-2 mt-1">';
  (note.checklistItems || []).forEach((item, idx) => {
    const struck = item.checked
      ? 'line-through text-paper-dim dark:text-ink-dim'
      : '';
    html += `
      <label class="flex items-start gap-3 cursor-pointer select-none">
        <input type="checkbox" ${item.checked ? 'checked' : ''}
          data-idx="${idx}"
          class="sn-checkbox mt-1.5 w-4 h-4 shrink-0 cursor-pointer">
        <span class="${struck} outline-none w-full cursor-text transition-all duration-200"
          contenteditable="true">${item.text}</span>
      </label>`;
  });
  html += '</div>';
  container.innerHTML = html;

  // Wire checkbox toggles
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx, 10);
      note.checklistItems[idx].checked = cb.checked;
      const span = cb.closest('label').querySelector('span');
      span.classList.toggle('line-through', cb.checked);
      span.classList.toggle('text-paper-dim', cb.checked);
      span.classList.toggle('dark:text-ink-dim', cb.checked);
      note.synced = false;
      note.updatedAt = new Date().toISOString();
      dbSaveNote(note);
    });
  });

  // Wire span edits
  container.querySelectorAll('span[contenteditable]').forEach((span, idx) => {
    span.addEventListener('blur', () => {
      note.checklistItems[idx].text = span.textContent;
      note.synced = false;
      note.updatedAt = new Date().toISOString();
      dbSaveNote(note);
    });
  });
}

// ─── REMINDERS ───────────────────────────────────────────────────────────

let _currentReminderNoteId = null;
const _reminderTimers = {};

function showReminderModal(noteId) {
  _currentReminderNoteId = noteId;
  const note = state.notes.find((n) => n.id === noteId);
  const input = $('reminder-datetime');
  const modal = $('reminder-modal');
  if (!input || !modal) return;

  if (note?.reminder?.datetime) {
    input.value = note.reminder.datetime.slice(0, 16);
  } else {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    input.value = d.toISOString().slice(0, 16);
  }

  modal.classList.remove('hidden');
  modal.querySelector('.modal-card')?.classList.add('modal-enter');
}

function hideReminderModal() {
  const modal = $('reminder-modal');
  if (modal) modal.classList.add('hidden');
  _currentReminderNoteId = null;
}

async function saveReminder() {
  if (!_currentReminderNoteId) return;
  const note = state.notes.find((n) => n.id === _currentReminderNoteId);
  if (!note) return;

  const val = $('reminder-datetime')?.value;
  if (!val) return;

  // Request notification permission if needed
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  note.reminder = { datetime: new Date(val).toISOString(), notified: false };
  note.synced = false;
  note.updatedAt = new Date().toISOString();
  await dbSaveNote(note);

  scheduleReminder(note);
  renderNotes();
  hideReminderModal();
  if (state.user) syncLocalToFirestore();
}

async function clearReminder() {
  if (!_currentReminderNoteId) return;
  const note = state.notes.find((n) => n.id === _currentReminderNoteId);
  if (!note) return;

  note.reminder = null;
  note.synced = false;
  note.updatedAt = new Date().toISOString();
  await dbSaveNote(note);

  clearTimeout(_reminderTimers[note.id]);
  renderNotes();
  hideReminderModal();
  if (state.user) syncLocalToFirestore();
}

function scheduleActiveReminders() {
  state.notes.forEach((note) => {
    if (note.reminder && !note.reminder.notified) {
      scheduleReminder(note);
    }
  });
}

function scheduleReminder(note) {
  if (!note.reminder || note.reminder.notified) return;

  clearTimeout(_reminderTimers[note.id]);

  const delay = new Date(note.reminder.datetime).getTime() - Date.now();

  if (delay <= 0) {
    triggerNotification(note);
    return;
  }

  // Cap setTimeout at ~24 days (max 32-bit int ms)
  const safeDelay = Math.min(delay, 2_147_483_647);
  _reminderTimers[note.id] = setTimeout(() => triggerNotification(note), safeDelay);
}

async function triggerNotification(note) {
  if (note.reminder?.notified) return;

  note.reminder.notified = true;
  await dbSaveNote(note);

  const body = note.title || stripHtml(note.content).slice(0, 120) || 'Reminder';

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('SimpleNotes', { body, icon: 'icon.svg', tag: note.id });
  }

  // Update card in DOM
  renderNotes();
}

function generateCalendarUrl(note) {
  if (!note.reminder) return '#';

  const dt = new Date(note.reminder.datetime);
  const fmt = (d) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const start = fmt(dt);
  const end = fmt(new Date(dt.getTime() + 30 * 60_000));

  const title = encodeURIComponent(note.title || 'SimpleNotes Reminder');
  const details = encodeURIComponent(stripHtml(note.content).slice(0, 200));

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
}

// ─── RENDERING ───────────────────────────────────────────────────────────

function renderNotes() {
  const list = $('notes-list');
  if (!list) return;

  list.innerHTML = '';

  if (state.notes.length === 0) {
    list.innerHTML = `
      <div class="text-center py-20">
        <p class="text-[10px] font-bold tracking-[0.3em] uppercase text-paper-dim dark:text-ink-dim">
          No notes yet — start typing or record
        </p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  state.notes.forEach((note) => {
    if (note.id !== state.activeDraftId) {
      frag.appendChild(buildNoteCard(note));
    }
  });
  list.appendChild(frag);
}

function buildNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'group flex flex-col gap-2';
  card.dataset.noteId = note.id;

  // ── Title
  const titleEl = document.createElement('div');
  titleEl.contentEditable = 'true';
  titleEl.className =
    'note-title text-xl md:text-2xl font-bold outline-none cursor-text';
  titleEl.setAttribute('placeholder', 'Title');
  titleEl.innerHTML = note.title || '';
  titleEl.addEventListener('blur', () =>
    handleNoteEdit(note.id, 'title', titleEl.innerHTML)
  );
  card.appendChild(titleEl);

  // ── Content
  const contentEl = document.createElement('div');
  contentEl.className =
    'note-content text-lg md:text-xl font-medium leading-normal outline-none';

  let isTruncated = false;

  if (note.isChecklist) {
    renderChecklistDOM(contentEl, note);
  } else {
    contentEl.contentEditable = 'true';
    contentEl.classList.add('cursor-text');
    contentEl.innerHTML = note.content || '';
    contentEl.addEventListener('blur', () =>
      handleNoteEdit(note.id, 'content', contentEl.innerHTML)
    );

    // Limit text displayed to 3 lines
    const rawLines = (note.content || '').replace(/<[^>]*>/g, '\n').split('\n').filter((l) => l.trim());
    if (rawLines.length > 3 || (note.content || '').length > 150) {
      contentEl.classList.add('line-clamp-3');
      isTruncated = true;
    }

    // Auto un-clamp when focused for editing
    contentEl.addEventListener('focus', () => {
      contentEl.classList.remove('line-clamp-3');
    });
  }
  card.appendChild(contentEl);

  // ── Audio player
  if (note.audioBlob || note.audioUrl) {
    let src = '';
    let blobRef = null;
    if (note.audioBlob) {
      blobRef = new Blob([note.audioBlob], { type: 'audio/webm' });
      src = URL.createObjectURL(blobRef);
    } else if (note.audioUrl) {
      src = note.audioUrl;
    }
    if (src) {
      const player = createMinimalAudioPlayer(src);
      
      const aiBtn = document.createElement('button');
      aiBtn.className = 'ml-4 text-paper-dim hover:text-paper-text dark:text-ink-dim dark:hover:text-ink-text transition-colors shrink-0';
      aiBtn.title = 'Convert to text with Gemini';
      aiBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.3 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`;
      
      aiBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        aiBtn.classList.add('animate-pulse');
        try {
          if (!blobRef && note.audioUrl) {
            blobRef = await fetch(note.audioUrl).then(r => r.blob());
          }
          const text = await transcribeAudio(blobRef);
          if (text) {
             const existing = (note.content || '').replace(/<[^>]*>/g, '\n').trim();
             // Clean up old fallback text if it exists
             let cleanedExisting = existing;
             if (cleanedExisting === '[voice note attached]') cleanedExisting = '';
             else cleanedExisting = cleanedExisting.replace('\n[voice note attached]', '');
             
             note.content = cleanedExisting ? cleanedExisting + '<br><br>' + text : text;
             note.audioBlob = null;
             note.audioUrl = null;
             note.synced = false;
             note.updatedAt = new Date().toISOString();
             await dbSaveNote(note);
             
             if (note.id === state.activeDraftId) {
                const bodyEl = $('note-input');
                if (bodyEl) bodyEl.innerHTML = note.content;
                hideAudioPreview();
             }
             renderNotes();
             if (state.user) {
               syncLocalToFirestore();
             }
          }
        } catch (err) {
          console.error(err);
        } finally {
          aiBtn.classList.remove('animate-pulse');
        }
      };
      
      player.appendChild(aiBtn);
      card.appendChild(player);
    }
  }

  // ── Tags
  if (note.tags?.length > 0) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'flex gap-2 flex-wrap mt-1';
    note.tags.forEach((tag) => {
      const badge = document.createElement('span');
      badge.className =
        'text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 border border-paper-border dark:border-ink-border text-paper-dim dark:text-ink-dim';
      badge.textContent = tag;
      tagsEl.appendChild(badge);
    });
    card.appendChild(tagsEl);
  }

  // ── Reminder
  if (note.reminder) {
    const remEl = document.createElement('div');
    remEl.className =
      'text-[10px] font-bold tracking-[0.15em] uppercase text-paper-dim dark:text-ink-dim flex items-center gap-3 mt-1';

    const dt = new Date(note.reminder.datetime);
    const dateStr = dt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const timeStr = dt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    remEl.innerHTML = `
      <span class="flex items-center gap-1.5">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        ${dateStr} ${timeStr}
      </span>
      <a href="${generateCalendarUrl(note)}" target="_blank" rel="noopener"
         class="underline underline-offset-2 hover:text-paper-text dark:hover:text-ink-text transition-colors">
        + GCAL
      </a>
      ${note.reminder.notified ? '<span class="opacity-50">DONE</span>' : ''}
    `;
    card.appendChild(remEl);
  }

  // ── Actions (visible on hover / focus-within)
  const actions = document.createElement('div');
  actions.className =
    'flex items-center gap-4 text-[10px] md:text-xs font-bold tracking-widest uppercase text-paper-dim dark:text-ink-dim opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200';

  const mkBtn = (label, handler) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className =
      'hover:text-paper-text dark:hover:text-ink-text transition-colors';
    b.addEventListener('click', handler);
    return b;
  };

  const listBtn = mkBtn(note.isChecklist ? 'TEXT' : 'LIST', () =>
    toggleChecklist(note.id, listBtn)
  );
  actions.appendChild(listBtn);

  if (isTruncated) {
    const expandBtn = mkBtn('MORE', () => {
      if (contentEl.classList.contains('line-clamp-3')) {
        contentEl.classList.remove('line-clamp-3');
        expandBtn.textContent = 'LESS';
      } else {
        contentEl.classList.add('line-clamp-3');
        expandBtn.textContent = 'MORE';
      }
    });
    actions.appendChild(expandBtn);
  }

  actions.appendChild(
    mkBtn('REMIND', () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      showReminderModal(note.id);
    })
  );
  actions.appendChild(mkBtn('DELETE', () => handleDeleteNote(note.id)));
  card.appendChild(actions);

  return card;
}



// ─── EVENT LISTENERS ─────────────────────────────────────────────────────

function setupEventListeners() {
  $('mic-btn')?.addEventListener('click', toggleRecording);
  $('theme-toggle')?.addEventListener('click', toggleTheme);
  $('auth-btn')?.addEventListener('click', handleAuth);

  // Auto-save as user types
  $('note-title-input')?.addEventListener('input', autoSaveDraftNote);
  $('note-input')?.addEventListener('input', autoSaveDraftNote);

  // Ctrl+Enter to save from creation bar
  $('note-input')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  });

  // Save when clicking outside the creation area
  document.addEventListener('click', (e) => {
    const isCreation = e.target.closest('#note-title-input') || 
                       e.target.closest('#note-input') || 
                       e.target.closest('#audio-preview') || 
                       e.target.closest('#mic-btn');
    if (!isCreation && state.activeDraftId) {
      const title = $('note-title-input')?.textContent.trim();
      const content = $('note-input')?.textContent.trim();
      if (title || content || state.currentAudioBlob) {
        handleSave();
      }
    }
  });



  // Menu & Settings
  $('menu-toggle-btn')?.addEventListener('click', toggleMenu);
  $('menu-close-btn')?.addEventListener('click', toggleMenu);
  $('menu-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'menu-modal') toggleMenu();
  });

  $('font-size-slider')?.addEventListener('input', updateFontSize);
  
  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      updateFontFamily(e.target.dataset.font);
    });
  });

  // Reminder modal
  $('reminder-save')?.addEventListener('click', saveReminder);
  $('reminder-clear')?.addEventListener('click', clearReminder);
  $('reminder-cancel')?.addEventListener('click', hideReminderModal);
  $('reminder-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reminder-modal') hideReminderModal();
  });

  // Online / offline
  window.addEventListener('online', () => {
    if (state.user) {
      state.syncStatus = 'syncing';
      updateSyncUI();
      syncLocalToFirestore();
    }
  });
  window.addEventListener('offline', () => {
    state.syncStatus = 'local';
    updateSyncUI();
  });
}

function handleSave() {
  if (state.activeDraftId) {
    state.activeDraftId = null;
    const titleEl = $('note-title-input');
    const bodyEl = $('note-input');
    if (titleEl) titleEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = '';
    hideAudioPreview();
    state.currentAudioBlob = null;
    renderNotes();
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || '';
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.update();
        console.log('[SW] Registered:', reg.scope);
      })
      .catch((err) => console.warn('[SW] Registration failed:', err));
  }
}

// ─── START ───────────────────────────────────────────────────────────────

init();
