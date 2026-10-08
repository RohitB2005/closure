import { NextResponse } from "next/server";
import { z } from "zod";
import jobsData from "@/data/jobs.json";
import { Candidate, Job, MatchResponse } from "@/lib/schemas";
import { baselineMatch } from "@/lib/match";
import { generateObject } from "@/lib/llm";

const jobs = z.array(Job).parse(jobsData);
const Body = z.object({ candidate: Candidate });

/**
 * POST /api/match  { candidate }
 * Returns jobs ranked for the candidate with reasons + gaps.
 * AI ranks and explains; if AI is unavailable or returns unknown job IDs, we fall back to the baseline.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { candidate } = parsed.data;

  const baseline = baselineMatch(candidate, jobs);

  const ai = await generateObject({
    schema: MatchResponse,
    system:
      "You are a fair, transparent job-matching assistant for a New Zealand jobs marketplace. " +
      "Score each job 0-100 for this candidate. Every reason and gap must refer to specific skills, location or work-type " +
      "facts present in the data. Never use age, gender, ethnicity, name or nationality as a factor.",
    user: JSON.stringify({ candidate, jobs }),
  });

  if (ai) {
    const known = new Set(jobs.map((j) => j.id));
    const matches = ai.data.matches.filter((m) => known.has(m.jobId)); // drop hallucinated IDs
    if (matches.length) {
      matches.sort((a, b) => b.score - a.score);
      return NextResponse.json({ source: "ai", model: ai.model, matches, baseline });
    }
  }
  return NextResponse.json({ source: "baseline", matches: baseline, baseline });
}
