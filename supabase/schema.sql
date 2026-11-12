-- Tribal Fantasy v1 — Supabase schema
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to re-run on an empty project. See README.md for the follow-up steps.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists league (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'Tribal Fantasy',
  scoring       jsonb not null default
    '{"boot":5,"immunity":3,"idol":2,"safe":1,"winner":15,"winnerChangePenalty":1,"winnerMin":5}',
  merged        boolean not null default false,
  winner_locked boolean not null default false,
  admin_uid     uuid
);

-- Secrets live in their own table with no public read policy.
create table if not exists league_secrets (
  id             int primary key default 1 check (id = 1),
  join_code_hash text
);

create table if not exists castaways (
  id          serial primary key,
  name        text not null,
  tribe       text,
  status      text not null default 'in' check (status in ('in', 'out', 'winner')),
  out_episode int,
  photo_url   text            -- e.g. img/cast/rob.webp (relative to the site) or a full https URL
);
alter table castaways add column if not exists photo_url text;

create table if not exists episodes (
  number  int primary key,
  title   text,
  lock_at timestamptz not null,
  scored  boolean not null default false,
  -- {"votedOut":[castawayId...], "immunity":["c:12" | "t:TribeName" ...], "idolPlayed":true|false}
  results jsonb
);

create table if not exists managers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  pin_hash   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists managers_name_lower on managers (lower(name));

create table if not exists picks (
  manager_id uuid not null references managers (id) on delete cascade,
  episode    int  not null references episodes (number) on delete cascade,
  boot       int references castaways (id) on delete set null,
  immunity   text,              -- "c:<castawayId>" or "t:<tribe>"
  idol       boolean,
  safe       int references castaways (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (manager_id, episode)
);

create table if not exists winner_picks (
  manager_id  uuid primary key references managers (id) on delete cascade,
  castaway_id int references castaways (id) on delete set null,
  changes     int not null default 0,
  updated_at  timestamptz not null default now()
);

insert into league (id) values (1) on conflict do nothing;
insert into league_secrets (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- helpers

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where admin_uid is not null and admin_uid = auth.uid());
$$;

-- Returns the manager id for a name + PIN, or raises. Internal only.
create or replace function check_manager(p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from managers
   where lower(name) = lower(trim(p_name)) and pin_hash = crypt(p_pin, pin_hash);
  if v_id is null then
    raise exception 'Wrong name or PIN';
  end if;
  return v_id;
end $$;
revoke execute on function check_manager(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS

alter table league         enable row level security;
alter table league_secrets enable row level security;
alter table castaways      enable row level security;
alter table episodes       enable row level security;
alter table managers       enable row level security;
alter table picks          enable row level security;
alter table winner_picks   enable row level security;

drop policy if exists "read league" on league;
create policy "read league" on league for select using (true);
drop policy if exists "admin league" on league;
create policy "admin league" on league for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "read castaways" on castaways;
create policy "read castaways" on castaways for select using (true);
drop policy if exists "admin castaways" on castaways;
create policy "admin castaways" on castaways for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "read episodes" on episodes;
create policy "read episodes" on episodes for select using (true);
drop policy if exists "admin episodes" on episodes;
create policy "admin episodes" on episodes for all to authenticated using (is_admin()) with check (is_admin());

-- Once an episode's lock time has passed, it can never be moved back into the future
-- (that would reopen picks after people may have seen the episode).
create or replace function episodes_no_reopen() returns trigger
language plpgsql as $$
begin
  if old.lock_at <= now() and new.lock_at > now() then
    raise exception 'Episode % is already locked; its lock time cannot be moved later', old.number;
  end if;
  return new;
end $$;
drop trigger if exists episodes_no_reopen on episodes;
create trigger episodes_no_reopen before update of lock_at on episodes
  for each row execute function episodes_no_reopen();

-- managers / picks / winner_picks / league_secrets: no public policies at all.
-- Players go through the functions below; the commissioner may delete managers.
-- (A DELETE with a WHERE clause also needs a SELECT policy, hence both.)
drop policy if exists "admin managers" on managers;
create policy "admin managers" on managers for delete to authenticated using (is_admin());
drop policy if exists "admin read managers" on managers;
create policy "admin read managers" on managers for select to authenticated using (is_admin());

-- ---------------------------------------------------------------- public views
-- Views run with the owner's rights, so they expose only the columns listed.

create or replace view manager_list as
  select id, name, created_at from managers;

-- Picks become visible to everyone only once the episode has locked.
create or replace view revealed_picks as
  select p.manager_id, p.episode, p.boot, p.immunity, p.idol, p.safe
    from picks p join episodes e on e.number = p.episode
   where e.lock_at <= now();

create or replace view winner_pick_list as
  select manager_id, castaway_id, changes from winner_picks;

grant select on manager_list, revealed_picks, winner_pick_list to anon, authenticated;

-- ---------------------------------------------------------------- player functions

create or replace function join_league(p_code text, p_name text, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_id uuid; v_name text := trim(p_name);
begin
  select join_code_hash into v_hash from league_secrets where id = 1;
  if v_hash is null then raise exception 'The commissioner has not set a join code yet'; end if;
  if crypt(upper(trim(p_code)), v_hash) <> v_hash then raise exception 'Wrong join code'; end if;
  if length(v_name) < 1 or length(v_name) > 24 then raise exception 'Name must be 1-24 characters'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'PIN must be 4 digits'; end if;
  if exists (select 1 from managers where lower(name) = lower(v_name)) then
    raise exception 'That name is taken — pick another or sign in';
  end if;
  insert into managers (name, pin_hash) values (v_name, crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end $$;

create or replace function my_picks(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := check_manager(p_name, p_pin);
begin
  return jsonb_build_object(
    'id', v_id,
    'name', (select name from managers where id = v_id),
    'picks', coalesce((select jsonb_agg(to_jsonb(p) - 'manager_id' - 'updated_at')
                         from picks p where p.manager_id = v_id), '[]'::jsonb),
    'winner', (select to_jsonb(w) - 'manager_id' - 'updated_at' from winner_picks w where w.manager_id = v_id)
  );
end $$;

create or replace function submit_picks(
  p_name text, p_pin text, p_episode int,
  p_boot int, p_immunity text, p_idol boolean, p_safe int
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := check_manager(p_name, p_pin);
  v_lock timestamptz;
  v_prev_safe int;
begin
  select lock_at into v_lock from episodes where number = p_episode;
  if v_lock is null then raise exception 'No such episode'; end if;
  if now() >= v_lock then raise exception 'Picks for this episode are locked'; end if;

  if p_boot is not null and not exists (select 1 from castaways where id = p_boot and status = 'in') then
    raise exception 'Boot pick must be a castaway still in the game';
  end if;
  if p_safe is not null and not exists (select 1 from castaways where id = p_safe and status = 'in') then
    raise exception 'Safe pick must be a castaway still in the game';
  end if;
  if p_boot is not null and p_boot = p_safe then
    raise exception 'Your boot pick and safe pick can''t be the same person';
  end if;

  select safe into v_prev_safe from picks
   where manager_id = v_id and episode < p_episode
   order by episode desc limit 1;
  if p_safe is not null and p_safe = v_prev_safe then
    raise exception 'You used that safe pick last week — choose someone else';
  end if;

  insert into picks (manager_id, episode, boot, immunity, idol, safe, updated_at)
  values (v_id, p_episode, p_boot, p_immunity, p_idol, p_safe, now())
  on conflict (manager_id, episode) do update
     set boot = excluded.boot, immunity = excluded.immunity, idol = excluded.idol,
         safe = excluded.safe, updated_at = now();
end $$;

create or replace function set_winner_pick(p_name text, p_pin text, p_castaway int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := check_manager(p_name, p_pin);
begin
  if (select winner_locked from league where id = 1) then
    raise exception 'Sole Survivor picks are locked';
  end if;
  if not exists (select 1 from castaways where id = p_castaway and status = 'in') then
    raise exception 'Pick a castaway still in the game';
  end if;
  insert into winner_picks (manager_id, castaway_id) values (v_id, p_castaway)
  on conflict (manager_id) do update
     set changes = winner_picks.changes + case when winner_picks.castaway_id is distinct from excluded.castaway_id then 1 else 0 end,
         castaway_id = excluded.castaway_id,
         updated_at = now();
end $$;

-- ---------------------------------------------------------------- commissioner functions

create or replace function set_join_code(p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Commissioner only'; end if;
  if length(trim(p_code)) < 4 then raise exception 'Join code must be at least 4 characters'; end if;
  update league_secrets set join_code_hash = crypt(upper(trim(p_code)), gen_salt('bf')) where id = 1;
end $$;

create or replace function reset_pin(p_manager uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Commissioner only'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'PIN must be 4 digits'; end if;
  update managers set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_manager;
end $$;

revoke execute on function set_join_code(text), reset_pin(uuid, text) from public, anon;
grant execute on function join_league(text, text, text), my_picks(text, text),
  submit_picks(text, text, int, int, text, boolean, int), set_winner_pick(text, text, int)
  to anon, authenticated;
grant execute on function set_join_code(text), reset_pin(uuid, text) to authenticated;
