import { NextResponse } from "next/server";
import { z } from "zod";
import { extractRole } from "@/lib/intake";

const Body = z.object({ jobAd: z.string().min(40, "Paste the full job ad").max(15000) });

/** POST /api/role { jobAd } -> a Role with screening requirements, for the recruiter to review and edit. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const out = await extractRole(parsed.data.jobAd);
  if (!out) return NextResponse.json({ error: "Couldn't read that job ad, try again" }, { status: 503 });
  return NextResponse.json(out);
}

export const maxDuration = 60;
