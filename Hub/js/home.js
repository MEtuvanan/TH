import { supabase } from './supabase.js';
import { esc, stateEmpty } from './ui.js';

// ─── Real Unsplash photos for Thailand destinations (CDN, free-to-use) ─────────
const PLACE_IMAGES = {
  // Temples & Landmarks — verified photo IDs
  'wat-phra-kaew':    'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&auto=format&fit=crop&q=80',
  'grand-palace':     'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&auto=format&fit=crop&q=80',
  'wat-pho':          'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&auto=format&fit=crop&q=80',
  'wat-arun':         'https://images.unsplash.com/photo-1638969725799-40c112559cbc?w=800&auto=format&fit=crop&q=80',
  'wat-saket':        'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&auto=format&fit=crop&q=80',
  // Markets & Culture
  'chatuchak':        'https://images.unsplash.com/photo-1583416750470-965b2707b355?w=800&auto=format&fit=crop&q=80',
  'yaowarat':         'https://images.unsplash.com/photo-1540704260519-4ae72e0e35a2?w=800&auto=format&fit=crop&q=80',
  'asiatique':        'https://images.unsplash.com/photo-1512003867696-6d5ce6835040?w=800&auto=format&fit=crop&q=80',
  // Parks & Nature
  'lumphini':         'https://images.unsplash.com/photo-1588880331179-bc9b93a8cb5e?w=800&auto=format&fit=crop&q=80',
  'bangkrachao':      'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800&auto=format&fit=crop&q=80',
  // Museums & Arts
  'jim-thompson':     'https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=800&auto=format&fit=crop&q=80',
  'national-museum':  'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop&q=80',
  // Default fallbacks by category
  '_default_temple':  'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&auto=format&fit=crop&q=80',
  '_default_market':  'https://images.unsplash.com/photo-1540704260519-4ae72e0e35a2?w=800&auto=format&fit=crop&q=80',
  '_default_nature':  'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800&auto=format&fit=crop&q=80',
  '_default':         'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&auto=format&fit=crop&q=80',
};

// Look up best image for a place by name slug or category
function getPlaceImage(place) {
  if (place.place_images?.[0]?.url) return place.place_images[0].url;
  const name = (place.name || '').toLowerCase().replace(/\s+/g, '-');
  for (const key of Object.keys(PLACE_IMAGES)) {
    if (key.startsWith('_')) continue;
    if (name.includes(key) || key.includes(name.split('-')[0])) return PLACE_IMAGES[key];
  }
  const cat = (place.place_categories?.name || '').toLowerCase();
  if (cat.includes('temple') || cat.includes('วัด')) return PLACE_IMAGES['_default_temple'];
  if (cat.includes('market') || cat.includes('ตลาด')) return PLACE_IMAGES['_default_market'];
  if (cat.includes('park') || cat.includes('สวน')) return PLACE_IMAGES['_default_nature'];
  return PLACE_IMAGES['_default'];
}

// ─── Featured Destinations ────────────────────────────────────────────────────
async function featured() {
  const el = document.getElementById('featured');
  try {
    const { data, error } = await supabase.from('places')
      .select('id, name, summary, districts(name_en), provinces(name_en), place_categories(name), place_images(url, alt), quests(id, reward_tokens)')
      .eq('status', 'published').order('created_at').limit(6);
    if (error) throw error;

    // Fallback demo cards if DB is empty
    const places = data?.length ? data : getDemoPlaces();

    el.innerHTML = places.map(p => {
      const imgUrl = getPlaceImage(p);
      const questCount = p.quests?.length || 0;
      const district = [p.districts?.name_en, p.provinces?.name_en].filter(Boolean).join(', ') || 'Bangkok';
      return `
      <article class="card destination-card">
        <div class="card-media">
          <img src="${esc(imgUrl)}" alt="${esc(p.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'card-media-placeholder\\'><span>🏛️</span></div>'">
          <span class="card-category-tag">${esc(p.place_categories?.name || 'Destination')}</span>
        </div>
        <div class="card-content">
          <div class="card-location">📍 ${esc(district)}</div>
          <h3 class="card-title"><a href="/place.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
          <p class="card-summary">${esc(p.summary || '')}</p>
          <div class="card-footer">
            ${questCount > 0 ? `<span class="badge badge-quest">⚔️ ${questCount} Quest${questCount > 1 ? 's' : ''}</span>` : '<span class="badge badge-muted">Explore</span>'}
            <a class="card-action-link" href="/place.html?id=${encodeURIComponent(p.id)}">View details →</a>
          </div>
        </div>
      </article>`;
    }).join('');
  } catch (e) {
    console.error(e);
    // Show demo cards even on error
    const places = getDemoPlaces();
    el.innerHTML = places.map(p => {
      const imgUrl = getPlaceImage(p);
      return `
      <article class="card destination-card">
        <div class="card-media">
          <img src="${esc(imgUrl)}" alt="${esc(p.name)}" loading="lazy">
          <span class="card-category-tag">${esc(p.place_categories?.name || 'Destination')}</span>
        </div>
        <div class="card-content">
          <div class="card-location">📍 ${p.districts?.name_en || 'Bangkok'}</div>
          <h3 class="card-title">${esc(p.name)}</h3>
          <p class="card-summary">${esc(p.summary || '')}</p>
          <div class="card-footer">
            <span class="badge badge-quest">⚔️ Quest Available</span>
            <a class="card-action-link" href="/explore.html">View on map →</a>
          </div>
        </div>
      </article>`;
    }).join('');
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
const CAMPAIGN_IMAGES = [
  'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1548940740-204726a19be3?w=800&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800&auto=format&fit=crop&q=80',
];

async function campaigns() {
  const el = document.getElementById('campaigns');
  try {
    const { data, error } = await supabase.from('campaigns')
      .select('id, title, description, starts_at, ends_at, reward_tokens').eq('status', 'published').limit(3);
    if (error) throw error;
    const fmt = d => d ? new Date(d).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) : '';
    const items = data?.length ? data : getDemoCampaigns();
    el.innerHTML = items.map((c, i) => `
      <article class="card campaign-card">
        <div class="campaign-media">
          <img src="${CAMPAIGN_IMAGES[i % CAMPAIGN_IMAGES.length]}" alt="${esc(c.title)}" loading="lazy">
          <div class="campaign-media-overlay">
            <span class="campaign-tokens-badge">🪙 +${c.reward_tokens || 100} Tokens</span>
          </div>
        </div>
        <div class="campaign-body">
          <div class="campaign-header">
            <span class="badge badge-campaign">Special Campaign</span>
            ${c.ends_at ? `<span class="campaign-deadline">🗓️ ${esc(fmt(c.ends_at))}</span>` : ''}
          </div>
          <h3 class="card-title">${esc(c.title)}</h3>
          <p class="card-summary">${esc(c.description)}</p>
          <a class="btn btn-small" href="/quests.html">Join Campaign Quests →</a>
        </div>
      </article>`).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = stateEmpty('No campaigns are running right now.');
  }
}

// ─── Demo data fallback (when DB is unavailable) ──────────────────────────────
function getDemoPlaces() {
  return [
    { id: 'wat-phra-kaew', name: 'Wat Phra Kaew', summary: 'Home of the sacred Emerald Buddha, the most revered Buddhist temple in Thailand.', districts: { name_en: 'Phra Nakhon' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Temple' }, place_images: [], quests: [1] },
    { id: 'wat-arun', name: 'Wat Arun (Temple of Dawn)', summary: 'Iconic riverside temple adorned with colorful porcelain mosaics and dramatic Khmer-style prangs.', districts: { name_en: 'Bangkok Yai' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Temple' }, place_images: [], quests: [1] },
    { id: 'wat-pho', name: 'Wat Pho (Reclining Buddha)', summary: 'Ancient temple featuring a massive 46-meter golden reclining Buddha and the birthplace of Thai massage.', districts: { name_en: 'Phra Nakhon' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Temple' }, place_images: [], quests: [] },
    { id: 'chatuchak', name: 'Chatuchak Weekend Market', summary: "One of the world's largest weekend markets with over 15,000 stalls of food, crafts, antiques, and fashion.", districts: { name_en: 'Chatuchak' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Market' }, place_images: [], quests: [1] },
    { id: 'yaowarat', name: 'Yaowarat Chinatown', summary: "Bangkok's oldest Chinatown district — a dazzling street food paradise of gold shops, temples and night markets.", districts: { name_en: 'Samphanthawong' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Market' }, place_images: [], quests: [1] },
    { id: 'lumphini', name: 'Lumphini Park', summary: 'The green lung of Bangkok — a tranquil escape with a lake, running tracks, paddle boats, and monitor lizards.', districts: { name_en: 'Pathum Wan' }, provinces: { name_en: 'Bangkok' }, place_categories: { name: 'Park' }, place_images: [], quests: [] },
  ];
}

function getDemoCampaigns() {
  return [
    { id: 1, title: 'Bangkok Temple Trail', description: 'Visit 5 iconic Bangkok temples and earn bonus tokens. Explore centuries of Thai Buddhist heritage in one epic quest chain.', starts_at: null, ends_at: '2025-12-31', reward_tokens: 250 },
    { id: 2, title: 'Street Food Explorer', description: 'Check-in at legendary Bangkok street food spots in Yaowarat, Silom, and Ari. Taste your way through the city.', starts_at: null, ends_at: '2025-11-30', reward_tokens: 150 },
    { id: 3, title: 'Green Bangkok Challenge', description: 'Discover Bangkok\'s hidden parks and green spaces. From Lumphini to Bang Krachao — the green lung of the city.', starts_at: null, ends_at: '2026-01-15', reward_tokens: 200 },
  ];
}

featured();
campaigns();
