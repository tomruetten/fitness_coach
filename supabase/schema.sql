-- Schema der Fitness-Coach-App. Im Supabase-SQL-Editor einmal ausführen.
-- Alle Tabellen tragen das Präfix fit_ und kollidieren damit nicht mit der alten App im selben Projekt.
-- Der Zugriff erfolgt ausschließlich serverseitig über den Service-Key; RLS ist aktiv und ohne Policies,
-- damit der öffentliche anon-Key nichts lesen kann.

create table if not exists fit_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists fit_activities (
  id bigint primary key,                 -- Garmin-Aktivitäts-ID
  start_time timestamptz not null,
  local_date date not null,
  sport text not null,                   -- running | cycling | strength | swimming | tennis | other
  sub_sport text,
  indoor boolean not null default false,
  duration_s integer not null default 0,
  distance_m integer not null default 0,
  avg_hr integer, max_hr integer,
  avg_cadence real, avg_power real, ascent_m real,
  te_aerobic real, te_anaerobic real,
  rpe real, feel integer,
  gct_ms real, vo_mm real, step_len_m real, vert_ratio real,
  zone_s jsonb,                          -- Sekunden je Zone [Z1..Z5]
  load real,
  best jsonb,                            -- beste 20/30-min-Anstrengung (Läufe)
  km_splits jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fit_activities_date on fit_activities (local_date desc);

create table if not exists fit_daily_health (
  date date primary key,
  resting_hr integer,
  hrv_avg real, hrv_status text,
  sleep_s integer, sleep_deep_s integer, sleep_avg_hr real,
  body_battery_max integer, body_battery_min integer,
  stress_avg integer, steps integer,
  updated_at timestamptz not null default now()
);

create table if not exists fit_strength_log (
  id bigserial primary key,
  date date not null,
  exercise_id text not null,
  sets integer, reps text,
  weight_kg real,
  done_all boolean not null default true,
  rpe real,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists fit_strength_log_ex on fit_strength_log (exercise_id, date desc);

create table if not exists fit_pain (
  id bigserial primary key,
  date date not null,
  level integer not null check (level between 0 and 10),
  area text,
  created_at timestamptz not null default now()
);

create table if not exists fit_passkeys (
  id text primary key,                   -- Credential-ID (base64url)
  public_key text not null,              -- base64url
  counter bigint not null default 0,
  transports text[],
  label text,
  created_at timestamptz not null default now()
);

create table if not exists fit_challenges (
  id text primary key,
  challenge text not null,
  kind text not null,                    -- register | login
  expires_at timestamptz not null
);

create table if not exists fit_login_attempts (
  ip text primary key,
  fails integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table fit_settings enable row level security;
alter table fit_activities enable row level security;
alter table fit_daily_health enable row level security;
alter table fit_strength_log enable row level security;
alter table fit_pain enable row level security;
alter table fit_passkeys enable row level security;
alter table fit_challenges enable row level security;
alter table fit_login_attempts enable row level security;
