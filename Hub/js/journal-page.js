import { requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import { listDiaries, saveDiary, deleteDiary, deletePhoto, signedUrls, validatePhoto } from './journal.js';
import { esc, toast, confirmDialog, stateEmpty, stateLoading, isUuid } from './ui.js';

const $ = id => document.getElementById(id);
let session, places = [], diaries = [], editing = null;

function fillPlaces() {
  const opts = places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('f-place').innerHTML = '<option value="">All</option>' + opts;
  $('ed-p').innerHTML = opts;
}

async function refresh() {
  $('list').innerHTML = stateLoading();
  try {
    diaries = await listDiaries({ from: $('f-from').value, to: $('f-to').value, placeId: $('f-place').value });
    const urls = await signedUrls(diaries.flatMap(d => d.diary_photos.map(p => p.storage_path)));
    $('list').innerHTML = diaries.length ? diaries.map(d => `
      <article class="card entry">
        <h2>${esc(d.title)}</h2>
        <p class="meta">${esc(d.travel_date)}${d.mood ? ' · ' + esc(d.mood) : ''}${d.diary_place_links.length ? ' · ' + esc(d.diary_place_links.map(l => l.places?.name).filter(Boolean).join(', ')) : ''}</p>
        <p>${esc(d.body).replace(/\n/g, '<br>')}</p>
        <div class="thumbs">${d.diary_photos.sort((a, b) => a.position - b.position).map(p => urls.get(p.storage_path)
          ? `<figure><img src="${esc(urls.get(p.storage_path))}" alt="${esc(p.caption || d.title)}" loading="lazy"><figcaption>${esc(p.caption)}</figcaption></figure>` : '').join('')}</div>
        <div class="entry-actions">
          <button class="btn btn-small btn-secondary" data-edit="${esc(d.id)}" type="button">Edit</button>
          <button class="btn btn-small btn-danger" data-del="${esc(d.id)}" type="button">Delete</button>
        </div>
      </article>`).join('') : stateEmpty('No journal entries yet. Create your first one.');
  } catch (e) { console.error(e); $('list').innerHTML = '<div class="state state-error" role="alert">Could not load your journal.</div>'; }
}

function openEditor(d) {
  editing = d || null;
  $('ed-title').textContent = d ? 'Edit entry' : 'New entry';
  $('ed-t').value = d?.title || '';
  $('ed-d').value = d?.travel_date || new Date().toISOString().slice(0, 10);
  $('ed-m').value = d?.mood || '';
  $('ed-b').value = d?.body || '';
  const linked = new Set(d?.diary_place_links.map(l => l.place_id) || []);
  const pre = new URLSearchParams(location.search).get('place_id');
  if (!d && isUuid(pre)) linked.add(pre);
  [...$('ed-p').options].forEach(o => { o.selected = linked.has(o.value); });
  $('ed-f').value = ''; $('ed-new').innerHTML = ''; $('ed-msg').hidden = true;
  $('ed-existing').innerHTML = (d?.diary_photos || []).map(p =>
    `<figure><figcaption>${esc(p.caption || 'Photo')}</figcaption><button class="btn btn-small btn-danger" data-rm="${esc(p.id)}" type="button">Remove</button></figure>`).join('');
  $('editor').showModal();
}

$('ed-f').addEventListener('change', () => {
  $('ed-new').innerHTML = [...$('ed-f').files].map((f, i) => {
    const err = validatePhoto(f);
    return `<div class="form-field"><label for="cap-${i}">${esc(f.name)}${err ? ` — <span class="field-error">${esc(err)}</span>` : ' caption'}</label>
      <input id="cap-${i}" data-cap="${i}" maxlength="300" ${err ? 'disabled' : ''}></div>`;
  }).join('');
});

$('ed-existing').addEventListener('click', async e => {
  const b = e.target.closest('[data-rm]');
  if (!b || !editing) return;
  const photo = editing.diary_photos.find(p => p.id === b.dataset.rm);
  if (!photo || !(await confirmDialog({ title: 'Remove photo', message: 'Delete this photo permanently?', confirmLabel: 'Delete', danger: true }))) return;
  try { await deletePhoto(photo); editing.diary_photos = editing.diary_photos.filter(p => p !== photo); b.closest('figure').remove(); }
  catch { toast('Could not remove the photo.', 'error'); }
});

$('ed-form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('ed-msg');
  const title = $('ed-t').value.trim(), date = $('ed-d').value;
  if (!title || !date) { msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Title and travel date are required.'; return; }
  const photos = [...$('ed-f').files].map((file, i) => ({ file, caption: document.querySelector(`[data-cap="${i}"]`)?.value.trim() }))
    .filter(p => !validatePhoto(p.file));
  $('ed-save').disabled = true;
  try {
    const { failed } = await saveDiary({
      id: editing?.id, userId: session.user.id, title, body: $('ed-b').value.trim(), travel_date: date, mood: $('ed-m').value.trim(),
      placeIds: [...$('ed-p').selectedOptions].map(o => o.value), photos, startPos: editing?.diary_photos.length || 0,
    });
    $('editor').close();
    toast(failed.length ? `Saved. ${failed.length} photo(s) failed: ${failed.join(', ')}` : 'Entry saved.', failed.length ? 'error' : 'ok');
    refresh();
  } catch (err) { console.error(err); msg.hidden = false; msg.className = 'alert alert-error'; msg.textContent = 'Could not save the entry.'; }
  finally { $('ed-save').disabled = false; }
});

$('list').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) openEditor(diaries.find(d => d.id === ed.dataset.edit));
  if (del) {
    const d = diaries.find(x => x.id === del.dataset.del);
    if (!d || !(await confirmDialog({ title: 'Delete entry', message: `Delete “${d.title}” and its photos?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await deleteDiary(d); toast('Entry deleted.'); refresh(); } catch { toast('Could not delete the entry.', 'error'); }
  }
});

$('new').addEventListener('click', () => openEditor(null));
$('ed-cancel').addEventListener('click', () => $('editor').close());
['f-from', 'f-to', 'f-place'].forEach(id => $(id).addEventListener('change', refresh));

(async () => {
  session = await requireAuth();
  if (!session) return;
  try {
    const { data, error } = await supabase.from('places').select('id, name').eq('status', 'published').order('name');
    if (error) throw error;
    places = data; fillPlaces();
  } catch (e) { console.error(e); }
  await refresh();
  const pre = new URLSearchParams(location.search).get('place_id');
  if (isUuid(pre)) openEditor(null);
})();
