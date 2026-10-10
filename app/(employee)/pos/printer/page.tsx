import Link from "next/link";
import { PrinterBridgeSetup, KitchenPrinterSetup, AutoKitchenPrintSettings } from "./printer-client";
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
            OPS imprime en RAW ESC/POS: sin hoja de Chrome y con soporte para
            gráficos térmicos.
          </p>
        </div>
        <div className="pos-result-actions">
          <Link href="/admin/pos/ticket" className="button">
            Editar ticket
          </Link>
          <Link href="/pos" className="button">
            Volver al POS
          </Link>
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">1 · INSTALAR UNA SOLA VEZ</p>
        <h2>Arranque automático en Windows</h2>
        <p className="muted">
          Desde la raíz del proyecto abre PowerShell y ejecuta:
        </p>
        <pre className="code-block">
          powershell -ExecutionPolicy Bypass -File
          .\tools\print-bridge\Install-CafeEpicoPrintBridge.ps1
        </pre>
        <p className="muted">
          El instalador crea una tarea de Windows para iniciar el puente oculto
          al entrar a tu sesión. Ya no necesitas dejar una ventana de
          PowerShell abierta.
        </p>
        <p className="muted">
          Al terminar te mostrará un token. Cópialo en el paso 2.
        </p>
      </section>

      <section className="card">
        <p className="eyebrow">2 · VINCULAR ESTA COMPUTADORA</p>
        <h2>Conectar OPS con la POS-58</h2>
        <PrinterBridgeSetup />
      </section>

      <section className="card stack">
        <p className="eyebrow">3 · IMPRESIÓN DE COMANDAS</p>
        <h2>Destino de las comandas de barra</h2>
        <p className="muted">Por defecto, las comandas salen en la misma POS-58. Si más adelante agregas una segunda impresora, conéctala a esta computadora e instala otro puente con puerto y token independientes.</p>
        <KitchenPrinterSetup />
        <hr/>
        <AutoKitchenPrintSettings />
        <details>
          <summary>Instalar segunda impresora en Windows (opcional)</summary>
          <p>Desde la raíz del proyecto, sustituye el nombre por el que aparece exactamente en «Impresoras y escáneres» de Windows:</p>
          <pre className="code-block">{String.raw`powershell -ExecutionPolicy Bypass -File .\tools\print-bridge\Install-CafeEpicoPrintBridge.ps1 -Instance Barra -PrinterName "NOMBRE DE IMPRESORA"`}</pre>
          <p className="muted">El puente de comandas usa 127.0.0.1:9138 y un token nuevo. La impresora de tickets continúa en 9137 sin cambios. Si reinstalas la impresora de barra, se conserva su token salvo que uses -ResetToken.</p>
        </details>
      </section>

      <section className="card">
        <p className="eyebrow">MANTENIMIENTO</p>
        <p className="muted">
          Para quitar el arranque automático usa:
        </p>
        <pre className="code-block">
          powershell -ExecutionPolicy Bypass -File
          .\tools\print-bridge\Uninstall-CafeEpicoPrintBridge.ps1
        </pre>
        <p className="muted">
          El puente escucha sólo en 127.0.0.1 y exige el token local para
          imprimir.
        </p>
      </section>
    </main>
  );
}
