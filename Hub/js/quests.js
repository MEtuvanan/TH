import { supabase } from './supabase.js';
import { getSession } from './auth.js';

// Only columns guaranteed to exist in the current DB schema.
// completion_method & instructions are added by migration 007 which may not have run yet.
const COLS = 'id, title, description, type, difficulty, starts_at, ends_at, reward_tokens, reward_character_id';

// Fetch quests — include draft so they appear before admin publishes them
export async function listQuests() {
  let { data, error } = await supabase.from('quests')
    .select(`${COLS}, quest_places(place_id, places(name)), campaign_quests(campaign_id)`)
    .in('status', ['published', 'draft'])
    .order('title');
  if (error) throw error;
  // Normalise: ensure arrays exist and derive completion_method from type
  return (data || []).map(q => ({
    ...q,
    quest_places: q.quest_places || [],
    campaign_quests: q.campaign_quests || [],
    // If completion_method column doesn't exist yet, derive from type
    completion_method: q.completion_method ?? (q.type === 'code' ? 'code' : 'quiz'),
    instructions: q.instructions ?? null,
  }));
}

export async function listQuestsForPlace(placeId) {
  const { data, error } = await supabase.from('quest_places')
    .select('quests(id, title, difficulty, reward_tokens)').eq('place_id', placeId);
  if (error) throw error;
  return data.map(r => r.quests).filter(Boolean);
}

export async function getQuestQuestions(questId) {
  const { data, error } = await supabase.from('quest_questions')
    .select('id, prompt, position, quest_options(id, label, position)')
    .eq('quest_id', questId).order('position');
  if (error) throw error;
  data.forEach(q => q.quest_options.sort((a, b) => a.position - b.position));
  return data;
}

export async function myProgress() {
  // Works for both real Supabase sessions and guest sessions
  const session = await getSession();
  if (!session || session.guest) return new Map();
  const { data: { session: sbSession } } = await supabase.auth.getSession();
  if (!sbSession) return new Map();
  const { data, error } = await supabase.from('user_quests').select('quest_id, status');
  if (error) return new Map();
  return new Map(data.map(r => [r.quest_id, r.status]));
}

export const startQuest = id => supabase.rpc('start_quest', { p_quest_id: id });
export const completeQuest = (id, answers, code) =>
  supabase.rpc('complete_quest', { p_quest_id: id, p_answers: answers || {}, p_code: code || null });
