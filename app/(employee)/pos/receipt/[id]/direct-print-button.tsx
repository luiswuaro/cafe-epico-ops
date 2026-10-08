"use client";

import { useRouter } from "next/navigation";
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
  pointsEarned?: string | null;
  pointsBalance?: string | null;
};

export type DirectReceiptTemplate = {
  businessName: string;
  addressLine: string;
  phoneLine: string | null;
  socialLine: string | null;
  headerMessage: string | null;
  footerMessage: string;
  showLogo: boolean;
  logoRasterBase64: string | null;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
  logoAlign: "left" | "center" | "right";
  showBusinessName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showSocial: boolean;
  showFolio: boolean;
  showDate: boolean;
  showEmployee: boolean;
  showService: boolean;
  showCustomer: boolean;
  showPoints: boolean;
  showItemNotes: boolean;
  showNoCfdi: boolean;
  lineWidthChars: number;
  feedLines: number;
  autoCut: boolean;
};

type PrintLine = {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: "normal" | "double";
};

function clip(text: string, width: number) {
  return text.length <= width ? text : text.slice(0, width);
}

function wrapText(text: string, width: number) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return [];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    const next = current ? current + " " + word : word;
    if (next.length <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function leftRight(left: string, right: string, width: number) {
  const safeRight = clip(right, Math.min(13, width));
  const maxLeft = Math.max(1, width - safeRight.length - 1);
  const safeLeft = clip(left, maxLeft);
  return (
    safeLeft +
    " ".repeat(Math.max(1, width - safeLeft.length - safeRight.length)) +
    safeRight
  );
}

function separator(width: number) {
  return "-".repeat(width);
}

function pushLabelValue(
  lines: PrintLine[],
  label: string,
  value: string,
  width: number,
) {
  if ((label + value).length + 1 <= width) {
    lines.push({ text: leftRight(label, value, width) });
    return;
  }

  lines.push({ text: label, bold: true });
  for (const part of wrapText(value, width)) {
    lines.push({ text: part, align: "right" });
  }
}

function buildLines(
  ticket: DirectReceiptPayload,
  template: DirectReceiptTemplate,
) {
  const width = Math.max(24, Math.min(42, template.lineWidthChars));
  const lines: PrintLine[] = [];

  if (template.showBusinessName) {
    lines.push({
      text: clip(template.businessName || "CAFE EPICO", Math.max(12, Math.floor(width / 2))),
      align: "center",
      bold: true,
      size: "double",
    });
  }

  if (template.showAddress && template.addressLine) {
    for (const part of wrapText(template.addressLine, width)) {
      lines.push({ text: part, align: "center", bold: true });
    }
  }

  if (template.showPhone && template.phoneLine) {
    for (const part of wrapText(template.phoneLine, width)) {
      lines.push({ text: part, align: "center" });
    }
  }

  if (template.showSocial && template.socialLine) {
    for (const part of wrapText(template.socialLine, width)) {
      lines.push({ text: part, align: "center" });
    }
  }

  if (template.headerMessage) {
    for (const part of wrapText(template.headerMessage, width)) {
      lines.push({ text: part, align: "center" });
    }
  }

  if (ticket.splitLabel) {
    lines.push({
      text: clip(ticket.splitLabel, width),
      align: "center",
      bold: true,
    });
  }

  lines.push({ text: separator(width) });

  if (template.showFolio) {
    pushLabelValue(lines, "Folio", ticket.folio, width);
  }
  if (template.showDate) {
    pushLabelValue(lines, "Fecha", ticket.date, width);
  }
  if (template.showEmployee) {
    pushLabelValue(lines, "Atendio", ticket.employee, width);
  }
  if (template.showService) {
    pushLabelValue(lines, "Servicio", ticket.service, width);
  }

  lines.push({ text: separator(width) });

  for (const item of ticket.items) {
    const label = item.quantity + "x " + item.name;

    if (label.length + item.total.length + 1 <= width) {
      lines.push({
        text: leftRight(label, item.total, width),
        bold: true,
      });
    } else {
      for (const part of wrapText(label, width)) {
        lines.push({ text: part, bold: true });
      }
      lines.push({ text: clip(item.total, width), align: "right", bold: true });
    }

    if (template.showItemNotes && item.note) {
      const noteWidth = Math.max(10, width - 2);
      for (const part of wrapText("> " + item.note, noteWidth)) {
        lines.push({ text: " " + part });
      }
    }
  }

  lines.push({ text: separator(width) });
  const doubleWidth = Math.max(12, Math.floor(width / 2));
  lines.push({
    text: leftRight("TOTAL", ticket.total, doubleWidth),
    bold: true,
    size: "double",
  });
  pushLabelValue(lines, "Pago", ticket.payment || "-", width);

  if (template.showCustomer && ticket.customer) {
    for (const part of wrapText("Cliente: " + ticket.customer, width)) {
      lines.push({ text: part });
    }
  }

  if (template.showPoints && ticket.pointsEarned) {
    pushLabelValue(lines, "Puntos ganados", "+" + ticket.pointsEarned, width);
  }
  if (template.showPoints && ticket.pointsBalance) {
    pushLabelValue(lines, "Saldo puntos", ticket.pointsBalance, width);
  }

  lines.push({ text: separator(width) });

  if (template.footerMessage) {
    for (const part of wrapText(template.footerMessage, width)) {
      lines.push({ text: part, align: "center", bold: true });
    }
  }

  if (template.showNoCfdi) {
    lines.push({
      text: "Este ticket no es CFDI.",
      align: "center",
    });
  }

  return lines;
}

export function DirectPrintTicketButton({
  ticket,
  template,
}: {
  ticket: DirectReceiptPayload;
  template: DirectReceiptTemplate;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "printing" | "ok" | "error">(
    "idle",
  );

  async function printDirect() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.push("/pos/printer");
      return;
    }

    try {
      const config = JSON.parse(raw) as { url: string; token: string };
      setState("printing");

      const logo =
        template.showLogo &&
        template.logoRasterBase64 &&
        template.logoWidthPx &&
        template.logoHeightPx
          ? {
              dataBase64: template.logoRasterBase64,
              width: template.logoWidthPx,
              height: template.logoHeightPx,
              align: template.logoAlign,
            }
          : null;

      const response = await fetch(
        config.url.replace(/\/$/, "") + "/print",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Cafe-Epico-Token": config.token,
          },
          body: JSON.stringify({
            logo,
            lines: buildLines(ticket, template),
            feed: template.feedLines,
            cut: template.autoCut,
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
