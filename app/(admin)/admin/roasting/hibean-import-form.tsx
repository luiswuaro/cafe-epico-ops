"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { startHiBeanRoastImport } from "./import-actions";
import {
  MAX_HIBEAN_JSON_BYTES,
  MAX_HIBEAN_JSON_MB,
} from "@/src/domain/roasting/upload-constraints";

function UploadButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={!ready || pending}>
    {pending ? "Leyendo JSON… espera sin cerrar" : "Leer JSON y revisar antes de registrar"}
  </button>;
}

/**
 * El cliente evita que archivos excesivos o JSON inválidos provoquen
 * el error global (413 del proxy o del límite de Server Actions).
 * Nada se inserta hasta que el usuario confirma la vista previa posterior.
 */
export function HiBeanImportForm() {
  const [message, setMessage] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [ready, setReady] = useState(false);
  const version = useRef(0);

  async function checkFile(file: File | undefined) {
    const current = ++version.current;
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
    setMessage("Comprobando JSON…");
    try {
      const text = await file.text();
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("root");
      }
      if (version.current !== current) return;
      setMessage("JSON válido · " + (file.size / 1_000).toFixed(0) +
        " KB · se revisarán los datos antes de registrar.");
      setReady(true);
    } catch {
      if (version.current !== current) return;
      setMessage("El archivo no es JSON válido. Vuelve a exportarlo desde HiBean; no se registró ningún tueste.");
    }
  }

  return <form action={startHiBeanRoastImport} encType="multipart/form-data"
    className="stack">
    <label>
      JSON de HiBean
      <input name="roastFile" type="file" accept=".json,application/json"
        required onChange={event=>void checkFile(event.target.files?.[0])} />
    </label>
    <small className="muted">
      Máximo {MAX_HIBEAN_JSON_MB} MB por archivo. OPS sólo prepara la revisión;
      el tueste y las existencias no se registran hasta tu confirmación.
    </small>
    {selectedName&&<small className="muted">Archivo: {selectedName}</small>}
    {message&&<p role="status" className={ready?"status-ok":"status-warn"}>{message}</p>}
    <UploadButton ready={ready}/>
  </form>;
}
