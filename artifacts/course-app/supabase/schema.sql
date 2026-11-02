-- English course access and administration schema for Supabase.
-- Before running this file, replace the quoted admin email placeholder near
-- the end with the administrator account already created in Supabase Auth.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.course_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.course_learners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  email text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create unique index if not exists course_learners_email_lower_unique
  on public.course_learners (lower(email));

create table if not exists public.course_learner_access_codes (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.course_learners (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists course_learner_one_pending_code
  on public.course_learner_access_codes (learner_id)
  where redeemed_at is null and revoked_at is null;

create table if not exists public.course_learner_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.course_learners (id) on delete cascade,
  session_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists course_learner_sessions_active_by_learner
  on public.course_learner_sessions (learner_id, last_seen_at desc)
  where revoked_at is null;

create table if not exists public.course_learner_login_attempts (
  email text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  blocked_until timestamptz
);

-- Keep the rate-limit table bounded to accounts that an administrator created.
insert into public.course_learner_login_attempts (email)
select lower(email)
from public.course_learners
on conflict (email) do nothing;

alter table public.course_admins enable row level security;
alter table public.course_learners enable row level security;
alter table public.course_learner_access_codes enable row level security;
alter table public.course_learner_sessions enable row level security;
alter table public.course_learner_login_attempts enable row level security;

-- Browser roles cannot read or write these tables directly. All access goes
-- through the restricted functions below.
revoke all on table public.course_admins from public, anon, authenticated;
revoke all on table public.course_learners from public, anon, authenticated;
revoke all on table public.course_learner_access_codes from public, anon, authenticated;
revoke all on table public.course_learner_sessions from public, anon, authenticated;
revoke all on table public.course_learner_login_attempts from public, anon, authenticated;

create or replace function public.is_course_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_admins as admins
    where admins.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_course_admin() from public, anon, authenticated;

create or replace function public.admin_list_learners()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_learners jsonb;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', learners.id,
        'name', learners.name,
        'email', learners.email,
        'created_at', learners.created_at,
        'active_session', exists (
          select 1
          from public.course_learner_sessions as sessions
          where sessions.learner_id = learners.id
            and sessions.revoked_at is null
        ),
        'pending_code', exists (
          select 1
          from public.course_learner_access_codes as codes
          where codes.learner_id = learners.id
            and codes.redeemed_at is null
            and codes.revoked_at is null
        ),
        'last_seen_at', (
          select max(sessions.last_seen_at)
          from public.course_learner_sessions as sessions
          where sessions.learner_id = learners.id
        )
      )
      order by learners.created_at desc
    ),
    '[]'::jsonb
  )
  into v_learners
  from public.course_learners as learners;

  return v_learners;
end;
$$;

create or replace function public.admin_create_learner(
  p_name text,
  p_email text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_code text := upper(trim(coalesce(p_code, '')));
  v_learner_id uuid;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'invalid_access_code' using errcode = '22023';
  end if;

  begin
    insert into public.course_learners (name, email, created_by)
    values (v_name, v_email, auth.uid())
    returning id into v_learner_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'email_exists');
  end;

  insert into public.course_learner_access_codes (
    learner_id,
    code_hash,
    created_by
  )
  values (
    v_learner_id,
    extensions.crypt(v_code, extensions.gen_salt('bf', 12)),
    auth.uid()
  );

  insert into public.course_learner_login_attempts (email)
  values (v_email)
  on conflict (email) do nothing;

  return jsonb_build_object(
    'ok', true,
    'learner', jsonb_build_object(
      'id', v_learner_id,
      'name', v_name,
      'email', v_email,
      'created_at', now(),
      'active_session', false,
      'pending_code', true,
      'last_seen_at', null
    )
  );
end;
$$;

create or replace function public.admin_generate_learner_code(
  p_learner_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'invalid_access_code' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.course_learners
    where id = p_learner_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'learner_not_found');
  end if;

  update public.course_learner_access_codes
  set revoked_at = now()
  where learner_id = p_learner_id
    and redeemed_at is null
    and revoked_at is null;

  insert into public.course_learner_access_codes (
    learner_id,
    code_hash,
    created_by
  )
  values (
    p_learner_id,
    extensions.crypt(v_code, extensions.gen_salt('bf', 12)),
    auth.uid()
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_revoke_learner_sessions(
  p_learner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked integer;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.course_learners
    where id = p_learner_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'learner_not_found');
  end if;

  update public.course_learner_sessions
  set revoked_at = now()
  where learner_id = p_learner_id
    and revoked_at is null;

  get diagnostics v_revoked = row_count;
  return jsonb_build_object('ok', true, 'revoked_sessions', v_revoked);
end;
$$;

create or replace function public.redeem_learner_access(
  p_email text,
  p_code text,
  p_session_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_code text := upper(trim(coalesce(p_code, '')));
  v_learner public.course_learners%rowtype;
  v_access_code public.course_learner_access_codes%rowtype;
  v_attempt public.course_learner_login_attempts%rowtype;
begin
  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_code !~ '^[A-HJ-NP-Z2-9]{10}$'
     or coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  select *
  into v_attempt
  from public.course_learner_login_attempts
  where email = v_email
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if v_attempt.blocked_until is not null
     and v_attempt.blocked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if v_attempt.window_started_at < now() - interval '15 minutes' then
    update public.course_learner_login_attempts
    set window_started_at = now(),
        attempts = 0,
        blocked_until = null
    where email = v_email;
  end if;

  select *
  into v_learner
  from public.course_learners
  where lower(email) = v_email
  for update;

  if found then
    select *
    into v_access_code
    from public.course_learner_access_codes
    where learner_id = v_learner.id
      and redeemed_at is null
      and revoked_at is null
    order by created_at desc
    limit 1
    for update;
  end if;

  if not found
     or v_access_code.id is null
     or extensions.crypt(v_code, v_access_code.code_hash) <> v_access_code.code_hash then
    update public.course_learner_login_attempts
    set attempts = attempts + 1,
        blocked_until = case
          when attempts + 1 >= 8 then now() + interval '15 minutes'
          else null
        end
    where email = v_email;

    return jsonb_build_object(
      'ok', false,
      'error', case
        when (select attempts from public.course_learner_login_attempts where email = v_email) >= 8
          then 'too_many_attempts'
        else 'invalid_credentials'
      end
    );
  end if;

  update public.course_learner_access_codes
  set redeemed_at = now()
  where id = v_access_code.id
    and redeemed_at is null
    and revoked_at is null;

  if not found then
    update public.course_learner_login_attempts
    set attempts = attempts + 1
    where email = v_email;
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  -- A newly redeemed code replaces any older active device session.
  update public.course_learner_sessions
  set revoked_at = now()
  where learner_id = v_learner.id
    and revoked_at is null;

  insert into public.course_learner_sessions (learner_id, session_hash)
  values (
    v_learner.id,
    encode(
      extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
      'hex'
    )
  );

  update public.course_learner_login_attempts
  set attempts = 0,
      window_started_at = now(),
      blocked_until = null
  where email = v_email;

  return jsonb_build_object(
    'ok', true,
    'learner', jsonb_build_object(
      'id', v_learner.id,
      'name', v_learner.name,
      'email', v_learner.email
    )
  );
end;
$$;

create or replace function public.validate_learner_session(
  p_session_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_learner_id uuid;
  v_name text;
  v_email text;
begin
  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false);
  end if;

  select sessions.id, learners.id, learners.name, learners.email
  into v_session_id, v_learner_id, v_name, v_email
  from public.course_learner_sessions as sessions
  join public.course_learners as learners
    on learners.id = sessions.learner_id
  where sessions.session_hash = encode(
      extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
      'hex'
    )
    and sessions.revoked_at is null
  for update of sessions;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id;

  return jsonb_build_object(
    'ok', true,
    'learner', jsonb_build_object(
      'id', v_learner_id,
      'name', v_name,
      'email', v_email
    )
  );
end;
$$;

-- Supabase grants EXECUTE to PUBLIC for newly created functions by default.
-- Revoke that default exposure for every RPC, then grant only the intended role.
revoke all on function public.admin_list_learners() from public, anon, authenticated;
revoke all on function public.admin_create_learner(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_generate_learner_code(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_revoke_learner_sessions(uuid) from public, anon, authenticated;
revoke all on function public.redeem_learner_access(text, text, text) from public, anon, authenticated;
revoke all on function public.validate_learner_session(text) from public, anon, authenticated;

grant execute on function public.admin_list_learners() to authenticated;
grant execute on function public.admin_create_learner(text, text, text) to authenticated;
grant execute on function public.admin_generate_learner_code(uuid, text) to authenticated;
grant execute on function public.admin_revoke_learner_sessions(uuid) to authenticated;
grant execute on function public.redeem_learner_access(text, text, text) to anon, authenticated;
grant execute on function public.validate_learner_session(text) to anon, authenticated;

-- Replace the placeholder with the email of the existing Supabase Auth user.
-- The block fails clearly if the placeholder is unchanged or no account matches.
do $$
declare
  v_admin_id uuid;
  v_admin_email text := lower(trim('YOUR_ADMIN_EMAIL_HERE'));
begin
  select id
  into v_admin_id
  from auth.users
  where lower(email) = v_admin_email
  limit 1;

  if v_admin_id is null then
    raise exception 'No Supabase Auth user was found for that email. Replace the admin email placeholder and retry.';
  end if;

  insert into public.course_admins (user_id)
  values (v_admin_id)
  on conflict (user_id) do nothing;
end;
$$;
