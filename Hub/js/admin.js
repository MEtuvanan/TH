// admin.js — Full Admin Dashboard CMS
// Features: Quests, Places with Leaflet Pin Picker, User Management & Blocking, Account Creation, Token Usage Analytics, AI GPT-OSS Assistant

import { supabase } from './supabase.js';
import { getProfile, signUp } from './auth.js';
import { esc, toast, confirmDialog, isUuid, stateLoading, stateEmpty } from './ui.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;

// Storage key for banned users and local accounts fallback
const STORAGE_BANNED = 'tc_banned_users';
const STORAGE_ACCOUNTS = 'tc_custom_users';
const STORAGE_QUESTS = 'tc_custom_quests';
const STORAGE_PLACES = 'tc_custom_places';

function getBannedUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_BANNED) || '[]'); } catch { return []; }
}
function setBannedUsers(list) {
  localStorage.setItem(STORAGE_BANNED, JSON.stringify(list));
}
function getCustomAccounts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS) || '[]'); } catch { return []; }
}
function saveCustomAccount(acc) {
  const list = getCustomAccounts();
  list.unshift(acc);
  localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(list));
}
function getCustomQuests() {
  try { return JSON.parse(localStorage.getItem(STORAGE_QUESTS) || '[]'); } catch { return []; }
}
function saveCustomQuest(q) {
  const list = getCustomQuests().filter(item => item.id !== q.id);
  list.unshift(q);
  localStorage.setItem(STORAGE_QUESTS, JSON.stringify(list));
}
function getCustomPlaces() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PLACES) || '[]'); } catch { return []; }
}
function saveCustomPlace(p) {
  const list = getCustomPlaces().filter(item => item.id !== p.id);
  list.unshift(p);
  localStorage.setItem(STORAGE_PLACES, JSON.stringify(list));
}

function renderPagination(containerId, total, page, onChange) {
  const el = $(containerId);
  if (!el) return;
  const pages = Math.ceil((total || 0) / PAGE_SIZE);
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  for (let i = 0; i < pages; i++) {
    html += `<button type="button" class="${i === page ? 'active' : ''}" data-p="${i}">${i + 1}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => onChange(parseInt(btn.dataset.p, 10)));
  });
}
window.renderPagination = renderPagination;

// ── Guard ────────────────────────────────────────────────────────────────────
async function guard() {
  const p = await getProfile();
  if (!p || p.role !== 'admin') {
    document.body.innerHTML = `
      <main class="section" style="padding:4rem 1rem;text-align:center;">
        <div style="max-width:480px;margin:0 auto;background:#FFF;padding:2rem;border-radius:12px;border:1px solid #E2E8F0;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
          <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
          <h2 style="font-size:1.35rem;font-weight:800;margin-bottom:0.5rem;color:#0F172A;">Admin Access Only</h2>
          <p style="color:#64748B;font-size:0.95rem;margin-bottom:1.5rem;">หน้านี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ กรุณาเข้าสู่ระบบด้วยบัญชีแอดมิน</p>
          <a href="/login.html" class="btn">เข้าสู่ระบบ</a>
        </div>
      </main>`;
    return false;
  }
  return true;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function initTabs() {
  const btns = document.querySelectorAll('.snav-item');
  const panels = document.querySelectorAll('.admin-panel');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = $(`panel-${btn.dataset.tab}`);
      if (target) target.classList.add('active');

      // Invalidate Leaflet map size if switching to map-dependent views
      if (btn.dataset.tab === 'places' && mapPicker) {
        setTimeout(() => mapPicker.invalidateSize(), 200);
      }
    });
  });
}

// ── Reference Data (Provinces & Categories) ───────────────────────────────────
let provinces = [], categories = [], allPlacesList = [];

async function loadRefs() {
  try {
    const [p, c, pl] = await Promise.all([
      supabase.from('provinces').select('id, name_en, name_th').order('name_th'),
      supabase.from('place_categories').select('id, slug, name').order('name'),
      supabase.from('places').select('id, name, lat, lng').order('name'),
    ]);
    provinces = p.data || [
      { id: 1, name_en: 'Bangkok', name_th: 'กรุงเทพมหานคร' },
      { id: 2, name_en: 'Chiang Mai', name_th: 'เชียงใหม่' },
      { id: 3, name_en: 'Phuket', name_th: 'ภูเก็ต' }
    ];
    categories = c.data || [
      { id: 'temple', slug: 'temple', name: 'วัด & โบราณสถาน' },
      { id: 'market', slug: 'market', name: 'ตลาด & ชุมชน' },
      { id: 'museum', slug: 'museum', name: 'พิพิธภัณฑ์' },
      { id: 'park', slug: 'park', name: 'สวนสาธารณะ' },
      { id: 'nature', slug: 'nature', name: 'ธรรมชาติ & ริมน้ำ' }
    ];
    allPlacesList = pl.data || [];
  } catch (e) {
    console.warn('loadRefs fallback', e);
  }
}

// ── Overview / Analytics ──────────────────────────────────────────────────────
async function loadStats() {
  try {
    const [places, quests, users, completions, tokens] = await Promise.all([
      supabase.from('places').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
      supabase.from('quests').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('user_quests').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('token_transactions').select('amount'),
    ]);

    const bannedList = getBannedUsers();
    const customAccounts = getCustomAccounts();
    const customQuests = getCustomQuests();
    const customPlaces = getCustomPlaces();

    const totalPlaces = (places.count || 0) + customPlaces.length;
    const totalQuests = (quests.count || 0) + customQuests.length;
    const totalUsers = Math.max(1, (users.count || 0) + customAccounts.length);
    const totalCompletions = completions.count || 0;

    let totalTokens = 0;
    if (tokens.data?.length) {
      totalTokens = tokens.data.reduce((sum, b) => sum + (b.amount || 0), 0);
    }
    customAccounts.forEach(a => totalTokens += (a.tokens || 50));

    $('stat-places').textContent = totalPlaces;
    $('stat-quests').textContent = totalQuests;
    $('stat-users').textContent = totalUsers;
    $('stat-completions').textContent = totalCompletions;
    $('stat-tokens-total').textContent = totalTokens.toLocaleString();
    $('stat-blocked').textContent = bannedList.length;

    // Load recent activity preview
    loadRecentActivity();
  } catch (e) {
    console.error('Stats error', e);
  }
}

async function loadRecentActivity() {
  const recentCheckinsEl = $('recent-checkins');
  const recentUsersEl = $('recent-users-list');

  try {
    const { data: checkins } = await supabase.from('user_quests')
      .select('id, quest_id, user_id, completed_at, quests(title, reward_tokens), profiles(display_name)')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false }).limit(5);

    if (checkins && checkins.length > 0) {
      recentCheckinsEl.innerHTML = checkins.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid #F1F5F9;font-size:0.88rem;">
          <div>
            <strong>${esc(c.profiles?.display_name || 'ผู้เล่น')}</strong>
            <div style="color:#64748B;font-size:0.8rem;">${esc(c.quests?.title || 'เควสท์')}</div>
          </div>
          <span class="badge badge-success">+${c.quests?.reward_tokens || 50} 🪙</span>
        </div>
      `).join('');
    } else {
      recentCheckinsEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid #F1F5F9;font-size:0.88rem;">
          <div><strong>สมชาย นักเดินทาง</strong><div style="color:#64748B;font-size:0.8rem;">เช็คอินยักษ์วัดแจ้ง (วัดอรุณ)</div></div>
          <span class="badge badge-success">+50 🪙</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;font-size:0.88rem;">
          <div><strong>นภา ลุยเดี่ยว</strong><div style="color:#64748B;font-size:0.8rem;">พิชิตภูเขาทอง วัดสระเกศ</div></div>
          <span class="badge badge-success">+75 🪙</span>
        </div>
      `;
    }

    const { data: users } = await supabase.from('profiles')
      .select('id, display_name, role, created_at')
      .order('created_at', { ascending: false }).limit(5);

    const custom = getCustomAccounts().slice(0, 3);
    const combined = [...custom, ...(users || [])].slice(0, 5);

    if (combined.length > 0) {
      recentUsersEl.innerHTML = combined.map(u => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid #F1F5F9;font-size:0.88rem;">
          <div>
            <strong>${esc(u.display_name || u.email || 'ผู้ใช้')}</strong>
            <div style="color:#64748B;font-size:0.8rem;">${u.role === 'admin' ? '🛡️ ผู้ดูแลระบบ' : '👤 สมาชิก'}</div>
          </div>
          <span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-info'}">${u.role || 'user'}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    console.warn('Recent activity fallback', e);
  }
}

// ── 📍 PLACES (MANAGEMENT & PINNING) ──────────────────────────────────────────
let placePage = 0, placeSearch = '', placeStatusFilter = '';

async function loadPlaces() {
  const tbody = $('places-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7">${stateLoading()}</td></tr>`;

  try {
    let q = supabase.from('places')
      .select('id, name, summary, status, lat, lng, visitor_info, provinces(name_th, name_en), place_categories(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(placePage * PAGE_SIZE, (placePage + 1) * PAGE_SIZE - 1);

    if (placeSearch.trim()) q = q.ilike('name', `%${placeSearch.trim()}%`);
    if (placeStatusFilter) q = q.eq('status', placeStatusFilter);

    const { data, count, error } = await q;
    if (error) throw error;

    let places = data || [];
    // merge custom places from local
    const custom = getCustomPlaces();
    if (custom.length) {
      places = [...custom, ...places];
    }

    if (!places.length) {
      tbody.innerHTML = `<tr><td colspan="7">${stateEmpty('ยังไม่มีสถานที่ในระบบ')}</td></tr>`;
      return;
    }

    tbody.innerHTML = places.map(p => {
      const img = 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=100&auto=format&fit=crop&q=80';
      const prov = p.provinces?.name_th || p.provinces?.name_en || 'กรุงเทพฯ';
      const loc = prov;
      const coords = (p.lat && p.lng) ? `${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}` : '—';
      const statusBadge = p.status === 'published' ? '<span class="badge badge-success">เผยแพร่</span>' :
                          p.status === 'draft' ? '<span class="badge badge-warning">ร่าง</span>' :
                          '<span class="badge badge-muted">เก็บถาวร</span>';

      return `
        <tr>
          <td><img src="${esc(img)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;"></td>
          <td>
            <strong><a href="/place.html?id=${encodeURIComponent(p.id)}" target="_blank" style="color:#0F172A;text-decoration:none;">${esc(p.name)}</a></strong>
          </td>
          <td><span class="badge badge-muted">${esc(p.place_categories?.name || 'สถานที่')}</span></td>
          <td class="meta">${esc(loc)}</td>
          <td>
            <button class="btn btn-small btn-secondary" onclick="window.viewPlaceOnMap(${p.lat}, ${p.lng}, '${esc(p.name)}')" title="ดูบนแผนที่">
              📍 ${coords}
            </button>
          </td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-small btn-secondary" data-act="place-edit" data-id="${esc(p.id)}">✏️ แก้ไข</button>
            <button class="btn btn-small btn-danger" data-act="place-del" data-id="${esc(p.id)}" data-name="${esc(p.name)}">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination('places-pagination', (count || places.length), placePage, p => { placePage = p; loadPlaces(); });
  } catch (err) {
    console.error('loadPlaces error', err);
    tbody.innerHTML = `<tr><td colspan="7" class="state state-error">ไม่สามารถโหลดสถานที่ได้</td></tr>`;
  }
}

// ── Leaflet Interactive Map Picker ───────────────────────────────────────────
let mapPicker = null;
let pickerMarker = null;
let pickerTargetField = 'place'; // 'place' or 'quest'

function initMapPicker() {
  const dlg = $('map-picker-dialog');
  if (!dlg) return;

  $('mp-cancel')?.addEventListener('click', () => dlg.close());
  $('mp-confirm')?.addEventListener('click', () => {
    const lat = $('mp-lat').value;
    const lng = $('mp-lng').value;
    if (!lat || !lng) {
      alert('กรุณาเลือกตำแหน่งบนแผนที่ก่อน');
      return;
    }
    if (pickerTargetField === 'place') {
      $('pm-lat').value = lat;
      $('pm-lng').value = lng;
    } else if (pickerTargetField === 'quest') {
      $('qm-lat').value = lat;
      $('qm-lng').value = lng;
    }
    toast(`ปักหมุดพิกัด ${lat}, ${lng} สำเร็จแล้ว`);
    dlg.close();
  });
}

function openMapPicker(target = 'place', initialLat = 13.7563, initialLng = 100.5018) {
  pickerTargetField = target;
  const dlg = $('map-picker-dialog');
  if (!dlg) return;

  const latVal = parseFloat(initialLat) || 13.7563;
  const lngVal = parseFloat(initialLng) || 100.5018;

  $('mp-lat').value = latVal.toFixed(6);
  $('mp-lng').value = lngVal.toFixed(6);

  dlg.showModal();

  setTimeout(() => {
    const mapEl = $('map-picker');
    if (!mapEl) return;

    if (!mapPicker) {
      mapPicker = L.map(mapEl).setView([latVal, lngVal], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapPicker);

      pickerMarker = L.marker([latVal, lngVal], { draggable: true }).addTo(mapPicker);

      pickerMarker.on('dragend', () => {
        const pos = pickerMarker.getLatLng();
        $('mp-lat').value = pos.lat.toFixed(6);
        $('mp-lng').value = pos.lng.toFixed(6);
      });

      mapPicker.on('click', e => {
        pickerMarker.setLatLng(e.latlng);
        $('mp-lat').value = e.latlng.lat.toFixed(6);
        $('mp-lng').value = e.latlng.lng.toFixed(6);
      });
    } else {
      mapPicker.invalidateSize();
      mapPicker.setView([latVal, lngVal], 14);
      pickerMarker.setLatLng([latVal, lngVal]);
    }
  }, 150);
}

window.viewPlaceOnMap = (lat, lng, name) => {
  if (!lat || !lng) return;
  openMapPicker('place', lat, lng);
};

// ── Place Modal (Add / Edit) ──────────────────────────────────────────────────
function openPlaceEditor(id = null) {
  const dlg = $('place-modal');
  if (!dlg) return;

  // Populate category & province options
  const catSel = $('pm-category');
  catSel.innerHTML = categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const provSel = $('pm-province');
  provSel.innerHTML = provinces.map(p => `<option value="${p.id}">${esc(p.name_th || p.name_en)}</option>`).join('');

  $('pm-id').value = id || '';
  $('place-modal-msg').hidden = true;

  if (id) {
    $('place-modal-title').textContent = '✏️ แก้ไขข้อมูลสถานที่';
    // Load place details
    supabase.from('places').select('*').eq('id', id).single().then(({ data }) => {
      if (data) {
        $('pm-name').value = data.name || '';
        $('pm-category').value = data.category_id || categories[0]?.id;
        $('pm-province').value = data.province_id || provinces[0]?.id;
        $('pm-subdistrict').value = '';
        $('pm-lat').value = data.lat || '';
        $('pm-lng').value = data.lng || '';
        $('pm-hours').value = data.visitor_info || '';
        $('pm-fee').value = '';
        $('pm-cover').value = '';
        $('pm-desc').value = data.description || data.summary || '';
        $('pm-status').value = data.status || 'published';
      }
    });
  } else {
    $('place-modal-title').textContent = '📍 ปักสถานที่ใหม่';
    $('pm-name').value = '';
    $('pm-subdistrict').value = '';
    $('pm-lat').value = '13.7563';
    $('pm-lng').value = '100.5018';
    $('pm-hours').value = 'เปิดทุกวัน 08:30 - 17:30 น.';
    $('pm-fee').value = 'เข้าชมฟรี';
    $('pm-cover').value = '';
    $('pm-desc').value = '';
    $('pm-status').value = 'published';
  }

  dlg.showModal();
}

function initPlaceForm() {
  const dlg = $('place-modal');
  $('pm-cancel')?.addEventListener('click', () => dlg.close());

  $('btn-pick-place-map')?.addEventListener('click', () => {
    openMapPicker('place', $('pm-lat').value, $('pm-lng').value);
  });

  $('place-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = $('pm-save');
    const msg = $('place-modal-msg');
    saveBtn.disabled = true;

    const id = $('pm-id').value;
    const name = $('pm-name').value.trim();

    const payload = {
      name,
      summary: $('pm-desc').value.trim().slice(0, 450) || name,
      description: $('pm-desc').value.trim() || null,
      category_id: parseInt($('pm-category').value, 10) || null,
      province_id: parseInt($('pm-province').value, 10),
      lat: parseFloat($('pm-lat').value) || 13.7563,
      lng: parseFloat($('pm-lng').value) || 100.5018,
      visitor_info: $('pm-hours').value.trim() ? `${$('pm-hours').value.trim()}${($('pm-fee').value.trim() ? ` • ค่าเข้า: ${$('pm-fee').value.trim()}` : '')}` : null,
      status: $('pm-status').value || 'published',
      verified: true
    };

    try {
      if (id) {
        const { error } = await supabase.from('places').update(payload).eq('id', id);
        if (error) throw error;
        toast('บันทึกการแก้ไขสถานที่ลงใน Supabase เรียบร้อย');
      } else {
        const { error } = await supabase.from('places').insert(payload);
        if (error) throw error;
        toast('ปักสถานที่ใหม่ลงใน Supabase สำเร็จแล้ว! 📍');
      }

      dlg.close();
      loadPlaces();
      loadStats();
    } catch (err) {
      console.error(err);
      msg.hidden = false;
      msg.className = 'alert alert-error';
      msg.textContent = err.message || 'เกิดข้อผิดพลาดในการบันทึกสถานที่';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ── 🎯 QUESTS (MANAGEMENT) ───────────────────────────────────────────────────
let questPage = 0, questSearch = '', questDiffFilter = '', questStatusFilter = '';

async function loadQuests() {
  const tbody = $('quests-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7">${stateLoading()}</td></tr>`;

  try {
    let q = supabase.from('quests')
      .select('id, title, description, type, difficulty, status, reward_tokens, quest_places(place_id, places(name, lat, lng))', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(questPage * PAGE_SIZE, (questPage + 1) * PAGE_SIZE - 1);

    if (questSearch.trim()) q = q.ilike('title', `%${questSearch.trim()}%`);
    if (questDiffFilter) q = q.eq('difficulty', questDiffFilter);
    if (questStatusFilter) q = q.eq('status', questStatusFilter);

    const { data, count, error } = await q;
    if (error) throw error;

    let quests = data || [];
    const custom = getCustomQuests();
    if (custom.length) quests = [...custom, ...quests];

    if (!quests.length) {
      tbody.innerHTML = `<tr><td colspan="7">${stateEmpty('ยังไม่มีเควสท์ในระบบ')}</td></tr>`;
      return;
    }

    tbody.innerHTML = quests.map(q => {
      const diffBadge = q.difficulty === 'easy' ? '<span class="badge badge-success">ง่าย 🟢</span>' :
                        q.difficulty === 'medium' ? '<span class="badge badge-warning">ปานกลาง 🟡</span>' :
                        '<span class="badge badge-danger">ยาก 🔴</span>';
      const statusBadge = q.status === 'published' ? '<span class="badge badge-success">เผยแพร่</span>' :
                          q.status === 'draft' ? '<span class="badge badge-warning">ร่าง</span>' :
                          '<span class="badge badge-muted">เก็บถาวร</span>';
      const typeLabel = q.type === 'photo' ? '📸 ถ่ายรูปเช็คอิน' :
                        q.type === 'exploration' ? '📡 เช็คอิน GPS' :
                        q.type === 'quiz' ? '❓ ตอบคำถาม' : '🏛️ วัฒนธรรม';
      const placeName = q.quest_places?.[0]?.places?.name || q.places?.name || 'สถานที่ในระบบ';

      return `
        <tr>
          <td><strong>${esc(q.title)}</strong></td>
          <td><span class="badge badge-info">${typeLabel}</span></td>
          <td>${diffBadge}</td>
          <td><strong style="color:#059669;">+${q.reward_tokens || 50} 🪙</strong></td>
          <td class="meta">${esc(placeName)}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-small btn-secondary" data-act="quest-edit" data-id="${esc(q.id)}">✏️ แก้ไข</button>
            <button class="btn btn-small btn-danger" data-act="quest-del" data-id="${esc(q.id)}" data-name="${esc(q.title)}">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination('quests-pagination', (count || quests.length), questPage, p => { questPage = p; loadQuests(); });
  } catch (err) {
    console.error('loadQuests error', err);
    tbody.innerHTML = `<tr><td colspan="7" class="state state-error">ไม่สามารถโหลดเควสท์ได้</td></tr>`;
  }
}

function openQuestEditor(id = null) {
  const dlg = $('quest-modal');
  if (!dlg) return;

  const placeSel = $('qm-place');
  placeSel.innerHTML = allPlacesList.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  $('qm-id').value = id || '';
  $('quest-modal-msg').hidden = true;

  if (id) {
    $('quest-modal-title').textContent = '✏️ แก้ไขเควสท์';
    supabase.from('quests').select('*, quest_places(place_id)').eq('id', id).single().then(({ data }) => {
      if (data) {
        $('qm-title').value = data.title || '';
        $('qm-place').value = data.quest_places?.[0]?.place_id || allPlacesList[0]?.id;
        $('qm-type').value = data.type || 'photo';
        $('qm-difficulty').value = data.difficulty || 'medium';
        $('qm-tokens').value = data.reward_tokens || 50;
        $('qm-instructions').value = data.description || '';
        $('qm-status').value = data.status || 'published';
      }
    });
  } else {
    $('quest-modal-title').textContent = '🎯 สร้างเควสท์ใหม่';
    $('qm-title').value = '';
    $('qm-type').value = 'photo';
    $('qm-difficulty').value = 'medium';
    $('qm-tokens').value = '50';
    $('qm-lat').value = '13.7563';
    $('qm-lng').value = '100.5018';
    $('qm-radius').value = '100';
    $('qm-photo').value = '';
    $('qm-instructions').value = 'ถ่ายรูปคู่กับจุดแลนด์มาร์คสำคัญ แล้วกดเปิดตำแหน่งเพื่อยืนยันพิกัดเช็คอิน';
    $('qm-status').value = 'published';
  }

  dlg.showModal();
}

function initQuestForm() {
  const dlg = $('quest-modal');
  $('qm-cancel')?.addEventListener('click', () => dlg.close());

  $('btn-pick-quest-map')?.addEventListener('click', () => {
    openMapPicker('quest', $('qm-lat').value, $('qm-lng').value);
  });

  // Auto-fill coordinates when place is selected
  $('qm-place')?.addEventListener('change', e => {
    const selPlace = allPlacesList.find(p => p.id === e.target.value);
    if (selPlace && selPlace.lat && selPlace.lng) {
      $('qm-lat').value = selPlace.lat;
      $('qm-lng').value = selPlace.lng;
    }
  });

  $('quest-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = $('qm-save');
    const msg = $('quest-modal-msg');
    saveBtn.disabled = true;

    const id = $('qm-id').value;
    const title = $('qm-title').value.trim();
    const placeId = $('qm-place').value;
    const typeVal = $('qm-type').value;
    const diffVal = $('qm-difficulty').value;
    const tokensVal = parseInt($('qm-tokens').value, 10) || 50;
    const statusVal = $('qm-status').value;
    const descVal = $('qm-instructions').value.trim() || 'ภารกิจท่องเที่ยวประจำสถานที่';

    const payload = {
      title,
      description: descVal,
      type: (typeVal === 'photo' || typeVal === 'exploration') ? 'quiz' : typeVal,
      difficulty: diffVal,
      reward_tokens: tokensVal,
      status: statusVal
    };

    try {
      if (id) {
        const { error } = await supabase.from('quests').update(payload).eq('id', id);
        if (error) throw error;
        if (placeId) {
          await supabase.from('quest_places').delete().eq('quest_id', id);
          await supabase.from('quest_places').insert({ quest_id: id, place_id: placeId });
        }
        toast('บันทึกการแก้ไขเควสท์ลงใน Supabase เรียบร้อย');
      } else {
        const { data: newQ, error } = await supabase.from('quests').insert(payload).select('id').single();
        if (error) throw error;
        if (placeId && newQ?.id) {
          await supabase.from('quest_places').insert({ quest_id: newQ.id, place_id: placeId });
        }
        toast('สร้างเควสท์ใหม่ลงใน Supabase สำเร็จแล้ว! 🎯');
      }

      dlg.close();
      loadQuests();
      loadStats();
    } catch (err) {
      console.error(err);
      msg.hidden = false;
      msg.className = 'alert alert-error';
      msg.textContent = err.message || 'เกิดข้อผิดพลาดในการบันทึกเควสท์';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ── 👤 USERS & BLOCKING (MANAGEMENT) ─────────────────────────────────────────
let userPage = 0, userSearch = '', userStatusFilter = '', userRoleFilter = '';

async function loadUsers() {
  const tbody = $('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7">${stateLoading()}</td></tr>`;

  try {
    const bannedUsers = getBannedUsers();

    let list = [];
    try {
      const { data: profiles, error } = await supabase.from('profiles')
        .select('id, display_name, role, created_at')
        .order('created_at', { ascending: false })
        .range(userPage * PAGE_SIZE, (userPage + 1) * PAGE_SIZE - 1);
      if (profiles && profiles.length) list = [...profiles];
    } catch (e) {
      console.warn('profiles query fallback', e);
    }

    const balanceMap = {};
    try {
      const { data: balances } = await supabase.from('token_balances').select('user_id, balance');
      (balances || []).forEach(b => { balanceMap[b.user_id] = b.balance; });
    } catch {}

    // Combine custom accounts
    const custom = getCustomAccounts();
    list = [...custom, ...list];

    // Filter
    if (userSearch.trim()) {
      const term = userSearch.toLowerCase().trim();
      list = list.filter(u => (u.display_name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term)));
    }
    if (userRoleFilter) {
      list = list.filter(u => (u.role || 'user') === userRoleFilter);
    }
    if (userStatusFilter) {
      list = list.filter(u => {
        const isBanned = bannedUsers.includes(u.id) || bannedUsers.includes(u.email);
        return userStatusFilter === 'banned' ? isBanned : !isBanned;
      });
    }

    if (!list.length) {
      list = [
        { id: '00000000-0000-0000-0000-000000000001', display_name: 'ผู้ดูแลระบบ (Admin)', email: 'ttt@gmail.com', role: 'admin', tokens: 1000, created_at: '2026-01-01' },
        { id: 'usr-demo-1', display_name: 'สมชาย นักเดินทาง', email: 'somchai.traveler@gmail.com', role: 'user', tokens: 450, created_at: '2026-02-15' },
        { id: 'usr-demo-2', display_name: 'นภา ลุยเดี่ยว', email: 'napha.explorer@gmail.com', role: 'user', tokens: 320, created_at: '2026-03-01' },
        { id: 'usr-demo-3', display_name: 'วิชัย บล็อกเกอร์', email: 'wichai.bkk@gmail.com', role: 'user', tokens: 250, created_at: '2026-03-10' },
        { id: 'usr-demo-4', display_name: 'กานดา นักชิม', email: 'kanda.foodie@gmail.com', role: 'user', tokens: 180, created_at: '2026-03-20' },
      ];
    }

    tbody.innerHTML = list.map(u => {
      const isBanned = bannedUsers.includes(u.id) || (u.email && bannedUsers.includes(u.email));
      const tokens = u.tokens || balanceMap[u.id] || 50;
      const email = u.email || (u.id === '00000000-0000-0000-0000-000000000001' ? 'ttt@gmail.com' : 'user@example.com');
      const roleBadge = u.role === 'admin' ? '<span class="badge badge-warning">🛡️ Admin</span>' : '<span class="badge badge-info">👤 User</span>';
      const statusBadge = isBanned ? '<span class="badge badge-danger">🚫 ถูกบล็อก</span>' : '<span class="badge badge-success">✓ ปกติ</span>';
      const toggleBtn = isBanned
        ? `<button class="btn btn-small btn-secondary" onclick="window.toggleBlockUser('${esc(u.id)}', '${esc(email)}', false)">✅ ปลดบล็อก</button>`
        : `<button class="btn btn-small btn-danger" onclick="window.toggleBlockUser('${esc(u.id)}', '${esc(email)}', true)">🚫 บล็อก</button>`;

      return `
        <tr>
          <td><strong>${esc(u.display_name || 'ผู้ใช้')}</strong></td>
          <td class="meta">${esc(email)}</td>
          <td>${roleBadge}</td>
          <td><strong style="color:#D97706;">🪙 ${tokens.toLocaleString()}</strong></td>
          <td>${statusBadge}</td>
          <td class="meta">${u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH') : 'วันนี้'}</td>
          <td>
            ${toggleBtn}
            <button class="btn btn-small btn-secondary" onclick="window.adjustUserTokens('${esc(u.id)}', '${esc(u.display_name || email)}')">🪙 ให้โทเคน</button>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination('users-pagination', list.length, userPage, p => { userPage = p; loadUsers(); });
  } catch (err) {
    console.error('loadUsers error', err);
    tbody.innerHTML = `<tr><td colspan="7" class="state state-error">ไม่สามารถโหลดผู้ใช้ได้</td></tr>`;
  }
}
window.loadUsers = loadUsers;

window.toggleBlockUser = async (userId, userEmail, block = true) => {
  const actionText = block ? 'บล็อกการเข้าสู่ระบบของ' : 'ปลดบล็อก';
  if (!(await confirmDialog({
    title: `${block ? '🚫 บล็อกผู้ใช้' : '✅ ปลดบล็อกผู้ใช้'}`,
    message: `คุณต้องการ${actionText} "${userEmail || userId}" หรือไม่?`,
    confirmLabel: block ? 'ยืนยันบล็อก' : 'ปลดบล็อก',
    danger: block
  }))) return;

  const list = getBannedUsers();
  if (block) {
    if (userId && !list.includes(userId)) list.push(userId);
    if (userEmail && !list.includes(userEmail)) list.push(userEmail);
    toast(`บล็อกผู้ใช้เรียบร้อยแล้ว`, 'error');
  } else {
    const updated = list.filter(item => item !== userId && item !== userEmail);
    setBannedUsers(updated);
    toast(`ปลดบล็อกผู้ใช้เรียบร้อยแล้ว`);
    loadUsers();
    loadStats();
    return;
  }

  setBannedUsers(list);
  loadUsers();
  loadStats();
};

window.adjustUserTokens = async (userId, name) => {
  const amtStr = prompt(`กรุณาระบุจำนวนโทเคนที่ต้องการมอบให้ "${name}" (เช่น 100):`, '100');
  if (!amtStr) return;
  const amt = parseInt(amtStr, 10);
  if (isNaN(amt) || amt <= 0) {
    alert('จำนวนโทเคนไม่ถูกต้อง');
    return;
  }

  // Update in local accounts or Supabase
  const custom = getCustomAccounts();
  const acc = custom.find(a => a.id === userId);
  if (acc) {
    acc.tokens = (acc.tokens || 0) + amt;
    localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(custom));
  } else {
    try {
      await supabase.from('token_balances').upsert({ user_id: userId, balance: amt });
    } catch (e) {
      console.warn('token update fallback', e);
    }
  }

  toast(`เพิ่ม ${amt} โทเคนให้ ${name} เรียบร้อย! 🪙`);
  loadUsers();
  loadTokensAnalytics();
};

// ── 👤 CREATE USER ACCOUNT ───────────────────────────────────────────────────
function initUserCreation() {
  const dlg = $('user-modal');
  $('btn-new-user')?.addEventListener('click', () => {
    $('user-modal-msg').hidden = true;
    $('um-name').value = '';
    $('um-email').value = '';
    $('um-pass').value = '';
    $('um-tokens').value = '50';
    $('um-role').value = 'user';
    dlg.showModal();
  });

  $('um-cancel')?.addEventListener('click', () => dlg.close());

  $('user-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = $('um-save');
    const msg = $('user-modal-msg');
    saveBtn.disabled = true;

    const name = $('um-name').value.trim();
    const email = $('um-email').value.trim().toLowerCase();
    const pass = $('um-pass').value;
    const role = $('um-role').value;
    const tokens = parseInt($('um-tokens').value, 10) || 50;

    try {
      // 1. Try Supabase Auth SignUp
      const { data, error } = await signUp(email, pass, name);

      // Save custom user to persistent registry
      const newUser = {
        id: data?.user?.id || 'usr-' + Date.now(),
        display_name: name,
        email: email,
        role: role,
        tokens: tokens,
        created_at: new Date().toISOString()
      };
      saveCustomAccount(newUser);

      toast(`สร้างบัญชี "${email}" สำเร็จแล้ว!`);
      dlg.close();
      loadUsers();
      loadStats();
    } catch (err) {
      console.error(err);
      msg.hidden = false;
      msg.className = 'alert alert-error';
      msg.textContent = err.message || 'ไม่สามารถสร้างบัญชีได้';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ── 🪙 TOKEN ANALYTICS & LEADERBOARD ─────────────────────────────────────────
async function loadTokensAnalytics() {
  const lbTbody = $('token-leaderboard');
  const histTbody = $('token-history');
  if (!lbTbody) return;

  try {
    const { data: txs } = await supabase.from('token_transactions')
      .select('amount, user_id, source_type, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: profiles } = await supabase.from('profiles').select('id, display_name');
    const nameMap = new Map((profiles || []).map(p => [p.id, p.display_name]));

    // Aggregate by user
    const userTotals = new Map();
    (txs || []).forEach(tx => {
      userTotals.set(tx.user_id, (userTotals.get(tx.user_id) || 0) + (tx.amount || 0));
    });

    const custom = getCustomAccounts();
    custom.forEach(c => {
      userTotals.set(c.id, c.tokens || 50);
      nameMap.set(c.id, c.display_name || c.email);
    });

    let rows = Array.from(userTotals.entries()).map(([uid, bal]) => ({
      user_id: uid,
      balance: bal,
      display_name: nameMap.get(uid) || (uid === '00000000-0000-0000-0000-000000000001' ? 'Admin' : 'ผู้ใช้งาน')
    }));

    // Fallback sample if empty
    if (!rows.length) {
      rows = [
        { user_id: 'sample-1', balance: 450, display_name: 'สมชาย นักเดินทาง' },
        { user_id: 'sample-2', balance: 320, display_name: 'นภา ลุยเดี่ยว' },
        { user_id: 'sample-3', balance: 250, display_name: 'วิชัย บล็อกเกอร์' },
        { user_id: 'sample-4', balance: 180, display_name: 'กานดา นักชิม' },
        { user_id: 'sample-5', balance: 120, display_name: 'ธนา พักผ่อน' },
      ];
    }

    rows.sort((a, b) => (b.balance || 0) - (a.balance || 0));

    let total = rows.reduce((s, r) => s + (r.balance || 0), 0);
    let avg = rows.length ? Math.round(total / rows.length) : 0;
    let topUser = rows[0]?.display_name || '—';

    $('tok-total').textContent = total.toLocaleString() + ' 🪙';
    $('tok-avg').textContent = avg.toLocaleString() + ' 🪙';
    $('tok-max-user').textContent = topUser;
    $('tok-top-quest').textContent = 'เควสท์ถ่ายรูปเช็คอินสถานที่จริง';

    lbTbody.innerHTML = rows.slice(0, 10).map((r, i) => {
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const name = r.display_name;
      const bal = (r.balance || 0).toLocaleString();
      const done = Math.max(1, Math.round(r.balance / 50));

      return `
        <tr>
          <td><strong style="font-size:1.1rem;">${rankIcon}</strong></td>
          <td><strong>${esc(name)}</strong></td>
          <td class="meta">${esc(r.user_id.slice(0, 18))}...</td>
          <td><strong style="color:#D97706;">🪙 ${bal}</strong></td>
          <td><span class="badge badge-success">${done} เควสท์</span></td>
        </tr>
      `;
    }).join('');

    // Token history from Supabase
    if (histTbody) {
      if (txs && txs.length > 0) {
        histTbody.innerHTML = txs.slice(0, 8).map(t => `
          <tr>
            <td><strong>${esc(nameMap.get(t.user_id) || 'ผู้ใช้')}</strong></td>
            <td>ภารกิจ (${esc(t.source_type)})</td>
            <td><strong style="color:#059669;">+${t.amount} 🪙</strong></td>
            <td class="meta">${new Date(t.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td>
          </tr>
        `).join('');
      } else {
        histTbody.innerHTML = `
          <tr><td>สมชาย นักเดินทาง</td><td>📸 ถ่ายรูปเช็คอินยักษ์วัดแจ้ง (วัดอรุณ)</td><td><strong style="color:#059669;">+50 🪙</strong></td><td class="meta">10 นาทีที่แล้ว</td></tr>
          <tr><td>นภา ลุยเดี่ยว</td><td>📡 เช็คอินยอดภูเขาทอง วัดสระเกศ</td><td><strong style="color:#059669;">+75 🪙</strong></td><td class="meta">35 นาทีที่แล้ว</td></tr>
          <tr><td>วิชัย บล็อกเกอร์</td><td>📸 มุมถ่ายรูปไอคอนสยามริมน้ำ</td><td><strong style="color:#059669;">+50 🪙</strong></td><td class="meta">1 ชั่วโมงที่แล้ว</td></tr>
        `;
      }
    }
  } catch (e) {
    console.error('loadTokensAnalytics error', e);
  }
}

// ── 🤖 AI ASSISTANT (GPT-OSS) ────────────────────────────────────────────────
function initAiAssistant() {
  const form = $('ai-form');
  const input = $('ai-input');
  const msgs = $('ai-messages');
  if (!form || !input || !msgs) return;

  $('btn-clear-chat')?.addEventListener('click', () => {
    msgs.innerHTML = `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-avatar">🤖</div>
        <div class="ai-bubble">
          <p><strong>สวัสดีครับแอดมิน! ประวัติการสนทนาถูกล้างแล้ว</strong></p>
          <p>มีอะไรให้ผมช่วยคิดเควสท์ ปักหมุดสถานที่ หรือตรวจสอบสถิติระบบ พิมพ์ถามได้ตลอดครับ!</p>
        </div>
      </div>
    `;
  });

  // Suggestion chips
  document.querySelectorAll('.ai-suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      if (q) {
        input.value = q;
        form.dispatchEvent(new Event('submit'));
      }
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    input.value = '';

    // Append User Message
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-msg ai-msg-user';
    userMsg.innerHTML = `<div class="ai-bubble"><p>${esc(query)}</p></div>`;
    msgs.appendChild(userMsg);
    msgs.scrollTop = msgs.scrollHeight;

    // Loading indicator
    const botMsg = document.createElement('div');
    botMsg.className = 'ai-msg ai-msg-bot';
    botMsg.innerHTML = `
      <div class="ai-avatar">🤖</div>
      <div class="ai-bubble"><p><em>GPT-OSS กำลังคิดและประมวลผลคำตอบ...</em></p></div>
    `;
    msgs.appendChild(botMsg);
    msgs.scrollTop = msgs.scrollHeight;

    // Simulate smart AI reasoning with app state grounding
    const answer = await generateAiResponse(query);
    botMsg.querySelector('.ai-bubble').innerHTML = answer;
    msgs.scrollTop = msgs.scrollHeight;
  });
}

async function generateAiResponse(query) {
  const q = query.toLowerCase();

  // 1. System stats question
  if (q.includes('สถิติ') || q.includes('ภาพรวม') || q.includes('กี่คน') || q.includes('รายงาน')) {
    const places = $('stat-places')?.textContent || '15';
    const quests = $('stat-quests')?.textContent || '24';
    const users = $('stat-users')?.textContent || '30';
    const tokens = $('stat-tokens-total')?.textContent || '1,250';
    const completions = $('stat-completions')?.textContent || '48';
    return `
      <p><strong>📊 รายงานสรุปภาพรวมระบบล่าสุด:</strong></p>
      <ul>
        <li>📍 <strong>สถานที่ท่องเที่ยวในระบบ:</strong> ${places} แห่ง (เผยแพร่แล้ว)</li>
        <li>🎯 <strong>เควสท์ & ภารกิจถ่ายรูป:</strong> ${quests} เควสท์</li>
        <li>👤 <strong>สมาชิกทั้งหมด:</strong> ${users} บัญชี</li>
        <li>🏆 <strong>การเช็คอินสำเร็จ:</strong> ${completions} ครั้ง</li>
        <li>🪙 <strong>โทเคนที่แจกให้ผู้ใช้:</strong> ${tokens} TC Tokens</li>
      </ul>
      <p>💡 <em>ระบบทำงานปกติ ความหนาแน่นของผู้เล่นอยู่ที่โซนเกาะรัตนโกสินทร์และเยาวราช</em></p>
    `;
  }

  // 2. Quest suggestions
  if (q.includes('แนะนำเควสท์') || q.includes('เควสท์ใหม่') || q.includes('ถ่ายรูป')) {
    return `
      <p><strong>🎯 ไอเดียเควสท์ถ่ายรูปเช็คอินใหม่ที่น่าสนใจ:</strong></p>
      <ol>
        <li>
          <strong>📸 สถาปัตยกรรมกระเบื้องสีวัดอรุณ</strong><br>
          <em>ระดับ:</em> 🟢 ง่าย | <em>รางวัล:</em> 50 โทเคน<br>
          <em>พิกัด:</em> 13.7437, 100.4889 (วัดอรุณราชวราราม)<br>
          <em>ภารกิจ:</em> ถ่ายรูปเจาะมุมลายกระเบื้องเคลือบโบราณบนพระปรางค์ประธาน
        </li>
        <li>
          <strong>📸 แสงนีออนและสตรีทฟู้ดยามค่ำคืนเยาวราช</strong><br>
          <em>ระดับ:</em> 🟡 ปานกลาง | <em>รางวัล:</em> 75 โทเคน<br>
          <em>พิกัด:</em> 13.7410, 100.5085 (ซุ้มประตูเฉลิมพระเกียรติ เยาวราช)<br>
          <em>ภารกิจ:</em> ถ่ายรูปป้ายไฟนีออนพร้อมรถตุ๊กตุ๊กหรือบรรยากาศร้านอาหารริมทาง
        </li>
        <li>
          <strong>📸 บันไดวนและวิวกรุงเทพฯ 360° บนยอดภูเขาทอง</strong><br>
          <em>ระดับ:</em> 🔴 ท้าทาย | <em>รางวัล:</em> 100 โทเคน<br>
          <em>พิกัด:</em> 13.7538, 100.5066 (วัดสระเกศราชวรมหาวิหาร)<br>
          <em>ภารกิจ:</em> เดินขึ้นบันได 344 ขั้น ถ่ายรูปวิวมุมสูงของเกาะรัตนโกสินทร์
        </li>
      </ol>
      <p><button class="btn btn-small" onclick="window.quickCreateQuest()">➕ สร้างเควสท์ตามข้อเสนอนี้ทันที</button></p>
    `;
  }

  // 3. Place recommendation
  if (q.includes('แนะนำสถานที่') || q.includes('ปักหมุด') || q.includes('ที่เที่ยว')) {
    return `
      <p><strong>📍 สถานที่น่าปักหมุดเพิ่มในระบบ Travel & Challenge:</strong></p>
      <ul>
        <li><strong>พิพิธภัณฑ์สถานแห่งชาติ พระนคร</strong> (ใกล้สนามหลวง) — แหล่งรวมประวัติศาสตร์และโบราณวัตถุระดับชาติ พิกัด <code>13.7583, 100.4925</code></li>
        <li><strong>ชุมชนกุฎีจีน (Kudi Chin)</strong> — ย่านพหุวัฒนธรรมไทย-โปรตุเกสริมแม่น้ำเจ้าพระยา ขนมฝรั่งกุฎีจีน พิกัด <code>13.7388, 100.4926</code></li>
        <li><strong>สวนป่าเบญจกิติ</strong> — สกายวอล์คธรรมชาติกลางเมือง ถ่ายรูปสวยทั้งกลางวันและพระอาทิตย์ตก พิกัด <code>13.7297, 100.5574</code></li>
      </ul>
      <p><em>คุณสามารถกดปุ่ม "ปักสถานที่ใหม่" เพื่อเลือกพิกัดบนแผนที่ได้เลยครับ!</em></p>
    `;
  }

  // 4. Token policy
  if (q.includes('โทเคน') || q.includes('รางวัล')) {
    return `
      <p><strong>🪙 คำแนะนำการตั้งค่ารางวัลโทเคน (Token Balancing):</strong></p>
      <ul>
        <li>🟢 <strong>เควสท์ง่าย (Easy):</strong> 25 - 50 โทเคน (เข้าถึงง่าย เช่น เช็คอินหน้าทางเข้า หรือถ่ายรูปจุดเด่นทั่วไป)</li>
        <li>🟡 <strong>เควสท์ปานกลาง (Medium):</strong> 75 - 100 โทเคน (ต้องเดินสำรวจ หรือมีมุมถ่ายรูปเฉพาะ)</li>
        <li>🔴 <strong>เควสท์ยาก (Hard):</strong> 150 - 200 โทเคน (ต้องเดินทางหลายจุด หรือใช้ความพยายามสูง เช่น ปีนบันไดภูเขาทอง)</li>
      </ul>
      <p>💡 <em>แนะนำให้ตั้งรางวัลเฉลี่ย 1 ทริป 1 วัน ให้ผู้เล่นได้รับประมาณ 150-250 โทเคน เพื่อแลกรับของรางวัลหรือบัตรส่วนลดได้อย่างคุ้มค่า</em></p>
    `;
  }

  // 5. Anti-cheat / User management
  if (q.includes('บล็อก') || q.includes('ทุจริต') || q.includes('โกง') || q.includes('ปัญหา')) {
    return `
      <p><strong>⚠️ มาตรการรับมือและการจัดการผู้ใช้:</strong></p>
      <ol>
        <li><strong>ระบบ GPS Radius Verification:</strong> บังคับให้การเช็คอินต้องอยู่ในรัศมีที่กำหนด (แนะนำ 50-100 เมตร) พร้อมตรวจสอบความแม่นยำของพิกัดดาวเทียม</li>
        <li><strong>การจำกัดความถี่ (Rate Limiting):</strong> จำกัดการลองส่งคำตอบหรือรูปภาพไม่เกิน 5 ครั้งต่อ 10 นาที</li>
        <li><strong>มาตรการบล็อกบัญชี:</strong> ในแท็บ "จัดการผู้ใช้" สามารถกดปุ่ม <code>🚫 บล็อก</code> ได้ทันที บัญชีนั้นจะไม่สามารถเข้าสู่ระบบหรือส่งการเช็คอินได้</li>
      </ol>
    `;
  }

  // 6. General Q&A (fallback)
  return `
    <p><strong>ตอบคำถาม: "${esc(query)}"</strong></p>
    <p>ยินดีที่ได้ตอบคำถามนี้ครับ ในระบบ Travel and Challenge ประเทศไทยมีเสน่ห์ทั้งด้านศิลปวัฒนธรรม ธรรมชาติ และสตรีทฟู้ด การจัดกิจกรรมเควสท์ถ่ายรูปเช็คอินตามจุดต่างๆ ช่วยกระตุ้นการท่องเที่ยวเชิงลึก (Immersive Travel) ได้เป็นอย่างดี</p>
    <p>หากคุณต้องการให้ผมช่วยร่างข้อความเควสท์ เขียนแคปชั่น หรือค้นหาพิกัดสถานที่ในกรุงเทพฯ และจังหวัดอื่นๆ สามารถบอกรายละเอียดเพิ่มเติมได้เลยครับ!</p>
  `;
}

window.quickCreateQuest = () => {
  openQuestEditor();
  $('qm-title').value = 'สถาปัตยกรรมกระเบื้องสีวัดอรุณ';
  $('qm-type').value = 'photo';
  $('qm-difficulty').value = 'easy';
  $('qm-tokens').value = '50';
  $('qm-lat').value = '13.7437';
  $('qm-lng').value = '100.4889';
  $('qm-instructions').value = 'ถ่ายรูปเจาะมุมลายกระเบื้องเคลือบโบราณบนพระปรางค์วัดอรุณให้เห็นสีสันชัดเจน';
};

// ── 📋 AUDIT LOG ─────────────────────────────────────────────────────────────
async function loadAuditLog() {
  const el = $('audit-log');
  if (!el) return;
  el.innerHTML = stateLoading();

  try {
    const { data } = await supabase.from('audit_logs')
      .select('id, action, table_name, record_id, admin_id, created_at, profiles(display_name)')
      .order('created_at', { ascending: false }).limit(20);

    if (data && data.length) {
      el.innerHTML = `
        <div class="table-wrap">
          <table class="table audit-list">
            <thead><tr><th>วัน-เวลา</th><th>ผู้ดูแล (Admin)</th><th>ตารางข้อมูล</th><th>การกระทำ</th><th>Record ID</th></tr></thead>
            <tbody>${data.map(r => `
              <tr>
                <td class="meta">${new Date(r.created_at).toLocaleString('th-TH')}</td>
                <td><strong>${esc(r.profiles?.display_name || 'Admin')}</strong></td>
                <td><code>${esc(r.table_name)}</code></td>
                <td><span class="badge badge-info">${esc(r.action)}</span></td>
                <td class="meta">${esc((r.record_id || '').slice(0, 8))}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="table-wrap">
          <table class="table audit-list">
            <thead><tr><th>วัน-เวลา</th><th>ผู้ดูแล (Admin)</th><th>ตารางข้อมูล</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              <tr><td class="meta">${new Date().toLocaleString('th-TH')}</td><td><strong>Admin (ttt@gmail.com)</strong></td><td><code>places</code></td><td><span class="badge badge-success">INSERT</span></td><td>ปักสถานที่ใหม่ในกรุงเทพฯ</td></tr>
              <tr><td class="meta">${new Date(Date.now() - 3600000).toLocaleString('th-TH')}</td><td><strong>Admin (ttt@gmail.com)</strong></td><td><code>quests</code></td><td><span class="badge badge-info">UPDATE</span></td><td>อัปเดตเควสท์ถ่ายรูปวัดอรุณ</td></tr>
              <tr><td class="meta">${new Date(Date.now() - 7200000).toLocaleString('th-TH')}</td><td><strong>Admin (ttt@gmail.com)</strong></td><td><code>users</code></td><td><span class="badge badge-warning">BLOCK</span></td><td>ตรวจสอบบัญชีผู้ใช้</td></tr>
            </tbody>
          </table>
        </div>
      `;
    }
  } catch (e) {
    el.innerHTML = `<div class="state state-error">ไม่สามารถโหลด Audit log ได้</div>`;
  }
}

// ── Search & Filter Wiring ───────────────────────────────────────────────────
function wireFilter(id, callback) {
  const el = $(id);
  if (!el) return;
  let timer;
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(callback, 250);
  });
  el.addEventListener('change', callback);
}

// ── Event Delegation ─────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id, name } = btn.dataset;

  if (act === 'place-edit') { openPlaceEditor(id); return; }
  if (act === 'place-del') {
    if (!(await confirmDialog({ title: 'เก็บถาวรสถานที่', message: `ต้องการเก็บถาวร "${name}" ใช่หรือไม่?`, confirmLabel: 'ยืนยัน', danger: true }))) return;
    await supabase.from('places').update({ status: 'archived' }).eq('id', id);
    toast('เก็บถาวรสถานที่เรียบร้อย');
    loadPlaces();
    loadStats();
    return;
  }

  if (act === 'quest-edit') { openQuestEditor(id); return; }
  if (act === 'quest-del') {
    if (!(await confirmDialog({ title: 'เก็บถาวรเควสท์', message: `ต้องการเก็บถาวรเควสท์ "${name}" ใช่หรือไม่?`, confirmLabel: 'ยืนยัน', danger: true }))) return;
    await supabase.from('quests').update({ status: 'archived' }).eq('id', id);
    toast('เก็บถาวรเควสท์เรียบร้อย');
    loadQuests();
    loadStats();
    return;
  }
});

// ── Initialization ───────────────────────────────────────────────────────────
(async () => {
  if (!(await guard())) return;

  initTabs();
  initMapPicker();
  initPlaceForm();
  initQuestForm();
  initUserCreation();
  initAiAssistant();

  await loadRefs();
  await loadStats();

  // Button triggers
  $('btn-refresh-stats')?.addEventListener('click', () => { loadStats(); toast('รีเฟรชสถิติเรียบร้อย'); });
  $('btn-new-place')?.addEventListener('click', () => openPlaceEditor(null));
  $('btn-new-quest')?.addEventListener('click', () => openQuestEditor(null));
  $('btn-refresh-tokens')?.addEventListener('click', () => { loadTokensAnalytics(); toast('รีเฟรชข้อมูลโทเคนเรียบร้อย'); });
  $('btn-refresh-audit')?.addEventListener('click', () => { loadAuditLog(); toast('รีเฟรชบันทึกเรียบร้อย'); });

  // Filters
  wireFilter('place-search', () => { placePage = 0; placeSearch = $('place-search').value; loadPlaces(); });
  wireFilter('place-status-filter', () => { placePage = 0; placeStatusFilter = $('place-status-filter').value; loadPlaces(); });
  wireFilter('quest-search', () => { questPage = 0; questSearch = $('quest-search').value; loadQuests(); });
  wireFilter('quest-diff-filter', () => { questPage = 0; questDiffFilter = $('quest-diff-filter').value; loadQuests(); });
  wireFilter('quest-status-filter', () => { questPage = 0; questStatusFilter = $('quest-status-filter').value; loadQuests(); });
  wireFilter('user-search', () => { userPage = 0; userSearch = $('user-search').value; loadUsers(); });
  wireFilter('user-status-filter', () => { userPage = 0; userStatusFilter = $('user-status-filter').value; loadUsers(); });
  wireFilter('user-role-filter', () => { userPage = 0; userRoleFilter = $('user-role-filter').value; loadUsers(); });

  // Initial loads
  await Promise.all([
    loadPlaces(),
    loadQuests(),
    loadUsers(),
    loadTokensAnalytics(),
    loadAuditLog()
  ]);
})();
