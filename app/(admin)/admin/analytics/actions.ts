"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePermission} from "@/src/infrastructure/auth/permissions";

/** Actualización de pantalla OPS; no importa recibos ni clientes de Loyverse. */
export async function refreshAnalytics(){
  await requirePermission("admin.access");
  revalidatePath("/admin/analytics");
  redirect("/admin/analytics?refreshed=1");
}
