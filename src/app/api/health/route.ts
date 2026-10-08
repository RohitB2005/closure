import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, llmConfigured } from "@/lib/llm";

/** GET /api/health -> confirms the API key works before you rely on it. */
export async function GET() {
  if (!llmConfigured()) return NextResponse.json({ ok: false, reason: "OPENROUTER_API_KEY not set" });
  const r = await generateObject({
    schema: z.object({ ok: z.boolean() }),
    system: "Health check.",
    user: 'Return {"ok": true}',
  });
  return NextResponse.json(r ? { ok: true, model: r.model } : { ok: false, reason: "All models failed — see server log" });
}
