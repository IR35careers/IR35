create table if not exists public.admin_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  invited_by_email text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_members_email_lowercase check (email = lower(btrim(email)))
);

create index if not exists admin_members_status_idx on public.admin_members(status);

alter table public.admin_members enable row level security;
revoke all on table public.admin_members from anon, authenticated;

insert into public.admin_members (email, role, status, invited_by_email)
values ('ir35careers@gmail.com', 'owner', 'active', 'system')
on conflict (email) do update
set role = 'owner',
    status = 'active',
    updated_at = now();

