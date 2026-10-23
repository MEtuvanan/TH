-- 005_trips_achievements: trips, trip_stops, achievements, user_achievements, ai_trip_requests

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  start_date date,
  total_days int not null default 1 check (total_days between 1 and 30),
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_user_idx on public.trips(user_id, created_at desc);
create trigger trg_trips_updated before update on public.trips
  for each row execute function public.set_updated_at();

create table public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.places(id),
  day_number int not null default 1 check (day_number between 1 and 30),
  stop_order int not null default 1 check (stop_order between 1 and 50),
  suggested_time text,
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index trip_stops_trip_idx on public.trip_stops(trip_id, day_number, stop_order);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  icon_url text,
  token_reward int not null default 0 check (token_reward >= 0),
  created_at timestamptz not null default now()
);

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table public.ai_trip_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  prompt_params jsonb not null,
  result_summary jsonb,
  created_at timestamptz not null default now()
);
create index ai_trip_requests_user_idx on public.ai_trip_requests(user_id, created_at desc);

alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.ai_trip_requests enable row level security;

create policy trips_owner on public.trips for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy trip_stops_owner on public.trip_stops for all
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

create policy achievements_read on public.achievements for select using (true);
create policy achievements_admin on public.achievements for all
  using (public.is_admin()) with check (public.is_admin());

create policy user_achievements_read on public.user_achievements for select
  using (user_id = auth.uid() or public.is_admin());

create policy ai_requests_read on public.ai_trip_requests for select
  using (user_id = auth.uid() or public.is_admin());
-- (The insert policy is tightened in 007: anonymous inserts are not allowed.)
create policy ai_requests_insert on public.ai_trip_requests for insert
  with check (user_id = auth.uid() or auth.uid() is null);

insert into public.achievements (slug, title, description, token_reward) values
  ('first_step', 'First Steps', 'Complete your first quest.', 50),
  ('temple_wanderer', 'Sacred Explorer', 'Complete quests at 3 different temples.', 100),
  ('journal_keeper', 'Memory Maker', 'Write your first travel diary entry.', 30),
  ('bangkok_master', 'Bangkok Trailblazer', 'Complete 5 different Bangkok quests.', 200)
on conflict (slug) do nothing;
