"use client";

export function PrintTicketButton() {
  function printTicket() {
    const paper = document.querySelector<HTMLElement>(".receipt-paper");
    if (!paper) {
      window.print();
      return;
    }

    const pxToMm = 25.4 / 96;
    const contentHeightMm = Math.ceil(paper.scrollHeight * pxToMm + 8);
    const pageHeightMm = Math.max(45, contentHeightMm);
    const style = document.createElement("style");
    style.dataset.ticketPrintSize = "true";
    style.textContent =
      "@media print { @page { size: 58mm " +
      pageHeightMm +
      "mm; margin: 0; } html, body { width: 58mm !important; height: " +
      pageHeightMm +
      "mm !important; margin: 0 !important; padding: 0 !important; } }";

    document.head
      .querySelectorAll('style[data-ticket-print-size="true"]')
      .forEach((node) => node.remove());
    document.head.appendChild(style);

    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup, { once: true });
    window.requestAnimationFrame(() => window.print());
  }

  return (
    <button
      type="button"
      className="button no-print"
      onClick={printTicket}
    >
      Imprimir con navegador
    </button>
  );
}
