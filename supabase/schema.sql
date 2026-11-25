create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'manager', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null check (length(last_name) between 1 and 100),
  company text not null check (length(company) between 1 and 180),
  job_title text not null default '' check (length(job_title) <= 160),
  email text not null default '' check (length(email) <= 254),
  phone text not null default '' check (length(phone) <= 50),
  kind text not null default 'prospect' check (kind in ('prospect', 'client', 'partner')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'customer', 'paused')),
  next_step text not null default '' check (length(next_step) <= 240),
  next_due_at date,
  notes text not null default '' check (length(notes) <= 3000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  kind text not null check (kind in ('call', 'meeting', 'email', 'follow_up', 'admin', 'field', 'expense', 'other')),
  title text not null check (length(title) between 1 and 180),
  summary text not null check (length(summary) between 1 and 4000),
  occurred_at timestamptz not null,
  due_at date,
  proof_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.onboarding_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  policy_version text not null,
  acknowledged_at timestamptz not null default now(),
  unique(team_id, user_id, policy_version)
);

create index if not exists contacts_team_updated_idx on public.contacts(team_id, updated_at desc);
create index if not exists activities_team_occurred_idx on public.activities(team_id, occurred_at desc);
create index if not exists activities_due_idx on public.activities(team_id, due_at) where due_at is not null;

create or replace function public.is_team_member(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team and tm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_team_manager(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team and tm.user_id = (select auth.uid())
      and tm.role in ('admin', 'manager')
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_contact_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id <> old.team_id or new.created_by <> old.created_by then
    raise exception 'Contact team and creator are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists contacts_protect_identity on public.contacts;
create trigger contacts_protect_identity
before update on public.contacts
for each row execute function public.protect_contact_identity();

revoke all on function public.is_team_member(uuid) from public;
revoke all on function public.is_team_manager(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_manager(uuid) to authenticated;

grant usage on schema public to authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
grant select, insert on public.onboarding_acknowledgements to authenticated;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.onboarding_acknowledgements enable row level security;

drop policy if exists "members read their teams" on public.teams;
create policy "members read their teams" on public.teams
for select to authenticated using (public.is_team_member(id));

drop policy if exists "members read team membership" on public.team_members;
create policy "members read team membership" on public.team_members
for select to authenticated using (public.is_team_member(team_id));

drop policy if exists "members read contacts" on public.contacts;
create policy "members read contacts" on public.contacts
for select to authenticated using (public.is_team_member(team_id));
drop policy if exists "members create contacts" on public.contacts;
create policy "members create contacts" on public.contacts
for insert to authenticated with check (
  public.is_team_member(team_id) and created_by = (select auth.uid())
);
drop policy if exists "members update contacts" on public.contacts;
create policy "members update contacts" on public.contacts
for update to authenticated using (
  public.is_team_member(team_id)
  and (created_by = (select auth.uid()) or public.is_team_manager(team_id))
)
with check (
  public.is_team_member(team_id)
  and (created_by = (select auth.uid()) or public.is_team_manager(team_id))
);
drop policy if exists "managers delete contacts" on public.contacts;
create policy "managers delete contacts" on public.contacts
for delete to authenticated using (public.is_team_manager(team_id));

drop policy if exists "members read activities" on public.activities;
create policy "members read activities" on public.activities
for select to authenticated using (public.is_team_member(team_id));
drop policy if exists "members create activities" on public.activities;
create policy "members create activities" on public.activities
for insert to authenticated with check (
  public.is_team_member(team_id) and created_by = (select auth.uid())
  and (contact_id is null or exists (
    select 1 from public.contacts c where c.id = contact_id and c.team_id = activities.team_id
  ))
);
drop policy if exists "managers update activities" on public.activities;
create policy "managers update activities" on public.activities
for update to authenticated using (public.is_team_manager(team_id))
with check (public.is_team_manager(team_id));
drop policy if exists "managers delete activities" on public.activities;
create policy "managers delete activities" on public.activities
for delete to authenticated using (public.is_team_manager(team_id));

drop policy if exists "members read acknowledgements" on public.onboarding_acknowledgements;
create policy "members read acknowledgements" on public.onboarding_acknowledgements
for select to authenticated using (public.is_team_member(team_id) and user_id = (select auth.uid()));
drop policy if exists "members acknowledge policy" on public.onboarding_acknowledgements;
create policy "members acknowledge policy" on public.onboarding_acknowledgements
for insert to authenticated with check (
  public.is_team_member(team_id) and user_id = (select auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-proofs',
  'crm-proofs',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "team members read proof files" on storage.objects;
create policy "team members read proof files" on storage.objects
for select to authenticated using (
  bucket_id = 'crm-proofs'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "team members upload proof files" on storage.objects;
create policy "team members upload proof files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'crm-proofs'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "owners delete proof files" on storage.objects;
create policy "owners delete proof files" on storage.objects
for delete to authenticated using (
  bucket_id = 'crm-proofs'
  and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or public.is_team_manager(((storage.foldername(name))[1])::uuid)
  )
);

-- Provisionnement initial : créer la première équipe puis attribuer les comptes
-- invités avec leurs UUID auth.users. Désactiver l’inscription publique dans Auth.
