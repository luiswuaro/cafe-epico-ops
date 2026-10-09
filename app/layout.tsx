import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: { default: "Café Épico Ops", template: "%s · Café Épico Ops" },
  description: "Sistema interno de operación de Café Épico.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f0e8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <ServiceWorkerRegister />
        {process.env.OPS_QA_MODE==="true" && process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" && (
          <div className="ops-qa-banner" role="status">
            <strong>ENTORNO QA</strong>
            <span>Operación simulada · sin ventas ni inventario reales · misma infraestructura PostgreSQL</span>
          </div>
        )}
        <header className="topbar">
          <Link className="brand" href="/today">Café Épico Ops</Link>
          <AppNav />
        </header>
        {children}
      </body>
    </html>
  );
}
