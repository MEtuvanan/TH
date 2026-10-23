import { getPlace } from './places.js';
import { createMap, setMarkers } from './maps.js';
import { listQuestsForPlace } from './quests.js';
import { supabase } from './supabase.js';
import { esc, isUuid } from './ui.js';
import { requireAuth } from './auth.js';

const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');

const fact = (label, value) =>
  `<dt>${esc(label)}</dt><dd>${value ? esc(value) : '<span class="badge badge-warn">Not verified yet</span>'}</dd>`;

async function init() {
  const session = await requireAuth();
  if (!session) return;
  if (!isUuid(id)) { $('status').textContent = 'Invalid destination link.'; return; }
  let p;
  try { p = await getPlace(id); }
  catch (e) { console.error(e); $('status').textContent = 'Could not load this destination. Please try again.'; return; }
  if (!p) { $('status').textContent = 'Destination not found.'; return; }

  document.title = `${p.name} — Travel and Challenge`;
  $('status').hidden = true;
  $('place').hidden = false;
  $('name').textContent = p.name;
  $('meta').textContent = [p.place_categories?.name, p.districts?.name_en, p.provinces?.name_en].filter(Boolean).join(' · ');
  $('description').textContent = p.description || p.summary || 'No description yet.';
  $('visitor').innerHTML = fact('General information', p.visitor_info) + fact('Opening hours', p.opening_hours)
    + fact('Entry fee', p.entry_fee) + fact('Accessibility', p.accessibility_info);
  $('coords').textContent = `Coordinates: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  $('gallery').innerHTML = p.place_images.map(i =>
    `<img src="${esc(i.url)}" alt="${esc(i.alt || p.name)}" loading="lazy">`).join('');
  $('btn-write-journal').href = `/journal.html?place_id=${encodeURIComponent(p.id)}`;
  $('btn-trip').href = `/planner.html?place_id=${encodeURIComponent(p.id)}`;
  const btnNav = $('btn-nav');
  if (btnNav) {
    btnNav.href = `/navigate.html?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}&id=${encodeURIComponent(p.id)}`;
  }

  try {
    const qs = await listQuestsForPlace(p.id);
    $('quests').innerHTML = qs.length
      ? qs.map(q => `<li><a href="/quests.html#${encodeURIComponent(q.id)}">${esc(q.title)}</a> <span class="meta">(${esc(q.difficulty)}, ${Number(q.reward_tokens)} tokens)</span></li>`).join('')
      : '<li class="muted">No quests here yet.</li>';
  } catch (e) { console.error(e); $('quests').innerHTML = '<li class="muted">Could not load quests.</li>'; }

  try {
    const { data, error } = await supabase.from('campaign_places')
      .select('campaigns(id, title)').eq('place_id', p.id);
    if (error) throw error;
    const cs = data.map(r => r.campaigns).filter(Boolean);
    $('campaigns').innerHTML = cs.length
      ? cs.map(c => `<li>${esc(c.title)}</li>`).join('')
      : '<li class="muted">No active campaigns.</li>';
  } catch (e) { console.error(e); $('campaigns').innerHTML = '<li class="muted">Could not load campaigns.</li>'; }

  try {
    const map = await createMap($('map'));
    setMarkers(map, {}, [p], () => {});
  } catch (e) { $('map-error').hidden = false; $('map-error').textContent = e.message; }
}
init();
