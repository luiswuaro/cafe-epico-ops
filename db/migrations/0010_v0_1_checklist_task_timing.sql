alter table checklist_run_tasks
  add column if not exists started_at timestamptz,
  add column if not exists started_by_employee_id uuid references employees(id) on delete set null;

create index if not exists checklist_run_tasks_started_by_idx
  on checklist_run_tasks(started_by_employee_id);

create index if not exists checklist_run_tasks_started_at_idx
  on checklist_run_tasks(started_at);
