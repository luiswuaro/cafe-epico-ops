import Link from "next/link";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";
import { recoveryCookie, verifyRecoveryProof } from "@/src/infrastructure/auth/recovery-proof";
import { requestPasswordRecovery, completePasswordRecovery } from "./actions";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [userResult,sessionResult,cookieStore] = await Promise.all([
    supabase.auth.getUser(),supabase.auth.getSession(),cookies(),
  ]);
  const userId = userResult.data.user?.id;
  const accessToken = sessionResult.data.session?.access_token;
  const ready = Boolean(userId && accessToken && verifyRecoveryProof(
    cookieStore.get(recoveryCookie)?.value,userId,accessToken,
  ));
  const errors: Record<string,string> = {
    expired:"El enlace no es válido o caducó. Solicita uno nuevo.",
    email:"Escribe un correo electrónico válido.",
    send:"No fue posible enviar el correo. Inténtalo de nuevo en unos minutos.",
    provider:"Supabase no aceptó el cambio. Prueba otra contraseña o solicita otro enlace.",
    validation:"La contraseña debe tener de 12 a 128 caracteres y coincidir en ambos campos.",
    config:"Falta configurar la verificación de recuperación en el servidor.",
  };
  const error = typeof params.error === "string" ? params.error : "";
  return <main className="centered">
    <section className="card login-card stack">
      <p className="eyebrow">CAFÉ ÉPICO OPS · SEGURIDAD</p>
      <h1>{ready ? "Establecer nueva contraseña" : "Recuperar contraseña"}</h1>
      {error && <p className="alert" role="alert">{errors[error] ?? "No pudimos procesar el enlace."}</p>}
      {params.sent === "1" && <p role="status">Si el correo está registrado, recibirás un enlace de recuperación. Revisa también spam.</p>}
      {ready ? <>
        <p className="muted">Enlace de recuperación verificado para {userResult.data.user?.email}. Por seguridad caduca a los 15 minutos.</p>
        <form action={completePasswordRecovery} className="stack">
          <label>Nueva contraseña
            <input type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
          </label>
          <label>Confirmar contraseña
            <input type="password" name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} required />
          </label>
          <button type="submit">Actualizar contraseña</button>
        </form>
      </> : <>
        <p className="muted">Solicita un enlace para cambiar tu contraseña. No hace falta conocer la contraseña anterior.</p>
        <form action={requestPasswordRecovery} className="stack">
          <label>Correo de tu cuenta
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <button type="submit">Enviar enlace de recuperación</button>
        </form>
      </>}
      <Link href="/login">Volver a inicio de sesión</Link>
    </section>
  </main>;
}
