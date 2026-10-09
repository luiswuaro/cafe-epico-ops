import { AppNavClient } from "./app-nav-client";
import { employeeHasPermission } from "@/src/infrastructure/auth/permissions";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";

export async function AppNav() {
  // En un Preview QA el usuario inicia sesión en Supabase real, pero el
  // empleado autorizado debe resolverse dentro de la organización QA.
  // Si no hay sesión, ocultar la navegación sin redirigir desde el layout global.
  const supabase = await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;

  const {employee}=await getCurrentEmployee();
  const storeId=employee.homeStoreId??undefined;
  const [canAdmin,canPos,canCash]=await Promise.all([
    employeeHasPermission(employee.id,"admin.access",storeId),
    employeeHasPermission(employee.id,"pos.sell",storeId),
    employeeHasPermission(employee.id,"pos.cash.manage",storeId),
  ]);

  return <AppNavClient canAdmin={canAdmin} canPos={canPos} canCash={canCash}/>;
}
