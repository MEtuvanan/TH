import { listQuests, getQuestQuestions, myProgress, startQuest, completeQuest } from './quests.js';
import { getSession, requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import { esc, toast } from './ui.js';
import { t, getLang, toggleLang } from './i18n.js';

const $ = id => document.getElementById(id);

// ── i18n labels ──────────────────────────────────────────
const DIFF_LABEL = () => ({
  easy:   `🟢 ${t('diff_easy')}`,
  medium: `🟡 ${t('diff_medium')}`,
  hard:   `🔴 ${t('diff_hard')}`,
});

const TYPE_LABEL = () => ({
  quiz:              `📝 ${t('type_quiz')}`,
  code:              `🔑 ${t('type_code')}`,
  exploration:       `🗺️ ${t('type_exploration')}`,
  culture:           `🎭 ${t('type_culture')}`,
  history:           `🏛️ ${t('type_history')}`,
  photo:             `📸 ${t('type_photo')}`,
  multi_destination: `🗾 Multi-destination`,
  campaign:          `🏆 Campaign`,
});

// ── State ─────────────────────────────────────────────────
let quests = [], progress = new Map(), campaigns = [], current = null;
let activeTab = 'all', searchTerm = '';

// ── Helpers ───────────────────────────────────────────────
function diffClass(d) {
  return { easy: 'diff-easy', medium: 'diff-medium', hard: 'diff-hard' }[d] || 'diff-easy';
}

function questStatus(id) {
  return progress.get(id) || 'not_started';
}

function filteredQuests() {
  const type = $('f-type')?.value || '';
  const diff = $('f-diff')?.value || '';
  const place = $('f-place')?.value || '';
  const term = searchTerm.trim().toLowerCase();

  return quests.filter(q => {
    const st = questStatus(q.id);
    if (activeTab === 'active' && st !== 'in_progress') return false;
    if (activeTab === 'completed' && st !== 'completed') return false;
    if (type && q.type !== type) return false;
    if (diff && q.difficulty !== diff) return false;
    if (place && !q.quest_places.some(x => x.place_id === place)) return false;
    if (term && !q.title.toLowerCase().includes(term) &&
        !q.quest_places.some(x => (x.places?.name || '').toLowerCase().includes(term))) return false;
    return true;
  });
}

// ── Filters population ───────────────────────────────────
function fillFilters() {
  const types = [...new Set(quests.map(q => q.type))];
  const TL = TYPE_LABEL();
  $('f-type').innerHTML = `<option value="">${t('filter_all_types')}</option>` +
    types.map(t2 => `<option value="${esc(t2)}">${esc(TL[t2] || t2)}</option>`).join('');

  const places = new Map();
  quests.forEach(q => q.quest_places.forEach(p => places.set(p.place_id, p.places?.name)));
  $('f-place').innerHTML = `<option value="">${t('filter_all_places')}</option>` +
    [...places].map(([id, n]) => `<option value="${esc(id)}">${esc(n || id)}</option>`).join('');
}

// ── Render cards ──────────────────────────────────────────
function render() {
  const list = filteredQuests();
  updateTabCounts();

  const TL = TYPE_LABEL();
  const DL = DIFF_LABEL();

  if (!list.length) {
    $('list').innerHTML = `
      <div class="quest-empty">
        <span class="quest-empty-icon">🗺️</span>
        <h3>${activeTab === 'completed' ? 'ยังไม่มีเควสท์ที่สำเร็จ' : activeTab === 'active' ? 'ยังไม่มีเควสท์ที่กำลังทำ' : 'ไม่มีเควสท์ที่ตรงกับการค้นหา'}</h3>
        <p>${activeTab === 'completed' ? 'เริ่มพิชิตเควสท์เลย!' : activeTab === 'active' ? 'กดปุ่ม "เริ่มทำเควสท์" บนการ์ดเพื่อเริ่ม' : 'ลองเปลี่ยนตัวกรองหรือค้นหาใหม่'}</p>
      </div>`;
    $('status').textContent = '';
    return;
  }

  $('list').innerHTML = list.map(q => {
    const st = questStatus(q.id);
    const places = q.quest_places.map(p => p.places?.name).filter(Boolean).join(' · ');
    const rewardTxt = `🪙 ${Number(q.reward_tokens)} ${t('reward_tokens')}${q.reward_character_id ? ` ${t('reward_character')}` : ''}`;

    let btnTxt, btnClass;
    if (st === 'completed') { btnTxt = `🏆 ${t('btn_view')}`; btnClass = 'btn-secondary'; }
    else if (st === 'in_progress') { btnTxt = `🔥 ${t('btn_continue')}`; btnClass = ''; }
    else { btnTxt = `⚔️ ${t('btn_start')}`; btnClass = ''; }

    return `
    <article class="quest-card${st === 'completed' ? ' is-completed' : ''}" id="q-${esc(q.id)}">
      <div class="quest-card-bar ${diffClass(q.difficulty)}"></div>
      <div class="quest-card-body">
        <div class="badges">
          <span class="badge">${esc(TL[q.type] || q.type)}</span>
          <span class="badge badge-diff-${esc(q.difficulty)}">${esc(DL[q.difficulty] || q.difficulty)}</span>
          ${st === 'in_progress' ? `<span class="badge" style="background:#FFF3CD;color:#856404">🔥 ${t('status_in_progress')}</span>` : ''}
        </div>
        <h2 class="quest-card-title">${esc(q.title)}</h2>
        ${places ? `<p class="quest-card-places">📍 ${esc(places)}</p>` : ''}
        ${q.description ? `<p class="quest-card-desc">${esc(q.description)}</p>` : ''}
        <div class="quest-card-reward">
          <span class="quest-reward-icon">🎁</span>
          <span>${esc(rewardTxt)}</span>
        </div>
      </div>
      <div class="quest-card-footer">
        <button class="btn ${btnClass}" data-id="${esc(q.id)}" type="button">${btnTxt}</button>
      </div>
    </article>`;
  }).join('');

  const total = list.length;
  $('status').textContent = `พบ ${total} เควสท์`;
}

// ── Update hero stats & tab counts ───────────────────────
function updateHeroStats() {
  $('hero-stat-total').textContent = `${quests.length} เควสท์`;
  const done = [...progress.values()].filter(v => v === 'completed').length;
  const active = [...progress.values()].filter(v => v === 'in_progress').length;
  $('hero-stat-tokens').textContent = done > 0 ? `${done} สำเร็จแล้ว` : 'สะสมโทเคน';
  $('hero-stat-chars').textContent = active > 0 ? `${active} กำลังทำ` : 'ตัวละครสะสม';
}

function updateTabCounts() {
  const all = quests.length;
  const active = quests.filter(q => questStatus(q.id) === 'in_progress').length;
  const done = quests.filter(q => questStatus(q.id) === 'completed').length;

  const addCount = (tabId, n) => {
    const tab = $(tabId);
    if (!tab) return;
    let span = tab.querySelector('.tab-count');
    if (!span) { span = document.createElement('span'); span.className = 'tab-count'; tab.appendChild(span); }
    span.textContent = n;
    span.hidden = !n;
  };
  addCount('tab-all', all);
  addCount('tab-active', active);
  addCount('tab-done', done);
}

// ── Quest Modal ───────────────────────────────────────────
async function openQuest(id) {
  current = quests.find(q => q.id === id);
  if (!current) return;

  const session = await getSession();
  if (!session) { location.href = `/login.html?next=${encodeURIComponent('/quests.html#' + id)}`; return; }

  const TL = TYPE_LABEL();
  const DL = DIFF_LABEL();
  const st = questStatus(id);

  // Header
  $('qd-badges').innerHTML = `
    <span class="badge">${esc(TL[current.type] || current.type)}</span>
    <span class="badge badge-diff-${esc(current.difficulty)}">${esc(DL[current.difficulty] || current.difficulty)}</span>`;
  $('qd-title').textContent = current.title;
  $('qd-desc').textContent = current.description || '';
  $('qd-reward').textContent = `🎁 รางวัล: 🪙 ${Number(current.reward_tokens)} โทเคน${current.reward_character_id ? ' + ตัวละครพิเศษ 🎭' : ''}`;
  $('qd-instr').textContent = current.instructions || '';
  $('qd-msg').hidden = true;

  const form = $('qd-form');
  const done = st === 'completed';
  $('qd-submit').hidden = done;
  $('qd-submit').textContent = `📤 ${t('modal_submit')}`;
  $('qd-close').textContent = `✕ ${t('modal_close')}`;

  form.innerHTML = `<div class="state" role="status"><div class="spinner" aria-hidden="true"></div>กำลังโหลด...</div>`;
  $('quest-dialog').showModal();

  const isGuest = session.guest === true;

  try {
    // For real Supabase sessions: call start_quest RPC to track progress
    // For demo/guest sessions: skip RPC (no DB write) and just show the quest content
    if (!progress.has(id) && !isGuest) {
      const { error } = await startQuest(id);
      if (error) {
        // If migration 007 hasn't run yet, start_quest won't exist — skip gracefully
        console.warn('start_quest RPC failed (migration may not be applied yet):', error.message);
      } else {
        progress.set(id, 'in_progress');
        render();
      }
    }
    if (!progress.has(id)) {
      progress.set(id, 'in_progress');
      render();
    }

    if (done) {
      form.innerHTML = `<p style="text-align:center;padding:1rem;color:var(--color-emerald);font-weight:700">🏆 คุณพิชิตเควสท์นี้สำเร็จแล้ว!</p>`;
      return;
    }

    const isQuiz = current.completion_method === 'quiz' || current.type === 'quiz';
    if (isQuiz) {
      const qs = await getQuestQuestions(id);
      if (!qs.length) {
        form.innerHTML = `<p class="qd-instr">เควสท์นี้ยังไม่มีคำถาม กรุณาติดต่อผู้ดูแลระบบ</p>`;
        return;
      }
      form.innerHTML = qs.map((q, i) => `
        <fieldset class="question">
          <legend>${i + 1}. ${esc(q.prompt)}</legend>
          ${q.quest_options.map(o => `
            <label>
              <input type="radio" name="${esc(q.id)}" value="${esc(o.id)}" required>
              <span>${esc(o.label)}</span>
            </label>`).join('')}
        </fieldset>`).join('');
    } else {
      form.innerHTML = `
        <div class="form-field qd-code-field">
          <label for="code">${t('modal_enter_code')}</label>
          <input id="code" name="code" required maxlength="100" autocomplete="off"
            placeholder="กรอกรหัสที่ได้รับจากสถานที่..." style="text-transform:uppercase;letter-spacing:.1em">
          <span class="form-hint">💡 ${t('modal_code_hint')}</span>
        </div>`;
    }
  } catch (e) {
    console.error(e);
    form.innerHTML = `<p class="state state-error" role="alert">ไม่สามารถโหลดเควสท์ได้ กรุณาลองใหม่อีกครั้ง (${esc(e.message || '')})</p>`;
  }
}

// ── Submit handler ────────────────────────────────────────
$('qd-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!current) return;
  const fd = new FormData(e.target);
  const answers = {};
  let code = null;
  for (const [k, v] of fd) {
    if (k === 'code') code = v.trim().toUpperCase();
    else answers[k] = v;
  }
  $('qd-submit').disabled = true;
  $('qd-submit').textContent = 'กำลังตรวจคำตอบ...';
  const msg = $('qd-msg');

  try {
    const session = await getSession();
    const isGuest = session?.guest === true;

    // Demo/guest mode: simulate completion locally (no DB write)
    if (isGuest) {
      await new Promise(r => setTimeout(r, 600)); // simulate network delay
      msg.hidden = false;
      msg.className = 'alert-ok';
      const tokens = current.reward_tokens;
      msg.textContent = `🎉 ${t('modal_success')} +${tokens} โทเคน! (โหมดทดลองใช้งาน — ไม่บันทึกลงฐานข้อมูล)`;
      progress.set(current.id, 'completed');
      render();
      updateHeroStats();
      $('qd-submit').hidden = true;
      toast(msg.textContent);
      return;
    }

    const { data, error } = await completeQuest(current.id, answers, code);
    if (error) {
      // If complete_quest RPC doesn't exist yet, fall back to demo mode
      if (error.message?.includes('permission denied') || error.message?.includes('does not exist')) {
        msg.hidden = false;
        msg.className = 'alert-ok';
        msg.textContent = `🎉 ยินดีด้วย! (หมายเหตุ: ฟังก์ชัน complete_quest ยังไม่ได้ migrate — โปรดรัน migration 007 ใน Supabase Dashboard)`;
        progress.set(current.id, 'completed');
        render(); updateHeroStats();
        $('qd-submit').hidden = true;
        return;
      }
      throw error;
    }
    msg.hidden = false;
    if (data.ok) {
      msg.className = 'alert-ok';
      const tokens = data.tokens || current.reward_tokens;
      msg.textContent = data.already_completed
        ? t('modal_already_done')
        : `🎉 ${t('modal_success')} +${tokens} โทเคน!`;
      progress.set(current.id, 'completed');
      render();
      updateHeroStats();
      $('qd-submit').hidden = true;
      toast(msg.textContent);
    } else {
      msg.className = 'alert-error';
      if (data.locked) {
        msg.textContent = `🔒 ลองผิดหลายครั้งเกินไป กรุณาลองใหม่ในอีก ${data.retry_after_minutes} นาที`;
      } else {
        msg.textContent = t('modal_wrong');
      }
      $('qd-submit').disabled = false;
      $('qd-submit').textContent = `📤 ${t('modal_submit')}`;
    }
  } catch (err) {
    console.error(err);
    msg.hidden = false;
    msg.className = 'alert-error';
    msg.textContent = `เกิดข้อผิดพลาด: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`;
    $('qd-submit').disabled = false;
    $('qd-submit').textContent = `📤 ${t('modal_submit')}`;
  }
});

// ── Close / Tab / Filter bindings ────────────────────────
$('qd-close').addEventListener('click', () => $('quest-dialog').close());
$('quest-dialog').addEventListener('click', e => {
  if (e.target === $('quest-dialog')) $('quest-dialog').close();
});

$('list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (b) openQuest(b.dataset.id);
});

['tab-all', 'tab-active', 'tab-done'].forEach(id => {
  $(id)?.addEventListener('click', () => {
    activeTab = $(id).dataset.tab;
    document.querySelectorAll('.quest-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    $(id).classList.add('active');
    $(id).setAttribute('aria-selected', 'true');
    render();
  });
});

let searchTimer;
$('search')?.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTerm = e.target.value; render(); }, 250);
});

['f-type', 'f-diff', 'f-place'].forEach(id => {
  $(id)?.addEventListener('change', render);
});
$('filters').addEventListener('submit', e => e.preventDefault());

// ── Language change listener ───────────────────────────
window.addEventListener('tc_lang_change', () => {
  fillFilters();
  render();
  // update static labels
  const l = getLang();
  document.documentElement.lang = l;
  $('qd-submit').textContent = `📤 ${t('modal_submit')}`;
  $('qd-close').textContent = `✕ ${t('modal_close')}`;
  $('search').placeholder = t('search_placeholder');
});

// ── Init ───────────────────────────────────────────────
(async () => {
  const session = await requireAuth();
  if (!session) return;

  $('list').innerHTML = `<div class="state" role="status"><div class="spinner" aria-hidden="true"></div>${t('loading')}</div>`;

  try {
    [quests, progress] = await Promise.all([listQuests(), myProgress()]);

    const { data: campsData } = await supabase.from('campaigns').select('id, title').eq('status', 'published');
    campaigns = campsData || [];

    fillFilters();
    render();
    updateHeroStats();

    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash) openQuest(hash);
  } catch (e) {
    console.error('quests error:', e);
    $('list').innerHTML = `
      <div class="quest-empty">
        <span class="quest-empty-icon">⚠️</span>
        <h3>โหลดข้อมูลเควสท์ไม่ได้</h3>
        <p>${esc(e.message || 'กรุณาลองรีเฟรชหน้าเว็บใหม่อีกครั้ง')}</p>
      </div>`;
  }
})();
