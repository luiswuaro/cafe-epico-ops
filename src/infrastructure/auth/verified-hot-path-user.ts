import {redirect} from "next/navigation";
import {localPrintAgentIdentity} from "./local-print-agent-context";
import {createSupabaseServerClient} from "./server";

/**
 * Verifica criptográficamente el JWT antes de entregar el sub a sondas SQL.
 * Nunca usar claims editables por el usuario para roles/autorizaciones:
 * empleado activo y permiso se verifican dentro de PostgreSQL en CADA poll.
 */
export async function getVerifiedHotPathUserId():Promise<string>{
  const device=localPrintAgentIdentity();
  if(device)return device.user.id; // Actor activo y autorizado desde la ruta local.
  const supabase=await createSupabaseServerClient();
  const {data,error}=await supabase.auth.getClaims();
  const claims=data?.claims;
  if(error||!claims||claims.role!=="authenticated"||typeof claims.sub!=="string")
    redirect("/login");
  return claims.sub;
}
