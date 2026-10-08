import { NextResponse } from "next/server";
import { z } from "zod";
import { applicants, runClosure } from "@/lib/closure";

const Body = z.object({ applicantId: z.string(), note: z.string().optional() });

/**
 * POST /api/close { applicantId, note? }
 * Drafts, verifies and critiques the feedback for one applicant. The client runs a few of these
 * at a time to close a whole role, so each row can show progress as it finishes.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const a = applicants.find((x) => x.id === parsed.data.applicantId);
  if (!a) return NextResponse.json({ error: "Unknown applicant" }, { status: 404 });
  const result = await runClosure({ ...a, note: parsed.data.note ?? a.note });
  return NextResponse.json(result);
}

export const maxDuration = 60;
