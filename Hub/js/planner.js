import { requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import { AI_PLANNER_URL, SUPABASE_ANON_KEY } from './config.js';
import { createMap, setMarkers, drawPath } from './maps.js';
import { esc, toast, confirmDialog, isUuid } from './ui.js';

const $ = id => document.getElementById(id);
let session, plan = null, tripId = null, mapState = {}, map = null;

function showMsg(text, type = 'error') {
  const m = $('msg'); m.hidden = !text; m.className = `alert alert-${type === 'ok' ? 'ok' : 'error'}`; m.textContent = text;
}

function prefsFromForm() {
  return {
    startingArea: $('p-area').value.trim(), startDate: $('p-date').value || undefined,
    days: Number($('p-days').value) || 1, hoursPerDay: Number($('p-hours').value) || 6,
    budget: $('p-budget').value, travelStyle: $('p-style').value, pace: $('p-pace').value,
    transport: $('p-transport').value, accessibility: $('p-access').value.trim(),
    interests: $('p-interests').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6),
    includeQuests: $('p-quests').checked,
  };
}

// ---------- render ----------
function render() {
  $('result').hidden = !plan;
  if (!plan) return;
  $('t-title').value ||= plan.trip_title;
  $('summary').textContent = plan.summary || '';
  $('notice').textContent = plan.notice || '';
  $('del').hidden = !tripId;
  $('days').innerHTML = plan.daily_plan.map((d, di) => `
    <div class="day"><h3>Day ${d.day}${d.theme ? ' — ' + esc(d.theme) : ''}</h3>
      ${d.stops.map((s, si) => `<div class="stop">
        <div><strong>${esc(s.name)}</strong>
          <div class="meta">${esc(s.arrival_time || 'time flexible')} · ~${Number(s.duration_minutes)} min (estimate)</div>
          ${s.why ? `<div>${esc(s.why)}</div>` : ''}${s.notes ? `<div class="meta">${esc(s.notes)}</div>` : ''}
          ${(s.quests || []).map(q => `<span class="badge">${esc(q.title)}</span>`).join(' ')}</div>
        <div class="stop-ctl">
          <button data-act="up" data-d="${di}" data-s="${si}" aria-label="Move ${esc(s.name)} up" ${si === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" data-d="${di}" data-s="${si}" aria-label="Move ${esc(s.name)} down" ${si === d.stops.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-act="rm" data-d="${di}" data-s="${si}" aria-label="Remove ${esc(s.name)}">✕</button>
        </div></div>`).join('') || '<p class="muted">No stops.</p>'}
      ${d.breaks?.length ? `<p class="meta">Suggested breaks: ${d.breaks.map(esc).join('; ')}</p>` : ''}
    </div>`).join('');
  drawMap();
}

async function drawMap() {
  const stops = plan.daily_plan.flatMap(d => d.stops);
  $('map').hidden = false;
  try {
    map ??= await createMap($('map'));
    setMarkers(map, mapState, stops.map(s => ({ lat: s.lat, lng: s.lng, name: s.name })), () => {});
    if (stops.length > 1) drawPath(map, mapState, stops);
    $('map-error').hidden = true;
  } catch (e) { $('map').hidden = true; $('map-error').hidden = false; $('map-error').textContent = e.message; }
}

$('days').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = plan.daily_plan[b.dataset.d], i = Number(b.dataset.s);
  if (b.dataset.act === 'rm') d.stops.splice(i, 1);
  else { const j = b.dataset.act === 'up' ? i - 1 : i + 1; [d.stops[i], d.stops[j]] = [d.stops[j], d.stops[i]]; }
  plan.daily_plan = plan.daily_plan.filter(x => x.stops.length);
  plan.daily_plan.forEach((x, n) => { x.day = n + 1; });
  render();
});

async function tryLocalGroqFallback(prefs) {
  try {
    const localMod = await import('./config.local.js');
    const cfg = localMod?.AI_CONFIG;
    if (!cfg?.apiKey || cfg.apiKey.includes('PASTE_YOUR_GROQ_KEY')) return null;
    const { data: places, error } = await supabase.from('places')
      .select('id, name, lat, lng, summary, opening_hours, entry_fee, place_categories(name), quests(id, title, difficulty, reward_tokens)')
      .eq('status', 'published').limit(30);
    if (error || !places?.length) return null;

    const catalog = places.map(p => ({
      id: p.id, name: p.name, category: p.place_categories?.name || 'place',
      lat: p.lat, lng: p.lng, summary: p.summary, opening_hours: p.opening_hours, entry_fee: p.entry_fee,
      quests: (p.quests || []).map(q => ({ id: q.id, title: q.title, difficulty: q.difficulty, reward_tokens: q.reward_tokens })),
    }));

    const prompt = `You are a travel itinerary planner for Thailand.
User preferences:
${JSON.stringify(prefs, null, 2)}

Verified destination catalog (YOU MUST ONLY USE PLACES FROM THIS LIST):
${JSON.stringify(catalog, null, 2)}

Create a ${prefs.days}-day itinerary. Return ONLY valid JSON in this schema:
{
  "trip_title": "string",
  "summary": "string",
  "notice": "All suggested visit times and durations are estimates. Check opening hours before you go.",
  "daily_plan": [
    {
      "day": 1,
      "theme": "string",
      "stops": [
        {
          "place_id": "valid id from catalog",
          "name": "matching name",
          "lat": 0.0,
          "lng": 0.0,
          "arrival_time": "09:00",
          "duration_minutes": 90,
          "why": "string",
          "notes": "string",
          "quests": [{"id": "quest id", "title": "quest title"}]
        }
      ],
      "breaks": ["string"]
    }
  ]
}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || 'gpt-oss',
        messages: [
          { role: 'system', content: 'You are a travel planner. Return ONLY valid raw JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Groq API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawContent);
    parsed.preferences = prefs;

    // Ground and backfill verified coordinates & place details from DB
    const placeMap = new Map(places.map(p => [p.id, p]));
    if (Array.isArray(parsed.daily_plan)) {
      parsed.daily_plan.forEach(d => {
        if (Array.isArray(d.stops)) {
          d.stops.forEach(s => {
            const realPlace = placeMap.get(s.place_id);
            if (realPlace) {
              s.name = realPlace.name;
              s.lat = realPlace.lat;
              s.lng = realPlace.lng;
            }
          });
        }
      });
    }
    return parsed;
  } catch (err) {
    console.warn('Local Groq fallback error:', err);
    throw err;
  }
}

// ---------- generate ----------
$('prefs').addEventListener('submit', async e => {
  e.preventDefault();
  showMsg('');
  $('go').disabled = true; $('go').textContent = 'Generating…';
  const prefs = prefsFromForm();
  let planResult = null;
  let edgeError = null;

  try {
    const { data: { session: s } } = await supabase.auth.getSession();
    const res = await fetch(AI_PLANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(prefs),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      planResult = body;
    } else {
      edgeError = body.error || `Edge function returned HTTP ${res.status}`;
    }
  } catch (netErr) {
    edgeError = netErr.message;
  }

  // If edge function is not available / failed, try local dev fallback with user's Groq key
  if (!planResult) {
    try {
      planResult = await tryLocalGroqFallback(prefs);
    } catch (e) {
      edgeError = e.message;
      console.warn('Local fallback attempt failed', e);
    }
  }

  if (planResult) {
    plan = planResult; tripId = null; $('t-title').value = '';
    render();
  } else {
    showMsg(edgeError || 'The AI planner is unavailable. If developing locally, provide your GROQ key in js/config.local.js or deploy the Supabase Edge Function.');
  }
  $('go').disabled = false; $('go').textContent = 'Generate itinerary';
});

// ---------- save / load / delete ----------
async function save() {
  const title = $('t-title').value.trim();
  if (!title) { toast('Give the trip a name first.', 'error'); return; }
  $('save').disabled = true;
  try {
    const row = { title, start_date: plan.preferences?.startDate || null, total_days: Math.max(plan.daily_plan.length, 1), preferences: plan.preferences || {} };
    if (tripId) {
      const { error } = await supabase.from('trips').update(row).eq('id', tripId);
      if (error) throw error;
      const { error: de } = await supabase.from('trip_stops').delete().eq('trip_id', tripId);
      if (de) throw de;
    } else {
      const { data, error } = await supabase.from('trips').insert({ ...row, user_id: session.user.id }).select('id').single();
      if (error) throw error;
      tripId = data.id;
    }
    const stops = plan.daily_plan.flatMap(d => d.stops.map((s, i) => ({
      trip_id: tripId, place_id: s.place_id, day_number: d.day, stop_order: i + 1,
      suggested_time: s.arrival_time || null, duration_minutes: s.duration_minutes || null,
      notes: [s.why, s.notes].filter(Boolean).join(' ').slice(0, 1000) || null,
    })));
    if (stops.length) { const { error } = await supabase.from('trip_stops').insert(stops); if (error) throw error; }
    toast('Trip saved.'); render(); loadSaved();
  } catch (e) { console.error(e); toast('Could not save the trip.', 'error'); }
  finally { $('save').disabled = false; }
}

async function loadSaved() {
  const { data, error } = await supabase.from('trips').select('id, title, created_at').order('created_at', { ascending: false });
  $('saved').innerHTML = error ? '<li class="muted">Could not load trips.</li>'
    : data.length ? data.map(t => `<li><button data-trip="${esc(t.id)}" type="button">${esc(t.title)}</button></li>`).join('')
    : '<li class="muted">No saved trips yet.</li>';
}

async function openTrip(id) {
  if (!isUuid(id)) return;
  const [t, s] = await Promise.all([
    supabase.from('trips').select('id, title, preferences').eq('id', id).maybeSingle(),
    supabase.from('trip_stops').select('place_id, day_number, stop_order, suggested_time, duration_minutes, notes, places(name, lat, lng)').eq('trip_id', id).order('day_number').order('stop_order'),
  ]);
  if (t.error || s.error || !t.data) { toast('Could not open that trip.', 'error'); return; }
  const days = new Map();
  for (const r of s.data) {
    if (!days.has(r.day_number)) days.set(r.day_number, { day: r.day_number, theme: '', stops: [], breaks: [] });
    days.get(r.day_number).stops.push({
      place_id: r.place_id, name: r.places?.name || 'Unknown', lat: r.places?.lat, lng: r.places?.lng,
      arrival_time: r.suggested_time, duration_minutes: r.duration_minutes, why: '', notes: r.notes || '', quests: [],
    });
  }
  plan = { trip_title: t.data.title, summary: '', preferences: t.data.preferences, notice: 'Saved itinerary. Times are estimates.', daily_plan: [...days.values()] };
  tripId = id; $('t-title').value = t.data.title; render();
}

$('save').addEventListener('click', save);
$('saved').addEventListener('click', e => { const b = e.target.closest('[data-trip]'); if (b) openTrip(b.dataset.trip); });
$('del').addEventListener('click', async () => {
  if (!tripId || !(await confirmDialog({ title: 'Delete trip', message: 'Delete this saved trip?', confirmLabel: 'Delete', danger: true }))) return;
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) { toast('Could not delete the trip.', 'error'); return; }
  tripId = null; plan = null; render(); loadSaved(); toast('Trip deleted.');
});

(async () => {
  session = await requireAuth();
  if (!session) return;
  await loadSaved();
  const t = new URLSearchParams(location.search).get('trip');
  if (t) openTrip(t);
})();
