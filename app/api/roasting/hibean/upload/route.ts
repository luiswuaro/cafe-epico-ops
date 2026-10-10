import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { stageHiBeanRoastImport } from "@/app/(admin)/admin/roasting/import-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Support both normal browser POSTs (303 redirect) and the memory-backed
 * mobile upload (JSON response, navigated explicitly by the client).
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;

  function finish(path: string, status = 200) {
    if (!path.startsWith("/admin/roasting") || path.startsWith("//")) {
      throw new Error("Unexpected import destination");
    }
    if (wantsJson) {
      return NextResponse.json({ next: path }, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.redirect(new URL(path, request.url), 303);
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return finish("/admin/roasting?error=hibean-file", 400);
    }
    const body = await request.formData();
    const file = body.get("roastFile");
    const bytes = file instanceof File ? file.size : 0;
    const path = await stageHiBeanRoastImport(body);
    console.info("HIBEAN_STAGE_RESULT", {
      result: path.includes("/import/") ? "STAGED" : "REJECTED",
      bytes,
      elapsedMs: Date.now() - startedAt,
    });
    return finish(path);
  } catch (error) {
    const reference = randomUUID().slice(0, 8).toUpperCase();
    console.error("HIBEAN_UPLOAD_FAILURE", {
      reference,
      elapsedMs: Date.now() - startedAt,
      type: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 300) : "Unexpected error",
    });
    return finish("/admin/roasting?error=hibean-server&ref=" + reference, 500);
  }
}
