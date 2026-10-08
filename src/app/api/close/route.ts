import { NextResponse } from "next/server";
import { z } from "zod";
import { applicants, role as demoRole, runClosure } from "@/lib/closure";
import { Applicant, Role } from "@/lib/schemas";

const Body = z.object({
  // demo data by id...
  applicantId: z.string().optional(),
  note: z.string().max(1000).optional(),
  // ...or the recruiter's own role and applicant
  role: Role.optional(),
  applicant: Applicant.extend({ cv: z.string().min(20).max(20000) }).optional(),
});

/**
 * POST /api/close { applicantId | applicant, role?, note? }
 * Drafts, verifies and critiques the feedback for one applicant. The client runs a few of these
 * at a time to close a whole role, so each row can show progress as it finishes.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { applicantId, applicant, note, role } = parsed.data;
  const a = applicant ?? applicants.find((x) => x.id === applicantId);
  if (!a) return NextResponse.json({ error: "Unknown applicant" }, { status: 404 });
  const result = await runClosure({ ...a, note: note ?? a.note }, role ?? demoRole);
  return NextResponse.json(result);
}

export const maxDuration = 60;
