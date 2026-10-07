import Link from "next/link";
import { PrinterBridgeSetup } from "./printer-client";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PosPrinterPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · HARDWARE</p>
          <h1>Impresora térmica directa</h1>
          <p className="muted">
            Esta configuración se guarda sólo en esta computadora. El puente
            manda ESC/POS RAW a Windows y evita el tamaño de hoja impuesto por
            Chrome.
          </p>
        </div>
        <Link href="/pos" className="button">
          Volver al POS
        </Link>
      </section>

      <section className="card">
        <p className="eyebrow">1 · PUENTE LOCAL</p>
        <h2>Ejecuta el puente en la computadora de caja</h2>
        <p className="muted">
          El archivo del proyecto es
          <code> tools/print-bridge/CafeEpicoPrintBridge.ps1</code>. Por
          defecto busca la impresora de Windows “POS-58 (copy 1)” y muestra un
          token local al arrancar.
        </p>
      </section>

      <section className="card">
        <p className="eyebrow">2 · VINCULAR ESTE NAVEGADOR</p>
        <h2>Conectar OPS con la impresora</h2>
        <PrinterBridgeSetup />
      </section>

      <section className="card">
        <p className="eyebrow">SEGURIDAD</p>
        <p className="muted">
          El puente sólo escucha en 127.0.0.1, por lo que no queda expuesto a
          otros equipos de la red. Además exige el token local para imprimir.
        </p>
      </section>
    </main>
  );
}
