import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

export const metadata: Metadata = { title: { default: "Café Épico Ops", template: "%s · Café Épico Ops" }, description: "Sistema interno de operación de Café Épico." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><ServiceWorkerRegister/><header className="topbar"><Link className="brand" href="/today">Café Épico Ops</Link><nav className="nav"><Link href="/today">Hoy</Link><Link href="/checklists">Checklist</Link><Link href="/recipes">Recetas</Link><Link href="/sops">SOPs</Link><Link href="/quality/espresso">Espresso QC</Link><Link href="/admin">Admin</Link></nav></header>{children}</body></html>;
}
