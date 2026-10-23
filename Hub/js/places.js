import { supabase } from './supabase.js';
import { isUuid } from './ui.js';

export { isUuid };

const LIST_COLS = 'id, name, summary, lat, lng, province_id, district_id, category_id, status';

// Select places (published or draft fallback for preview), sorted by name
export async function listPlaces({ search, provinceId, districtId, categoryId } = {}) {
  let q = supabase.from('places').select(LIST_COLS).in('status', ['published', 'draft']).order('name');
  if (provinceId) q = q.eq('province_id', provinceId);
  if (districtId) q = q.eq('district_id', districtId);
  if (categoryId) q = q.eq('category_id', categoryId);
  const term = (search || '').trim().replace(/[%,()*\\]/g, ' ').slice(0, 80);
  if (term) q = q.or(`name.ilike.%${term}%,summary.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getFilterOptions() {
  const [p, d, c] = await Promise.all([
    supabase.from('provinces').select('id, name_en').order('name_en'),
    supabase.from('districts').select('id, province_id, name_en').order('name_en'),
    supabase.from('place_categories').select('id, name').order('name'),
  ]);
  for (const r of [p, d, c]) if (r.error) throw r.error;
  return { provinces: p.data, districts: d.data, categories: c.data };
}

export async function getPlace(id) {
  if (!isUuid(id)) throw new Error('invalid id');
  const { data, error } = await supabase.from('places')
    .select(`*, provinces(name_en), districts(name_en), place_categories(name), place_images(url, alt, position)`)
    .eq('id', id).eq('status', 'published').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.place_images.sort((a, b) => a.position - b.position);
  return data;
}

// Public counts used for "has quests / campaigns" indicators.
export async function getPlaceIndicators() {
  const [q, c] = await Promise.all([
    supabase.from('quest_places').select('place_id'),
    supabase.from('campaign_places').select('place_id'),
  ]);
  const toSet = r => new Set((r.data || []).map(x => x.place_id));
  return { quests: toSet(q), campaigns: toSet(c) };
}
