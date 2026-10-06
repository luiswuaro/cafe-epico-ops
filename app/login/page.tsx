import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const missing = params.config === "missing";
  const next = typeof params.next === "string" ? params.next : "/today";
  return <main className="centered"><section className="card login-card"><p className="eyebrow">CAFÉ ÉPICO OPS</p><h1>Iniciar sesión</h1>
    {missing && <p className="alert">Falta configurar Supabase en el servidor.</p>}
    {error && <p className="alert">{error}</p>}
    <form action={signIn} className="stack"><input type="hidden" name="next" value={next}/><label>Correo<input name="email" type="email" required /></label><label>Contraseña<input name="password" type="password" required /></label><button type="submit">Entrar</button></form>
  </section></main>;
}
