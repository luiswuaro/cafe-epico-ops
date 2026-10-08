import Link from "next/link";
import { TicketTemplateEditor } from "./ticket-template-editor";
import { getPosPrintSettings } from "@/src/application/pos/print-settings";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PosTicketAdminPage() {
  const { organizationId } = await requirePermission("pos.print.manage");
  const settings = await getPosPrintSettings(organizationId);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">GESTIÓN · POS</p>
          <h1>Ticket térmico</h1>
          <p className="muted">
            Define la composición base que usa la impresión directa ESC/POS.
            El logo se convierte a gráfico monocromático para la POS-58.
          </p>
        </div>
        <Link href="/pos/printer" className="button">
          Configurar impresora
        </Link>
      </section>

      <TicketTemplateEditor initial={settings} />
    </main>
  );
}
