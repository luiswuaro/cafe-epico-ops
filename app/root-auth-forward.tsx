"use client";

import { useEffect } from "react";

export function RootAuthForward() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery") {
      // Los enlaces antiguos de flujo implícito no aportan prueba PKCE verificable
      // a esta ruta. Pedimos uno nuevo en lugar de permitir un cambio inseguro.
      window.location.replace("/auth/recovery?error=legacy");
      return;
    }
    window.location.replace("/today");
  }, []);

  return <main className="centered"><p>Abriendo Café Épico OPS…</p></main>;
}
