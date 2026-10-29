import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, llmConfigured, NO_KEY, withUserKey } from "@/lib/llm";

/** GET /api/health -> confirms an API key works before you rely on it (the UI uses it to check a visitor's key). */
export async function GET(req: Request) {
  return withUserKey(req, async () => {
    if (!llmConfigured()) return NextResponse.json({ ok: false, reason: NO_KEY });
    const r = await generateObject({
      schema: z.object({ ok: z.boolean(), greeting: z.string() }),
      system: "Health check.",
      user: 'Return {"ok": true, "greeting": "<one short sentence>"}',
    });
    return NextResponse.json(r ? { ok: true, model: r.model, greeting: r.data.greeting } : { ok: false, reason: "The key didn't work: check it and try again" });
  });
}
