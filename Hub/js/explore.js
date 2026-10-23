import { listPlaces, getFilterOptions, getPlaceIndicators } from './places.js';
import { createMap, setMarkers } from './maps.js';
import { esc, debounce, stateEmpty } from './ui.js';
import { requireAuth } from './auth.js';
import { initAIPlannerModal } from './ai-planner-modal.js';

const $ = id => document.getElementById(id);
const state = { map: null, markers: [] };
let options, indicators = { quests: new Set(), campaigns: new Set() };

function fill(sel, rows, label) {
  sel.innerHTML = `<option value="">${esc(label)}</option>` +
    rows.map(r => `<option value="${Number(r.id)}">${esc(r.name_en ?? r.name)}</option>`).join('');
}

function updateDistricts() {
  const pid = Number($('province').value);
  fill($('district'), options.districts.filter(d => !pid || d.province_id === pid), 'All districts');
}

function renderList(places) {
  const catMap = new Map(options?.categories?.map(c => [c.id, c.name]) || []);
  const provMap = new Map(options?.provinces?.map(p => [p.id, p.name_en]) || []);
  const distMap = new Map(options?.districts?.map(d => [d.id, d.name_en]) || []);

  $('list').innerHTML = places.map(p => {
    const catName = catMap.get(p.category_id) || p.place_categories?.name || 'สถานที่ท่องเที่ยว';
    const distName = distMap.get(p.district_id) || p.districts?.name_en || '';
    const provName = provMap.get(p.province_id) || p.provinces?.name_en || 'กรุงเทพมหานคร';
    const locName = [distName, provName].filter(Boolean).join(', ');
    return `
    <li data-id="${esc(p.id)}">
      <h2><a href="/place.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h2>
      <div class="badges">
        <span class="badge badge-muted">${esc(catName)}</span>
        <span class="badge badge-muted">${esc(locName)}</span>
        ${indicators.quests.has(p.id) ? '<span class="badge">Quests</span>' : ''}
        ${indicators.campaigns.has(p.id) ? '<span class="badge">Campaign</span>' : ''}
      </div>
      <p class="meta">${esc(p.summary || '')}</p>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
        <a href="/place.html?id=${encodeURIComponent(p.id)}" class="btn" style="font-size:0.8rem;padding:4px 10px;text-decoration:none;">รายละเอียด</a>
        <a href="/navigate.html?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}&id=${encodeURIComponent(p.id)}" class="btn" style="font-size:0.8rem;padding:4px 10px;background:linear-gradient(135deg,#00A86B,#007A4D);color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:4px;">🧭 นำทาง GPS</a>
      </div>
    </li>`;
  }).join('');
}

function select(p) {
  document.querySelectorAll('#list li').forEach(li => {
    if (li.dataset.id === p.id) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
  });
  document.querySelector(`#list li[data-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  state.map?.panTo({ lat: p.lat, lng: p.lng });
}

async function refresh() {
  $('status').textContent = 'Loading…';
  try {
    const places = await listPlaces({
      search: $('search').value,
      provinceId: Number($('province').value) || null,
      districtId: Number($('district').value) || null,
      categoryId: Number($('category').value) || null,
    });
    renderList(places);
    $('status').textContent = places.length ? `${places.length} destination(s)` : '';
    if (!places.length) $('list').innerHTML = stateEmpty('No published destinations match your filters.');
    if (state.map) setMarkers(state.map, state, places, select);
  } catch (e) {
    console.error('refresh error:', e?.message || e);
    $('list').innerHTML = '';
    $('status').textContent = `Could not load destinations: ${e?.message || e?.error_description || JSON.stringify(e)}`;
  }
}

async function init() {
  const session = await requireAuth();
  if (!session) return;
  try {
    options = await getFilterOptions();
    fill($('province'), options.provinces, 'All provinces');
    fill($('category'), options.categories, 'All categories');
    updateDistricts();
    indicators = await getPlaceIndicators();
  } catch (e) { console.error(e); }

  $('filters').addEventListener('submit', e => e.preventDefault());
  $('search').addEventListener('input', debounce(refresh, 300));
  $('province').addEventListener('change', () => { updateDistricts(); refresh(); });
  $('district').addEventListener('change', refresh);
  $('category').addEventListener('change', refresh);

  window.addEventListener('gmaps_error', ev => {
    $('map-error').hidden = false;
    $('map-error').textContent = `${ev.detail.message} The list below still works.`;
  });
  try {
    state.map = await createMap($('map'));
    window.__exploreMap = state.map;
  } catch (e) {
    $('map-error').hidden = false;
    $('map-error').textContent = `${e.message} The list below still works.`;
  }
  refresh();
  initAIPlannerModal();
}
init();
