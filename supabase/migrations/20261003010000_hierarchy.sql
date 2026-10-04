-- T6: organization -> area -> project
alter table public.observations rename column project to organization;
alter table public.observations add column if not exists area text;
alter table public.observations add column if not exists project text;

alter table public.members rename column default_project to default_organization;

drop index if exists public.observations_project_created_idx;
create index if not exists observations_scope_idx
  on public.observations (organization, area, project, created_at desc)
  where deleted_at is null;

-- topic upsert targets: expression-based so NULL area/project still collide correctly
drop index if exists public.observations_topic_shared_uniq;
drop index if exists public.observations_topic_personal_uniq;
create unique index if not exists observations_topic_shared_uniq
  on public.observations (organization, coalesce(area, ''), coalesce(project, ''), topic_key)
  where topic_key is not null and scope = 'shared' and deleted_at is null;
create unique index if not exists observations_topic_personal_uniq
  on public.observations (organization, coalesce(area, ''), coalesce(project, ''), topic_key, author_id)
  where topic_key is not null and scope = 'personal' and deleted_at is null;
