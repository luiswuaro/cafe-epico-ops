import { AppNavClient } from "./app-nav-client";
import { getEmployeePermissions } from "@/src/infrastructure/auth/permissions";
import { getOptionalCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export async function AppNav() {
  // El layout global también se renderiza en /login. No invocar aquí una
  // función que redirija por empleado inactivo o no vinculado: causaría
  // /pos -> /login -> /login ... y ERR_TOO_MANY_REDIRECTS.
  const identity=await getOptionalCurrentEmployee();
  if(!identity)return null;
  const {employee}=identity;
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
