-- 002_quests_rewards: quests, quizzes, ledger, characters. All reward writes go through complete_quest().

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  rarity text not null default 'common' check (rarity in ('common','rare','epic')),
  unlock_hint text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  type text not null default 'quiz' check (type in ('quiz','code')),
  difficulty text not null default 'easy' check (difficulty in ('easy','medium','hard')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  reward_tokens int not null default 0 check (reward_tokens between 0 and 500),
  reward_character_id uuid references public.characters(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index quests_status_idx on public.quests(status);
create trigger trg_quests_updated before update on public.quests
  for each row execute function public.set_updated_at();

create table public.quest_places (
  quest_id uuid not null references public.quests(id) on delete cascade,
  place_id uuid not null references public.places(id),
  primary key (quest_id, place_id)
);
create index quest_places_place_idx on public.quest_places(place_id);

create table public.quest_questions (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  position int not null default 0,
  prompt text not null
);
create table public.quest_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quest_questions(id) on delete cascade,
  label text not null,
  position int not null default 0
);
-- Correct answers live apart from options so clients can never read them.
create table public.quest_answer_keys (
  option_id uuid primary key references public.quest_options(id) on delete cascade
);
-- Check-in codes (e.g. QR content) for 'code' quests. Admin-only.
create table public.quest_secrets (
  quest_id uuid primary key references public.quests(id) on delete cascade,
  checkin_code text not null check (char_length(checkin_code) >= 4)
);

create table public.user_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id uuid not null references public.quests(id),
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, quest_id)
);

-- Append-only ledger; unique key makes granting idempotent.
create table public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null,
  source_type text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);
create table public.user_characters (
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  source_quest_id uuid references public.quests(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, character_id)
);

-- ---------- RLS ----------
alter table public.characters enable row level security;
alter table public.quests enable row level security;
alter table public.quest_places enable row level security;
alter table public.quest_questions enable row level security;
alter table public.quest_options enable row level security;
alter table public.quest_answer_keys enable row level security;
alter table public.quest_secrets enable row level security;
alter table public.user_quests enable row level security;
alter table public.token_transactions enable row level security;
alter table public.user_characters enable row level security;

create or replace function public.quest_is_open(q public.quests) returns boolean
language sql stable as $$
  select q.status = 'published'
     and (q.starts_at is null or q.starts_at <= now())
     and (q.ends_at is null or q.ends_at > now());
$$;

create policy characters_read on public.characters for select using (status = 'active' or public.is_admin());
create policy characters_admin on public.characters for all using (public.is_admin()) with check (public.is_admin());

create policy quests_read on public.quests for select using (public.quest_is_open(quests) or public.is_admin());
create policy quests_admin on public.quests for all using (public.is_admin()) with check (public.is_admin());

create policy quest_places_read on public.quest_places for select using (
  public.is_admin() or exists (select 1 from public.quests q where q.id = quest_id and public.quest_is_open(q)));
create policy quest_places_admin on public.quest_places for all using (public.is_admin()) with check (public.is_admin());

create policy qq_read on public.quest_questions for select using (
  public.is_admin() or exists (select 1 from public.quests q where q.id = quest_id and public.quest_is_open(q)));
create policy qq_admin on public.quest_questions for all using (public.is_admin()) with check (public.is_admin());

create policy qo_read on public.quest_options for select using (
  public.is_admin() or exists (select 1 from public.quest_questions qq join public.quests q on q.id = qq.quest_id
    where qq.id = question_id and public.quest_is_open(q)));
create policy qo_admin on public.quest_options for all using (public.is_admin()) with check (public.is_admin());

create policy qak_admin on public.quest_answer_keys for all using (public.is_admin()) with check (public.is_admin());
create policy qs_admin on public.quest_secrets for all using (public.is_admin()) with check (public.is_admin());

-- Users read their own progress/rewards; no client writes at all.
create policy uq_read_own on public.user_quests for select using (user_id = auth.uid() or public.is_admin());
create policy tt_read_own on public.token_transactions for select using (user_id = auth.uid() or public.is_admin());
create policy uc_read_own on public.user_characters for select using (user_id = auth.uid() or public.is_admin());

-- ---------- RPCs ----------
create or replace function public.start_quest(p_quest_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quests;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into q from public.quests where id = p_quest_id;
  if not found or not public.quest_is_open(q) then raise exception 'quest not available'; end if;
  insert into public.user_quests (user_id, quest_id) values (auth.uid(), p_quest_id)
    on conflict (user_id, quest_id) do nothing;
end $$;

-- p_answers: {"<question_id>": "<option_id>", ...}; p_code: check-in code for 'code' quests.
-- (Superseded by the hardened version in 007.)
create or replace function public.complete_quest(p_quest_id uuid, p_answers jsonb default '{}', p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q public.quests;
  uq public.user_quests;
  total int; correct int;
  ok boolean := false;
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

  if q.type = 'quiz' then
    select count(*) into total from public.quest_questions where quest_id = p_quest_id;
    select count(*) into correct
      from public.quest_questions qq
      where qq.quest_id = p_quest_id
        and exists (select 1 from public.quest_answer_keys k join public.quest_options o on o.id = k.option_id
                    where o.question_id = qq.id and o.id::text = p_answers ->> qq.id::text);
    ok := total > 0 and correct = total;
  elsif q.type = 'code' then
    ok := p_code is not null and exists (
      select 1 from public.quest_secrets s
      where s.quest_id = p_quest_id and lower(trim(s.checkin_code)) = lower(trim(p_code)));
  end if;

  if not ok then
    return jsonb_build_object('ok', false, 'correct', coalesce(correct, 0), 'total', coalesce(total, 0));
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
  return jsonb_build_object('ok', true, 'already_completed', false, 'tokens', q.reward_tokens,
                            'character_id', q.reward_character_id);
end $$;

create or replace function public.my_token_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.token_transactions where user_id = auth.uid();
$$;

revoke all on function public.start_quest(uuid), public.complete_quest(uuid, jsonb, text), public.my_token_balance() from public, anon;
grant execute on function public.start_quest(uuid), public.complete_quest(uuid, jsonb, text), public.my_token_balance() to authenticated;
