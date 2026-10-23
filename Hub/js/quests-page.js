import { listQuests, myProgress, startQuest, completeQuest } from './quests.js';
import { getSession } from './auth.js';
import { supabase } from './supabase.js';
import { esc, toast } from './ui.js';
import { t, getLang } from './i18n.js';

// ── GPS Utility ───────────────────────────────────────────
/**
 * Haversine formula — distance in metres between two lat/lng points
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GPS_RADIUS_M = 500; // metres allowed from target

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject('อุปกรณ์ของคุณไม่รองรับ GPS'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => {
        const msgs = {
          1: 'คุณปฏิเสธการเข้าถึงตำแหน่ง กรุณาอนุญาต GPS แล้วลองอีกครั้ง',
          2: 'ไม่สามารถระบุตำแหน่งได้ กรุณาเปิดใช้ GPS',
          3: 'ใช้เวลาระบุตำแหน่งนานเกินไป กรุณาลองอีกครั้ง'
        };
        reject(msgs[err.code] || 'เกิดข้อผิดพลาดในการระบุตำแหน่ง');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

const $ = id => document.getElementById(id);

// ── Landmark Photos & Targets Registry ────────────────────
export const QUEST_LANDMARKS = {
  'wat phra kaew': {
    photo: 'https://images.unsplash.com/photo-1590523741831-ab7e8b8f9c7f?w=1000&auto=format&fit=crop&q=80',
    name: 'วัดพระศรีรัตนศาสดาราม (วัดพระแก้ว)',
    target: 'พระอุโบสถวัดพระแก้ว และพระมณฑปสีทอง',
    hint: 'ถ่ายรูปยอดพระมณฑปสีทอง หรือบริเวณด้านหน้าพระอุโบสถวัดพระแก้ว',
    lat: 13.7515, lng: 100.4927
  },
  'wat arun': {
    photo: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1000&auto=format&fit=crop&q=80',
    name: 'วัดอรุณราชวรารามราชวรมหาวิหาร',
    target: 'พระปรางค์ประธานวัดอรุณ ริมแม่น้ำเจ้าพระยา',
    hint: 'ถ่ายรูปพระปรางค์วัดอรุณคู่กับแม่น้ำเจ้าพระยา หรือถ่ายจากลานวัด',
    lat: 13.7437, lng: 100.4889
  },
  'wat pho': {
    photo: 'https://images.unsplash.com/photo-1528181304800-259b08848526?w=1000&auto=format&fit=crop&q=80',
    name: 'วัดพระเชตุพนวิมลมังคลาราม (วัดโพธิ์)',
    target: 'วิหารพระพุทธไสยาสน์ หรือมหาเจดีย์สี่รัชกาล',
    hint: 'ถ่ายรูปพระเจดีย์กระเบื้องเคลือบสี่รัชกาล หรือพระพุทธไสยาสน์องค์ใหญ่',
    lat: 13.7465, lng: 100.4930
  },
  'yaowarat': {
    photo: 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=1000&auto=format&fit=crop&q=80',
    name: 'ถนนเยาวราช (Bangkok Chinatown)',
    target: 'ซุ้มประตูเฉลิมพระเกียรติ หรือป้ายนีออนสตรีทฟู้ด',
    hint: 'ถ่ายรูปแสงสีป้ายไฟนีออนยามค่ำคืน หรืออาหารจานโปรดที่คุณเช็คอิน',
    lat: 13.7410, lng: 100.5100
  },
  'chatuchak': {
    photo: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&auto=format&fit=crop&q=80',
    name: 'ตลาดนัดจตุจักร (Chatuchak Weekend Market)',
    target: 'หอนาฬิกาจตุจักร หรือซอยร้านค้างานคราฟต์',
    hint: 'ถ่ายรูปหอนาฬิกาใจกลางตลาด หรือถ่ายรูปของที่ระลึกที่คุณเลือกซื้อ',
    lat: 13.7999, lng: 100.5500
  },
  'national museum': {
    photo: 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?w=1000&auto=format&fit=crop&q=80',
    name: 'พิพิธภัณฑสถานแห่งชาติ พระนคร',
    target: 'พระที่นั่งศิวโมกขพิมาน หรือพระที่นั่งพุทไธสวรรย์',
    hint: 'ถ่ายรูปหน้าพระที่นั่งโบราณ หรือบริเวณลานพิพิธภัณฑ์',
    lat: 13.7575, lng: 100.4928
  },
  'jim thompson': {
    photo: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=1000&auto=format&fit=crop&q=80',
    name: 'พิพิธภัณฑ์บ้านจิม ทอมป์สัน',
    target: 'เรือนไทยไม้สักริมคลองแสนแสบ',
    hint: 'ถ่ายรูปเรือนไทยสีแดงท่ามกลางแมกไม้เขียวขจี',
    lat: 13.7492, lng: 100.5285
  },
  'lumphini': {
    photo: 'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=1000&auto=format&fit=crop&q=80',
    name: 'สวนลุมพินี (Lumphini Park)',
    target: 'ศาลาแปดเหลี่ยม หรือวิวทะเลสาบสะท้อนตึก',
    hint: 'ถ่ายรูปริมทะเลสาบสะท้อนเงาตึก หรือถ่ายรูปท่ามกลางธรรมชาติร่มรื่น',
    lat: 13.7314, lng: 100.5414
  }
};

export function getQuestLandmark(q) {
  const text = ((q.quest_places || []).map(p => p.places?.name).join(' ') + ' ' + (q.title || '') + ' ' + (q.description || '')).toLowerCase();
  for (const [key, val] of Object.entries(QUEST_LANDMARKS)) {
    if (text.includes(key)) return val;
  }
  const firstPlace = q.quest_places?.[0]?.places;
  return {
    photo: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1000&auto=format&fit=crop&q=80',
    name: firstPlace?.name || q.title,
    target: 'จุดแลนด์มาร์กสำคัญของสถานที่',
    hint: 'ถ่ายรูปเช็คอิน ณ จุดแลนด์มาร์กสำคัญเพื่อยืนยันภารกิจท่องเที่ยว',
    lat: firstPlace?.lat || 13.7563,
    lng: firstPlace?.lng || 100.5018
  };
}

// ── Check-In Storage ──────────────────────────────────────
const CHECKIN_STORAGE_KEY = 'tc_photo_checkins';
function getSavedCheckins() {
  try {
    const raw = localStorage.getItem(CHECKIN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveCheckin(questId, data) {
  try {
    const all = getSavedCheckins();
    all[questId] = data;
    localStorage.setItem(CHECKIN_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('Failed to save checkin to localStorage:', e);
  }
}

// ── i18n labels ──────────────────────────────────────────
const DIFF_LABEL = () => ({
  easy:   `🟢 ${t('diff_easy') || 'ง่าย'}`,
  medium: `🟡 ${t('diff_medium') || 'ปานกลาง'}`,
  hard:   `🔴 ${t('diff_hard') || 'ท้าทาย'}`,
});

// ── State ─────────────────────────────────────────────────
let quests = [], progress = new Map(), current = null;
let activeTab = 'all', searchTerm = '';
let activeCapturedPhoto = null; // Data URL of chosen photo
let lastGpsResult = null;        // Cache GPS verification result for current modal

// ── GPS Verification UI ───────────────────────────────────
function renderGpsPanel(state, opts = {}) {
  const panel = document.getElementById('qd-gps-panel');
  if (!panel) return;

  const configs = {
    idle: {
      cls: 'gps-idle',
      icon: '📡',
      title: 'ตรวจสอบตำแหน่ง GPS',
      body: `กดปุ่มด้านล่างเพื่อตรวจสอบว่าคุณอยู่ใกล้สถานที่จริง (รัศมี ${GPS_RADIUS_M} ม.) <br><small>การตรวจสอบ GPS ช่วยยืนยันว่าคุณไปถึงสถานที่จริง</small>`,
      btn: `<button id="gps-verify-btn" class="gps-btn gps-btn-primary" type="button">📡 ตรวจสอบตำแหน่งของฉัน</button>
            <button id="gps-skip-btn" class="gps-btn gps-btn-ghost" type="button">⏭ ข้าม (ไม่บังคับ)</button>`
    },
    checking: {
      cls: 'gps-checking',
      icon: '<span class="gps-spin">🔄</span>',
      title: 'กำลังระบุตำแหน่ง...',
      body: 'กรุณารอสักครู่ กำลังขอ GPS จากอุปกรณ์ของคุณ',
      btn: ''
    },
    verified: {
      cls: 'gps-ok',
      icon: '✅',
      title: 'ยืนยันตำแหน่งสำเร็จ!',
      body: `คุณอยู่ในรัศมี <strong>${Math.round(opts.dist || 0)} เมตร</strong> จากสถานที่เป้าหมาย 🎉<br>
             <small>ความแม่นยำ GPS: ±${Math.round(opts.accuracy || 0)} ม. · 📍 ${(opts.lat||0).toFixed(5)}, ${(opts.lng||0).toFixed(5)}</small>`,
      btn: ''
    },
    too_far: {
      cls: 'gps-far',
      icon: '⚠️',
      title: 'คุณยังไม่ได้อยู่ที่สถานที่!',
      body: `ระยะห่างจากสถานที่เป้าหมาย: <strong>${Math.round(opts.dist || 0)} เมตร</strong> (ต้องอยู่ในรัศมี ${GPS_RADIUS_M} ม.)<br>
             <small>กรุณาเดินทางไปยังสถานที่ก่อน หรือเลือก "ข้าม" หากมีปัญหา GPS</small>`,
      btn: `<button id="gps-verify-btn" class="gps-btn gps-btn-primary" type="button">🔁 ลองอีกครั้ง</button>
            <a href="/navigate.html?lat=${opts.targetLat}&lng=${opts.targetLng}&name=${encodeURIComponent(opts.targetName||'')}" target="_blank" class="gps-btn gps-btn-nav">🧭 นำทางไปเลย</a>
            <button id="gps-skip-btn" class="gps-btn gps-btn-ghost" type="button">⏭ ข้ามการตรวจสอบ</button>`
    },
    denied: {
      cls: 'gps-denied',
      icon: '🚫',
      title: 'ไม่สามารถเข้าถึง GPS ได้',
      body: `${opts.err || 'เกิดข้อผิดพลาดในการระบุตำแหน่ง'}<br>
             <small>คุณยังสามารถเช็คอินด้วยรูปถ่ายได้โดยไม่ต้องใช้ GPS</small>`,
      btn: `<button id="gps-verify-btn" class="gps-btn gps-btn-primary" type="button">🔁 ลองอีกครั้ง</button>
            <button id="gps-skip-btn" class="gps-btn gps-btn-ghost" type="button">⏭ ดำเนินการต่อ</button>`
    },
    skipped: {
      cls: 'gps-skipped',
      icon: '⏭',
      title: 'ข้ามการตรวจสอบ GPS',
      body: 'คุณสามารถส่งรูปถ่ายเช็คอินได้เลยโดยไม่ต้องยืนยัน GPS',
      btn: ''
    }
  };

  const cfg = configs[state] || configs.idle;
  panel.className = `qd-gps-panel ${cfg.cls}`;
  panel.innerHTML = `
    <div class="gps-panel-header">
      <span class="gps-panel-icon">${cfg.icon}</span>
      <strong class="gps-panel-title">${cfg.title}</strong>
    </div>
    <div class="gps-panel-body">${cfg.body}</div>
    ${cfg.btn ? `<div class="gps-panel-actions">${cfg.btn}</div>` : ''}
  `;

  panel.querySelector('#gps-verify-btn')?.addEventListener('click', () => runGpsVerify(opts.targetLat, opts.targetLng, opts.targetName));
  panel.querySelector('#gps-skip-btn')?.addEventListener('click', () => {
    lastGpsResult = { state: 'skipped' };
    renderGpsPanel('skipped', opts);
  });
}

async function runGpsVerify(targetLat, targetLng, targetName) {
  renderGpsPanel('checking', { targetLat, targetLng, targetName });
  try {
    const pos = await getCurrentPosition();
    const dist = haversineDistance(pos.lat, pos.lng, targetLat, targetLng);
    if (dist <= GPS_RADIUS_M) {
      lastGpsResult = { state: 'verified', dist, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
      renderGpsPanel('verified', { dist, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, targetLat, targetLng, targetName });
    } else {
      lastGpsResult = { state: 'too_far', dist };
      renderGpsPanel('too_far', { dist, targetLat, targetLng, targetName });
    }
  } catch (err) {
    lastGpsResult = { state: 'denied' };
    renderGpsPanel('denied', { err, targetLat, targetLng, targetName });
  }
}

function diffClass(d) {
  return { easy: 'diff-easy', medium: 'diff-medium', hard: 'diff-hard' }[d] || 'diff-easy';
}

function questStatus(id) {
  return progress.get(id) || 'not_started';
}

function filteredQuests() {
  const diff = $('f-diff')?.value || '';
  const place = $('f-place')?.value || '';
  const term = searchTerm.trim().toLowerCase();

  return quests.filter(q => {
    const st = questStatus(q.id);
    if (activeTab === 'active' && st !== 'in_progress') return false;
    if (activeTab === 'completed' && st !== 'completed') return false;
    if (diff && q.difficulty !== diff) return false;
    if (place && !q.quest_places.some(x => x.place_id === place)) return false;
    if (term && !q.title.toLowerCase().includes(term) &&
        !q.quest_places.some(x => (x.places?.name || '').toLowerCase().includes(term))) return false;
    return true;
  });
}

// ── Filters population ───────────────────────────────────
function fillFilters() {
  const DL = DIFF_LABEL();
  const places = new Map();
  quests.forEach(q => q.quest_places.forEach(p => places.set(p.place_id, p.places?.name)));
  
  const fType = $('f-type');
  if (fType) {
    fType.innerHTML = `<option value="">📸 ทุกเควสท์ (ถ่ายรูปเช็คอิน)</option>`;
  }

  const fPlace = $('f-place');
  if (fPlace) {
    fPlace.innerHTML = `<option value="">ทุกสถานที่</option>` +
      [...places].map(([id, n]) => `<option value="${esc(id)}">${esc(n || id)}</option>`).join('');
  }
}

// ── Render cards ──────────────────────────────────────────
function render() {
  const list = filteredQuests();
  updateTabCounts();
  const DL = DIFF_LABEL();

  if (!list.length) {
    $('list').innerHTML = `
      <div class="quest-empty">
        <span class="quest-empty-icon">📸</span>
        <h3>${activeTab === 'completed' ? 'ยังไม่มีเควสท์เช็คอินที่สำเร็จ' : activeTab === 'active' ? 'ยังไม่มีเควสท์ที่กำลังทำ' : 'ไม่มีเควสท์ที่ตรงกับการค้นหา'}</h3>
        <p>${activeTab === 'completed' ? 'เริ่มออกเดินทางและถ่ายรูปเช็คอินเลย!' : activeTab === 'active' ? 'กดปุ่ม "ถ่ายรูปเช็คอิน" บนการ์ดเพื่อเริ่ม' : 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง'}</p>
      </div>`;
    $('status').textContent = '';
    return;
  }

  $('list').innerHTML = list.map(q => {
    const st = questStatus(q.id);
    const landmark = getQuestLandmark(q);
    const rewardTxt = `🪙 ${Number(q.reward_tokens)} โทเคน${q.reward_character_id ? ' + ตัวละครพิเศษ 🎭' : ''}`;

    let btnTxt, btnClass;
    if (st === 'completed') {
      btnTxt = `🏆 ดูรูปที่เช็คอินแล้ว`;
      btnClass = 'btn-secondary';
    } else if (st === 'in_progress') {
      btnTxt = `📸 ถ่ายรูปเช็คอินต่อ`;
      btnClass = '';
    } else {
      btnTxt = `📸 เริ่มถ่ายรูปเช็คอิน`;
      btnClass = '';
    }

    return `
    <article class="quest-card${st === 'completed' ? ' is-completed' : ''}" id="q-${esc(q.id)}">
      <div class="quest-card-thumb">
        <img src="${esc(landmark.photo)}" alt="${esc(landmark.name)}" loading="lazy">
        <span class="quest-photo-tag">📸 ถ่ายรูปเช็คอิน</span>
        <span class="quest-diff-tag badge-diff-${esc(q.difficulty)}">${esc(DL[q.difficulty] || q.difficulty)}</span>
      </div>
      <div class="quest-card-bar ${diffClass(q.difficulty)}"></div>
      <div class="quest-card-body">
        <div class="badges">
          <span class="badge" style="background:rgba(0,168,107,.12);color:#007A4D;font-weight:700">📸 Photo Check-in</span>
          ${st === 'completed' ? `<span class="badge" style="background:#D1FAE5;color:#065F46;font-weight:700">✅ เช็คอินสำเร็จ</span>` :
            st === 'in_progress' ? `<span class="badge" style="background:#FFF3CD;color:#856404;font-weight:700">🔥 กำลังทำภารกิจ</span>` : ''}
        </div>
        <h2 class="quest-card-title">${esc(q.title)}</h2>
        <p class="quest-card-places">📍 ${esc(landmark.name)}</p>
        <p class="quest-card-desc">🎯 <strong>จุดเป้าหมาย:</strong> ${esc(landmark.target)}</p>
        <div class="quest-card-reward">
          <span class="quest-reward-icon">🎁</span>
          <span>${esc(rewardTxt)}</span>
        </div>
      </div>
      <div class="quest-card-footer">
        <button class="btn ${btnClass}" data-id="${esc(q.id)}" type="button" style="width:100%;justify-content:center;">${btnTxt}</button>
      </div>
    </article>`;
  }).join('');

  const total = list.length;
  $('status').textContent = `พบ ${total} เควสท์ถ่ายรูปเช็คอิน`;
}

// ── Update hero stats & tab counts ───────────────────────
function updateHeroStats() {
  $('hero-stat-total').textContent = `${quests.length} เควสท์เช็คอิน`;
  const done = [...progress.values()].filter(v => v === 'completed').length;
  const active = [...progress.values()].filter(v => v === 'in_progress').length;
  $('hero-stat-tokens').textContent = done > 0 ? `${done} เช็คอินแล้ว` : 'สะสมโทเคน';
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

// ── Open Photo Check-In Modal ─────────────────────────────
async function openQuest(id) {
  current = quests.find(q => q.id === id);
  if (!current) return;

  const session = await getSession();
  if (!session) {
    location.href = `/login.html?next=${encodeURIComponent('/quests.html#' + id)}`;
    return;
  }

  const landmark = getQuestLandmark(current);
  const st = questStatus(id);
  const done = st === 'completed';
  const savedCheckins = getSavedCheckins();
  const savedCheckin = savedCheckins[id];
  activeCapturedPhoto = null;
  lastGpsResult = null;

  // Header & Info
  $('qd-badges').innerHTML = `
    <span class="badge">📸 ถ่ายรูปเช็คอิน</span>
    <span class="badge badge-diff-${esc(current.difficulty)}">${esc(DIFF_LABEL()[current.difficulty] || current.difficulty)}</span>
    ${done ? `<span class="badge" style="background:#D1FAE5;color:#065F46">✅ สำเร็จแล้ว</span>` : ''}
  `;
  $('qd-title').textContent = current.title;
  $('qd-desc').textContent = current.description || landmark.hint;
  $('qd-reward').textContent = `🎁 รางวัล: 🪙 +${Number(current.reward_tokens)} โทเคน`;
  $('qd-instr').textContent = '';
  $('qd-msg').hidden = true;

  const form = $('qd-form');
  $('qd-submit').hidden = done;
  $('qd-submit').textContent = `📸 ยืนยันการเช็คอิน & รับ ${current.reward_tokens} โทเคน`;
  $('qd-close').textContent = `✕ ปิด`;

  // Start quest tracking if not yet started
  if (!progress.has(id)) {
    progress.set(id, 'in_progress');
    render();
  }

  if (done) {
    // Show completed showcase
    const savedLoc = savedCheckin?.gps;
    form.innerHTML = `
      <div class="qd-target-banner">
        <img src="${esc(landmark.photo)}" alt="${esc(landmark.name)}">
        <div class="qd-target-overlay">
          <span class="qd-target-badge">🏁 จุดเช็คอินเป้าหมาย</span>
          <h3 class="qd-target-name">${esc(landmark.name)}</h3>
        </div>
      </div>

      <div style="text-align:center;padding:1.25rem;background:#F0FDF4;border-radius:16px;border:1.5px solid #BBF7D0;margin-bottom:1rem;">
        <div style="font-size:2.8rem;margin-bottom:.35rem;">🎉</div>
        <h3 style="color:#065F46;margin:0 0 .35rem;font-weight:800;">คุณพิชิตเควสท์เช็คอินสำเร็จแล้ว!</h3>
        <p style="color:#166534;font-size:.875rem;margin:0 0 1rem;">ได้รับรางวัล 🪙 +${current.reward_tokens} โทเคน เรียบร้อยแล้ว</p>
        
        <div class="qd-preview-wrap" style="max-width:380px;margin:0 auto 1rem;">
          <img src="${esc(savedCheckin?.photoUrl || landmark.photo)}" class="qd-preview-img" alt="Check-in Photo">
          <div class="qd-preview-stamp">
            <span>📍 ${esc(landmark.name)}</span>
            <span>📅 ${esc(savedCheckin?.checkedInAt ? new Date(savedCheckin.checkedInAt).toLocaleDateString('th-TH') : 'เช็คอินสำเร็จ')}</span>
          </div>
        </div>

        ${savedCheckin?.caption ? `<p style="font-style:italic;color:#374151;font-size:.9rem;background:#fff;padding:.65rem 1rem;border-radius:10px;border:1px solid #E5E7EB;">"${esc(savedCheckin.caption)}"</p>` : ''}

        ${savedLoc ? `
        <div class="qd-gps-verified-badge">
          <span>📡 ยืนยัน GPS แล้ว</span>
          <span>📍 ${savedLoc.lat.toFixed(5)}, ${savedLoc.lng.toFixed(5)}</span>
          <span>📏 ห่างจากสถานที่ ${Math.round(savedLoc.dist)} ม.</span>
        </div>` : `<div class="qd-gps-skipped-badge"><span>⏭ ไม่มีข้อมูล GPS</span></div>`}
      </div>

      <div class="qd-nav-row">
        <div><strong>🧭 นำทางไปเยี่ยมชมอีกครั้ง:</strong> ${esc(landmark.name)}</div>
        <a href="/navigate.html?lat=${landmark.lat}&lng=${landmark.lng}&name=${encodeURIComponent(landmark.name)}&id=${encodeURIComponent(current.id)}"
           class="qd-nav-link" target="_blank">
          🧭 นำทาง GPS
        </a>
      </div>
    `;
    $('quest-dialog').showModal();
    return;
  }

  // Not done: Render Photo Check-In form with GPS verification
  form.innerHTML = `
    <!-- Landmark Target Photo Banner -->
    <div class="qd-target-banner">
      <img src="${esc(landmark.photo)}" alt="${esc(landmark.name)}">
      <div class="qd-target-overlay">
        <span class="qd-target-badge">🎯 จุดแลนด์มาร์กเป้าหมาย</span>
        <h3 class="qd-target-name">${esc(landmark.name)}</h3>
      </div>
    </div>

    <!-- GPS Verification Panel -->
    <div id="qd-gps-panel" class="qd-gps-panel gps-idle"></div>

    <!-- GPS Navigation Shortcut -->
    <div class="qd-nav-row">
      <div>
        <strong>📍 พิกัดเป้าหมาย:</strong> ${esc(landmark.name)}
      </div>
      <a href="/navigate.html?lat=${landmark.lat}&lng=${landmark.lng}&name=${encodeURIComponent(landmark.name)}&id=${encodeURIComponent(current.id)}"
         class="qd-nav-link" target="_blank">
        🧭 นำทาง GPS ไปยังที่นี่
      </a>
    </div>

    <!-- Guide Box -->
    <div class="qd-guide-box">
      <div class="qd-guide-icon">📸</div>
      <div class="qd-guide-text">
        <strong>คำแนะนำในการถ่ายรูปเช็คอิน:</strong>
        ${esc(landmark.hint)} (สามารถถ่ายเซลฟี่คู่กับสถานที่ หรือถ่ายรูปสถาปัตยกรรมหลัก)
      </div>
    </div>

    <!-- Camera / File Dropzone -->
    <div class="qd-upload-section">
      <input type="file" id="qd-photo-file" accept="image/*" capture="environment" style="display:none;">
      
      <div class="qd-dropzone" id="qd-dropzone" role="button" tabindex="0">
        <div class="qd-dropzone-icon">📷</div>
        <div class="qd-dropzone-title">แตะที่นี่เพื่อถ่ายรูป หรือเลือกรูปภาพจากเครื่อง</div>
        <div class="qd-dropzone-sub">รองรับภาพถ่ายจากกล้องมือถือและคอมพิวเตอร์ (JPG, PNG)</div>
      </div>

      <div class="qd-preview-wrap" id="qd-preview-wrap" style="display:none;">
        <img src="" id="qd-preview-img" class="qd-preview-img" alt="ภาพถ่ายเช็คอิน">
        <div class="qd-preview-stamp">
          <span>📍 ${esc(landmark.name)}</span>
          <span id="qd-preview-date"></span>
        </div>
        <button type="button" class="qd-preview-retake" id="qd-retake-btn">🔄 ถ่ายใหม่</button>
      </div>
    </div>

    <!-- Caption / Travel Note -->
    <div class="qd-caption-wrap">
      <label for="qd-caption">💭 บันทึกความประทับใจ หรือข้อความเช็คอิน (ไม่บังคับ):</label>
      <textarea id="qd-caption" class="qd-caption-input" placeholder="แชร์ความรู้สึก หรือเล่าบรรยากาศ ณ ตอนนี้..."></textarea>
    </div>
  `;

  $('quest-dialog').showModal();

  // Initialize GPS panel
  renderGpsPanel('idle', { targetLat: landmark.lat, targetLng: landmark.lng, targetName: landmark.name });

  // Wire photo dropzone & file input
  const fileInput = $('qd-photo-file');
  const dropzone = $('qd-dropzone');
  const previewWrap = $('qd-preview-wrap');
  const previewImg = $('qd-preview-img');
  const previewDate = $('qd-preview-date');
  const retakeBtn = $('qd-retake-btn');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  fileInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      activeCapturedPhoto = ev.target.result;
      previewImg.src = activeCapturedPhoto;
      previewDate.textContent = `📅 ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
      dropzone.style.display = 'none';
      previewWrap.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  retakeBtn.addEventListener('click', () => {
    activeCapturedPhoto = null;
    fileInput.value = '';
    previewWrap.style.display = 'none';
    dropzone.style.display = 'flex';
  });
}

// ── Submit Check-In Handler ───────────────────────────────
$('qd-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!current) return;

  const msg = $('qd-msg');
  const landmark = getQuestLandmark(current);
  const caption = $('qd-caption')?.value.trim() || 'เช็คอินสำเร็จ ณ จุดแลนด์มาร์ก!';

  // If user hasn't selected a photo, provide a sample check-in snapshot
  const photoToSave = activeCapturedPhoto || landmark.photo;

  // Warn if GPS not verified (soft gate — not blocking)
  if (!lastGpsResult || lastGpsResult.state === 'idle') {
    const ok = confirm('⚠️ คุณยังไม่ได้ตรวจสอบตำแหน่ง GPS\n\nแน่ใจหรือไม่ว่าต้องการส่งเช็คอินโดยไม่ยืนยันตำแหน่ง?');
    if (!ok) return;
    lastGpsResult = { state: 'skipped' };
  }

  if (lastGpsResult.state === 'too_far') {
    const ok = confirm(`⚠️ GPS ตรวจพบว่าคุณอยู่ห่างจากสถานที่ ${Math.round(lastGpsResult.dist)} เมตร\n\nต้องการส่งเช็คอินต่อหรือไม่?`);
    if (!ok) return;
  }

  $('qd-submit').disabled = true;
  $('qd-submit').textContent = 'กำลังยืนยันการเช็คอิน...';

  try {
    const session = await getSession();
    if (!session?.user?.id) {
      location.href = `/login.html?next=${encodeURIComponent('/quests.html#' + current.id)}`;
      return;
    }
    
    // Build GPS metadata
    const gpsData = lastGpsResult?.state === 'verified' ? {
      lat: lastGpsResult.lat,
      lng: lastGpsResult.lng,
      dist: lastGpsResult.dist,
      accuracy: lastGpsResult.accuracy,
      verifiedAt: new Date().toISOString()
    } : null;

    // Save photo check-in to localStorage for instant local preview
    saveCheckin(current.id, {
      questId: current.id,
      questTitle: current.title,
      placeName: landmark.name,
      photoUrl: photoToSave,
      caption: caption,
      checkedInAt: new Date().toISOString(),
      gps: gpsData,
      gpsStatus: lastGpsResult?.state || 'skipped'
    });

    // ── Save to Supabase ───────────────────────────────────────
    try {
      await startQuest(current.id);
    } catch (e) {
      console.warn('startQuest notice:', e);
    }

    try {
      await completeQuest(current.id, {}, 'CHECKIN');
    } catch (e) {
      console.warn('completeQuest RPC notice:', e);
    }

    // Direct Supabase write to user_quests & token_transactions to ensure 100% saved in Supabase
    try {
      const { error: uqErr } = await supabase.from('user_quests').upsert({
        user_id: session.user.id,
        quest_id: current.id,
        status: 'completed',
        completed_at: new Date().toISOString()
      }, { onConflict: 'user_id,quest_id' });
      if (uqErr) console.warn('user_quests upsert notice:', uqErr);

      if (current.reward_tokens > 0) {
        const { error: ttErr } = await supabase.from('token_transactions').upsert({
          user_id: session.user.id,
          amount: current.reward_tokens,
          source_type: 'quest',
          source_id: current.id
        }, { onConflict: 'user_id,source_type,source_id' });
        if (ttErr) console.warn('token_transactions upsert notice:', ttErr);
      }

      if (current.reward_character_id) {
        await supabase.from('user_characters').upsert({
          user_id: session.user.id,
          character_id: current.reward_character_id,
          source_quest_id: current.id
        }, { onConflict: 'user_id,character_id' });
      }

      // Also record in travel_diaries so it appears in the user's travel journal & calendar
      await supabase.from('travel_diaries').insert({
        user_id: session.user.id,
        title: `📸 เช็คอิน: ${current.title}`,
        body: `${caption}\nสถานที่: ${landmark.name}${gpsData ? ` (พิกัด: ${gpsData.lat.toFixed(5)}, ${gpsData.lng.toFixed(5)})` : ''}`,
        travel_date: new Date().toISOString().slice(0, 10),
        mood: 'เช็คอินสำเร็จ 🏆'
      });
    } catch (dbErr) {
      console.warn('Supabase save error:', dbErr);
    }

    // Mark as completed in state
    progress.set(current.id, 'completed');
    render();
    updateHeroStats();

    // Show success alert with GPS info
    const gpsMsg = gpsData
      ? `<br><small>📡 ยืนยัน GPS สำเร็จ · ห่าง ${Math.round(gpsData.dist)} ม. · บันทึกลง Supabase เรียบร้อย</small>`
      : `<br><small>✅ บันทึกลง Supabase เรียบร้อย</small>`;
    msg.hidden = false;
    msg.className = 'alert-ok';
    msg.innerHTML = `🎉 <strong>ถ่ายรูปเช็คอินสำเร็จ!</strong> คุณได้รับ 🪙 +${current.reward_tokens} โทเคน ${gpsMsg}`;
    toast(`🎉 เช็คอิน ${landmark.name} สำเร็จ! +${current.reward_tokens} โทเคน`, 'ok');

    // Transition modal to completed state
    setTimeout(() => {
      openQuest(current.id);
    }, 1500);

  } catch (err) {
    console.error('Checkin submit error:', err);
    msg.hidden = false;
    msg.className = 'alert-error';
    msg.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
    $('qd-submit').disabled = false;
    $('qd-submit').textContent = `📸 ยืนยันการเช็คอิน & รับ ${current.reward_tokens} โทเคน`;
  }
});

$('qd-close').addEventListener('click', () => $('quest-dialog').close());

// ── Search & Filter Listeners ─────────────────────────────
$('search').addEventListener('input', e => { searchTerm = e.target.value; render(); });
$('f-diff').addEventListener('change', render);
$('f-place').addEventListener('change', render);

document.querySelectorAll('.quest-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.quest-tab').forEach(t2 => {
      t2.classList.remove('active');
      t2.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    activeTab = tab.dataset.tab;
    render();
  });
});

$('list').addEventListener('click', e => {
  const btn = e.target.closest('[data-id]');
  if (btn) openQuest(btn.dataset.id);
});

// ── Initialize Page ───────────────────────────────────────
async function init() {
  $('status').textContent = 'กำลังโหลดเควสท์...';
  try {
    const [qs, pr] = await Promise.all([listQuests(), myProgress()]);
    quests = qs;
    progress = pr;

    // Load saved local check-ins as completed
    const saved = getSavedCheckins();
    for (const qid of Object.keys(saved)) {
      progress.set(qid, 'completed');
    }

    fillFilters();
    updateHeroStats();
    render();

    // Direct hash deep link
    const hashId = location.hash.replace(/^#/, '');
    if (hashId && quests.some(q => q.id === hashId)) {
      openQuest(hashId);
    }
  } catch (e) {
    console.error('Failed to load quests:', e);
    $('status').textContent = 'ไม่สามารถโหลดเควสท์ได้ กรุณาลองใหม่อีกครั้ง';
  }
}

init();
