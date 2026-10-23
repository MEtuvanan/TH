// admin.js — Admin CMS. All writes are protected by RLS (is_admin()).
// The service_role key is NEVER used here; the anon key + RLS is the security model.
import { supabase } from './supabase.js';
import { getProfile } from './auth.js';
import { esc, toast, confirmDialog, isUuid, stateLoading, stateEmpty } from './ui.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 20;

// ── Guard ────────────────────────────────────────────────────────────────────
async function guard() {
  const p = await getProfile();
  if (!p || p.role !== 'admin') {
    document.body.innerHTML = `<main class="section"><div class="container"><div class="state state-error" role="alert">
      <p>Admin access only. <a href="/index.html">Return home</a></p></div></div></main>`;
    return false;
  }
  return true;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.setAttribute('aria-selected', 'false'));
      panels.forEach(p => p.setAttribute('aria-hidden', 'true'));
      btn.setAttribute('aria-selected', 'true');
      const target = $(`panel-${btn.dataset.tab}`);
      if (target) target.setAttribute('aria-hidden', 'false');
    });
  });
}

// ── Analytics / Stats ─────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const [places, quests, campaigns, completions] = await Promise.all([
      supabase.from('places').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('quests').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('user_quests').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    ]);
    $('stat-places').textContent = places.count ?? 0;
    $('stat-quests').textContent = quests.count ?? 0;
    $('stat-campaigns').textContent = campaigns.count ?? 0;
    $('stat-completions').textContent = completions.count ?? 0;
  } catch (e) { console.error('Stats error', e); }
}

// ── Destinations ──────────────────────────────────────────────────────────────
let placePage = 0, placeSearch = '', provinces = [], categories = [];

async function loadRefs() {
  const [p, c, d] = await Promise.all([
    supabase.from('provinces').select('id, name_en').order('name_en'),
    supabase.from('place_categories').select('id, slug, name').order('name'),
    supabase.from('districts').select('id, province_id, name_en').order('name_en'),
  ]);
  provinces = p.data || [];
  categories = c.data || [];
  return { provinces, categories, districts: d.data || [] };
}

async function loadPlaces() {
  const panel = $('panel-places');
  const tbody = $('places-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">${stateLoading()}</td></tr>`;
  try {
    let q = supabase.from('places')
      .select('id, name, status, verified, provinces(name_en), place_categories(name), updated_at', { count: 'exact' })
      .order('name').range(placePage * PAGE_SIZE, (placePage + 1) * PAGE_SIZE - 1);
    const term = placeSearch.trim();
    if (term) q = q.ilike('name', `%${term}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    tbody.innerHTML = data.length ? data.map(p => `
      <tr>
        <td><a href="/place.html?id=${encodeURIComponent(p.id)}" target="_blank">${esc(p.name)}</a></td>
        <td>${esc(p.place_categories?.name ?? '—')}</td>
        <td>${esc(p.provinces?.name_en ?? '—')}</td>
        <td><span class="badge ${p.status === 'published' ? '' : 'badge-muted'}">${esc(p.status)}</span>
            ${p.verified ? '<span class="badge" title="Verified">✓</span>' : ''}</td>
        <td><span class="meta">${new Date(p.updated_at).toLocaleDateString()}</span></td>
        <td>
          <button class="btn btn-small btn-secondary" data-act="place-edit" data-id="${esc(p.id)}" type="button">Edit</button>
          <button class="btn btn-small btn-danger" data-act="place-del" data-id="${esc(p.id)}" data-name="${esc(p.name)}" type="button">Archive</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="6">${stateEmpty('No destinations found.')}</td></tr>`;
    renderPagination('places-pagination', count, placePage, n => { placePage = n; loadPlaces(); });
  } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="6" class="state state-error">Could not load destinations.</td></tr>`; }
}

function renderPagination(containerId, total, page, onChange) {
  const el = $(containerId);
  if (!el) return;
  const pages = Math.ceil((total || 0) / PAGE_SIZE);
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn btn-small btn-secondary" ${page <= 0 ? 'disabled' : ''} data-pg="${page - 1}">‹ Prev</button>
    <span class="meta">Page ${page + 1} of ${pages}</span>
    <button class="btn btn-small btn-secondary" ${page >= pages - 1 ? 'disabled' : ''} data-pg="${page + 1}">Next ›</button>`;
  el.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => onChange(Number(b.dataset.pg))));
}

// Place editor dialog
async function openPlaceEditor(id) {
  const refs = await loadRefs();
  const isNew = !id;
  let row = { name: '', summary: '', description: '', province_id: '', district_id: '', category_id: '', lat: '', lng: '', visitor_info: '', opening_hours: '', entry_fee: '', accessibility_info: '', status: 'draft', verified: false };
  if (!isNew) {
    const { data, error } = await supabase.from('places').select('*').eq('id', id).single();
    if (error || !data) { toast('Could not load destination.', 'error'); return; }
    row = data;
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.style.maxWidth = '680px';
  dlg.setAttribute('aria-labelledby', 'ped-title');
  const provinceSel = refs.provinces.map(p => `<option value="${p.id}" ${row.province_id === p.id ? 'selected' : ''}>${esc(p.name_en)}</option>`).join('');
  const districtSel = refs.districts.map(d => `<option value="${d.id}" ${row.district_id === d.id ? 'selected' : ''}>${esc(d.name_en)}</option>`).join('');
  const catSel = refs.categories.map(c => `<option value="${c.id}" ${row.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  dlg.innerHTML = `
    <h2 id="ped-title" style="font-size:1.25rem">${isNew ? 'New destination' : 'Edit destination'}</h2>
    <div id="ped-msg" role="alert" hidden></div>
    <form id="ped-form" novalidate>
      <div class="form-2col">
        <div class="form-field"><label>Name *</label><input id="ped-name" required maxlength="200" value="${esc(row.name)}"></div>
        <div class="form-field"><label>Category</label><select id="ped-cat"><option value="">None</option>${catSel}</select></div>
      </div>
      <div class="form-field"><label>Summary (max 500)</label><textarea id="ped-sum" maxlength="500">${esc(row.summary || '')}</textarea></div>
      <div class="form-field"><label>Description</label><textarea id="ped-desc">${esc(row.description || '')}</textarea></div>
      <div class="form-2col">
        <div class="form-field"><label>Province *</label><select id="ped-prov" required><option value="">Select province</option>${provinceSel}</select></div>
        <div class="form-field"><label>District</label><select id="ped-dist"><option value="">None</option>${districtSel}</select></div>
      </div>
      <div class="form-2col">
        <div class="form-field"><label>Latitude *</label><input id="ped-lat" type="number" step="any" required value="${esc(String(row.lat ?? ''))}"></div>
        <div class="form-field"><label>Longitude *</label><input id="ped-lng" type="number" step="any" required value="${esc(String(row.lng ?? ''))}"></div>
      </div>
      <div class="form-field"><label>Visitor information (verified)</label><textarea id="ped-vis" maxlength="1000">${esc(row.visitor_info || '')}</textarea></div>
      <div class="form-2col">
        <div class="form-field"><label>Opening hours (verified)</label><input id="ped-hrs" maxlength="200" value="${esc(row.opening_hours || '')}"></div>
        <div class="form-field"><label>Entry fee (verified)</label><input id="ped-fee" maxlength="200" value="${esc(row.entry_fee || '')}"></div>
      </div>
      <div class="form-field"><label>Accessibility info (verified)</label><input id="ped-acc" maxlength="500" value="${esc(row.accessibility_info || '')}"></div>
      <div class="form-2col">
        <div class="form-field"><label>Status</label><select id="ped-status">
          <option value="draft" ${row.status === 'draft' ? 'selected' : ''}>Draft</option>
          <option value="published" ${row.status === 'published' ? 'selected' : ''}>Published</option>
          <option value="archived" ${row.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select></div>
        <div class="form-field" style="justify-content:flex-end;padding-top:1.75rem">
          <label style="flex-direction:row;align-items:center;gap:.5rem;cursor:pointer">
            <input id="ped-verified" type="checkbox" ${row.verified ? 'checked' : ''}> Verified</label>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="ped-cancel">Cancel</button>
        <button type="submit" class="btn" id="ped-save">Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  dlg.querySelector('#ped-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#ped-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = dlg.querySelector('#ped-msg');
    const payload = {
      name: dlg.querySelector('#ped-name').value.trim(),
      summary: dlg.querySelector('#ped-sum').value.trim() || null,
      description: dlg.querySelector('#ped-desc').value.trim() || null,
      province_id: Number(dlg.querySelector('#ped-prov').value) || null,
      district_id: Number(dlg.querySelector('#ped-dist').value) || null,
      category_id: Number(dlg.querySelector('#ped-cat').value) || null,
      lat: parseFloat(dlg.querySelector('#ped-lat').value),
      lng: parseFloat(dlg.querySelector('#ped-lng').value),
      visitor_info: dlg.querySelector('#ped-vis').value.trim() || null,
      opening_hours: dlg.querySelector('#ped-hrs').value.trim() || null,
      entry_fee: dlg.querySelector('#ped-fee').value.trim() || null,
      accessibility_info: dlg.querySelector('#ped-acc').value.trim() || null,
      status: dlg.querySelector('#ped-status').value,
      verified: dlg.querySelector('#ped-verified').checked,
    };
    if (!payload.name) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Name is required.'; return; }
    if (!payload.province_id) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Province is required.'; return; }
    if (isNaN(payload.lat) || isNaN(payload.lng)) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Valid coordinates are required.'; return; }
    if (payload.status === 'published' && !payload.verified) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'A place must be verified before publishing.'; return; }

    dlg.querySelector('#ped-save').disabled = true;
    try {
      if (isNew) {
        const { error } = await supabase.from('places').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('places').update(payload).eq('id', id);
        if (error) throw error;
      }
      toast('Destination saved.');
      dlg.close(); dlg.remove();
      loadPlaces();
    } catch (err) {
      console.error(err);
      msg.hidden = false; msg.className = 'alert alert-error';
      msg.textContent = err.message || 'Could not save destination.';
    } finally { dlg.querySelector('#ped-save').disabled = false; }
  });
}

// ── Quests ────────────────────────────────────────────────────────────────────
let questPage = 0, questSearch = '';

async function loadQuests() {
  const tbody = $('quests-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">${stateLoading()}</td></tr>`;
  try {
    let q = supabase.from('quests')
      .select('id, title, type, difficulty, status, reward_tokens, updated_at', { count: 'exact' })
      .order('title').range(questPage * PAGE_SIZE, (questPage + 1) * PAGE_SIZE - 1);
    const term = questSearch.trim();
    if (term) q = q.ilike('title', `%${term}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    tbody.innerHTML = data.length ? data.map(q => `
      <tr>
        <td>${esc(q.title)}</td>
        <td><span class="badge badge-muted">${esc(q.type)}</span></td>
        <td><span class="badge badge-muted">${esc(q.difficulty)}</span></td>
        <td><span class="badge ${q.status === 'published' ? '' : 'badge-muted'}">${esc(q.status)}</span></td>
        <td>${Number(q.reward_tokens)}</td>
        <td>
          <button class="btn btn-small btn-secondary" data-act="quest-edit" data-id="${esc(q.id)}" type="button">Edit</button>
          <button class="btn btn-small btn-danger" data-act="quest-del" data-id="${esc(q.id)}" data-name="${esc(q.title)}" type="button">Archive</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="6">${stateEmpty('No quests found.')}</td></tr>`;
    renderPagination('quests-pagination', count, questPage, n => { questPage = n; loadQuests(); });
  } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="6" class="state state-error">Could not load quests.</td></tr>`; }
}

async function openQuestEditor(id) {
  const refs = await loadRefs();
  const isNew = !id;
  let row = { title: '', description: '', instructions: '', type: 'quiz', completion_method: 'quiz', difficulty: 'easy', reward_tokens: 10, status: 'draft', starts_at: '', ends_at: '' };
  let questions = [], places = [], existingQPs = [];

  if (!isNew) {
    const [qr, qq, qp] = await Promise.all([
      supabase.from('quests').select('*').eq('id', id).single(),
      supabase.from('quest_questions').select('id, prompt, position, quest_options(id, label, position), quest_answer_keys(option_id)').eq('quest_id', id).order('position'),
      supabase.from('quest_places').select('place_id, places(name)').eq('quest_id', id),
    ]);
    if (qr.error) { toast('Could not load quest.', 'error'); return; }
    row = qr.data;
    questions = (qq.data || []).map(q => ({
      id: q.id, prompt: q.prompt,
      options: q.quest_options.sort((a, b) => a.position - b.position),
      correctOptionId: q.quest_answer_keys?.[0]?.option_id || null,
    }));
    existingQPs = qp.data || [];
  }

  const { data: allPlaces } = await supabase.from('places').select('id, name').eq('status', 'published').order('name');
  places = allPlaces || [];

  const dlg = document.createElement('dialog');
  dlg.className = 'modal'; dlg.style.maxWidth = '720px';
  dlg.setAttribute('aria-labelledby', 'qed-title');

  const placeOpts = places.map(p => `<option value="${esc(p.id)}" ${existingQPs.some(x => x.place_id === p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

  dlg.innerHTML = `
    <h2 id="qed-title" style="font-size:1.25rem">${isNew ? 'New quest' : 'Edit quest'}</h2>
    <div id="qed-msg" role="alert" hidden></div>
    <form id="qed-form" novalidate>
      <div class="form-field"><label>Title *</label><input id="qed-title-f" required maxlength="200" value="${esc(row.title)}"></div>
      <div class="form-field"><label>Description</label><textarea id="qed-desc" maxlength="2000">${esc(row.description || '')}</textarea></div>
      <div class="form-field"><label>Instructions (shown to player)</label><textarea id="qed-instr" maxlength="2000">${esc(row.instructions || '')}</textarea></div>
      <div class="form-2col">
        <div class="form-field"><label>Type</label><select id="qed-type">
          <option value="exploration" ${row.type === 'exploration' ? 'selected' : ''}>Exploration</option>
          <option value="quiz" ${row.type === 'quiz' ? 'selected' : ''}>Quiz</option>
          <option value="culture" ${row.type === 'culture' ? 'selected' : ''}>Local culture</option>
          <option value="history" ${row.type === 'history' ? 'selected' : ''}>Historical discovery</option>
          <option value="photo" ${row.type === 'photo' ? 'selected' : ''}>Photo challenge</option>
          <option value="multi_destination" ${row.type === 'multi_destination' ? 'selected' : ''}>Multi-destination</option>
          <option value="campaign" ${row.type === 'campaign' ? 'selected' : ''}>Campaign</option>
          <option value="code" ${row.type === 'code' ? 'selected' : ''}>Check-in code</option>
        </select></div>
        <div class="form-field"><label>Completion method</label><select id="qed-method">
          <option value="quiz" ${row.completion_method === 'quiz' ? 'selected' : ''}>Quiz (questions)</option>
          <option value="code" ${row.completion_method === 'code' ? 'selected' : ''}>Check-in code</option>
        </select></div>
      </div>
      <div class="form-2col">
        <div class="form-field"><label>Difficulty</label><select id="qed-diff">
          <option value="easy" ${row.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
          <option value="medium" ${row.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="hard" ${row.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
        </select></div>
        <div class="form-field"><label>Reward tokens</label><input id="qed-tokens" type="number" min="0" max="500" value="${Number(row.reward_tokens)}"></div>
      </div>
      <div class="form-2col">
        <div class="form-field"><label>Available from</label><input id="qed-start" type="date" value="${esc((row.starts_at || '').slice(0, 10))}"></div>
        <div class="form-field"><label>Available until</label><input id="qed-end" type="date" value="${esc((row.ends_at || '').slice(0, 10))}"></div>
      </div>
      <div class="form-field"><label>Status</label><select id="qed-status">
        <option value="draft" ${row.status === 'draft' ? 'selected' : ''}>Draft</option>
        <option value="published" ${row.status === 'published' ? 'selected' : ''}>Published</option>
        <option value="archived" ${row.status === 'archived' ? 'selected' : ''}>Archived</option>
      </select></div>
      <div class="form-field"><label>Destinations (hold Ctrl/Cmd for multiple)</label>
        <select id="qed-places" multiple size="5">${placeOpts}</select></div>

      <div id="qed-method-fields">
        <h3 style="margin-top:1.5rem;font-size:1rem">Quiz questions</h3>
        <div id="qed-questions" class="questions-list"></div>
        <button type="button" class="btn btn-small btn-secondary" id="qed-addq" style="margin-top:.75rem">+ Add question</button>
      </div>

      <div class="form-field" id="qed-code-field" hidden>
        <label>Check-in code (secret — share only at destination)</label>
        <input id="qed-code" maxlength="100" autocomplete="off">
        <span class="form-hint">Leave blank to keep existing code.</span>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="qed-cancel">Cancel</button>
        <button type="submit" class="btn" id="qed-save">Save quest</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  // Toggle quiz vs code fields
  const methodSel = dlg.querySelector('#qed-method');
  function toggleMethod() {
    const isQuiz = methodSel.value === 'quiz';
    dlg.querySelector('#qed-method-fields').hidden = !isQuiz;
    dlg.querySelector('#qed-code-field').hidden = isQuiz;
  }
  methodSel.addEventListener('change', toggleMethod);
  toggleMethod();

  // Render questions
  let qList = [...questions];
  function renderQuestions() {
    const container = dlg.querySelector('#qed-questions');
    container.innerHTML = qList.map((q, qi) => `
      <div class="question-block" data-qi="${qi}">
        <div class="form-field"><label>Question ${qi + 1}</label>
          <input class="q-prompt" maxlength="500" value="${esc(q.prompt)}" required></div>
        <div class="options-list">
          ${q.options.map((o, oi) => `
            <div class="option-row">
              <input type="radio" name="correct-${qi}" value="${esc(o.id || `new-${qi}-${oi}`)}" ${q.correctOptionId === o.id ? 'checked' : ''}>
              <input class="opt-label" data-oi="${oi}" maxlength="300" value="${esc(o.label)}" required>
              <button type="button" class="btn btn-small btn-danger" data-rm-opt="${oi}">✕</button>
            </div>`).join('')}
        </div>
        <div style="margin-top:.5rem;display:flex;gap:.5rem">
          <button type="button" class="btn btn-small btn-secondary" data-add-opt="${qi}">+ Option</button>
          <button type="button" class="btn btn-small btn-danger" data-rm-q="${qi}">Remove question</button>
        </div>
      </div>`).join('') || '<p class="muted">No questions yet.</p>';
  }
  renderQuestions();

  dlg.querySelector('#qed-addq').addEventListener('click', () => {
    qList.push({ id: null, prompt: '', options: [{ id: null, label: '' }, { id: null, label: '' }], correctOptionId: null });
    renderQuestions();
  });

  dlg.querySelector('#qed-questions').addEventListener('click', e => {
    const rmQ = e.target.closest('[data-rm-q]');
    const addOpt = e.target.closest('[data-add-opt]');
    const rmOpt = e.target.closest('[data-rm-opt]');
    if (rmQ) { qList.splice(Number(rmQ.dataset.rmQ), 1); renderQuestions(); }
    if (addOpt) { qList[Number(addOpt.dataset.addOpt)].options.push({ id: null, label: '' }); renderQuestions(); }
    if (rmOpt) {
      const block = e.target.closest('[data-qi]');
      qList[Number(block.dataset.qi)].options.splice(Number(rmOpt.dataset.rmOpt), 1);
      renderQuestions();
    }
  });

  dlg.querySelector('#qed-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#qed-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = dlg.querySelector('#qed-msg');
    const isQuiz = methodSel.value === 'quiz';
    const payload = {
      title: dlg.querySelector('#qed-title-f').value.trim(),
      description: dlg.querySelector('#qed-desc').value.trim() || null,
      instructions: dlg.querySelector('#qed-instr').value.trim() || null,
      type: dlg.querySelector('#qed-type').value,
      completion_method: methodSel.value,
      difficulty: dlg.querySelector('#qed-diff').value,
      reward_tokens: Math.min(500, Math.max(0, Number(dlg.querySelector('#qed-tokens').value))),
      starts_at: dlg.querySelector('#qed-start').value || null,
      ends_at: dlg.querySelector('#qed-end').value || null,
      status: dlg.querySelector('#qed-status').value,
    };
    if (!payload.title) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Title is required.'; return; }

    dlg.querySelector('#qed-save').disabled = true;
    try {
      let questId = id;
      if (isNew) {
        const { data, error } = await supabase.from('quests').insert(payload).select('id').single();
        if (error) throw error;
        questId = data.id;
      } else {
        const { error } = await supabase.from('quests').update(payload).eq('id', id);
        if (error) throw error;
      }

      // Save quest_places
      const selectedPlaces = [...dlg.querySelector('#qed-places').selectedOptions].map(o => o.value).filter(isUuid);
      await supabase.from('quest_places').delete().eq('quest_id', questId);
      if (selectedPlaces.length) {
        const { error } = await supabase.from('quest_places').insert(selectedPlaces.map(place_id => ({ quest_id: questId, place_id })));
        if (error) console.error('quest_places error', error);
      }

      // Save questions (for quiz method)
      if (isQuiz) {
        // Collect question data from DOM
        const blocks = dlg.querySelectorAll('[data-qi]');
        const deletedIds = new Set(questions.map(q => q.id).filter(Boolean));
        for (const [qi, block] of blocks.entries()) {
          const prompt = block.querySelector('.q-prompt').value.trim();
          if (!prompt) continue;
          const opts = [...block.querySelectorAll('.opt-label')].map(i => i.value.trim()).filter(Boolean);
          if (!opts.length) continue;
          const correctRadio = block.querySelector(`input[type=radio][name="correct-${qi}"]:checked`);

          const qData = qList[qi];
          let qqId = qData.id;
          if (qqId) {
            deletedIds.delete(qqId);
            await supabase.from('quest_questions').update({ prompt, position: qi }).eq('id', qqId);
          } else {
            const { data } = await supabase.from('quest_questions').insert({ quest_id: questId, prompt, position: qi }).select('id').single();
            qqId = data?.id;
          }
          if (!qqId) continue;

          // Delete old options and re-insert
          await supabase.from('quest_options').delete().eq('question_id', qqId);
          let correctNewId = null;
          for (const [oi, label] of opts.entries()) {
            const { data: od } = await supabase.from('quest_options').insert({ question_id: qqId, label, position: oi }).select('id').single();
            const origOpt = qData.options[oi];
            const isCorrect = correctRadio && (correctRadio.value === (origOpt?.id || `new-${qi}-${oi}`));
            if (isCorrect && od?.id) correctNewId = od.id;
          }
          if (correctNewId) {
            await supabase.from('quest_answer_keys').delete().eq('quest_id', questId);
            await supabase.from('quest_answer_keys').insert({ quest_id: questId, question_id: qqId, option_id: correctNewId });
          }
        }
        // Delete removed questions
        for (const delId of deletedIds) {
          await supabase.from('quest_questions').delete().eq('id', delId);
        }
      } else {
        // Save check-in code if provided
        const code = dlg.querySelector('#qed-code')?.value.trim();
        if (code) {
          await supabase.from('quest_secrets').delete().eq('quest_id', questId);
          await supabase.from('quest_secrets').insert({ quest_id: questId, checkin_code: code });
        }
      }

      toast('Quest saved.');
      dlg.close(); dlg.remove();
      loadQuests();
    } catch (err) {
      console.error(err);
      msg.hidden = false; msg.className = 'alert alert-error';
      msg.textContent = err.message || 'Could not save quest.';
    } finally { dlg.querySelector('#qed-save').disabled = false; }
  });
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
let campPage = 0;

async function loadCampaigns() {
  const tbody = $('camps-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">${stateLoading()}</td></tr>`;
  try {
    const { data, error, count } = await supabase.from('campaigns')
      .select('id, title, status, starts_at, ends_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(campPage * PAGE_SIZE, (campPage + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    tbody.innerHTML = data.length ? data.map(c => `
      <tr>
        <td>${esc(c.title)}</td>
        <td><span class="badge ${c.status === 'published' ? '' : 'badge-muted'}">${esc(c.status)}</span></td>
        <td class="meta">${c.starts_at ? new Date(c.starts_at).toLocaleDateString() : '—'}</td>
        <td class="meta">${c.ends_at ? new Date(c.ends_at).toLocaleDateString() : '—'}</td>
        <td>
          <button class="btn btn-small btn-secondary" data-act="camp-edit" data-id="${esc(c.id)}" type="button">Edit</button>
          <button class="btn btn-small btn-danger" data-act="camp-del" data-id="${esc(c.id)}" data-name="${esc(c.title)}" type="button">Archive</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="5">${stateEmpty('No campaigns found.')}</td></tr>`;
    renderPagination('camps-pagination', count, campPage, n => { campPage = n; loadCampaigns(); });
  } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="5" class="state state-error">Could not load campaigns.</td></tr>`; }
}

async function openCampaignEditor(id) {
  const isNew = !id;
  let row = { title: '', description: '', status: 'draft', starts_at: '', ends_at: '', reward_tokens: 0 };
  let existingPlaces = [], existingQuests = [];

  if (!isNew) {
    const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
    if (error || !data) { toast('Could not load campaign.', 'error'); return; }
    row = data;
    const [cp, cq] = await Promise.all([
      supabase.from('campaign_places').select('place_id, places(name)').eq('campaign_id', id),
      supabase.from('campaign_quests').select('quest_id, quests(title)').eq('campaign_id', id),
    ]);
    existingPlaces = cp.data || [];
    existingQuests = cq.data || [];
  }

  const [allPlaces, allQuests] = await Promise.all([
    supabase.from('places').select('id, name').eq('status', 'published').order('name'),
    supabase.from('quests').select('id, title').eq('status', 'published').order('title'),
  ]);

  const dlg = document.createElement('dialog');
  dlg.className = 'modal'; dlg.style.maxWidth = '680px';
  dlg.setAttribute('aria-labelledby', 'ced-title');
  const placeOpts = (allPlaces.data || []).map(p => `<option value="${esc(p.id)}" ${existingPlaces.some(x => x.place_id === p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const questOpts = (allQuests.data || []).map(q => `<option value="${esc(q.id)}" ${existingQuests.some(x => x.quest_id === q.id) ? 'selected' : ''}>${esc(q.title)}</option>`).join('');

  dlg.innerHTML = `
    <h2 id="ced-title" style="font-size:1.25rem">${isNew ? 'New campaign' : 'Edit campaign'}</h2>
    <div id="ced-msg" role="alert" hidden></div>
    <form id="ced-form" novalidate>
      <div class="form-field"><label>Title *</label><input id="ced-title-f" required maxlength="200" value="${esc(row.title)}"></div>
      <div class="form-field"><label>Description</label><textarea id="ced-desc" maxlength="3000">${esc(row.description || '')}</textarea></div>
      <div class="form-2col">
        <div class="form-field"><label>Start date</label><input id="ced-start" type="date" value="${esc((row.starts_at || '').slice(0, 10))}"></div>
        <div class="form-field"><label>End date</label><input id="ced-end" type="date" value="${esc((row.ends_at || '').slice(0, 10))}"></div>
      </div>
      <div class="form-2col">
        <div class="form-field"><label>Reward tokens</label><input id="ced-tokens" type="number" min="0" max="1000" value="${Number(row.reward_tokens)}"></div>
        <div class="form-field"><label>Status</label><select id="ced-status">
          <option value="draft" ${row.status === 'draft' ? 'selected' : ''}>Draft</option>
          <option value="published" ${row.status === 'published' ? 'selected' : ''}>Published</option>
          <option value="paused" ${row.status === 'paused' ? 'selected' : ''}>Paused</option>
          <option value="ended" ${row.status === 'ended' ? 'selected' : ''}>Ended</option>
          <option value="archived" ${row.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select></div>
      </div>
      <div class="form-field"><label>Destinations (hold Ctrl/Cmd)</label><select id="ced-places" multiple size="5">${placeOpts}</select></div>
      <div class="form-field"><label>Quests (hold Ctrl/Cmd)</label><select id="ced-quests" multiple size="5">${questOpts}</select></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="ced-cancel">Cancel</button>
        <button type="submit" class="btn" id="ced-save">Save campaign</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  dlg.querySelector('#ced-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#ced-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = dlg.querySelector('#ced-msg');
    const start = dlg.querySelector('#ced-start').value;
    const end = dlg.querySelector('#ced-end').value;
    if (start && end && end < start) {
      msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'End date must be after start date.'; return;
    }
    const payload = {
      title: dlg.querySelector('#ced-title-f').value.trim(),
      description: dlg.querySelector('#ced-desc').value.trim() || null,
      starts_at: start || null,
      ends_at: end || null,
      reward_tokens: Math.min(1000, Math.max(0, Number(dlg.querySelector('#ced-tokens').value))),
      status: dlg.querySelector('#ced-status').value,
    };
    if (!payload.title) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Title is required.'; return; }

    dlg.querySelector('#ced-save').disabled = true;
    try {
      let campId = id;
      if (isNew) {
        const { data, error } = await supabase.from('campaigns').insert(payload).select('id').single();
        if (error) throw error;
        campId = data.id;
      } else {
        const { error } = await supabase.from('campaigns').update(payload).eq('id', id);
        if (error) throw error;
      }
      const selPlaces = [...dlg.querySelector('#ced-places').selectedOptions].map(o => o.value).filter(isUuid);
      const selQuests = [...dlg.querySelector('#ced-quests').selectedOptions].map(o => o.value).filter(isUuid);
      await Promise.all([
        supabase.from('campaign_places').delete().eq('campaign_id', campId),
        supabase.from('campaign_quests').delete().eq('campaign_id', campId),
      ]);
      if (selPlaces.length) await supabase.from('campaign_places').insert(selPlaces.map(place_id => ({ campaign_id: campId, place_id })));
      if (selQuests.length) await supabase.from('campaign_quests').insert(selQuests.map(quest_id => ({ campaign_id: campId, quest_id })));

      toast('Campaign saved.');
      dlg.close(); dlg.remove();
      loadCampaigns();
    } catch (err) {
      console.error(err);
      msg.hidden = false; msg.className = 'alert alert-error';
      msg.textContent = err.message || 'Could not save campaign.';
    } finally { dlg.querySelector('#ced-save').disabled = false; }
  });
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function loadAuditLog() {
  const el = $('audit-log');
  if (!el) return;
  el.innerHTML = stateLoading();
  try {
    const { data, error } = await supabase.from('audit_logs')
      .select('id, action, table_name, record_id, admin_id, created_at, profiles(display_name)')
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    el.innerHTML = data.length ? `<div class="table-wrap"><table class="table audit-list">
      <thead><tr><th>When</th><th>Admin</th><th>Table</th><th>Action</th><th>Record</th></tr></thead>
      <tbody>${data.map(r => `<tr>
        <td class="meta">${new Date(r.created_at).toLocaleString()}</td>
        <td>${esc(r.profiles?.display_name || r.admin_id?.slice(0, 8) || '—')}</td>
        <td>${esc(r.table_name)}</td>
        <td><span class="badge badge-muted">${esc(r.action)}</span></td>
        <td class="meta">${esc((r.record_id || '').slice(0, 8))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : stateEmpty('No audit records yet.');
  } catch (e) { console.error(e); el.innerHTML = `<div class="state state-error">Could not load audit log.</div>`; }
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id, name } = btn.dataset;

  if (act === 'place-edit') { openPlaceEditor(id); return; }
  if (act === 'place-del') {
    if (!(await confirmDialog({ title: 'Archive destination', message: `Archive "${name}"? It will be hidden from public pages.`, confirmLabel: 'Archive', danger: true }))) return;
    const { error } = await supabase.from('places').update({ status: 'archived' }).eq('id', id);
    if (error) { toast('Could not archive destination.', 'error'); return; }
    toast('Destination archived.'); loadPlaces();
    return;
  }
  if (act === 'quest-edit') { openQuestEditor(id); return; }
  if (act === 'quest-del') {
    if (!(await confirmDialog({ title: 'Archive quest', message: `Archive "${name}"?`, confirmLabel: 'Archive', danger: true }))) return;
    const { error } = await supabase.from('quests').update({ status: 'archived' }).eq('id', id);
    if (error) { toast('Could not archive quest.', 'error'); return; }
    toast('Quest archived.'); loadQuests();
    return;
  }
  if (act === 'camp-edit') { openCampaignEditor(id); return; }
  if (act === 'camp-del') {
    if (!(await confirmDialog({ title: 'Archive campaign', message: `Archive "${name}"?`, confirmLabel: 'Archive', danger: true }))) return;
    const { error } = await supabase.from('campaigns').update({ status: 'archived' }).eq('id', id);
    if (error) { toast('Could not archive campaign.', 'error'); return; }
    toast('Campaign archived.'); loadCampaigns();
    return;
  }
});

// Search handlers
function wireSearch(inputId, reset, load) {
  const el = $(inputId);
  if (!el) return;
  let t;
  el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { reset(); load(); }, 350); });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!(await guard())) return;
  initTabs();
  await loadStats();
  await loadRefs();

  // Wire new buttons
  $('btn-new-place')?.addEventListener('click', () => openPlaceEditor(null));
  $('btn-new-quest')?.addEventListener('click', () => openQuestEditor(null));
  $('btn-new-camp')?.addEventListener('click', () => openCampaignEditor(null));

  wireSearch('place-search', () => { placePage = 0; placeSearch = $('place-search')?.value || ''; }, loadPlaces);
  wireSearch('quest-search', () => { questPage = 0; questSearch = $('quest-search')?.value || ''; }, loadQuests);

  // Load active tab data
  await Promise.all([loadPlaces(), loadQuests(), loadCampaigns(), loadAuditLog()]);
})();
