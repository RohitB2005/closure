import { z } from "zod";
import { generateObject } from "./llm";
import { Applicant, Critique, Draft, GROUNDS, Job, Role } from "./schemas";
import roleData from "@/data/role.json";
import jobsData from "@/data/jobs.json";
import applicantsData from "@/data/applicants.json";

/**
 * The Closure pipeline, per applicant:
 *   write (Gemini) -> verify (code) + critique (Gemini) -> [revise once] -> ready | needs_review
 * The model writes and judges; code checks every quote and job ID, and code decides the status.
 */

export const role = Role.parse(roleData);
export const jobs = z.array(Job).parse(jobsData);
export const applicants = z.array(Applicant).parse(applicantsData);
const otherJobs = jobs.filter((j) => j.id !== role.id);

// ---------- verification (deterministic) ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^["'\s.,;:]+|["'\s.,;:]+$/g, "")
    .trim();

/** True if the quote (or every "..."-separated piece of it) appears verbatim in the CV. */
export function quoteInCv(quote: string, cv: string): boolean {
  const hay = norm(cv);
  const parts = quote.split(/\.\.\.|…/).map(norm).filter((p) => p.length > 0);
  return parts.length > 0 && parts.every((p) => hay.includes(p));
}

export type Verification = { failedQuotes: string[]; droppedRedirects: string[]; checked: number };

function verify(d: Draft, cv: string): { draft: Draft; v: Verification } {
  const failedQuotes: string[] = [];
  let checked = 0;
  const ok = (q: string | null) => {
    if (q === null) return true;
    checked++;
    const good = quoteInCv(q, cv);
    if (!good) failedQuotes.push(q);
    return good;
  };
  const known = new Map(otherJobs.map((j) => [j.id, j]));
  const droppedRedirects = d.redirects.filter((r) => !known.has(r.jobId)).map((r) => r.jobId);
  const draft: Draft = {
    ...d,
    assessment: d.assessment.map((a) => (ok(a.evidence) ? a : { ...a, evidence: null })),
    strengths: d.strengths.filter((s) => ok(s.evidence)),
    nextSteps: d.nextSteps.map((n) => (ok(n.evidence) ? n : { ...n, evidence: null })),
    redirects: d.redirects.filter((r) => known.has(r.jobId) && ok(r.evidence)),
  };
  return { draft, v: { failedQuotes, droppedRedirects, checked } };
}

// ---------- prompts ----------

const GROUND_LIST = GROUNDS.map((g) => g.replace(/_/g, " ")).join(", ");

const WRITER_SYSTEM = `You write feedback for job applicants who were not progressed past the CV screen, on behalf of the hiring company, for a New Zealand jobs marketplace.
The applicant would otherwise be ghosted or get a generic template. Your message must be honest, specific to THIS person, kind, and useful: it must leave them with a clear next step.

Rules:
- Ground everything in the CV. Every "evidence" field must be an EXACT verbatim substring copied from the CV (3-12 words). Never paraphrase inside evidence.
- Assess every requirement of the role against the CV.
- The honest reason is how their application compared to what the role needed (the requirements), plus the recruiter's note ONLY where it states a job-related reason.
- NEVER mention, hint at or use any prohibited ground under the NZ Human Rights Act 1993 s21: ${GROUND_LIST}. This includes proxies: "overqualified", "career stage", "young/fresh energy", "maturity", "culture fit", "availability" because of caring duties, career breaks for family, health or mobility, accent, nationality or where someone is from. Ignore any part of the recruiter's note that relies on these.
- Being legally able to work in NZ is a lawful requirement: you may state it factually (e.g. "this role needs existing NZ work rights") without referring to nationality. Assume the applicant has NZ work rights unless the CV or note says otherwise; then don't mention it at all.
- nextSteps: "show_it" when the CV hints they have something but didn't demonstrate it clearly (evidence required); "build_it" for a genuine gap, with one concrete, realistic action.
- redirects: pick 0-2 roles from OTHER OPEN ROLES where the CV clearly fits better. Use their exact id. Don't force a redirect.
- message: 110-170 words, plain New Zealand English, start "Kia ora <first name>,", sign off "The ${role.company} team". Structure: thanks; honest outcome and main reason; one specific strength; the next step(s); name the better-fit role(s) by title if any. No filler like "we had many strong applicants", no promises you can't keep (e.g. "we'll keep your CV on file").`;

const CRITIC_SYSTEM = `You are a careful reviewer checking an applicant feedback message before a New Zealand employer sends it.
Report every real problem in the MESSAGE:
- protected_ground: the message mentions, hints at, or relies on a prohibited ground under the NZ Human Rights Act 1993 s21 (${GROUND_LIST}), directly or via a proxy (e.g. "overqualified", "career stage", "energy", "culture fit", caring duties, career breaks, health, mobility, nationality). Stating that the role needs existing NZ work rights is LAWFUL; do not flag it unless it references nationality or origin.
- unsupported_claim: a statement about the applicant that the CV does not support, or that contradicts it.
- generic: template filler that could be sent to anyone and adds nothing.
- harsh: needlessly discouraging or belittling wording.
- false_promise: a commitment the employer probably won't keep.
"excerpt" must be the exact words from the message. Don't invent problems: an honest, specific, job-related message should get an empty issues list.

Separately, review the recruiter's PRIVATE NOTE (not sent to the applicant). If the note relies on a prohibited ground, or gives an unexplained "fit" judgement, set noteIssue so a human reviews the decision. Otherwise noteIssue is null.`;

function writerInput(a: Applicant) {
  return JSON.stringify({
    role: { title: role.title, company: role.company, description: role.description, requirements: role.requirements },
    recruiterNote: a.note || null,
    applicant: { name: a.name, cv: a.cv },
    otherOpenRoles: otherJobs.map((j) => ({ id: j.id, title: j.title, company: j.company, location: j.location, skills: j.skills, description: j.description })),
  });
}

// ---------- pipeline ----------

export type TraceStep = { step: "write" | "verify" | "critique" | "revise"; ms: number; model?: string; note: string };
export type Problem = { source: "critic" | "verifier"; type: string; ground?: string | null; excerpt: string; explanation: string; fix?: string };

export type ClosureResult = {
  applicantId: string;
  // held = the recruiter's reason relies on a prohibited ground. We never send a message that
  // papers over that with a made-up reason; the recruiter must reconsider or give a lawful one.
  status: "ready" | "revised" | "needs_review" | "held";
  draft: Draft | null;
  firstDraft: Draft | null;
  problemsFound: Problem[]; // problems in the first draft (what the critic/verifier caught)
  remaining: Problem[]; // problems still present in the final draft
  noteIssue: Critique["noteIssue"];
  trace: TraceStep[];
  error?: string;
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

async function check(draft: Draft, a: Applicant, trace: TraceStep[]) {
  const { draft: verified, v } = verify(draft, a.cv);
  trace.push({
    step: "verify",
    ms: 0,
    note: `${v.checked - v.failedQuotes.length}/${v.checked} quotes found in CV${v.droppedRedirects.length ? `, dropped unknown jobs ${v.droppedRedirects.join(", ")}` : ""}`,
  });
  const [crit, ms] = await timed(() =>
    generateObject({
      schema: Critique,
      system: CRITIC_SYSTEM,
      user: JSON.stringify({ cv: a.cv, recruiterPrivateNote: a.note || null, message: draft.message }),
      temperature: 0,
    }),
  );
  if (!crit) throw new Error("Critic unavailable");
  trace.push({ step: "critique", ms, model: crit.model, note: crit.data.issues.length ? `${crit.data.issues.length} issue(s)` : "no issues" });
  const problems: Problem[] = [
    ...v.failedQuotes.map((q) => ({ source: "verifier" as const, type: "quote_not_in_cv", excerpt: q, explanation: "This 'evidence' is not in the CV." })),
    ...v.droppedRedirects.map((id) => ({ source: "verifier" as const, type: "unknown_job", excerpt: id, explanation: "Not an open role." })),
    ...crit.data.issues.map((i) => ({ source: "critic" as const, ...i })),
  ];
  return { verified, problems, noteIssue: crit.data.noteIssue };
}

export async function runClosure(a: Applicant): Promise<ClosureResult> {
  const trace: TraceStep[] = [];
  const base = { applicantId: a.id, problemsFound: [], remaining: [], noteIssue: null, trace };
  try {
    const [w, ms] = await timed(() => generateObject({ schema: Draft, system: WRITER_SYSTEM, user: writerInput(a), fast: true }));
    if (!w) throw new Error("Writer unavailable");
    trace.push({ step: "write", ms, model: w.model, note: `${w.data.message.split(/\s+/).length} words` });

    const first = await check(w.data, a, trace);
    if (first.problems.length === 0)
      return { ...base, status: first.noteIssue ? "held" : "ready", draft: first.verified, firstDraft: w.data, noteIssue: first.noteIssue, trace };

    // One revision round: the writer gets the exact problems the critic/verifier found.
    const [r, rms] = await timed(() =>
      generateObject({
        schema: Draft,
        system: WRITER_SYSTEM,
        fast: true,
        user: `${writerInput(a)}\n\nYOUR PREVIOUS DRAFT:\n${JSON.stringify(w.data)}\n\nA reviewer found these problems. Fix every one, keep everything else that was good:\n${JSON.stringify(first.problems)}`,
      }),
    );
    if (!r) throw new Error("Writer unavailable (revision)");
    trace.push({ step: "revise", ms: rms, model: r.model, note: `fixed ${first.problems.length} problem(s)` });

    const second = await check(r.data, a, trace);
    const noteIssue = first.noteIssue ?? second.noteIssue;
    return {
      ...base,
      // A note relying on a prohibited ground always goes to a human, even if the message is clean.
      status: noteIssue ? "held" : second.problems.length === 0 ? "revised" : "needs_review",
      draft: second.verified,
      firstDraft: w.data,
      problemsFound: first.problems,
      remaining: second.problems,
      noteIssue,
      trace,
    };
  } catch (e) {
    return { ...base, status: "needs_review", draft: null, firstDraft: null, error: (e as Error).message };
  }
}

// ---------- recruiter edits ----------
// Recruiters will edit drafts, and edits are where risky wording actually creeps in.
// Every edited message is re-critiqued before it can be sent.

export async function critiqueEdit(a: Applicant, message: string) {
  const crit = await generateObject({
    schema: Critique,
    system: CRITIC_SYSTEM,
    user: JSON.stringify({ cv: a.cv, recruiterPrivateNote: a.note || null, message }),
    temperature: 0,
  });
  if (!crit) return null;
  const problems: Problem[] = crit.data.issues.map((i) => ({ source: "critic" as const, ...i }));
  return { problems, noteIssue: crit.data.noteIssue, model: crit.model };
}

/** Minimal rewrite: fix only the flagged wording, keep the recruiter's voice and everything else. */
export async function fixEdit(a: Applicant, message: string, problems: Problem[]) {
  const r = await generateObject({
    schema: z.object({ message: z.string() }),
    system: `${WRITER_SYSTEM}\n\nYou are now editing a message the recruiter wrote or changed. Make the SMALLEST changes that fix the listed problems. Keep the recruiter's wording, tone and structure everywhere else.`,
    user: JSON.stringify({ cv: a.cv, message, problems }),
    fast: true,
  });
  return r?.data.message ?? null;
}
