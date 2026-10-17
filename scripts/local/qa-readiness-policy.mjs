/** Política de admisión local QA. Entradas sintéticas, sin acceso a red ni secretos. */
export const CRITICAL_QA_TABLES=[
  "public.organizations","public.stores","public.employees",
  "public.role_permissions","public.inventory_items",
  "public.inventory_movements","public.inventory_balances",
  "public.recipes","public.recipe_versions",
  "public.sops","public.sop_versions","public.checklist_tasks",
  "public.pos_orders","public.pos_order_lines","public.pos_payments",
  "public.pos_order_splits","public.pos_order_split_lines",
  "public.pos_cash_sessions","public.pos_customers",
  "public.pos_loyalty_entries","public.audit_events",
  "public.pos_print_station_status",
  "public.ops_local_migrations",
  "public.financial_budgets",
  "public.operational_inventory_balances",
  "public.operational_inventory_movements",
];
export function assessQaSnapshot({presentTables=[],expectedMigrations=[],appliedMigrations=[],
  organizations=[],stores=[],authUsers=0,orders=0,liveOrders=0}={}){
  const errors=[];
  const warnings=[];
  const tableSet=new Set(presentTables);
  for(const name of CRITICAL_QA_TABLES){
    if(!tableSet.has(name))errors.push("Falta tabla crítica: "+name);
  }
  const actual=new Map(appliedMigrations.map(m=>[m.name,m.sha256?.trim()]));
  for(const expected of expectedMigrations){
    if(actual.get(expected.name)!==expected.sha256)
      errors.push("Migración no aplicada o alterada: "+expected.name);
  }
  if(organizations.length!==1||organizations[0]?.slug!=="cafe-epico-qa")
    errors.push("La base QA debe contener únicamente la organización cafe-epico-qa.");
  if(stores.length!==1||stores[0]?.code!=="QA-TEPEXI"||
      stores[0]?.organizationId!==organizations[0]?.id)
    errors.push("La sucursal QA no está aislada correctamente.");
  if(liveOrders>0)errors.push("Hay ventas LIVE en la réplica QA; detener pruebas.");
  if(orders>0)warnings.push("Hay pedidos sintéticos en QA: "+orders);
  if(authUsers===0)warnings.push("Aún no hay usuario Auth QA; falta crear y vincular credenciales locales.");
  return {ok:errors.length===0,errors,warnings};
}
