import { NextResponse } from "next/server";
import { z } from "zod";
import { llmConfigured, NO_KEY, withUserKey } from "@/lib/llm";
import { applicants, role as demoRole, runClosure } from "@/lib/closure";
import { Applicant, Role } from "@/lib/schemas";

const Body = z.object({
  // demo data by id...
  applicantId: z.string().optional(),
  note: z.string().max(1000).optional(),
  // ...or the recruiter's own role and applicant
  role: Role.optional(),
  applicant: Applicant.extend({ cv: z.string().min(20).max(20000) }).optional(),
  stream: z.boolean().optional(), // NDJSON: {stage} lines while working, then {result}
});

/**
 * POST /api/close { applicantId | applicant, role?, note? }
 * Drafts, verifies and critiques the feedback for one applicant. The client runs a few of these
 * at a time to close a whole role, so each row can show progress as it finishes.
 */
export async function POST(req: Request) {
  return withUserKey(req, async () => {
    if (!llmConfigured()) return NextResponse.json({ error: NO_KEY }, { status: 401 });
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { applicantId, applicant, note, role, stream } = parsed.data;
    const found = applicant ?? applicants.find((x) => x.id === applicantId);
    if (!found) return NextResponse.json({ error: "Unknown applicant" }, { status: 404 });
    const a = { ...found, note: note ?? found.note };
    if (!stream) return NextResponse.json(await runClosure(a, role ?? demoRole));

    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        const result = await runClosure(a, role ?? demoRole, (stage) => send({ stage }));
        send({ result });
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
  });
}

export const maxDuration = 60;
