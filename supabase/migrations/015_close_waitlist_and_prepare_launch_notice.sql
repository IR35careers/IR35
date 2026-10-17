-- Public access is now open. Preserve the former waitlist as a private launch
-- audience, stop accepting new public sign-ups, and add a durable delivery
-- ledger for the one-time access-open notice.

alter table public.waitlist
  add column if not exists launch_notified_at timestamptz,
  add column if not exists launch_email_id text,
  add column if not exists launch_email_attempts integer not null default 0,
  add column if not exists launch_last_error text;

drop policy if exists "Allow anonymous inserts" on public.waitlist;
revoke insert on table public.waitlist from anon, authenticated;

drop view if exists public.waitlist_count;

comment on table public.waitlist is
  'Private legacy launch audience retained only for the one-time public-access notice and audit record.';
