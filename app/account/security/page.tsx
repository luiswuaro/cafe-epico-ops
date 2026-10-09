import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export default async function AccountSecurityPage() {
  const { user } = await getCurrentEmployee();
  return <main className="shell pos-shell"><section className="card"><h1>Seguridad</h1><p>{user.email}</p></section></main>;
}
