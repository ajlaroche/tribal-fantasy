-- Tribal Fantasy — pick reminder emails. Run AFTER schema.sql (safe to re-run).
-- Players may add an email; 24h before each lock the send-reminders Edge Function emails
-- everyone who hasn't picked yet (via Resend). Only the commissioner can read emails.

alter table managers add column if not exists email text;
alter table managers add column if not exists email_reminders boolean not null default true;

-- One row per reminder sent, so nobody gets the same reminder twice. Service role only.
create table if not exists reminders_sent (
  episode    int  not null references episodes (number) on delete cascade,
  manager_id uuid not null references managers (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (episode, manager_id)
);
alter table reminders_sent enable row level security;

create or replace function clean_email(p_email text) returns text
language plpgsql immutable as $$
declare v text := lower(trim(coalesce(p_email, '')));
begin
  if v = '' then return null; end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v) > 200 then
    raise exception 'That email address doesn''t look right';
  end if;
  return v;
end $$;

-- join_league now takes an optional email (4th argument).
drop function if exists join_league(text, text, text);
create or replace function join_league(p_code text, p_name text, p_pin text, p_email text default null) returns uuid
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
  insert into managers (name, pin_hash, email) values (v_name, crypt(p_pin, gen_salt('bf')), clean_email(p_email))
  returning id into v_id;
  return v_id;
end $$;

-- A player sets, changes or removes (empty) their email, and turns reminders on/off.
create or replace function set_my_email(p_name text, p_pin text, p_email text, p_reminders boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := check_manager(p_name, p_pin);
begin
  update managers set email = clean_email(p_email), email_reminders = coalesce(p_reminders, true) where id = v_id;
end $$;

-- my_picks also returns the player's own email settings.
create or replace function my_picks(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := check_manager(p_name, p_pin);
begin
  return jsonb_build_object(
    'id', v_id,
    'name', (select name from managers where id = v_id),
    'email', (select email from managers where id = v_id),
    'email_reminders', (select email_reminders from managers where id = v_id),
    'picks', coalesce((select jsonb_agg(to_jsonb(p) - 'manager_id' - 'updated_at')
                         from picks p where p.manager_id = v_id), '[]'::jsonb),
    'winner', (select to_jsonb(w) - 'manager_id' - 'updated_at' from winner_picks w where w.manager_id = v_id)
  );
end $$;

grant execute on function join_league(text, text, text, text), set_my_email(text, text, text, boolean),
  my_picks(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- hourly schedule
-- Calls the send-reminders Edge Function every hour, on the hour.
-- The function itself only emails players whose episode locks within 24h and who
-- haven't picked or been reminded yet, so extra runs are harmless.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-reminders') where exists (select 1 from cron.job where jobname = 'send-reminders');
select cron.schedule('send-reminders', '0 * * * *', $cron$
  select net.http_post(
    url     := 'https://pkvjzreeglijxdpxodcl.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrdmp6cmVlZ2xpanhkcHhvZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMDE0NjQsImV4cCI6MjEwOTY3NzQ2NH0.CPxOZ1fw8J8mwN5LKv1HytNs7h48NG6k6D6elpm-V3M'),
    body    := '{}'::jsonb
  );
$cron$);
