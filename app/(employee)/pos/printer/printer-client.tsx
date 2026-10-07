"use client";

import { useState } from "react";

const STORAGE_KEY = "cafe-epico-printer-bridge-v1";

type StoredConfig = {
  url: string;
  token: string;
};

export function PrinterBridgeSetup() {
  const [url, setUrl] = useState("http://127.0.0.1:9137");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Sin probar");


  async function testAndSave() {
    setStatus("Probando conexión…");
    try {
      const response = await fetch(url.replace(/\/$/, "") + "/status", {
        method: "GET",
        headers: {
          "X-Cafe-Epico-Token": token,
        },
      });
      const data = (await response.json()) as {
        ok?: boolean;
        printer?: string;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No respondió el puente local");
      }

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ url: url.replace(/\/$/, ""), token }),
      );
      setStatus("Conectado · " + (data.printer || "impresora térmica"));
    } catch (error) {
      setStatus(
        "Error · " +
          (error instanceof Error ? error.message : "sin conexión"),
      );
    }
  }

  return (
    <div className="stack">
      <label>
        URL del puente local
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
        />
      </label>
      <label>
        Token mostrado por el puente
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
      </label>
      <button type="button" onClick={testAndSave}>
        Probar y guardar en esta computadora
      </button>
      <div className="printer-bridge-status">{status}</div>
    </div>
  );
}

export const printerBridgeStorageKey = STORAGE_KEY;
