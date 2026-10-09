import Link from "next/link";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { changeAccountPassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await getCurrentEmployee();
  const params = await searchParams;
  const changed = params.changed === "1";
  const error = typeof params.error === "string" ? params.error : "";
  const messages: Record<string, string> = {
    validation: "Revisa la contraseña nueva: debe tener de 12 a 128 caracteres, coincidir con la confirmación y ser diferente de la actual.",
    current: "La contraseña actual no coincide.",
    provider: "No se pudo actualizar la contraseña. Intenta nuevamente o utiliza la recuperación por correo.",
  };
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div><p className="eyebrow">MI CUENTA · SEGURIDAD</p><h1>Cambiar contraseña</h1>
        <p className="muted">Cuenta: {user.email ?? "Correo no disponible"}</p></div>
      <Link href="/today" className="button">Volver a Hoy</Link>
    </section>
    <section className="card stack">
      <h2>Actualizar acceso</h2>
      <p className="muted">Se verifica tu contraseña actual antes de aplicar una nueva. Esto no afecta los accesos de otros empleados.</p>
      {changed && <p role="status" className="status-ok">Contraseña actualizada. Usa la nueva la próxima vez que inicies sesión.</p>}
      {error && <p role="alert" className="alert">{messages[error] ?? "No fue posible realizar el cambio."}</p>}
      <form action={changeAccountPassword} className="stack">
        <label>Contraseña actual
          <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <label>Nueva contraseña
          <input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </label>
        <label>Confirmar nueva contraseña
          <input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </label>
        <p className="muted">Mínimo 12 caracteres. Es recomendable usar una frase de acceso larga y única.</p>
        <button type="submit">Guardar nueva contraseña</button>
      </form>
      <p>¿No recuerdas tu contraseña actual? <Link href="/auth/recovery">Recupérala por correo</Link>.</p>
    </section>
  </main>;
}
