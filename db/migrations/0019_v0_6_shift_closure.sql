-- Cierre de turno: responsable de cierre + nota general.
alter table public.checklist_runs
  add column if not exists completed_by_employee_id uuid
    references public.employees(id) on delete set null,
  add column if not exists closing_note text;

create index if not exists checklist_runs_completed_by_idx
  on public.checklist_runs(completed_by_employee_id);
