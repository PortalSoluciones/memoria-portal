-- portales-memoria — initial schema
-- Shared agent memory for the Portales team: one Postgres source of truth,
-- per-member attribution, project grouping, shared/personal visibility.

-- pgcrypto is used to hash member tokens (see the onboarding convention in seed.sql).
create extension if not exists pgcrypto with schema extensions;

-- Teammates. One row per member; the bearer token identifies the caller.
create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  token_hash      text not null unique,          -- lowercase hex SHA-256 of the raw token
  default_project text not null default 'portales',
  created_at      timestamptz not null default now()
);

-- The memory itself.
create table if not exists public.observations (
  id             bigint generated always as identity primary key,
  project        text not null,
  author_id      uuid not null references public.members(id) on delete restrict,
  scope          text not null default 'shared' check (scope in ('shared','personal')),
  type           text not null default 'manual',
  title          text not null,
  content        text not null,
  topic_key      text,
  revision_count integer not null default 1,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- ponytail: 'simple' = language-agnostic, no stemming. The team writes mixed
  -- Spanish prose plus English identifiers; a Spanish stemmer would mangle
  -- identifiers and an English one would not stem Spanish. Switch the regconfig
  -- or add pg_trgm only if recall proves poor.
  search         tsvector generated always as (
                   to_tsvector('simple'::regconfig,
                     coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(topic_key, ''))
                 ) stored
);

create index if not exists observations_search_idx
  on public.observations using gin (search);

create index if not exists observations_project_created_idx
  on public.observations (project, created_at desc)
  where deleted_at is null;

create index if not exists observations_author_idx
  on public.observations (author_id);

-- topic_key upsert targets. Shared topics are team-level (one row per project);
-- personal topics are per author. Soft-deleted rows are excluded so a topic can be reused.
create unique index if not exists observations_topic_shared_uniq
  on public.observations (project, topic_key)
  where topic_key is not null and scope = 'shared' and deleted_at is null;

create unique index if not exists observations_topic_personal_uniq
  on public.observations (project, topic_key, author_id)
  where topic_key is not null and scope = 'personal' and deleted_at is null;

-- RLS enabled with no policies: anon/authenticated get nothing even if the tables
-- are reachable through the Data API. The MCP Edge Function uses the service role,
-- which bypasses RLS, so it is unaffected. Visibility is enforced in function logic.
alter table public.members enable row level security;
alter table public.observations enable row level security;

-- ponytail: no updated_at trigger. The MCP function is the only writer and sets
-- updated_at explicitly on every upsert. Add a trigger only if other writers appear.
