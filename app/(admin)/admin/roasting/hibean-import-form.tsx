"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  MAX_HIBEAN_JSON_BYTES,
  MAX_HIBEAN_JSON_MB,
} from "@/src/domain/roasting/upload-constraints";

/**
 * Mobile Chrome/Android document providers can invalidate their File handle
 * between the initial preview and native multipart form submission
 * (ERR_UPLOAD_FILE_CHANGED). Read once on selection, then upload a Blob
 * built from the in-memory snapshot. Never re-read the external File.
 */
export function HiBeanImportForm() {
  const [message, setMessage] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const version = useRef(0);
  const snapshot = useRef<{ name: string; content: string } | null>(null);

  async function checkFile(file: File | undefined) {
    const current = ++version.current;
    snapshot.current = null;
    setReady(false);
    setSelectedName(file?.name ?? "");
    if (!file) {
      setMessage("Selecciona el archivo JSON exportado de HiBean.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      setMessage("Selecciona un archivo con extensión .json exportado desde HiBean.");
      return;
    }
    if (file.size <= 0) {
      setMessage("El archivo está vacío. Exporta nuevamente el tueste desde HiBean.");
      return;
    }
    if (file.size > MAX_HIBEAN_JSON_BYTES) {
      setMessage(
        "El JSON pesa " + (file.size / 1_000_000).toFixed(2) +
        " MB y supera el máximo admitido aquí (" + MAX_HIBEAN_JSON_MB +
        " MB). No se envió nada. Comparte el archivo para preparar una importación de mayor tamaño.",
      );
      return;
    }
    setMessage("Copiando y comprobando JSON…");
    try {
      // Only access Android's original file here, while the selected handle
      // is still valid. The subsequent upload uses the saved text instead.
      const content = await file.text();
      const data: unknown = JSON.parse(content);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("El JSON no tiene un objeto raíz.");
      }
      if (version.current !== current) return;
      const bytes = new Blob([content]).size;
      if (bytes > MAX_HIBEAN_JSON_BYTES) {
        setMessage("El JSON convertido supera los " + MAX_HIBEAN_JSON_MB +
          " MB. No se ha enviado.");
        return;
      }
      snapshot.current = { name: file.name, content };
      setMessage("JSON válido · " + (bytes / 1_000).toFixed(0) +
        " KB · copia segura lista para enviar y revisar.");
      setReady(true);
    } catch {
      if (version.current !== current) return;
      setMessage(
        "No fue posible leer o validar este JSON. Intenta guardarlo primero " +
        "en Descargas del teléfono y vuelve a elegirlo. No se registró ningún tueste.",
      );
    }
  }

  async function submitSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = snapshot.current;
    if (!ready || submitting || !file) return;
    setSubmitting(true);
    setMessage("Enviando la copia del JSON a OPS…");
    try {
      // A memory-backed Blob avoids re-opening the Android content:// URI
      // that Chrome previously used for the file picker.
      const data = new FormData();
      data.append("roastFile", new Blob([file.content], {
        type: "application/json",
      }), file.name);
      const response = await fetch("/api/roasting/hibean/upload", {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json();
      const next = result && typeof result === "object" && "next" in result
        ? (result as { next?: unknown }).next
        : null;
      if (typeof next === "string" &&
        next.startsWith("/admin/roasting") && !next.startsWith("//")) {
        window.location.assign(next);
        return;
      }
      throw new Error("Respuesta de importación inesperada");
    } catch {
      setMessage(
        "No se completó el envío. El JSON sigue listo en esta pantalla: " +
        "comprueba la conexión e intenta de nuevo. No se confirmó ningún tueste.",
      );
      setSubmitting(false);
    }
  }

  return <form action="/api/roasting/hibean/upload"
    method="post" encType="multipart/form-data"
    className="stack" onSubmit={event=>void submitSnapshot(event)}>
    <label>
      JSON de HiBean
      <input name="roastFile" type="file" accept=".json,application/json"
        required onChange={event=>void checkFile(event.target.files?.[0])} />
    </label>
    <small className="muted">
      Máximo {MAX_HIBEAN_JSON_MB} MB por archivo. El navegador conserva
      una copia del JSON para que Android no tenga que abrirlo dos veces.
      No se registra el batch ni se descuenta inventario sin tu confirmación.
    </small>
    {selectedName&&<small className="muted">Archivo: {selectedName}</small>}
    {message&&<p role="status" className={ready?"status-ok":"status-warn"}>{message}</p>}
    <button type="submit" disabled={!ready||submitting}>
      {submitting?"Enviando copia de JSON…":"Leer JSON y revisar antes de registrar"}
    </button>
  </form>;
}
