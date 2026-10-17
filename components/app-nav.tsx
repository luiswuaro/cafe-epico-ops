import { AppNavClient } from "./app-nav-client";
import { getEmployeePermissions } from "@/src/infrastructure/auth/permissions";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";

export async function AppNav() {
  // En un Preview QA el usuario inicia sesión en Supabase real, pero el
  // empleado autorizado debe resolverse dentro de la organización QA.
  // Si no hay sesión, ocultar la navegación sin redirigir desde el layout global.
  const supabase = await createSupabaseServerClient();
  // Verificación criptográfica local del JWT en vez de consultar Auth en cada render.
  const {data,error}=await supabase.auth.getClaims();
  const claims=data?.claims;
  if(error||!claims||claims.role!=="authenticated"||typeof claims.sub!=="string")return null;

  const {employee}=await getCurrentEmployee();
  const storeId=employee.homeStoreId??undefined;
  // Un solo viaje a PostgreSQL para los tres permisos de navegación.
  // La consulta se ejecuta otra vez en cada request; no persiste autorizaciones.
  const grants=await getEmployeePermissions(employee.id,[
    "admin.access","pos.sell","pos.cash.manage",
  ],storeId);
  const canAdmin=grants.has("admin.access");
  const canPos=grants.has("pos.sell");
  const canCash=grants.has("pos.cash.manage");

  const enableClosingQa=process.env.OPS_QA_MODE==="true" && process.env.OPS_LOCAL_FIRST==="true" && process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa";
  return <AppNavClient canAdmin={canAdmin} canPos={canPos} canCash={canCash} enableClosingQa={enableClosingQa}/>;
}
