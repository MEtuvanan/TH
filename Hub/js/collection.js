import { supabase } from './supabase.js';
import { requireAuth } from './auth.js';
import { esc, toast, confirmDialog } from './ui.js';

const $ = id => document.getElementById(id);

async function load() {
  const [chars, owned, ach, mine, tx, bal] = await Promise.all([
    supabase.from('characters').select('id, name, description, image_url, rarity, unlock_hint, unlock_cost').eq('status', 'active').order('name'),
    supabase.from('user_characters').select('character_id, acquired_at'),
    supabase.from('achievements').select('id, title, description, token_reward').order('title'),
    supabase.from('user_achievements').select('achievement_id, unlocked_at'),
    supabase.from('token_transactions').select('amount, source_type, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.rpc('my_token_balance'),
  ]);
  for (const r of [chars, owned, ach, mine, tx, bal]) if (r.error) throw r.error;

  const ownedIds = new Set(owned.data.map(o => o.character_id));
  const unlockedIds = new Set(mine.data.map(o => o.achievement_id));
  const balance = Number(bal.data);

  $('balance').textContent = balance;
  $('progress').textContent = `${ownedIds.size} of ${chars.data.length} characters owned`;

  $('characters').innerHTML = chars.data.map(c => {
    const has = ownedIds.has(c.id);
    const art = c.image_url ? `<img src="${esc(c.image_url)}" alt="">` : '★';
    return `<article class="card char-card ${has ? '' : 'locked'}">
      <div class="avatar" aria-hidden="true">${art}</div>
      <h3 class="card-title">${esc(c.name)}</h3>
      <span class="badge ${has ? '' : 'badge-muted'}">${has ? 'Owned' : 'Locked'}</span> <span class="badge badge-muted">${esc(c.rarity)}</span>
      <p class="meta">${esc(c.description)}</p>
      ${has ? '' : `<p class="meta">How to unlock: ${esc(c.unlock_hint || 'Not specified')}</p>`}
      ${!has && c.unlock_cost ? `<button class="btn btn-small" data-unlock="${esc(c.id)}" data-cost="${Number(c.unlock_cost)}" data-name="${esc(c.name)}" type="button" ${balance < c.unlock_cost ? 'disabled' : ''}>Unlock for ${Number(c.unlock_cost)} tokens</button>` : ''}
    </article>`;
  }).join('') || '<p class="muted">No characters yet.</p>';

  $('achievements').innerHTML = ach.data.map(a => {
    const has = unlockedIds.has(a.id);
    return `<article class="card ${has ? '' : 'char-card locked'}"><h3 class="card-title">${esc(a.title)}</h3>
      <span class="badge ${has ? '' : 'badge-muted'}">${has ? 'Unlocked' : 'Locked'}</span>
      <p class="meta">${esc(a.description)} Reward: ${Number(a.token_reward)} tokens.</p></article>`;
  }).join('') || '<p class="muted">No achievements defined.</p>';

  $('history').innerHTML = tx.data.map(t =>
    `<tr><td>${esc(new Date(t.created_at).toLocaleString())}</td><td>${esc(t.source_type)}</td><td>${t.amount > 0 ? '+' : ''}${Number(t.amount)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No token activity yet.</td></tr>';
}

$('characters').addEventListener('click', async e => {
  const b = e.target.closest('[data-unlock]');
  if (!b) return;
  const ok = await confirmDialog({ title: 'Unlock character', message: `Spend ${b.dataset.cost} tokens to unlock ${b.dataset.name}?`, confirmLabel: 'Unlock' });
  if (!ok) return;
  const { data, error } = await supabase.rpc('unlock_character', { p_character_id: b.dataset.unlock });
  if (error || !data?.ok) { toast(data?.reason === 'insufficient_tokens' ? 'Not enough tokens.' : 'Could not unlock this character.', 'error'); return; }
  toast('Character unlocked!');
  load().catch(console.error);
});

(async () => {
  if (!(await requireAuth())) return;
  try { await load(); $('status').hidden = true; $('content').hidden = false; }
  catch (e) { console.error(e); $('status').textContent = 'Could not load your collection. Please try again.'; }
})();
