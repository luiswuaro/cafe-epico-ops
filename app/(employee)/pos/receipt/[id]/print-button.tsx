"use client";

export function PrintTicketButton() {
  return (
    <button
      type="button"
      className="button no-print"
      onClick={() => window.print()}
    >
      Imprimir
    </button>
  );
}
