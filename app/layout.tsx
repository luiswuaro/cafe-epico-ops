import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: { default: "Café Épico Ops", template: "%s · Café Épico Ops" },
  description: "Sistema interno de operación de Café Épico.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <ServiceWorkerRegister />
        <header className="topbar">
          <Link className="brand" href="/today">Café Épico Ops</Link>
          <AppNav />
        </header>
        {children}
      </body>
    </html>
  );
}
