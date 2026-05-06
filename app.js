// ============================================================
//  app.js  —  Patient Care Checklist
//  Supabase-backed, fully persistent
// ============================================================

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const WARDS           = ['ward_a', 'ward_b', 'icu_1', 'icu_2'];
const WARD_LABELS     = { ward_a: 'Ward A', ward_b: 'Ward B', icu_1: 'ICU 1', icu_2: 'ICU 2' };

// ── Supabase client ──────────────────────────────────────────
let db;
try {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  setStatus('error', 'Config missing');
}

// ── Local state ──────────────────────────────────────────────
const state = { ward_a: [], ward_b: [], icu_1: [], icu_2: [] };
let currentWard = null;
let editingId   = null;
let modalForm   = {
  supine: false, sidelying: false, positional_na: false,
  splinting: null, splinting_na: false,
  speech: null
};
let saveTimers = {};

// ── UI helpers ───────────────────────────────────────────────
function setStatus(type, text) {
  document.getElementById('status-dot').className    = 'status-dot ' + type;
  document.getElementById('status-text').textContent = text;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

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
  return [...arr].sort((a, b) =>
    roomSortKey(a.room_number).localeCompare(roomSortKey(b.room_number)));
}

// ── Initials ─────────────────────────────────────────────────
function getInitials(name) {
  const parts = (name || '').trim().split(' ').filter(p => p.length > 0);
  return parts.length ? parts.map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??';
}

// ── Expiry ───────────────────────────────────────────────────
function getExpiryInfo(patient) {
  const createdAt = new Date(patient.created_at).getTime();
  const expiresAt = createdAt + THREE_MONTHS_MS;
  const now       = Date.now();
  const remaining = expiresAt - now;
  const pct       = Math.min(100, Math.round(((now - createdAt) / THREE_MONTHS_MS) * 100));
  const daysLeft  = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const expired   = remaining <= 0;
  const soon      = !expired && daysLeft <= 14;
  return { pct, daysLeft, expired, soon };
}

// ── Missing guidelines ────────────────────────────────────────
function getMissingGuidelines(patient) {
  const missing = [];
  if (!patient.positional_supine && !patient.positional_sidelying && !patient.positional_na)
    missing.push('Positional');
  if (patient.splinting === null && !patient.splinting_na)
    missing.push('Splinting');
  if (patient.speech === null)
    missing.push('Speech');
  return missing;
}

// ── Alert badge ───────────────────────────────────────────────
function refreshAlertBadge() {
  const all   = WARDS.flatMap(w => state[w]);
  const total = new Set([
    ...all.filter(p => getMissingGuidelines(p).length > 0).map(p => p.id),
    ...all.filter(p => (p.splinting === null || p.splinting === false) && !p.splinting_na).map(p => p.id),
    ...all.filter(p => p.speech === null || p.speech === false).map(p => p.id)
  ]).size;
  const badge = document.getElementById('badge-alerts');
  if (badge) badge.textContent = total;
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(wardId, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ward-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + wardId).classList.add('active');
  if (wardId === 'alerts') renderAlerts();
}

// ── Modal: toggle positional pill ────────────────────────────
function togglePill(key) {
  if (key === 'positional_na') {
    modalForm.positional_na = !modalForm.positional_na;
    if (modalForm.positional_na) {
      modalForm.supine    = false;
      modalForm.sidelying = false;
      document.getElementById('pill-supine').classList.remove('active');
      document.getElementById('pill-sidelying').classList.remove('active');
    }
    document.getElementById('pill-positional_na').classList.toggle('active', modalForm.positional_na);
    return;
  }
  // supine or sidelying
  modalForm[key] = !modalForm[key];
  if (modalForm[key]) {
    modalForm.positional_na = false;
    document.getElementById('pill-positional_na').classList.remove('active');
  }
  document.getElementById('pill-' + key).classList.toggle('active', modalForm[key]);
}

// ── Modal: toggle Yes / No / N/A ─────────────────────────────
function toggleYN(field, val) {
  if (val === 'na') {
    modalForm.splinting_na = !modalForm.splinting_na;
    if (modalForm.splinting_na) {
      modalForm.splinting = null;
      document.getElementById('yn-splint-yes')?.classList.remove('active');
      document.getElementById('yn-splint-no')?.classList.remove('active');
    }
    document.getElementById('yn-splint-na')?.classList.toggle('active', modalForm.splinting_na);
    return;
  }

  const isYes      = (val === 'yes');
  const shortField = field === 'splinting' ? 'splint' : field;

  if (field === 'splinting') {
    modalForm.splinting_na = false;
    document.getElementById('yn-splint-na')?.classList.remove('active');
  }

  modalForm[field] = (modalForm[field] === isYes) ? null : isYes;

  document.getElementById('yn-' + shortField + '-yes')?.classList.toggle('active', modalForm[field] === true);
  document.getElementById('yn-' + shortField + '-no')?.classList.toggle('active',  modalForm[field] === false);
}

// ── Modal: reset ──────────────────────────────────────────────
function resetModal() {
  ['input-name', 'input-room', 'input-mrn',
   'note-positional', 'note-splinting', 'note-speech'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.style.borderColor = ''; }
  });
  modalForm = {
    supine: false, sidelying: false, positional_na: false,
    splinting: null, splinting_na: false,
    speech: null
  };
  ['pill-supine', 'pill-sidelying', 'pill-positional_na',
   'yn-splint-yes', 'yn-splint-no', 'yn-splint-na',
   'yn-speech-yes', 'yn-speech-no'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
}

// ── Modal: open for new patient ───────────────────────────────
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

// ── Modal: open for editing ───────────────────────────────────
function openEditModal(wardId, patientId) {
  const p = getPatient(wardId, patientId);
  if (!p) return;
  currentWard = wardId;
  editingId   = patientId;
  resetModal();

  document.getElementById('input-name').value      = p.patient_name  || '';
  document.getElementById('input-room').value      = p.room_number   || '';
  document.getElementById('input-mrn').value       = p.mrn           || '';
  document.getElementById('note-positional').value = p.note_positional || '';
  document.getElementById('note-splinting').value  = p.note_splinting  || '';
  document.getElementById('note-speech').value     = p.note_speech     || '';

  modalForm.supine        = !!p.positional_supine;
  modalForm.sidelying     = !!p.positional_sidelying;
  modalForm.positional_na = !!p.positional_na;
  modalForm.splinting     = p.splinting;
  modalForm.splinting_na  = !!p.splinting_na;
  modalForm.speech        = p.speech;

  document.getElementById('pill-supine').classList.toggle('active',        modalForm.supine);
  document.getElementById('pill-sidelying').classList.toggle('active',     modalForm.sidelying);
  document.getElementById('pill-positional_na').classList.toggle('active', modalForm.positional_na);
  document.getElementById('yn-splint-yes').classList.toggle('active',      modalForm.splinting === true);
  document.getElementById('yn-splint-no').classList.toggle('active',       modalForm.splinting === false);
  document.getElementById('yn-splint-na').classList.toggle('active',       modalForm.splinting_na);
  document.getElementById('yn-speech-yes').classList.toggle('active',      modalForm.speech === true);
  document.getElementById('yn-speech-no').classList.toggle('active',       modalForm.speech === false);

  document.getElementById('modal-title').textContent      = '✏️ Edit Patient';
  document.getElementById('modal-submit-btn').textContent = 'Save Changes';
  document.getElementById('modal-submit-btn').className   = 'btn-primary purple';
  document.getElementById('modal').classList.add('open');
}

// ── Modal: close ──────────────────────────────────────────────
function closeModal() {
  document.getElementById('modal').classList.remove('open');
  currentWard = null;
  editingId   = null;
}

// ── Modal: submit ─────────────────────────────────────────────
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

  // Capture before closeModal() clears them
  const wardToLoad = currentWard;
  const idToEdit   = editingId;

  closeModal();
  setLoading(true);

  const payload = {
    patient_name:         name,
    room_number:          room         || null,
    mrn:                  mrn          || null,
    positional_supine:    modalForm.supine,
    positional_sidelying: modalForm.sidelying,
    positional_na:        modalForm.positional_na,
    splinting:            modalForm.splinting_na ? null : modalForm.splinting,
    splinting_na:         modalForm.splinting_na,
    speech:               modalForm.speech,
    note_positional:      notePos      || null,
    note_splinting:       noteSpl      || null,
    note_speech:          noteSpe      || null,
  };

  let error;

  if (idToEdit) {
    ({ error } = await db.from('patients').update(payload).eq('id', idToEdit));
    if (error) { showToast('❌ Save failed: ' + error.message, 'error'); setLoading(false); return; }
    showToast('✓ Patient updated', 'success');
  } else {
    ({ error } = await db.from('patients').insert({ ...payload, ward: wardToLoad }));
    if (error) { showToast('❌ Add failed: ' + error.message, 'error'); setLoading(false); return; }
    showToast('✓ Patient added', 'success');
  }

  await loadWard(wardToLoad);
  refreshAlertBadge();
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
  refreshAlertBadge();
  setLoading(false);
}

// ── Inline: toggle positional ────────────────────────────────
async function togglePositional(wardId, patientId, key) {
  const p = getPatient(wardId, patientId);
  if (!p) return;

  if (key === 'na') {
    p.positional_na = !p.positional_na;
    if (p.positional_na) { p.positional_supine = false; p.positional_sidelying = false; }
    renderCard(wardId, p);
    refreshAlertBadge();
    await db.from('patients').update({
      positional_na:        p.positional_na,
      positional_supine:    p.positional_supine,
      positional_sidelying: p.positional_sidelying
    }).eq('id', patientId);
    return;
  }

  const field = 'positional_' + key;
  p[field] = !p[field];
  if (p[field]) p.positional_na = false;
  renderCard(wardId, p);
  refreshAlertBadge();
  await db.from('patients').update({
    [field]: p[field], positional_na: p.positional_na
  }).eq('id', patientId);
}

// ── Inline: toggle Yes / No / N/A ────────────────────────────
async function setYesNo(wardId, patientId, field, val) {
  const p = getPatient(wardId, patientId);
  if (!p) return;

  if (val === 'na') {
    p.splinting_na = !p.splinting_na;
    if (p.splinting_na) p.splinting = null;
    renderCard(wardId, p);
    refreshAlertBadge();
    await db.from('patients').update({
      splinting: p.splinting, splinting_na: p.splinting_na
    }).eq('id', patientId);
    return;
  }

  // Normalize val to boolean (HTML onclick passes string or boolean)
  const boolVal = (val === true || val === 'true');
  if (field === 'splinting') p.splinting_na = false;
  p[field] = (p[field] === boolVal) ? null : boolVal;
  renderCard(wardId, p);
  refreshAlertBadge();

  const updatePayload = { [field]: p[field] };
  if (field === 'splinting') updatePayload.splinting_na = false;
  await db.from('patients').update(updatePayload).eq('id', patientId);
}

// ── Inline: note auto-save (debounced 1.2 s) ─────────────────
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

// ── Get patient from local state ──────────────────────────────
function getPatient(wardId, patientId) {
  return state[wardId]?.find(p => p.id === patientId);
}

// ── Render single ward card ───────────────────────────────────
function renderCard(wardId, patient) {
  const el = document.getElementById('card-' + patient.id);
  if (!el) return;

  const { pct, daysLeft, expired, soon } = getExpiryInfo(patient);
  const missing = getMissingGuidelines(patient);

  el.className = 'patient-card' + (expired ? ' expired' : soon ? ' expiring' : '');

  const barColor    = expired ? 'var(--red)' : soon ? 'var(--orange)' : 'var(--green)';
  const expiryClass = expired ? 'expired'    : soon ? 'soon'          : 'ok';
  const expiryText  = expired
    ? '⚠ Expired — renew now'
    : soon ? `⏳ ${daysLeft}d left — renew soon`
    : `✓ ${daysLeft}d remaining`;

  const missingBanner = missing.length > 0
    ? `<div class="missing-banner">⚠ Pending: ${missing.map(m =>
        `<span class="missing-tag">${m}</span>`).join('')}</div>`
    : `<div class="complete-banner">✅ All guidelines set</div>`;

  const supine    = !!patient.positional_supine;
  const sidelying = !!patient.positional_sidelying;
  const posNA     = !!patient.positional_na;
  const splintYes = patient.splinting === true  && !patient.splinting_na;
  const splintNo  = patient.splinting === false && !patient.splinting_na;
  const splintNA  = !!patient.splinting_na;
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
          <div class="patient-name">${patient.patient_name || '—'}</div>
          <div class="patient-meta">
            <span>🚪 ${patient.room_number || '—'}</span>
            <span>🆔 ${patient.mrn || 'Not entered'}</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="edit-btn" onclick="openEditModal('${wardId}','${patient.id}')">✏️ Edit</button>
        <button class="delete-btn" onclick="deletePatient('${wardId}','${patient.id}')" title="Remove">✕</button>
      </div>
    </div>
    <div class="checklist-body">
      <div class="expiry-bar-wrap">
        <div class="expiry-bar" style="width:${100 - pct}%;background:${barColor}"></div>
      </div>
      <span class="expiry-badge ${expiryClass}">${expiryText}</span>
      ${missingBanner}
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
          <label class="check-pill na-pill ${posNA ? 'checked' : ''}"
            onclick="togglePositional('${wardId}','${patient.id}','na')">
            <span class="pill-dot"></span> N/A
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
          <button class="yn-btn na ${splintNA ? 'active' : ''}"
            onclick="setYesNo('${wardId}','${patient.id}','splinting','na')">— N/A</button>
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

// ── Render compact alert card ─────────────────────────────────
function renderAlertCard(container, patient, wardId) {
  const missing     = getMissingGuidelines(patient);
  const { expired, soon, daysLeft } = getExpiryInfo(patient);
  const expiryClass = expired ? 'expired' : soon ? 'soon' : 'ok';
  const expiryText  = expired ? '⚠ Expired' : soon ? `⏳ ${daysLeft}d left` : `✓ ${daysLeft}d`;

  const card = document.createElement('div');
  card.className = 'patient-card alert-card' + (expired ? ' expired' : soon ? ' expiring' : '');

  const missingTags = missing.length > 0
    ? missing.map(m => `<span class="missing-tag">${m}</span>`).join('')
    : `<span class="missing-tag no-guideline-tag">No guideline in room</span>`;

  card.innerHTML = `
    <div class="patient-card-header">
      <div class="patient-info">
        <div class="patient-avatar">${getInitials(patient.patient_name)}</div>
        <div>
          <div class="patient-name">${patient.patient_name || '—'}</div>
          <div class="patient-meta">
            <span>🚪 ${patient.room_number || '—'}</span>
            <span>🆔 ${patient.mrn || 'Not entered'}</span>
            <span class="ward-tag">${WARD_LABELS[wardId] || wardId}</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="edit-btn" onclick="openEditModal('${wardId}','${patient.id}')">✏️ Edit</button>
      </div>
    </div>
    <div class="checklist-body">
      <div class="missing-banner">${missingTags}</div>
      <span class="expiry-badge ${expiryClass}">${expiryText}</span>
    </div>`;

  container.appendChild(card);
}

// ── Fill one alert sub-grid ───────────────────────────────────
function fillGrid(gridId, emptyId, countId, patients) {
  const grid  = document.getElementById(gridId);
  const empty = document.getElementById(emptyId);
  const count = document.getElementById(countId);
  if (!grid) return;
  grid.innerHTML        = '';
  count.textContent     = patients.length;
  empty.style.display   = patients.length === 0 ? 'block' : 'none';
  patients.forEach(p => renderAlertCard(grid, p, p._ward));
}

// ── Render Alerts tab ─────────────────────────────────────────
function renderAlerts() {
  const all = WARDS.flatMap(w => state[w].map(p => ({ ...p, _ward: w })));

  fillGrid('grid-pending',  'empty-pending',  'count-pending',
    all.filter(p => getMissingGuidelines(p).length > 0));
  fillGrid('grid-nosplint', 'empty-nosplint', 'count-nosplint',
    all.filter(p => (p.splinting === null || p.splinting === false) && !p.splinting_na));
  fillGrid('grid-nospeech', 'empty-nospeech', 'count-nospeech',
    all.filter(p => p.speech === null || p.speech === false));

  refreshAlertBadge();
}

// ── Render full ward grid ─────────────────────────────────────
function renderWard(wardId) {
  const grid = document.getElementById('grid-' + wardId);
  if (!grid) return;
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
  refreshAlertBadge();
}

// ── Load ward from Supabase ───────────────────────────────────
async function loadWard(wardId) {
  const { data, error } = await db
    .from('patients')
    .select('*')
    .eq('ward', wardId)
    .order('created_at', { ascending: true });

  if (error) { showToast('❌ Load error: ' + error.message, 'error'); return; }
  state[wardId] = sortPatients(data || []);
  renderWard(wardId);
}

// ── Bootstrap ─────────────────────────────────────────────────
async function init() {
  if (!db) return;
  setLoading(true);
  setStatus('', 'Connecting…');

  // Load all wards — errors surface via showToast inside loadWard
  const results = await Promise.allSettled(WARDS.map(w => loadWard(w)));
  const anyError = results.some(r => r.status === 'rejected');

  if (anyError) {
    setStatus('error', 'DB error');
    showToast('❌ Cannot reach database. Check config.js', 'error');
  } else {
    setStatus('connected', 'Connected');
  }

  setLoading(false);
}

// ── Realtime subscription ─────────────────────────────────────
function subscribeRealtime() {
  if (!db) return;
  db.channel('patients-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'patients' },
      async payload => {
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


// ── Report generation ─────────────────────────────────────────
async function generateReport() {
  const btn = document.getElementById('report-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  try {
    const { AlignmentType, BorderStyle, Document, Footer, Header,
            HeadingLevel, Packer, PageNumber, Paragraph, ShadingType,
            Table, TableCell, TableRow, TextRun, WidthType,
            VerticalAlign, PageBreak } = docx;

    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const WARD_LABELS_R   = { ward_a:'Ward A', ward_b:'Ward B', icu_1:'ICU 1', icu_2:'ICU 2' };
    const C = {
      teal:'0f7b8c', tealLight:'e0f4f7', slate:'1e2a35',
      orange:'e07b39', orangeLight:'fdf0e8',
      red:'d94f3d', redLight:'fdecea',
      yellow:'fff3cd', green:'2a9d5c', greenLight:'e6f6ee',
      white:'ffffff', midGray:'dde3ea', muted:'6b7a8d',
    };

    // Gather all patients from live state
    const patients = WARDS.flatMap(w => state[w].map(p => ({...p, _ward:w})));

    // ── Helpers ──────────────────────────────────────────────
    function getDaysLeft(p) {
      return Math.ceil((new Date(p.created_at).getTime() + THREE_MONTHS_MS - Date.now()) / 86400000);
    }
    function getPositional(p) {
      if (p.positional_na) return 'N/A';
      const o = [];
      if (p.positional_supine)    o.push('Supine');
      if (p.positional_sidelying) o.push('Side-lying');
      return o.length ? o.join(', ') : '— Not set';
    }
    function getSplinting(p) {
      if (p.splinting_na)      return 'N/A';
      if (p.splinting === true)  return 'Yes';
      if (p.splinting === false) return 'No';
      return '— Not set';
    }
    function getSpeech(p) {
      if (p.speech === true)  return 'Yes';
      if (p.speech === false) return 'No';
      return '— Not set';
    }
    function getMissingR(p) {
      const m = [];
      if (!p.positional_supine && !p.positional_sidelying && !p.positional_na) m.push('Positional');
      if (p.splinting === null && !p.splinting_na) m.push('Splinting');
      if (p.speech === null) m.push('Speech');
      return m;
    }
    function getInitialsR(name) {
      const parts = (name||'').trim().split(' ').filter(x=>x);
      return parts.length ? parts.map(w=>w[0]).join('').toUpperCase().slice(0,2) : '—';
    }

    // ── Cell factories ────────────────────────────────────────
    const bdr = (color='CCCCCC') => ({ style:BorderStyle.SINGLE, size:1, color });
    const bdrs = (c='CCCCCC') => ({ top:bdr(c), bottom:bdr(c), left:bdr(c), right:bdr(c) });
    const cm = { top:80, bottom:80, left:120, right:120 };

    function mkCell(text, {w=2340,bold=false,shade=null,textColor='000000',center=false}={}) {
      return new TableCell({
        width:{size:w,type:WidthType.DXA}, borders:bdrs(C.midGray), margins:cm,
        shading: shade ? {fill:shade,type:ShadingType.CLEAR} : undefined,
        verticalAlign: VerticalAlign.CENTER,
        children:[new Paragraph({
          alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
          children:[new TextRun({text:String(text||'—'),bold,color:textColor,font:'Arial',size:18})]
        })]
      });
    }
    function hdrCell(text, w=2340) {
      return new TableCell({
        width:{size:w,type:WidthType.DXA}, borders:bdrs(C.teal), margins:cm,
        shading:{fill:C.teal,type:ShadingType.CLEAR}, verticalAlign:VerticalAlign.CENTER,
        children:[new Paragraph({alignment:AlignmentType.CENTER,
          children:[new TextRun({text,bold:true,color:C.white,font:'Arial',size:18})]})]
      });
    }
    function pgBreak() { return new Paragraph({children:[new PageBreak()]}); }
    function h1(text) {
      return new Paragraph({heading:HeadingLevel.HEADING_1,
        children:[new TextRun({text,bold:true,font:'Arial',size:36,color:C.slate})]});
    }
    function subH(text) {
      return new Paragraph({spacing:{before:200,after:100},
        border:{bottom:{style:BorderStyle.SINGLE,size:4,color:C.teal,space:1}},
        children:[new TextRun({text,bold:true,font:'Arial',size:22,color:C.teal})]});
    }
    function para(text,{bold=false,color='000000',after=80}={}) {
      return new Paragraph({spacing:{after},
        children:[new TextRun({text,bold,font:'Arial',size:20,color})]});
    }

    // ── Stats ─────────────────────────────────────────────────
    const now      = new Date();
    const dateStr  = now.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
    const timeStr  = now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const allMiss  = patients.filter(p => getMissingR(p).length > 0);
    const noSplint = patients.filter(p => (p.splinting===null||p.splinting===false)&&!p.splinting_na);
    const noSpeech = patients.filter(p => p.speech===null||p.speech===false);
    const expired  = patients.filter(p => getDaysLeft(p)<=0);
    const soonExp  = patients.filter(p => { const d=getDaysLeft(p); return d>0&&d<=14; });
    const complete = patients.filter(p => getMissingR(p).length===0);
    const total    = patients.length;

    const children = [];

    // COVER
    children.push(
      new Paragraph({spacing:{before:1440,after:200},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:'SALMA RAHBA',bold:true,font:'Arial',size:52,color:C.teal})]}),
      new Paragraph({spacing:{after:100},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:'REHABILITATION MEDICINE HOSPITAL',bold:true,font:'Arial',size:36,color:C.slate})]}),
      new Paragraph({spacing:{after:600},alignment:AlignmentType.CENTER,
        border:{bottom:{style:BorderStyle.SINGLE,size:8,color:C.teal,space:2}},
        children:[new TextRun({text:'',font:'Arial',size:4})]}),
      new Paragraph({spacing:{before:600,after:160},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:'Patient Care Guidelines Report',bold:true,font:'Arial',size:48,color:C.slate})]}),
      new Paragraph({spacing:{after:80},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:'Positional · Splinting · Speech',font:'Arial',size:28,color:C.muted})]}),
      new Paragraph({spacing:{before:200,after:80},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:`Generated: ${dateStr} at ${timeStr}`,font:'Arial',size:22,color:C.muted})]}),
      new Paragraph({spacing:{after:80},alignment:AlignmentType.CENTER,
        children:[new TextRun({text:`Total Patients: ${total}`,bold:true,font:'Arial',size:24,color:C.slate})]}),
      pgBreak(),
    );

    // SECTION 1 — Summary
    children.push(h1('1. Executive Summary'));
    const statsData = [
      ['Total Patients',         String(total),          C.tealLight],
      ['All Guidelines Complete',String(complete.length),complete.length===total?C.greenLight:C.tealLight],
      ['Pending Guidelines',     String(allMiss.length), allMiss.length>0?C.yellow:C.greenLight],
      ['No Splinting Guideline', String(noSplint.length),noSplint.length>0?C.orangeLight:C.greenLight],
      ['No Speech Guideline',    String(noSpeech.length),noSpeech.length>0?C.orangeLight:C.greenLight],
      ['Expired Checklists',     String(expired.length), expired.length>0?C.redLight:C.greenLight],
      ['Expiring Within 14 Days',String(soonExp.length), soonExp.length>0?C.yellow:C.greenLight],
    ];
    children.push(
      new Table({width:{size:6000,type:WidthType.DXA},columnWidths:[3800,1000,1200],
        rows:[
          new TableRow({children:[hdrCell('Metric',3800),hdrCell('Count',1000),hdrCell('Status',1200)]}),
          ...statsData.map(([label,count,shade])=>new TableRow({children:[
            mkCell(label,{w:3800,shade}),
            mkCell(count,{w:1000,bold:true,shade,center:true}),
            mkCell(count==='0'?'✓ OK':'⚠ Action needed',{w:1200,shade,center:true,
              textColor:count==='0'?C.green:C.orange}),
          ]}))
        ]}),
      new Paragraph({spacing:{after:200}}), pgBreak(),
    );

    // SECTION 2 — Missing guidelines
    children.push(h1('2. Patients with Pending Guidelines'));
    if (allMiss.length === 0) {
      children.push(para('✅ All patients have complete guidelines.', {bold:true,color:C.green}));
    } else {
      children.push(para(`${allMiss.length} patient(s) have one or more guidelines not yet set.`,{after:160}));
      children.push(new Table({width:{size:9360,type:WidthType.DXA},
        columnWidths:[1700,1600,1200,1600,1600,1300,760],
        rows:[
          new TableRow({tableHeader:true,children:[
            hdrCell('Patient',1700),hdrCell('Room',1600),hdrCell('Ward',1200),
            hdrCell('Positional',1600),hdrCell('Splinting',1600),hdrCell('Speech',1300),hdrCell('Expires',760),
          ]}),
          ...allMiss.map(p=>{
            const miss=getMissingR(p), d=getDaysLeft(p), exp=d<=0;
            const sh=exp?C.redLight:C.yellow;
            return new TableRow({children:[
              mkCell(p.patient_name,{w:1700,bold:true,shade:sh}),
              mkCell(p.room_number, {w:1600,shade:sh}),
              mkCell(WARD_LABELS_R[p._ward],{w:1200,shade:sh,center:true}),
              mkCell(miss.includes('Positional')?'⚠ Missing':getPositional(p),{w:1600,shade:sh,
                textColor:miss.includes('Positional')?C.red:C.green}),
              mkCell(miss.includes('Splinting')?'⚠ Missing':getSplinting(p),{w:1600,shade:sh,
                textColor:miss.includes('Splinting')?C.red:C.green}),
              mkCell(miss.includes('Speech')?'⚠ Missing':getSpeech(p),{w:1300,shade:sh,
                textColor:miss.includes('Speech')?C.red:C.green}),
              mkCell(exp?'EXPIRED':`${d}d`,{w:760,center:true,bold:exp||d<=14,shade:sh,
                textColor:exp?C.red:d<=14?C.orange:C.green}),
            ]});
          })
        ]}));
    }
    children.push(new Paragraph({spacing:{after:200}}), pgBreak());

    // SECTION 3 — Per ward
    children.push(h1('3. Full Patient List by Ward'));
    WARDS.forEach((wardId, wi) => {
      const wp = patients.filter(p=>p._ward===wardId);
      children.push(subH(`${WARD_LABELS_R[wardId]} — ${wp.length} Patient(s)`));
      if (wp.length===0) {
        children.push(para('No patients in this ward.',{color:C.muted}));
      } else {
        children.push(new Table({width:{size:9360,type:WidthType.DXA},
          columnWidths:[1600,1500,1200,1500,1500,1300,760],
          rows:[
            new TableRow({tableHeader:true,children:[
              hdrCell('Patient',1600),hdrCell('Room',1500),hdrCell('MRN',1200),
              hdrCell('Positional',1500),hdrCell('Splinting',1500),hdrCell('Speech',1300),hdrCell('Expires',760),
            ]}),
            ...wp.map(p=>{
              const miss=getMissingR(p), d=getDaysLeft(p), exp=d<=0, hm=miss.length>0;
              const sh=exp?C.redLight:hm?C.yellow:C.white;
              return new TableRow({children:[
                mkCell(p.patient_name,{w:1600,bold:hm,shade:sh}),
                mkCell(p.room_number, {w:1500,shade:sh}),
                mkCell(p.mrn||'—',   {w:1200,shade:sh}),
                mkCell(getPositional(p),{w:1500,shade:sh,
                  textColor:miss.includes('Positional')?C.red:'000000'}),
                mkCell(getSplinting(p),{w:1500,shade:sh,
                  textColor:miss.includes('Splinting')?C.red:p.splinting===true?C.green:'000000'}),
                mkCell(getSpeech(p),{w:1300,shade:sh,
                  textColor:miss.includes('Speech')?C.red:p.speech===true?C.green:'000000'}),
                mkCell(exp?'EXPIRED':`${d}d`,{w:760,center:true,bold:exp||d<=14,shade:sh,
                  textColor:exp?C.red:d<=14?C.orange:C.green}),
              ]});
            })
          ]}));

        // Notes
        const wn = wp.filter(p=>p.note_positional||p.note_splinting||p.note_speech);
        if (wn.length) {
          children.push(
            new Paragraph({spacing:{before:200,after:80},
              children:[new TextRun({text:'Notes:',bold:true,font:'Arial',size:20})]}),
            ...wn.flatMap(p=>[
              new Paragraph({spacing:{before:100,after:40},
                children:[new TextRun({text:`${p.patient_name||'—'} (${p.room_number||'—'})`,
                  bold:true,font:'Arial',size:18,color:C.teal})]}),
              ...(p.note_positional?[new Paragraph({spacing:{after:20},children:[new TextRun({text:`  📐 Positional: ${p.note_positional}`,font:'Arial',size:18})]})]:[]),
              ...(p.note_splinting?[new Paragraph({spacing:{after:20},children:[new TextRun({text:`  🦾 Splinting: ${p.note_splinting}`,font:'Arial',size:18})]})]:[]),
              ...(p.note_speech?[new Paragraph({spacing:{after:20},children:[new TextRun({text:`  🗣 Speech: ${p.note_speech}`,font:'Arial',size:18})]})]:[]),
            ])
          );
        }
      }
      children.push(new Paragraph({spacing:{after:200}}));
      if (wi < WARDS.length-1) children.push(pgBreak());
    });

    // SECTION 4 — Expiry
    children.push(pgBreak(), h1('4. Checklist Expiry Status'));
    const sorted = [...patients].sort((a,b)=>getDaysLeft(a)-getDaysLeft(b));
    children.push(new Table({width:{size:9360,type:WidthType.DXA},
      columnWidths:[2000,1800,1400,2400,1760],
      rows:[
        new TableRow({tableHeader:true,children:[
          hdrCell('Patient',2000),hdrCell('Room',1800),hdrCell('Ward',1400),
          hdrCell('Status',2400),hdrCell('Days Left',1760),
        ]}),
        ...sorted.map(p=>{
          const d=getDaysLeft(p), exp=d<=0, soon=!exp&&d<=14;
          const sh=exp?C.redLight:soon?C.yellow:C.greenLight;
          return new TableRow({children:[
            mkCell(p.patient_name,{w:2000,bold:exp||soon,shade:sh}),
            mkCell(p.room_number, {w:1800,shade:sh}),
            mkCell(WARD_LABELS_R[p._ward],{w:1400,shade:sh,center:true}),
            mkCell(exp?'⚠ EXPIRED — Replace immediately':soon?`⏳ Expiring soon — ${d} days left`:'✓ Valid',
              {w:2400,shade:sh,textColor:exp?C.red:soon?C.orange:C.green}),
            mkCell(exp?'0':String(d),{w:1760,center:true,bold:exp||soon,shade:sh,
              textColor:exp?C.red:soon?C.orange:C.green}),
          ]});
        })
      ]}));

    // Footer note
    children.push(
      new Paragraph({spacing:{before:400,after:80},
        border:{top:{style:BorderStyle.SINGLE,size:4,color:C.midGray,space:4}},
        children:[new TextRun({text:'This report is auto-generated from the Patient Care Checklist system. ',
          font:'Arial',size:16,color:C.muted})]}),
      new Paragraph({spacing:{after:0},
        children:[new TextRun({text:'Checklists expire 90 days from creation and must be replaced with updated printed guidelines.',
          font:'Arial',size:16,color:C.muted})]})
    );

    // Build document
    const doc = new Document({
      styles:{
        default:{ document:{ run:{ font:'Arial', size:20 } } },
        paragraphStyles:[
          {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,
            run:{size:36,bold:true,font:'Arial',color:C.slate},
            paragraph:{spacing:{before:360,after:200},outlineLevel:0}},
          {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,
            run:{size:28,bold:true,font:'Arial',color:C.slate},
            paragraph:{spacing:{before:240,after:160},outlineLevel:1}},
        ]
      },
      sections:[{
        properties:{ page:{ size:{width:12240,height:15840}, margin:{top:1080,right:1080,bottom:1080,left:1080} } },
        headers:{
          default: new Header({children:[new Paragraph({
            alignment:AlignmentType.RIGHT,
            border:{bottom:{style:BorderStyle.SINGLE,size:4,color:C.teal,space:4}},
            spacing:{after:120},
            children:[new TextRun({text:'Patient Care Guidelines Report — CONFIDENTIAL',font:'Arial',size:16,color:C.muted})]
          })]})
        },
        footers:{
          default: new Footer({children:[new Paragraph({
            alignment:AlignmentType.CENTER,
            border:{top:{style:BorderStyle.SINGLE,size:4,color:C.midGray,space:4}},
            spacing:{before:120},
            children:[
              new TextRun({text:'Page ',font:'Arial',size:16,color:C.muted}),
              new TextRun({children:[PageNumber.CURRENT],font:'Arial',size:16,color:C.muted}),
              new TextRun({text:' of ',font:'Arial',size:16,color:C.muted}),
              new TextRun({children:[PageNumber.TOTAL_PAGES],font:'Arial',size:16,color:C.muted}),
              new TextRun({text:`  •  Generated ${dateStr}`,font:'Arial',size:16,color:C.muted}),
            ]
          })]})
        },
        children
      }]
    });

    // Download
    const buffer = await Packer.toBuffer(doc);
    const blob   = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = `Guidelines_Report_${now.toISOString().slice(0,10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ Report downloaded!', 'success');

  } catch(err) {
    console.error('Report error:', err);
    showToast('❌ Report failed: ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '📄 Report';
  }
}
