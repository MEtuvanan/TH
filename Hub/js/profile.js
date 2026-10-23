// profile.js — user profile page. Data is protected by RLS; users can only see their own records.
import { supabase } from './supabase.js';
import { requireAuth, getProfile, signOut } from './auth.js';
import { esc, toast, confirmDialog } from './ui.js';

const $ = id => document.getElementById(id);

async function load(session) {
  const uid = session.user.id;

  const [profile, quests, trips, balance] = await Promise.all([
    getProfile(),
    supabase.from('user_quests').select('quest_id, status, completed_at, quests(title)').eq('user_id', uid).order('completed_at', { ascending: false }).limit(20),
    supabase.from('trips').select('id, title, start_date, total_days, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(10),
    supabase.rpc('my_token_balance'),
  ]);

  if (!profile) { $('status').textContent = 'Could not load profile.'; return; }

  // Header
  $('p-name').textContent = profile.display_name || session.user.email;
  $('p-email').textContent = session.user.email;
  $('p-role').textContent = profile.role === 'admin' ? 'Administrator' : 'Explorer';
  $('p-tokens').textContent = Number(balance.data ?? 0);

  // Stats
  const completed = (quests.data || []).filter(q => q.status === 'completed');
  $('stat-quests').textContent = completed.length;
  const placesVisited = await supabase.from('user_quests')
    .select('quests(quest_places(place_id))', { count: 'exact' })
    .eq('user_id', uid).eq('status', 'completed');
  const uniquePlaces = new Set();
  (placesVisited.data || []).forEach(u =>
    (u.quests?.quest_places || []).forEach(qp => uniquePlaces.add(qp.place_id)));
  $('stat-places').textContent = uniquePlaces.size;
  $('stat-trips').textContent = (trips.data || []).length;

  // Quest history
  const qEl = $('p-quests');
  qEl.innerHTML = completed.length ? completed.map(q => `
    <li>
      <span>${esc(q.quests?.title || 'Unknown quest')}</span>
      <span class="badge">Completed</span>
    </li>`).join('') : '<li class="muted">No quests completed yet.</li>';

  // Saved trips
  const tEl = $('p-trips');
  tEl.innerHTML = (trips.data || []).length ? trips.data.map(t => `
    <li>
      <a href="/planner.html?trip=${encodeURIComponent(t.id)}">${esc(t.title)}</a>
      <span class="meta">${t.total_days} day${t.total_days !== 1 ? 's' : ''}${t.start_date ? ' · ' + esc(new Date(t.start_date + 'T00:00:00').toLocaleDateString()) : ''}</span>
    </li>`).join('') : '<li class="muted">No saved trips.</li>';

  // Pre-fill edit form
  $('ed-name').value = profile.display_name || '';
  $('ed-name-current').textContent = profile.display_name || session.user.email;

  $('status').hidden = true;
  $('content').hidden = false;
}

let currentSession = null;

// ── Edit display name ─────────────────────────────────────────────────────────
$('ed-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('ed-name').value.trim().slice(0, 40);
  if (!name) { toast('Display name cannot be empty.', 'error'); return; }
  $('ed-save').disabled = true;
  try {
    const uid = currentSession?.user?.id;
    if (!uid) throw new Error('Not authenticated');
    const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', uid);
    if (error) throw error;
    $('p-name').textContent = name;
    $('ed-name-current').textContent = name;
    toast('Name updated.');
  } catch (e) { console.error(e); toast('Could not update name.', 'error'); }
  finally { $('ed-save').disabled = false; }
});

// ── Change password ───────────────────────────────────────────────────────────
$('pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('pw-new').value;
  const pw2 = $('pw-confirm').value;
  if (pw.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
  if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }
  $('pw-save').disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;
    $('pw-new').value = ''; $('pw-confirm').value = '';
    toast('Password updated.');
  } catch (e) { console.error(e); toast(e.message || 'Could not update password.', 'error'); }
  finally { $('pw-save').disabled = false; }
});

// ── Sign out ──────────────────────────────────────────────────────────────────
$('btn-signout').addEventListener('click', async () => {
  await signOut();
  location.href = '/';
});

// ── Delete account ────────────────────────────────────────────────────────────
$('btn-delete-account')?.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Delete account',
    message: 'This permanently deletes your account and all private data. This cannot be undone.',
    confirmLabel: 'Delete my account',
    danger: true,
  });
  if (!ok) return;
  // Supabase does not expose deleteUser from the client with the anon key;
  // the user should contact support or an edge function should be set up.
  toast('To delete your account, please contact support.', 'error');
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const session = await requireAuth();
  if (!session) return;
  currentSession = session;
  try {
    await load(session);
  } catch (e) {
    console.error(e);
    $('status').textContent = 'Could not load your profile. Please try again.';
  }
})();
