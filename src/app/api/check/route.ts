import { NextResponse } from "next/server";
import { z } from "zod";
import { applicants, critiqueEdit, fixEdit } from "@/lib/closure";

const Body = z.object({ applicantId: z.string(), note: z.string().optional(), message: z.string().min(1), fix: z.boolean().optional(), criticFast: z.boolean().optional() });

/**
 * POST /api/check { applicantId, message, note?, fix? }
 * Re-critiques a recruiter-edited message. With fix=true, rewrites only the flagged wording
 * and critiques the result again, so what comes back is always checked.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const found = applicants.find((x) => x.id === parsed.data.applicantId);
  if (!found) return NextResponse.json({ error: "Unknown applicant" }, { status: 404 });
  const a = { ...found, note: parsed.data.note ?? found.note };
  let message = parsed.data.message;

  let crit = await critiqueEdit(a, message, parsed.data.criticFast);
  if (!crit) return NextResponse.json({ error: "Critic unavailable, try again" }, { status: 503 });
  const before = crit.problems;
  if (parsed.data.fix && before.length) {
    const fixed = await fixEdit(a, message, before);
    if (!fixed) return NextResponse.json({ error: "Writer unavailable, try again" }, { status: 503 });
    message = fixed;
    crit = await critiqueEdit(a, message);
    if (!crit) return NextResponse.json({ error: "Critic unavailable, try again" }, { status: 503 });
  }
  return NextResponse.json({ message, problems: crit.problems, fixed: parsed.data.fix ? before : [], noteIssue: crit.noteIssue });
}

export const maxDuration = 60;
