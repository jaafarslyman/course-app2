-- One shared group chat, participant messages, messaging toggle, and private media.
-- Run schema.sql and courses.sql first.
begin;

create table if not exists public.course_chat_settings (
  id integer primary key default 1 check (id = 1),
  learner_messaging_enabled boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.course_chat_settings (id, learner_messaging_enabled)
values (1, true)
on conflict (id) do nothing;

create table if not exists public.course_chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_type text not null check (sender_type in ('admin', 'learner')),
  sender_id uuid,
  sender_name text not null check (char_length(trim(sender_name)) between 1 and 200),
  kind text not null check (kind in ('text', 'image', 'video', 'audio')),
  body text,
  storage_path text,
  mime_type text,
  file_size_bytes bigint check (
    file_size_bytes is null or file_size_bytes between 1 and 52428800
  ),
  created_at timestamptz not null default now(),
  constraint course_chat_message_content_shape check (
    (
      kind = 'text'
      and body is not null
      and char_length(trim(body)) between 1 and 5000
      and storage_path is null
      and mime_type is null
      and file_size_bytes is null
    )
    or (
      kind in ('image', 'video', 'audio')
      and storage_path is not null
      and char_length(storage_path) between 1 and 255
      and mime_type is not null
      and (
        (kind = 'image' and mime_type like 'image/%')
        or (kind = 'video' and mime_type like 'video/%')
        or (kind = 'audio' and mime_type like 'audio/%')
      )
      and file_size_bytes between 1 and 52428800
      and (body is null or char_length(body) <= 1000)
    )
  )
);

create index if not exists course_chat_messages_created_idx
  on public.course_chat_messages (created_at desc, id desc);

alter table public.course_chat_settings enable row level security;
alter table public.course_chat_messages enable row level security;
revoke all on table public.course_chat_settings from public, anon, authenticated;
revoke all on table public.course_chat_messages from public, anon, authenticated;

create or replace function public.chat_get_state(p_session_secret text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_learner_id uuid;
  v_session_id uuid;
  v_messaging_enabled boolean;
  v_messages jsonb;
begin
  v_is_admin := public.is_course_admin();

  if not v_is_admin then
    if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    select sessions.id, sessions.learner_id
    into v_session_id, v_learner_id
    from public.course_learner_sessions as sessions
    where sessions.session_hash = encode(
      extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
      'hex'
    )
      and sessions.revoked_at is null
    for update;

    if not found then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    update public.course_learner_sessions
    set last_seen_at = now()
    where id = v_session_id;
  end if;

  select settings.learner_messaging_enabled
  into v_messaging_enabled
  from public.course_chat_settings as settings
  where settings.id = 1;
  v_messaging_enabled := coalesce(v_messaging_enabled, true);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'senderType', recent.sender_type,
        'senderName', recent.sender_name,
        'body', recent.body,
        'kind', recent.kind,
        'mimeType', recent.mime_type,
        'fileSizeBytes', recent.file_size_bytes,
        'createdAt', recent.created_at
      )
      order by recent.created_at, recent.id
    ),
    '[]'::jsonb
  )
  into v_messages
  from (
    select
      messages.id,
      messages.sender_type,
      messages.sender_name,
      messages.body,
      messages.kind,
      messages.mime_type,
      messages.file_size_bytes,
      messages.created_at
    from public.course_chat_messages as messages
    order by messages.created_at desc, messages.id desc
    limit 100
  ) as recent;

  return jsonb_build_object(
    'messagingEnabled', v_messaging_enabled,
    'canSend', v_is_admin or v_messaging_enabled,
    'messages', v_messages
  );
end;
$$;

create or replace function public.admin_chat_set_messaging_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.course_chat_settings
  set learner_messaging_enabled = coalesce(p_enabled, false),
      updated_by = auth.uid(),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'messagingEnabled', coalesce(p_enabled, false)
  );
end;
$$;

create or replace function public.chat_media_upload_permission(
  p_session_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_messaging_enabled boolean;
begin
  if public.is_course_admin() then
    return jsonb_build_object('ok', true, 'senderType', 'admin');
  end if;

  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false);
  end if;

  select sessions.id
  into v_session_id
  from public.course_learner_sessions as sessions
  where sessions.session_hash = encode(
    extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
    'hex'
  )
    and sessions.revoked_at is null
  for update;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select settings.learner_messaging_enabled
  into v_messaging_enabled
  from public.course_chat_settings as settings
  where settings.id = 1;

  if not coalesce(v_messaging_enabled, true) then
    return jsonb_build_object('ok', false);
  end if;

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id;

  return jsonb_build_object('ok', true, 'senderType', 'learner');
end;
$$;

create or replace function public.chat_send_message(
  p_session_secret text default null,
  p_kind text default 'text',
  p_body text default null,
  p_storage_path text default null,
  p_mime_type text default null,
  p_file_size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_learner_id uuid;
  v_session_id uuid;
  v_sender_name text;
  v_sender_id uuid;
  v_messaging_enabled boolean;
  v_message_id uuid;
begin
  v_is_admin := public.is_course_admin();

  if v_is_admin then
    v_sender_id := auth.uid();
    v_sender_name := 'المشرف';
  else
    if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    select sessions.id, sessions.learner_id, learners.name
    into v_session_id, v_learner_id, v_sender_name
    from public.course_learner_sessions as sessions
    join public.course_learners as learners on learners.id = sessions.learner_id
    where sessions.session_hash = encode(
      extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
      'hex'
    )
      and sessions.revoked_at is null
    for update of sessions;

    if not found then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    select settings.learner_messaging_enabled
    into v_messaging_enabled
    from public.course_chat_settings as settings
    where settings.id = 1;

    if not coalesce(v_messaging_enabled, true) then
      raise exception 'messaging_closed' using errcode = '42501';
    end if;

    v_sender_id := v_learner_id;
    update public.course_learner_sessions
    set last_seen_at = now()
    where id = v_session_id;
  end if;

  if p_kind is null or p_kind not in ('text', 'image', 'video', 'audio') then
    raise exception 'invalid_message_kind' using errcode = '22023';
  end if;

  if p_kind = 'text' then
    if p_body is null or char_length(trim(p_body)) not between 1 and 5000
       or p_storage_path is not null
       or p_mime_type is not null
       or p_file_size_bytes is not null then
      raise exception 'invalid_text_message' using errcode = '22023';
    end if;
  else
    if p_storage_path is null
       or p_storage_path !~ '^chat/[A-Za-z0-9-]{36}$'
       or p_mime_type is null
       or p_file_size_bytes is null
       or p_file_size_bytes not between 1 and 52428800
       or (p_body is not null and char_length(p_body) > 1000)
       or not (
         (p_kind = 'image' and p_mime_type like 'image/%')
         or (p_kind = 'video' and p_mime_type like 'video/%')
         or (p_kind = 'audio' and p_mime_type like 'audio/%')
       )
       or not exists (
         select 1
         from storage.objects as objects
         where objects.bucket_id = 'chat-media'
           and objects.name = p_storage_path
       ) then
      raise exception 'invalid_media_message' using errcode = '22023';
    end if;
  end if;

  insert into public.course_chat_messages (
    sender_type,
    sender_id,
    sender_name,
    kind,
    body,
    storage_path,
    mime_type,
    file_size_bytes
  )
  values (
    case when v_is_admin then 'admin' else 'learner' end,
    v_sender_id,
    coalesce(nullif(trim(v_sender_name), ''), 'المتعلّم'),
    p_kind,
    p_body,
    p_storage_path,
    p_mime_type,
    p_file_size_bytes
  )
  returning id into v_message_id;

  return jsonb_build_object('ok', true, 'id', v_message_id);
end;
$$;

create or replace function public.chat_media_path(
  p_message_id uuid,
  p_session_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_storage_path text;
begin
  if not public.is_course_admin() then
    if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
      return jsonb_build_object('ok', false);
    end if;

    select sessions.id
    into v_session_id
    from public.course_learner_sessions as sessions
    where sessions.session_hash = encode(
      extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
      'hex'
    )
      and sessions.revoked_at is null
    for update;

    if not found then
      return jsonb_build_object('ok', false);
    end if;

    update public.course_learner_sessions
    set last_seen_at = now()
    where id = v_session_id;
  end if;

  select messages.storage_path
  into v_storage_path
  from public.course_chat_messages as messages
  where messages.id = p_message_id
    and messages.kind in ('image', 'video', 'audio');

  if v_storage_path is null then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object('ok', true, 'storagePath', v_storage_path);
end;
$$;

revoke all on function public.chat_get_state(text) from public, anon, authenticated;
revoke all on function public.admin_chat_set_messaging_enabled(boolean) from public, anon, authenticated;
revoke all on function public.chat_media_upload_permission(text) from public, anon, authenticated;
revoke all on function public.chat_send_message(text, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.chat_media_path(uuid, text) from public, anon, authenticated;

grant execute on function public.chat_get_state(text) to anon, authenticated;
grant execute on function public.admin_chat_set_messaging_enabled(boolean) to authenticated;
grant execute on function public.chat_media_upload_permission(text) to anon, authenticated;
grant execute on function public.chat_send_message(text, text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.chat_media_path(uuid, text) to anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-media',
  'chat-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
    'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/3gpp'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
