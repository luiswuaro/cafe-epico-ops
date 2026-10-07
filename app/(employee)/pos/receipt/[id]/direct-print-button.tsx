"use client";

import { useState } from "react";

const STORAGE_KEY = "cafe-epico-printer-bridge-v1";

export type DirectReceiptPayload = {
  folio: string;
  date: string;
  employee: string;
  service: string;
  splitLabel?: string | null;
  items: Array<{
    quantity: number;
    name: string;
    note?: string | null;
    total: string;
  }>;
  total: string;
  payment: string;
  customer?: string | null;
};

function clip(text: string, width = 32) {
  return text.length <= width ? text : text.slice(0, width);
}

function leftRight(left: string, right: string, width = 32) {
  const safeRight = clip(right, Math.min(12, width));
  const maxLeft = Math.max(1, width - safeRight.length - 1);
  const safeLeft = clip(left, maxLeft);
  return safeLeft + " ".repeat(Math.max(1, width - safeLeft.length - safeRight.length)) + safeRight;
}

function buildLines(ticket: DirectReceiptPayload) {
  const lines: Array<{
    text: string;
    align?: "left" | "center" | "right";
    bold?: boolean;
    size?: "normal" | "double";
  }> = [];

  lines.push({
    text: "CAFE EPICO",
    align: "center",
    bold: true,
    size: "double",
  });
  lines.push({
    text: "Tepexi de Rodriguez, Puebla",
    align: "center",
    bold: true,
  });

  if (ticket.splitLabel) {
    lines.push({
      text: ticket.splitLabel,
      align: "center",
      bold: true,
    });
  }

  lines.push({ text: "--------------------------------" });
  lines.push({ text: leftRight("Folio", ticket.folio) });
  lines.push({ text: leftRight("Fecha", ticket.date) });
  lines.push({ text: leftRight("Atendio", ticket.employee) });
  lines.push({ text: leftRight("Servicio", ticket.service) });
  lines.push({ text: "--------------------------------" });

  for (const item of ticket.items) {
    lines.push({
      text: leftRight(
        item.quantity + "x " + item.name,
        item.total,
      ),
      bold: true,
    });
    if (item.note) {
      lines.push({ text: "  > " + clip(item.note, 28) });
    }
  }

  lines.push({ text: "--------------------------------" });
  lines.push({
    text: leftRight("TOTAL", ticket.total),
    bold: true,
    size: "double",
  });
  lines.push({ text: leftRight("Pago", ticket.payment || "-") });

  if (ticket.customer) {
    lines.push({ text: clip("Cliente: " + ticket.customer) });
  }

  lines.push({ text: "--------------------------------" });
  lines.push({
    text: "Gracias por tu visita.",
    align: "center",
    bold: true,
  });

  return lines;
}

export function DirectPrintTicketButton({
  ticket,
}: {
  ticket: DirectReceiptPayload;
}) {
  const [state, setState] = useState<"idle" | "printing" | "ok" | "error">(
    "idle",
  );

  async function printDirect() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.location.href = "/pos/printer";
      return;
    }

    try {
      const config = JSON.parse(raw) as { url: string; token: string };
      setState("printing");

      const response = await fetch(
        config.url.replace(/\/$/, "") + "/print",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Cafe-Epico-Token": config.token,
          },
          body: JSON.stringify({
            lines: buildLines(ticket),
            feed: 3,
            cut: false,
          }),
        },
      );

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "No se pudo imprimir");
      }

      setState("ok");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className="button no-print"
      onClick={printDirect}
      disabled={state === "printing"}
    >
      {state === "printing"
        ? "Imprimiendo…"
        : state === "ok"
          ? "Impreso ✓"
          : state === "error"
            ? "Error · configurar"
            : "Imprimir directo ESC/POS"}
    </button>
  );
}
