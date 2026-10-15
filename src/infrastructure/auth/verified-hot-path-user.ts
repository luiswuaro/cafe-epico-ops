import {redirect} from "next/navigation";
import {createSupabaseServerClient} from "./server";

/**
 * Verifica criptográficamente el JWT antes de entregar el sub a sondas SQL.
 * Nunca usar claims editables por el usuario para roles/autorizaciones:
 * empleado activo y permiso se verifican dentro de PostgreSQL en CADA poll.
 */
export async function getVerifiedHotPathUserId():Promise<string>{
  const supabase=await createSupabaseServerClient();
  const {data,error}=await supabase.auth.getClaims();
  const claims=data?.claims;
  if(error||!claims||claims.role!=="authenticated"||typeof claims.sub!=="string")
    redirect("/login");
  return claims.sub;
}
