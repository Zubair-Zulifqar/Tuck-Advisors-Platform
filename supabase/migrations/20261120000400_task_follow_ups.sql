-- Track when the follow-up-due event fired so it is emitted exactly once per due date.
alter table public.tasks add column follow_up_notified_at timestamptz;
create index tasks_follow_up_due_idx on public.tasks(due_at) where status = 'open' and follow_up_notified_at is null;
