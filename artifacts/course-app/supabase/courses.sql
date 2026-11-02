-- Course hierarchy, protected media storage, and learner progress.
-- Run schema.sql first if the access tables/functions do not already exist.
begin;

create table if not exists public.course_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  sort_order integer not null default 0,
  published boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_levels (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course_courses (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.course_levels (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_content_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course_courses (id) on delete cascade,
  level_id uuid references public.course_levels (id) on delete cascade,
  section_id uuid references public.course_sections (id) on delete cascade,
  kind text not null check (kind in ('video', 'image', 'text', 'note', 'audio')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text,
  storage_path text,
  mime_type text,
  file_size_bytes bigint check (
    file_size_bytes is null or file_size_bytes between 0 and 524288000
  ),
  duration_seconds integer check (
    duration_seconds is null or duration_seconds between 0 and 86400
  ),
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_content_location_shape check (
    (section_id is null)
    or (level_id is not null)
  ),
  constraint course_content_body_or_media check (
    (
      kind in ('text', 'note')
      and body is not null
      and char_length(trim(body)) between 1 and 50000
      and storage_path is null
    )
    or (
      kind in ('video', 'image', 'audio')
      and storage_path is not null
      and char_length(storage_path) between 1 and 255
    )
  )
);

create unique index if not exists course_content_storage_path_unique
  on public.course_content_items (storage_path)
  where storage_path is not null;

create index if not exists course_levels_order_idx
  on public.course_levels (course_id, sort_order, id);
create index if not exists course_sections_order_idx
  on public.course_sections (level_id, sort_order, id);
create index if not exists course_content_course_order_idx
  on public.course_content_items (course_id, sort_order, id);
create index if not exists course_content_level_order_idx
  on public.course_content_items (level_id, sort_order, id)
  where section_id is null;
create index if not exists course_content_section_order_idx
  on public.course_content_items (section_id, sort_order, id)
  where section_id is not null;

create table if not exists public.course_learner_progress (
  learner_id uuid not null references public.course_learners (id) on delete cascade,
  content_item_id uuid not null references public.course_content_items (id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer check (
    duration_seconds is null or duration_seconds between 0 and 86400
  ),
  progress_percent smallint not null default 0 check (
    progress_percent between 0 and 100
  ),
  is_completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, content_item_id)
);

create index if not exists course_learner_progress_content_idx
  on public.course_learner_progress (content_item_id);

alter table public.course_courses enable row level security;
alter table public.course_levels enable row level security;
alter table public.course_sections enable row level security;
alter table public.course_content_items enable row level security;
alter table public.course_learner_progress enable row level security;

revoke all on table public.course_courses from public, anon, authenticated;
revoke all on table public.course_levels from public, anon, authenticated;
revoke all on table public.course_sections from public, anon, authenticated;
revoke all on table public.course_content_items from public, anon, authenticated;
revoke all on table public.course_learner_progress from public, anon, authenticated;

create or replace function public.touch_course_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists course_courses_touch_updated_at
  on public.course_courses;
create trigger course_courses_touch_updated_at
  before update on public.course_courses
  for each row execute function public.touch_course_updated_at();

drop trigger if exists course_levels_touch_updated_at
  on public.course_levels;
create trigger course_levels_touch_updated_at
  before update on public.course_levels
  for each row execute function public.touch_course_updated_at();

drop trigger if exists course_sections_touch_updated_at
  on public.course_sections;
create trigger course_sections_touch_updated_at
  before update on public.course_sections
  for each row execute function public.touch_course_updated_at();

drop trigger if exists course_content_touch_updated_at
  on public.course_content_items;
create trigger course_content_touch_updated_at
  before update on public.course_content_items
  for each row execute function public.touch_course_updated_at();

create or replace function public.course_content_json(
  p_content_id uuid,
  p_learner_id uuid,
  p_include_storage_path boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', items.id,
    'kind', items.kind,
    'title', items.title,
    'body', items.body,
    'storagePath', case
      when p_include_storage_path then items.storage_path
      else null
    end,
    'mimeType', items.mime_type,
    'fileSizeBytes', items.file_size_bytes,
    'durationSeconds', items.duration_seconds,
    'sortOrder', items.sort_order,
    'progress', (
      select jsonb_build_object(
        'positionSeconds', progress.position_seconds,
        'durationSeconds', progress.duration_seconds,
        'progressPercent', progress.progress_percent,
        'completed', progress.is_completed,
        'completedAt', progress.completed_at,
        'updatedAt', progress.updated_at
      )
      from public.course_learner_progress as progress
      where progress.content_item_id = items.id
        and progress.learner_id = p_learner_id
    )
  )
  from public.course_content_items as items
  where items.id = p_content_id;
$$;

create or replace function public.course_section_json(
  p_section_id uuid,
  p_learner_id uuid,
  p_include_storage_path boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', sections.id,
    'title', sections.title,
    'sortOrder', sections.sort_order,
    'items', coalesce((
      select jsonb_agg(
        public.course_content_json(
          items.id,
          p_learner_id,
          p_include_storage_path
        )
        order by items.sort_order, items.id
      )
      from public.course_content_items as items
      where items.section_id = sections.id
    ), '[]'::jsonb)
  )
  from public.course_sections as sections
  where sections.id = p_section_id;
$$;

create or replace function public.course_level_json(
  p_level_id uuid,
  p_learner_id uuid,
  p_include_storage_path boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', levels.id,
    'title', levels.title,
    'sortOrder', levels.sort_order,
    'items', coalesce((
      select jsonb_agg(
        public.course_content_json(
          items.id,
          p_learner_id,
          p_include_storage_path
        )
        order by items.sort_order, items.id
      )
      from public.course_content_items as items
      where items.level_id = levels.id
        and items.section_id is null
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        public.course_section_json(
          sections.id,
          p_learner_id,
          p_include_storage_path
        )
        order by sections.sort_order, sections.id
      )
      from public.course_sections as sections
      where sections.level_id = levels.id
    ), '[]'::jsonb)
  )
  from public.course_levels as levels
  where levels.id = p_level_id;
$$;

create or replace function public.course_tree_json(
  p_learner_id uuid,
  p_published_only boolean,
  p_include_storage_path boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', courses.id,
      'name', courses.name,
      'published', courses.published,
      'sortOrder', courses.sort_order,
      'createdAt', courses.created_at,
      'updatedAt', courses.updated_at,
      'items', coalesce((
        select jsonb_agg(
          public.course_content_json(
            items.id,
            p_learner_id,
            p_include_storage_path
          )
          order by items.sort_order, items.id
        )
        from public.course_content_items as items
        where items.course_id = courses.id
          and items.level_id is null
          and items.section_id is null
      ), '[]'::jsonb),
      'levels', coalesce((
        select jsonb_agg(
          public.course_level_json(
            levels.id,
            p_learner_id,
            p_include_storage_path
          )
          order by levels.sort_order, levels.id
        )
        from public.course_levels as levels
        where levels.course_id = courses.id
      ), '[]'::jsonb)
    )
    order by courses.sort_order, courses.created_at, courses.id
  ), '[]'::jsonb)
  from public.course_courses as courses
  where not p_published_only or courses.published;
$$;

create or replace function public.admin_course_tree()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return public.course_tree_json(null, false, true);
end;
$$;

create or replace function public.learner_course_tree(p_session_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_learner_id uuid;
  v_session_id uuid;
begin
  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return '[]'::jsonb;
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
    return '[]'::jsonb;
  end if;

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id;

  return public.course_tree_json(v_learner_id, true, false);
end;
$$;

create or replace function public.admin_course_mutate(
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_course_id uuid;
  v_level_id uuid;
  v_section_id uuid;
  v_existing public.course_content_items%rowtype;
  v_kind text;
  v_title text;
  v_body text;
  v_storage_path text;
  v_mime_type text;
  v_file_size_bytes bigint;
  v_duration_seconds integer;
  v_sort_order integer;
  v_actual_course_id uuid;
  v_actual_level_id uuid;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  if p_action = 'create_course' then
    v_title := trim(coalesce(p_payload->>'name', ''));
    if char_length(v_title) not between 1 and 200 then
      raise exception 'invalid_course_name' using errcode = '22023';
    end if;
    select coalesce(max(sort_order), -1) + 1
    into v_sort_order
    from public.course_courses;
    insert into public.course_courses (name, sort_order, created_by)
    values (v_title, v_sort_order, auth.uid())
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'rename_course' then
    v_id := (p_payload->>'courseId')::uuid;
    v_title := trim(coalesce(p_payload->>'name', ''));
    if char_length(v_title) not between 1 and 200 then
      raise exception 'invalid_course_name' using errcode = '22023';
    end if;
    update public.course_courses
    set name = v_title
    where id = v_id;
  elsif p_action = 'set_course_published' then
    v_id := (p_payload->>'courseId')::uuid;
    update public.course_courses
    set published = (p_payload->>'published')::boolean
    where id = v_id;
  elsif p_action = 'delete_course' then
    v_id := (p_payload->>'courseId')::uuid;
    delete from public.course_courses
    where id = v_id;
  elsif p_action = 'create_level' then
    v_course_id := (p_payload->>'courseId')::uuid;
    v_title := trim(coalesce(p_payload->>'title', ''));
    if char_length(v_title) not between 1 and 200
       or not exists (
         select 1 from public.course_courses where id = v_course_id
       )
       or exists (
         select 1
         from public.course_content_items
         where course_id = v_course_id
           and level_id is null
           and section_id is null
       ) then
      raise exception 'invalid_level' using errcode = '22023';
    end if;
    select coalesce(max(sort_order), -1) + 1
    into v_sort_order
    from public.course_levels
    where course_id = v_course_id;
    insert into public.course_levels (course_id, title, sort_order)
    values (v_course_id, v_title, v_sort_order)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'rename_level' then
    v_id := (p_payload->>'levelId')::uuid;
    v_title := trim(coalesce(p_payload->>'title', ''));
    if char_length(v_title) not between 1 and 200 then
      raise exception 'invalid_level_title' using errcode = '22023';
    end if;
    update public.course_levels
    set title = v_title
    where id = v_id;
  elsif p_action = 'delete_level' then
    v_id := (p_payload->>'levelId')::uuid;
    delete from public.course_levels
    where id = v_id;
  elsif p_action = 'create_section' then
    v_level_id := (p_payload->>'levelId')::uuid;
    v_title := trim(coalesce(p_payload->>'title', ''));
    if char_length(v_title) not between 1 and 200
       or not exists (
         select 1 from public.course_levels where id = v_level_id
       )
       or exists (
         select 1
         from public.course_content_items
         where level_id = v_level_id
           and section_id is null
       ) then
      raise exception 'invalid_section' using errcode = '22023';
    end if;
    select coalesce(max(sort_order), -1) + 1
    into v_sort_order
    from public.course_sections
    where level_id = v_level_id;
    insert into public.course_sections (level_id, title, sort_order)
    values (v_level_id, v_title, v_sort_order)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'rename_section' then
    v_id := (p_payload->>'sectionId')::uuid;
    v_title := trim(coalesce(p_payload->>'title', ''));
    if char_length(v_title) not between 1 and 200 then
      raise exception 'invalid_section_title' using errcode = '22023';
    end if;
    update public.course_sections
    set title = v_title
    where id = v_id;
  elsif p_action = 'delete_section' then
    v_id := (p_payload->>'sectionId')::uuid;
    delete from public.course_sections
    where id = v_id;
  elsif p_action in ('create_content', 'update_content') then
    v_kind := p_payload->>'kind';
    v_title := trim(coalesce(p_payload->>'title', ''));
    v_body := p_payload->>'body';
    v_storage_path := p_payload->>'storagePath';
    v_mime_type := p_payload->>'mimeType';
    v_file_size_bytes := nullif(p_payload->>'fileSizeBytes', '')::bigint;
    v_duration_seconds := nullif(p_payload->>'durationSeconds', '')::integer;

    if p_action = 'create_content' then
      v_course_id := (p_payload->>'courseId')::uuid;
      v_level_id := nullif(p_payload->>'levelId', '')::uuid;
      v_section_id := nullif(p_payload->>'sectionId', '')::uuid;
    else
      v_id := (p_payload->>'contentId')::uuid;
      select * into v_existing
      from public.course_content_items
      where id = v_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'content_not_found');
      end if;
      v_course_id := v_existing.course_id;
      v_level_id := v_existing.level_id;
      v_section_id := v_existing.section_id;
      v_kind := coalesce(nullif(v_kind, ''), v_existing.kind);
      v_title := coalesce(nullif(v_title, ''), v_existing.title);
      if not (p_payload ? 'body') then
        v_body := v_existing.body;
      end if;
      if not (p_payload ? 'storagePath') then
        v_storage_path := v_existing.storage_path;
      end if;
      if not (p_payload ? 'mimeType') then
        v_mime_type := v_existing.mime_type;
      end if;
      if not (p_payload ? 'fileSizeBytes') then
        v_file_size_bytes := v_existing.file_size_bytes;
      end if;
      if not (p_payload ? 'durationSeconds') then
        v_duration_seconds := v_existing.duration_seconds;
      end if;
    end if;

    if v_kind is null
       or v_kind not in ('video', 'image', 'text', 'note', 'audio')
       or v_title is null
       or char_length(v_title) not between 1 and 200
       or (v_file_size_bytes is not null and v_file_size_bytes not between 0 and 524288000)
       or (v_duration_seconds is not null and v_duration_seconds not between 0 and 86400) then
      raise exception 'invalid_content' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.course_courses where id = v_course_id
    ) then
      raise exception 'invalid_course' using errcode = '22023';
    end if;

    if v_section_id is not null then
      select sections.level_id, levels.course_id
      into v_actual_level_id, v_actual_course_id
      from public.course_sections as sections
      join public.course_levels as levels on levels.id = sections.level_id
      where sections.id = v_section_id;
      if not found
         or v_actual_level_id is distinct from v_level_id
         or v_actual_course_id is distinct from v_course_id then
        raise exception 'invalid_content_location' using errcode = '22023';
      end if;
    elsif v_level_id is not null then
      select levels.course_id into v_actual_course_id
      from public.course_levels as levels
      where levels.id = v_level_id;
      if not found or v_actual_course_id is distinct from v_course_id then
        raise exception 'invalid_content_location' using errcode = '22023';
      end if;
    end if;

    if p_action = 'create_content'
       and v_level_id is null
       and exists (
         select 1
         from public.course_levels
         where course_id = v_course_id
       ) then
      raise exception 'course_structure_conflict' using errcode = '22023';
    end if;
    if p_action = 'create_content'
       and v_level_id is not null
       and v_section_id is null
       and exists (
         select 1
         from public.course_sections
         where level_id = v_level_id
       ) then
      raise exception 'level_structure_conflict' using errcode = '22023';
    end if;

    if v_kind in ('text', 'note') then
      if v_body is null
         or char_length(trim(v_body)) not between 1 and 50000
         or v_storage_path is not null then
        raise exception 'invalid_text_content' using errcode = '22023';
      end if;
      v_mime_type := null;
      v_file_size_bytes := null;
      v_duration_seconds := null;
    elsif v_storage_path is null
       or char_length(v_storage_path) not between 1 and 255
       or v_file_size_bytes is null
       or v_mime_type is null
       or not (
         (v_kind = 'video' and v_mime_type like 'video/%')
         or (v_kind = 'image' and v_mime_type like 'image/%')
         or (v_kind = 'audio' and v_mime_type like 'audio/%')
       )
       or v_body is not null then
      raise exception 'invalid_media_content' using errcode = '22023';
    end if;

    if p_action = 'create_content' then
      select coalesce(max(sort_order), -1) + 1
      into v_sort_order
      from public.course_content_items as items
      where items.course_id = v_course_id
        and items.level_id is not distinct from v_level_id
        and items.section_id is not distinct from v_section_id;
      insert into public.course_content_items (
        course_id,
        level_id,
        section_id,
        kind,
        title,
        body,
        storage_path,
        mime_type,
        file_size_bytes,
        duration_seconds,
        sort_order,
        created_by
      )
      values (
        v_course_id,
        v_level_id,
        v_section_id,
        v_kind,
        v_title,
        v_body,
        v_storage_path,
        v_mime_type,
        v_file_size_bytes,
        v_duration_seconds,
        v_sort_order,
        auth.uid()
      )
      returning id into v_id;
    else
      update public.course_content_items
      set kind = v_kind,
          title = v_title,
          body = v_body,
          storage_path = v_storage_path,
          mime_type = v_mime_type,
          file_size_bytes = v_file_size_bytes,
          duration_seconds = v_duration_seconds
      where id = v_id;
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'delete_content' then
    v_id := (p_payload->>'contentId')::uuid;
    delete from public.course_content_items
    where id = v_id;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_course_reorder(
  p_kind text,
  p_parent_type text,
  p_parent_id uuid,
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_ids is null then
    raise exception 'invalid_order' using errcode = '22023';
  end if;
  if cardinality(p_ids) <> (
    select count(distinct item_id)
    from unnest(p_ids) as supplied(item_id)
  ) then
    raise exception 'duplicate_order_id' using errcode = '22023';
  end if;

  if p_kind = 'courses' and p_parent_type = 'none' and p_parent_id is null then
    select count(*) into v_expected from public.course_courses;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_courses as courses
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where courses.id = supplied.id;
  elsif p_kind = 'levels' and p_parent_type = 'course' and p_parent_id is not null then
    select count(*) into v_expected
    from public.course_levels where course_id = p_parent_id;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_levels as levels
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where levels.id = supplied.id and levels.course_id = p_parent_id;
  elsif p_kind = 'sections' and p_parent_type = 'level' and p_parent_id is not null then
    select count(*) into v_expected
    from public.course_sections where level_id = p_parent_id;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_sections as sections
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where sections.id = supplied.id and sections.level_id = p_parent_id;
  elsif p_kind = 'content'
    and p_parent_type = 'course'
    and p_parent_id is not null then
    select count(*) into v_expected
    from public.course_content_items
    where course_id = p_parent_id and level_id is null and section_id is null;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_content_items as items
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where items.id = supplied.id
      and items.course_id = p_parent_id
      and items.level_id is null
      and items.section_id is null;
  elsif p_kind = 'content'
    and p_parent_type = 'level'
    and p_parent_id is not null then
    select count(*) into v_expected
    from public.course_content_items
    where level_id = p_parent_id and section_id is null;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_content_items as items
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where items.id = supplied.id
      and items.level_id = p_parent_id
      and items.section_id is null;
  elsif p_kind = 'content'
    and p_parent_type = 'section'
    and p_parent_id is not null then
    select count(*) into v_expected
    from public.course_content_items where section_id = p_parent_id;
    if cardinality(p_ids) <> v_expected then
      raise exception 'incomplete_order' using errcode = '22023';
    end if;
    update public.course_content_items as items
    set sort_order = supplied.ordinality::integer - 1
    from unnest(p_ids) with ordinality as supplied(id, ordinality)
    where items.id = supplied.id and items.section_id = p_parent_id;
  else
    raise exception 'invalid_order_scope' using errcode = '22023';
  end if;

  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_ids) then
    raise exception 'order_contains_foreign_id' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.learner_save_progress(
  p_session_secret text,
  p_content_id uuid,
  p_position_seconds double precision,
  p_duration_seconds double precision,
  p_mark_done boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_learner_id uuid;
  v_duration integer;
  v_position integer;
  v_percent smallint;
  v_completed boolean;
begin
  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$'
     or p_position_seconds is null
     or p_position_seconds < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_progress');
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
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select coalesce(
    case
      when p_duration_seconds > 0
        then least(floor(p_duration_seconds), 86400)::integer
      else null
    end,
    items.duration_seconds
  )
  into v_duration
  from public.course_content_items as items
  join public.course_courses as courses on courses.id = items.course_id
  where items.id = p_content_id and courses.published;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'content_not_available');
  end if;

  v_position := least(
    floor(least(p_position_seconds, 86400))::integer,
    coalesce(v_duration, 86400)
  );
  v_completed := coalesce(p_mark_done, false)
    or (v_duration is not null and v_duration > 0 and v_position >= v_duration - 5);
  v_percent := case
    when v_completed then 100
    when v_duration is null or v_duration = 0 then 0
    else least(99, floor((v_position::numeric / v_duration::numeric) * 100))::smallint
  end;

  insert into public.course_learner_progress (
    learner_id,
    content_item_id,
    position_seconds,
    duration_seconds,
    progress_percent,
    is_completed,
    completed_at,
    updated_at
  )
  values (
    v_learner_id,
    p_content_id,
    v_position,
    v_duration,
    v_percent,
    v_completed,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (learner_id, content_item_id) do update
  set position_seconds = excluded.position_seconds,
      duration_seconds = coalesce(excluded.duration_seconds, course_learner_progress.duration_seconds),
      progress_percent = case
        when course_learner_progress.is_completed or excluded.is_completed then 100
        else excluded.progress_percent
      end,
      is_completed = course_learner_progress.is_completed or excluded.is_completed,
      completed_at = case
        when course_learner_progress.is_completed then course_learner_progress.completed_at
        when excluded.is_completed then now()
        else null
      end,
      updated_at = now();

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id;

  return jsonb_build_object(
    'ok', true,
    'progress', jsonb_build_object(
      'positionSeconds', v_position,
      'durationSeconds', v_duration,
      'progressPercent', v_percent,
      'completed', v_completed
    )
  );
end;
$$;

create or replace function public.course_media_path(
  p_content_id uuid,
  p_session_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_session_id uuid;
  v_learner_id uuid;
begin
  if public.is_course_admin() then
    select items.storage_path into v_path
    from public.course_content_items as items
    where items.id = p_content_id
      and items.kind in ('video', 'image', 'audio');
    if v_path is null then
      return jsonb_build_object('ok', false);
    end if;
    return jsonb_build_object('ok', true, 'storagePath', v_path);
  end if;

  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false);
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
    return jsonb_build_object('ok', false);
  end if;

  select items.storage_path into v_path
  from public.course_content_items as items
  join public.course_courses as courses on courses.id = items.course_id
  where items.id = p_content_id
    and items.kind in ('video', 'image', 'audio')
    and courses.published;
  if v_path is null then
    return jsonb_build_object('ok', false);
  end if;

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id and learner_id = v_learner_id;

  return jsonb_build_object('ok', true, 'storagePath', v_path);
end;
$$;

-- Keep content and progress behind trusted RPCs. The API server validates the
-- learner session before it uses its server-only key to sign media URLs.
revoke all on function public.touch_course_updated_at() from public, anon, authenticated;
revoke all on function public.course_content_json(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.course_section_json(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.course_level_json(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.course_tree_json(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.admin_course_tree() from public, anon, authenticated;
revoke all on function public.learner_course_tree(text) from public, anon, authenticated;
revoke all on function public.admin_course_mutate(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_course_reorder(text, text, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.learner_save_progress(text, uuid, double precision, double precision, boolean) from public, anon, authenticated;
revoke all on function public.course_media_path(uuid, text) from public, anon, authenticated;

grant execute on function public.is_course_admin() to authenticated;
grant execute on function public.admin_course_tree() to authenticated;
grant execute on function public.admin_course_mutate(text, jsonb) to authenticated;
grant execute on function public.admin_course_reorder(text, text, uuid, uuid[]) to authenticated;
grant execute on function public.learner_course_tree(text) to anon, authenticated;
grant execute on function public.learner_save_progress(text, uuid, double precision, double precision, boolean) to anon, authenticated;
grant execute on function public.course_media_path(uuid, text) to anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'course-media',
  'course-media',
  false,
  524288000,
  array[
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
    'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/3gpp'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Course admins upload course media" on storage.objects;
create policy "Course admins upload course media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'course-media'
  and public.is_course_admin()
);

drop policy if exists "Course admins read course media" on storage.objects;
create policy "Course admins read course media"
on storage.objects for select to authenticated
using (
  bucket_id = 'course-media'
  and public.is_course_admin()
);

drop policy if exists "Course admins update course media" on storage.objects;
create policy "Course admins update course media"
on storage.objects for update to authenticated
using (
  bucket_id = 'course-media'
  and public.is_course_admin()
)
with check (
  bucket_id = 'course-media'
  and public.is_course_admin()
);

drop policy if exists "Course admins delete course media" on storage.objects;
create policy "Course admins delete course media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'course-media'
  and public.is_course_admin()
);

commit;
