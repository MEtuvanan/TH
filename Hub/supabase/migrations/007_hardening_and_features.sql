-- 007_hardening_and_features
-- Fixes found in review of 001-006 and adds the missing spec features.
-- Safe to apply on top of 001-006.

-- =====================================================================
-- 1. places: spec fields. NULL on opening_hours / entry_fee / accessibility
--    means "not verified" and the UI must say so.
-- =====================================================================
alter table public.places
  add column if not exists slug text,
  add column if not exists subdistrict text,
  add column if not exists opening_hours text,
  add column if not exists entry_fee text,
  add column if not exists accessibility_info text;

update public.places
   set slug = lower(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')) || '-' || left(id::text, 6)
 where slug is null;
alter table public.places alter column slug set not null;
create unique index if not exists places_slug_key on public.places(slug);

create or replace function public.places_default_slug() returns trigger
language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := trim(both '-' from lower(regexp_replace(new.name, '[^A-Za-z0-9]+', '-', 'g'))) || '-' || left(new.id::text, 6);
  end if;
  return new;
end $$;
create trigger trg_places_slug before insert on public.places
  for each row execute function public.places_default_slug();

-- =====================================================================
-- 2. quests: spec quest types. `type` is the content category;
--    `completion_method` is how the server verifies completion.
-- =====================================================================
alter table public.quests add column if not exists completion_method text;
update public.quests set completion_method = type where completion_method is null;
alter table public.quests alter column completion_method set not null;
alter table public.quests alter column completion_method set default 'quiz';
alter table public.quests add constraint quests_completion_method_check
  check (completion_method in ('quiz','code'));

alter table public.quests drop constraint if exists quests_type_check;
alter table public.quests add constraint quests_type_check check (type in
  ('exploration','quiz','culture','history','photo','multi_destination','campaign','code'));
-- Instructions shown to the player.
alter table public.quests add column if not exists instructions text;

-- =====================================================================
-- 3. Anti-brute-force: failed attempts are recorded and rate-limited,
--    and a failed attempt no longer reveals how many answers were right.
-- =====================================================================
create table public.quest_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id uuid not null references public.quests(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index quest_attempts_lookup_idx on public.quest_attempts(user_id, quest_id, created_at desc);
alter table public.quest_attempts enable row level security;  -- no policies: server-only

-- =====================================================================
-- 4. Achievements are data-driven and evaluated against real records.
-- =====================================================================
alter table public.achievements
  add column if not exists criteria_type text
    check (criteria_type in ('quests_completed','places_visited','category_places','campaigns_completed','diaries_written')),
  add column if not exists criteria_count int check (criteria_count > 0),
  add column if not exists criteria_category text;

update public.achievements set criteria_type='quests_completed', criteria_count=1 where slug='first_step';
update public.achievements set criteria_type='category_places', criteria_count=3, criteria_category='temple' where slug='temple_wanderer';
update public.achievements set criteria_type='diaries_written', criteria_count=1 where slug='journal_keeper';
update public.achievements set criteria_type='quests_completed', criteria_count=5 where slug='bangkok_master';
insert into public.achievements (slug, title, description, token_reward, criteria_type, criteria_count) values
  ('explorer_5', 'Destination Hopper', 'Complete quests at 5 different destinations.', 75, 'places_visited', 5),
  ('campaigner', 'Campaign Finisher', 'Complete a campaign.', 100, 'campaigns_completed', 1)
on conflict (slug) do nothing;

-- =====================================================================
-- 5. Campaign rewards and completion
-- =====================================================================
alter table public.campaigns
  add column if not exists reward_tokens int not null default 0 check (reward_tokens between 0 and 1000),
  add column if not exists reward_character_id uuid references public.characters(id),
  add column if not exists required_quests int check (required_quests is null or required_quests > 0);

create table public.campaign_completions (
  campaign_id uuid not null references public.campaigns(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
alter table public.campaign_completions enable row level security;
create policy ccomp_read_own on public.campaign_completions for select using (user_id = auth.uid() or public.is_admin());

-- =====================================================================
-- 6. Characters: optional token price
-- =====================================================================
alter table public.characters add column if not exists unlock_cost int check (unlock_cost is null or unlock_cost > 0);
-- token_transactions has no INSERT policy, so clients cannot write; only the
-- security-definer functions below do.

-- =====================================================================
-- 7. Server-side logic
-- =====================================================================
create or replace function public.evaluate_achievements(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a record; n int;
begin
  for a in select * from public.achievements
           where criteria_type is not null
             and id not in (select achievement_id from public.user_achievements where user_id = p_user)
  loop
    n := case a.criteria_type
      when 'quests_completed' then
        (select count(*) from public.user_quests where user_id = p_user and status = 'completed')
      when 'places_visited' then
        (select count(distinct qp.place_id) from public.user_quests u
           join public.quest_places qp on qp.quest_id = u.quest_id
          where u.user_id = p_user and u.status = 'completed')
      when 'category_places' then
        (select count(distinct qp.place_id) from public.user_quests u
           join public.quest_places qp on qp.quest_id = u.quest_id
           join public.places p on p.id = qp.place_id
           join public.place_categories c on c.id = p.category_id
          where u.user_id = p_user and u.status = 'completed' and c.slug = a.criteria_category)
      when 'campaigns_completed' then
        (select count(*) from public.campaign_completions where user_id = p_user)
      when 'diaries_written' then
        (select count(*) from public.travel_diaries where user_id = p_user)
      else 0 end;
    if n >= a.criteria_count then
      insert into public.user_achievements (user_id, achievement_id) values (p_user, a.id)
        on conflict do nothing;
      if found and a.token_reward > 0 then
        insert into public.token_transactions (user_id, amount, source_type, source_id)
          values (p_user, a.token_reward, 'achievement', a.id) on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;

create or replace function public.diary_created_achievements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_achievements(new.user_id);
  return new;
end $$;
create trigger trg_diary_achievements after insert on public.travel_diaries
  for each row execute function public.diary_created_achievements();

-- Hardened completion: rate-limited, no per-question feedback, evaluates achievements.
create or replace function public.complete_quest(p_quest_id uuid, p_answers jsonb default '{}', p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q public.quests;
  uq public.user_quests;
  total int; correct int;
  ok boolean := false;
  recent_fails int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into q from public.quests where id = p_quest_id;
  if not found or not public.quest_is_open(q) then raise exception 'quest not available'; end if;

  insert into public.user_quests (user_id, quest_id) values (uid, p_quest_id)
    on conflict (user_id, quest_id) do nothing;
  -- Row lock serialises concurrent completions for the same user+quest.
  select * into uq from public.user_quests where user_id = uid and quest_id = p_quest_id for update;
  if uq.status = 'completed' then
    return jsonb_build_object('ok', true, 'already_completed', true, 'tokens', 0);
  end if;

  select count(*) into recent_fails from public.quest_attempts
   where user_id = uid and quest_id = p_quest_id and created_at > now() - interval '10 minutes';
  if recent_fails >= 5 then
    return jsonb_build_object('ok', false, 'locked', true, 'retry_after_minutes', 10);
  end if;

  if q.completion_method = 'quiz' then
    select count(*) into total from public.quest_questions where quest_id = p_quest_id;
    select count(*) into correct
      from public.quest_questions qq
      where qq.quest_id = p_quest_id
        and exists (select 1 from public.quest_answer_keys k join public.quest_options o on o.id = k.option_id
                    where o.question_id = qq.id and o.id::text = p_answers ->> qq.id::text);
    ok := total > 0 and correct = total;
  else
    ok := p_code is not null and exists (
      select 1 from public.quest_secrets s
      where s.quest_id = p_quest_id and lower(trim(s.checkin_code)) = lower(trim(p_code)));
  end if;

  if not ok then
    insert into public.quest_attempts (user_id, quest_id) values (uid, p_quest_id);
    return jsonb_build_object('ok', false, 'locked', false);  -- deliberately no score
  end if;

  update public.user_quests set status = 'completed', completed_at = now() where id = uq.id;
  if q.reward_tokens > 0 then
    insert into public.token_transactions (user_id, amount, source_type, source_id)
      values (uid, q.reward_tokens, 'quest', p_quest_id) on conflict do nothing;
  end if;
  if q.reward_character_id is not null then
    insert into public.user_characters (user_id, character_id, source_quest_id)
      values (uid, q.reward_character_id, p_quest_id) on conflict do nothing;
  end if;
  perform public.evaluate_achievements(uid);
  return jsonb_build_object('ok', true, 'already_completed', false, 'tokens', q.reward_tokens,
                            'character_id', q.reward_character_id);
end $$;

-- Claim a campaign reward once, based on real quest completions.
create or replace function public.claim_campaign_reward(p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.campaigns;
  need int; done int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into c from public.campaigns where id = p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;
  if not exists (select 1 from public.campaign_participants where campaign_id = p_campaign_id and user_id = uid) then
    raise exception 'join the campaign first';
  end if;
  if exists (select 1 from public.campaign_completions where campaign_id = p_campaign_id and user_id = uid) then
    return jsonb_build_object('ok', true, 'already_completed', true);
  end if;
  if c.status not in ('published','ended') then raise exception 'campaign not available'; end if;

  select count(*) into need from public.campaign_quests where campaign_id = p_campaign_id;
  if c.required_quests is not null then need := least(need, c.required_quests); end if;
  select count(*) into done from public.campaign_quests cq
    join public.user_quests u on u.quest_id = cq.quest_id and u.user_id = uid and u.status = 'completed'
    -- only completions made during the campaign window count
    where cq.campaign_id = p_campaign_id
      and (c.starts_at is null or u.completed_at >= c.starts_at)
      and (c.ends_at is null or u.completed_at <= c.ends_at);
  if need = 0 or done < need then
    return jsonb_build_object('ok', false, 'completed', done, 'required', need);
  end if;

  insert into public.campaign_completions (campaign_id, user_id) values (p_campaign_id, uid) on conflict do nothing;
  if found then
    if c.reward_tokens > 0 then
      insert into public.token_transactions (user_id, amount, source_type, source_id)
        values (uid, c.reward_tokens, 'campaign', p_campaign_id) on conflict do nothing;
    end if;
    if c.reward_character_id is not null then
      insert into public.user_characters (user_id, character_id) values (uid, c.reward_character_id) on conflict do nothing;
    end if;
    perform public.evaluate_achievements(uid);
  end if;
  return jsonb_build_object('ok', true, 'already_completed', false, 'tokens', c.reward_tokens);
end $$;

-- Spend tokens on a character. Locking the profile row serialises a user's spends.
create or replace function public.unlock_character(p_character_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ch public.characters;
  bal bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into ch from public.characters where id = p_character_id and status = 'active';
  if not found or ch.unlock_cost is null then raise exception 'character cannot be unlocked with tokens'; end if;
  perform 1 from public.profiles where id = uid for update;
  if exists (select 1 from public.user_characters where user_id = uid and character_id = p_character_id) then
    return jsonb_build_object('ok', true, 'already_owned', true);
  end if;
  select coalesce(sum(amount), 0) into bal from public.token_transactions where user_id = uid;
  if bal < ch.unlock_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_tokens', 'balance', bal, 'cost', ch.unlock_cost);
  end if;
  insert into public.token_transactions (user_id, amount, source_type, source_id)
    values (uid, -ch.unlock_cost, 'unlock', p_character_id);
  insert into public.user_characters (user_id, character_id) values (uid, p_character_id);
  return jsonb_build_object('ok', true, 'already_owned', false, 'balance', bal - ch.unlock_cost);
end $$;

revoke all on function public.claim_campaign_reward(uuid), public.unlock_character(uuid) from public, anon;
grant execute on function public.claim_campaign_reward(uuid), public.unlock_character(uuid) to authenticated;
revoke all on function public.complete_quest(uuid, jsonb, text) from public, anon;
grant execute on function public.complete_quest(uuid, jsonb, text) to authenticated;

-- =====================================================================
-- 8. Policy / constraint fixes
-- =====================================================================
-- Anonymous callers could insert ai_trip_requests rows (auth.uid() is null).
drop policy if exists ai_requests_insert on public.ai_trip_requests;
create policy ai_requests_insert on public.ai_trip_requests for insert
  with check (user_id = auth.uid());

-- Reordering stops swaps positions inside one statement, so check at commit.
alter table public.trip_stops
  add constraint trip_stops_order_key unique (trip_id, day_number, stop_order) deferrable initially deferred;

-- Audit also covers achievements and the new unlock price column via characters trigger.
create trigger audit_achievements after insert or update or delete on public.achievements
  for each row execute function public.log_audit();
