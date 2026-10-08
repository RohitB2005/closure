import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, llmConfigured } from "@/lib/llm";

/** GET /api/health -> confirms an API key works before you rely on it. */
export async function GET() {
  if (!llmConfigured()) return NextResponse.json({ ok: false, reason: "No GEMINI_API_KEY or OPENROUTER_API_KEY set" });
  const r = await generateObject({
    schema: z.object({ ok: z.boolean(), greeting: z.string() }),
    system: "Health check.",
    user: 'Say hello to the ZEIL Hackathon. Return {"ok": true, "greeting": "<one short sentence>"}',
  });
  return NextResponse.json(r ? { ok: true, model: r.model, greeting: r.data.greeting } : { ok: false, reason: "All providers failed — see server log" });
}
