import { NextResponse } from "next/server";
export function GET() { return NextResponse.json({ ok: true, service: "cafe-epico-ops", version: "0.1.0" }); }
