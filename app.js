// ============================================================
//  app.js  —  Patient Care Checklist
//  Supabase-backed, fully persistent
// ============================================================

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const WARDS = ['ward_a', 'ward_b', 'icu_1', 'icu_2'];

// ── Supabase client ──────────────────────────────────────────
let db;
try {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  setStatus('error', 'Config missing');
}

// ── Local state (mirrors DB) ─────────────────────────────────
const state = { ward_a: [], ward_b: [], icu_1: [], icu_2: [] };
let revealed   = {};   // patientId → timeout handle
let currentWard = null;
let editingId   = null;
let modalForm   = { supine: false, sidelying: false, splinting: null, speech: null };
let saveTimers  = {};  // patientId → debounce handle for note autosave

// ── Status indicator ─────────────────────────────────────────
function setStatus(type, text) {
  document.getElementById('status-dot').className  = 'status-dot ' + type;
  document.getElementById('status-text').textContent = text;
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ── Loading overlay ──────────────────────────────────────────
function setLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('visible', on);
}

// ── Sorting ──────────────────────────────────────────────────
function roomSortKey(room) {
  return (room || '').trim().toLowerCase()
    .replace(/^room\s*/i, '')
    .replace(/(\d+)/g, m => m.padStart(6, '0'));
}
function sortPatients(arr) {
  return [...arr].sort((a, b) => roomSortKey(a.room_number).localeCompare(roomSortKey(b.room_number)));
}

// ── Masking ──────────────────────────────────────────────────
function maskName(name) {
  return (name || '').trim().split(' ')
    .map(p => p[0] + '●'.repeat(Math.max(p.length - 1, 2))).join(' ');
}
function maskMRN(mrn) {
  if (!mrn) return '—';
  return mrn.slice(0, 2) + '●●●●' + mrn.slice(-2);
}
function maskRoom(room) {
  if (!room) return '—';
  if (room.length <= 3) return room[0] + '●●';
  return room[0] + '●●' + room.slice(-1);
}
function getInitials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Expiry ───────────────────────────────────────────────────
function getExpiryInfo(patient) {
  const createdAt  = new Date(patient.created_at).getTime();
  const expiresAt  = createdAt + THREE_MONTHS_MS;
  const now        = Date.now();
  const remaining  = expiresAt - now;
  const pct        = Math.min(100, Math.round(((now - createdAt) / THREE_MONTHS_MS) * 100));
  const daysLeft   = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const expired    = remaining <= 0;
  const soon       = !expired && daysLeft <= 14;
  return { pct, daysLeft, expired, soon };
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(wardId, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ward-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + wardId).classList.add('active');
}

// ── Modal helpers ─────────────────────────────────────────────
function togglePill(key) {
  modalForm[key] = !modalForm[key];
  document.getElementById('pill-' + key).classList.toggle('active', modalForm[key]);
}

function toggleYN(field, val) {
  const boolVal = (val === 'yes');
  modalForm[field] = (modalForm[field] === boolVal) ? null : boolVal;
  document.getElementById('yn-' + field + '-yes').classList.toggle('active', modalForm[field] === true);
  document.getElementById('yn-' + field + '-no').classList.toggle('active',  modalForm[field] === false);
}

function resetModal() {
  ['input-name', 'input-room', 'input-mrn',
   'note-positional', 'note-splinting', 'note-speech'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.style.borderColor = ''; }
  });
  modalForm = { supine: false, sidelying: false, splinting: null, speech: null };
  ['pill-supine', 'pill-sidelying'].forEach(id =>
    document.getElementById(id).classList.remove('active'));
  ['yn-splint-yes', 'yn-splint-no', 'yn-speech-yes', 'yn-speech-no'].forEach(id =>
    document.getElementById(id).classList.remove('active'));
}

function openModal(ward) {
  currentWard = ward;
  editingId   = null;
  resetModal();
  document.getElementById('modal-title').textContent      = '➕ Add New Patient';
  document.getElementById('modal-submit-btn').textContent = 'Add Patient';
  document.getElementById('modal-submit-btn').className   = 'btn-primary';
  document.getElementById('modal').classList.add('open');
  setTimeout(() => document.getElementById('input-name').focus(), 100);
}

function openEditModal(wardId, patientId) {
  const p = getPatient(wardId, patientId);
  if (!p) return;
  currentWard = wardId;
  editingId   = patientId;
  resetModal();

  document.getElementById('input-name').value       = p.patient_name;
  document.getElementById('input-room').value       = p.room_number;
  document.getElementById('input-mrn').value        = p.mrn || '';
  document.getElementById('note-positional').value  = p.note_positional || '';
  document.getElementById('note-splinting').value   = p.note_splinting  || '';
  document.getElementById('note-speech').value      = p.note_speech     || '';

  modalForm.supine    = !!p.positional_supine;
  modalForm.sidelying = !!p.positional_sidelying;
  modalForm.splinting = p.splinting;
  modalForm.speech    = p.speech;

  document.getElementById('pill-supine').classList.toggle('active',    modalForm.supine);
  document.getElementById('pill-sidelying').classList.toggle('active', modalForm.sidelying);
  document.getElementById('yn-splint-yes').classList.toggle('active',  modalForm.splinting === true);
  document.getElementById('yn-splint-no').classList.toggle('active',   modalForm.splinting === false);
  document.getElementById('yn-speech-yes').classList.toggle('active',  modalForm.speech === true);
  document.getElementById('yn-speech-no').classList.toggle('active',   modalForm.speech === false);

  document.getElementById('modal-title').textContent      = '✏️ Edit Patient';
  document.getElementById('modal-submit-btn').textContent = 'Save Changes';
  document.getElementById('modal-submit-btn').className   = 'btn-primary purple';
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  currentWard = null;
  editingId   = null;
}

// ── Submit modal (add or edit) ────────────────────────────────
async function submitModal() {
  const name    = document.getElementById('input-name').value.trim();
  const room    = document.getElementById('input-room').value.trim();
  const mrn     = document.getElementById('input-mrn').value.trim();
  const notePos = document.getElementById('note-positional').value.trim();
  const noteSpl = document.getElementById('note-splinting').value.trim();
  const noteSpe = document.getElementById('note-speech').value.trim();
  const nameEl  = document.getElementById('input-name');

  if (!name) { nameEl.style.borderColor = 'var(--red)'; nameEl.focus(); return; }
  nameEl.style.borderColor = '';

  const payload = {
    ward:                 currentWard,
    patient_name:         name,
    room_number:          room,
    mrn:                  mrn || null,
    positional_supine:    modalForm.supine,
    positional_sidelying: modalForm.sidelying,
    splinting:            modalForm.splinting,
    speech:               modalForm.speech,
    note_positional:      notePos || null,
    note_splinting:       noteSpl || null,
    note_speech:          noteSpe || null,
  };

  closeModal();
  setLoading(true);

  if (editingId) {
    const { error } = await db.from('patients').update(payload).eq('id', editingId);
    if (error) { showToast('❌ Save failed: ' + error.message, 'error'); setLoading(false); return; }
    showToast('✓ Patient updated', 'success');
  } else {
    const { error } = await db.from('patients').insert(payload);
    if (error) { showToast('❌ Add failed: ' + error.message, 'error'); setLoading(false); return; }
    showToast('✓ Patient added', 'success');
  }

  await loadWard(currentWard);
  setLoading(false);
}

// ── Delete patient ────────────────────────────────────────────
async function deletePatient(wardId, patientId) {
  if (!confirm('Remove this patient checklist?')) return;
  setLoading(true);
  const { error } = await db.from('patients').delete().eq('id', patientId);
  if (error) { showToast('❌ Delete failed', 'error'); setLoading(false); return; }
  showToast('Patient removed', '');
  await loadWard(wardId);
  setLoading(false);
}

// ── Toggle positional pill (auto-save) ───────────────────────
async function togglePositional(wardId, patientId, key) {
  const p = getPatient(wardId, patientId);
  if (!p) return;
  const field = 'positional_' + key;
  p[field] = !p[field];
  renderCard(wardId, p);
  await db.from('patients').update({ [field]: p[field] }).eq('id', patientId);
}

// ── Toggle Yes/No (auto-save) ─────────────────────────────────
async function setYesNo(wardId, patientId, field, val) {
  const p = getPatient(wardId, patientId);
  if (!p) return;
  p[field] = (p[field] === val) ? null : val;
  renderCard(wardId, p);
  await db.from('patients').update({ [field]: p[field] }).eq('id', patientId);
}

// ── Note auto-save (debounced 1.2s) ──────────────────────────
function updateNote(wardId, patientId, section, value) {
  const p = getPatient(wardId, patientId);
  if (!p) return;
  const field = 'note_' + section;
  p[field] = value;

  clearTimeout(saveTimers[patientId + field]);
  saveTimers[patientId + field] = setTimeout(async () => {
    await db.from('patients').update({ [field]: value || null }).eq('id', patientId);
  }, 1200);
}

// ── Reveal / mask ─────────────────────────────────────────────
function toggleReveal(patientId) {
  if (revealed[patientId]) {
    clearTimeout(revealed[patientId]);
    delete revealed[patientId];
  } else {
    revealed[patientId] = setTimeout(() => {
      delete revealed[patientId];
      WARDS.forEach(w => state[w].forEach(p => { if (p.id === patientId) renderCard(w, p); }));
    }, 8000);
  }
  WARDS.forEach(w => state[w].forEach(p => { if (p.id === patientId) renderCard(w, p); }));
}

// ── Get patient from local state ──────────────────────────────
function getPatient(wardId, patientId) {
  return state[wardId]?.find(p => p.id === patientId);
}

// ── Render a single card ──────────────────────────────────────
function renderCard(wardId, patient) {
  const el = document.getElementById('card-' + patient.id);
  if (!el) return;

  const { pct, daysLeft, expired, soon } = getExpiryInfo(patient);
  const isRevealed = !!revealed[patient.id];

  const displayName = isRevealed ? patient.patient_name : maskName(patient.patient_name);
  const displayRoom = isRevealed ? (patient.room_number || '—') : maskRoom(patient.room_number);
  const displayMRN  = isRevealed ? (patient.mrn || 'Not entered') : maskMRN(patient.mrn);

  el.className = 'patient-card' + (expired ? ' expired' : soon ? ' expiring' : '');

  const barColor    = expired ? 'var(--red)' : soon ? 'var(--orange)' : 'var(--green)';
  const expiryClass = expired ? 'expired'    : soon ? 'soon'           : 'ok';
  const expiryText  = expired
    ? '⚠ Expired — renew now'
    : soon
      ? `⏳ ${daysLeft}d left — renew soon`
      : `✓ ${daysLeft}d remaining`;

  const supine    = !!patient.positional_supine;
  const sidelying = !!patient.positional_sidelying;
  const splintYes = patient.splinting === true;
  const splintNo  = patient.splinting === false;
  const speechYes = patient.speech === true;
  const speechNo  = patient.speech === false;

  const noteArea = (section, placeholder) =>
    `<textarea class="note-field" rows="2" placeholder="${placeholder}"
       oninput="updateNote('${wardId}','${patient.id}','${section}',this.value)"
     >${patient['note_' + section] || ''}</textarea>`;

  el.innerHTML = `
    <div class="patient-card-header">
      <div class="patient-info">
        <div class="patient-avatar">${getInitials(patient.patient_name)}</div>
        <div>
          <div class="patient-name">${displayName}</div>
          <div class="patient-meta">
            <span>🚪 ${displayRoom}</span>
            <span>🆔 ${displayMRN}</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="reveal-btn" onclick="toggleReveal('${patient.id}')">
          ${isRevealed ? '🙈 Hide' : '👁 Reveal'}
        </button>
        <button class="edit-btn" onclick="openEditModal('${wardId}','${patient.id}')">✏️ Edit</button>
        <button class="delete-btn" onclick="deletePatient('${wardId}','${patient.id}')" title="Remove">✕</button>
      </div>
    </div>

    <div class="checklist-body">
      <div class="expiry-bar-wrap">
        <div class="expiry-bar" style="width:${100 - pct}%;background:${barColor}"></div>
      </div>
      <span class="expiry-badge ${expiryClass}">${expiryText}</span>

      <div class="divider"></div>

      <div class="checklist-section">
        <div class="section-label">📐 Positional</div>
        <div class="check-row">
          <label class="check-pill ${supine ? 'checked' : ''}"
            onclick="togglePositional('${wardId}','${patient.id}','supine')">
            <span class="pill-dot"></span> Supine
          </label>
          <label class="check-pill ${sidelying ? 'checked' : ''}"
            onclick="togglePositional('${wardId}','${patient.id}','sidelying')">
            <span class="pill-dot"></span> Side-lying
          </label>
        </div>
        ${noteArea('positional', 'e.g. elevate head 30°, right side preferred…')}
      </div>

      <div class="checklist-section">
        <div class="section-label">🦾 Splinting</div>
        <div class="yes-no-row">
          <button class="yn-btn yes ${splintYes ? 'active' : ''}"
            onclick="setYesNo('${wardId}','${patient.id}','splinting',true)">✓ Yes</button>
          <button class="yn-btn no ${splintNo ? 'active' : ''}"
            onclick="setYesNo('${wardId}','${patient.id}','splinting',false)">✕ No</button>
        </div>
        ${noteArea('splinting', 'e.g. resting hand splint, 2hrs on/off…')}
      </div>

      <div class="checklist-section">
        <div class="section-label">🗣 Speech</div>
        <div class="yes-no-row">
          <button class="yn-btn yes ${speechYes ? 'active' : ''}"
            onclick="setYesNo('${wardId}','${patient.id}','speech',true)">✓ Yes</button>
          <button class="yn-btn no ${speechNo ? 'active' : ''}"
            onclick="setYesNo('${wardId}','${patient.id}','speech',false)">✕ No</button>
        </div>
        ${noteArea('speech', 'e.g. thickened fluids level 2, AAC board on right…')}
      </div>
    </div>`;
}

// ── Render full ward grid ─────────────────────────────────────
function renderWard(wardId) {
  const grid = document.getElementById('grid-' + wardId);
  grid.innerHTML = '';
  state[wardId].forEach(patient => {
    const div = document.createElement('div');
    div.className = 'patient-card';
    div.id        = 'card-' + patient.id;
    grid.appendChild(div);
    renderCard(wardId, patient);
  });
  document.getElementById('empty-' + wardId).style.display =
    state[wardId].length === 0 ? 'block' : 'none';
  document.getElementById('badge-' + wardId).textContent = state[wardId].length;
}

// ── Load a ward from Supabase ─────────────────────────────────
async function loadWard(wardId) {
  const { data, error } = await db
    .from('patients')
    .select('*')
    .eq('ward', wardId)
    .order('created_at', { ascending: true });

  if (error) {
    showToast('❌ Load error: ' + error.message, 'error');
    return;
  }

  state[wardId] = sortPatients(data || []);
  renderWard(wardId);
}

// ── Bootstrap ─────────────────────────────────────────────────
async function init() {
  if (!db) return;

  setLoading(true);
  setStatus('', 'Connecting…');

  // Test connection
  const { error: pingError } = await db.from('patients').select('id').limit(1);
  if (pingError) {
    setStatus('error', 'DB error');
    showToast('❌ Cannot reach database. Check config.js', 'error');
    setLoading(false);
    return;
  }

  setStatus('connected', 'Connected');

  // Load all wards in parallel
  await Promise.all(WARDS.map(w => loadWard(w)));
  setLoading(false);
}

// ── Realtime subscription (live updates across devices) ───────
function subscribeRealtime() {
  if (!db) return;
  db.channel('patients-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, async payload => {
      // Reload the affected ward
      const ward = payload.new?.ward || payload.old?.ward;
      if (ward && WARDS.includes(ward)) await loadWard(ward);
    })
    .subscribe();
}

// ── Event listeners ───────────────────────────────────────────
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' &&
      document.getElementById('modal').classList.contains('open') &&
      e.target.tagName !== 'TEXTAREA') {
    submitModal();
  }
});

// ── Start ─────────────────────────────────────────────────────
init().then(() => subscribeRealtime());
