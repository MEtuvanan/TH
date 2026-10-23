import { supabase } from './supabase.js';
import { esc, stateEmpty } from './ui.js';

async function featured() {
  const el = document.getElementById('featured');
  try {
    const { data, error } = await supabase.from('places')
      .select('id, name, summary, districts(name_en), provinces(name_en), place_categories(name), place_images(url, alt), quests(id, reward_tokens)')
      .eq('status', 'published').order('created_at').limit(6);
    if (error) throw error;
    el.innerHTML = data.length ? data.map(p => {
      const img = p.place_images?.[0];
      const questCount = p.quests?.length || 0;
      return `
      <article class="card destination-card">
        <div class="card-media">
          ${img?.url ? `<img src="${esc(img.url)}" alt="${esc(img.alt || p.name)}" loading="lazy">`
                     : `<div class="card-media-placeholder"><span>🏛️</span></div>`}
          <span class="card-category-tag">${esc(p.place_categories?.name || 'Destination')}</span>
        </div>
        <div class="card-content">
          <div class="card-location">📍 ${esc([p.districts?.name_en, p.provinces?.name_en].filter(Boolean).join(', '))}</div>
          <h3 class="card-title"><a href="/place.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
          <p class="card-summary">${esc(p.summary || '')}</p>
          <div class="card-footer">
            ${questCount > 0 ? `<span class="badge badge-quest">⚔️ ${questCount} Quest${questCount > 1 ? 's' : ''}</span>` : '<span class="badge badge-muted">Explore</span>'}
            <a class="card-action-link" href="/place.html?id=${encodeURIComponent(p.id)}">View details →</a>
          </div>
        </div>
      </article>`;
    }).join('') : stateEmpty('Destinations will appear here once they are verified and published.');
  } catch (e) { console.error(e); el.innerHTML = stateEmpty('Could not load destinations.'); }
}

async function campaigns() {
  const el = document.getElementById('campaigns');
  try {
    const { data, error } = await supabase.from('campaigns')
      .select('id, title, description, starts_at, ends_at, reward_tokens').eq('status', 'published').limit(3);
    if (error) throw error;
    const fmt = d => d ? new Date(d).toLocaleDateString() : '';
    el.innerHTML = data.length ? data.map(c => `
      <article class="card campaign-card">
        <div class="campaign-header">
          <span class="badge badge-campaign">Special Campaign</span>
          ${c.reward_tokens ? `<span class="badge badge-reward">🪙 +${c.reward_tokens} Tokens</span>` : ''}
        </div>
        <h3 class="card-title">${esc(c.title)}</h3>
        <p class="meta">📅 ${esc(fmt(c.starts_at))}${c.ends_at ? ' – ' + esc(fmt(c.ends_at)) : ''}</p>
        <p class="card-summary">${esc(c.description)}</p>
        <div style="margin-top:auto;padding-top:1rem">
          <a class="btn btn-small" href="/quests.html">Join Campaign Quests →</a>
        </div>
      </article>`).join('') : stateEmpty('No campaigns are running right now.');
  } catch (e) { console.error(e); el.innerHTML = stateEmpty('Could not load campaigns.'); }
}

featured();
campaigns();
