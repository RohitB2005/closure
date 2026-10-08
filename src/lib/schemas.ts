import { z } from "zod";

/** Shared shapes for Closure. Data files are validated against these at load time. */

export const Job = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workType: z.enum(["Full-time", "Part-time", "Contract", "Casual", "Internship"]),
  salaryRange: z.string().optional(),
  skills: z.array(z.string()),
  description: z.string(),
});
export type Job = z.infer<typeof Job>;

export const Requirement = z.object({ id: z.string(), text: z.string(), kind: z.enum(["must", "nice"]) });
export const Role = Job.extend({
  requirements: z.array(Requirement),
  hired: z.string(),
  applicantCount: z.number(),
});
export type Role = z.infer<typeof Role>;

export const Applicant = z.object({ id: z.string(), name: z.string(), note: z.string(), cv: z.string() });
export type Applicant = z.infer<typeof Applicant>;

/** Prohibited grounds of discrimination, NZ Human Rights Act 1993 s21. */
export const GROUNDS = [
  "sex",
  "marital_status",
  "religious_belief",
  "ethical_belief",
  "colour",
  "race",
  "ethnic_or_national_origins",
  "disability",
  "age",
  "political_opinion",
  "employment_status",
  "family_status",
  "sexual_orientation",
] as const;
export const Ground = z.enum(GROUNDS);

const evidence = z
  .string()
  .describe("EXACT verbatim substring copied from the CV (3-12 words). Never paraphrase.");

/** What the writer model returns: the structured reasoning AND the message built from it. */
export const Draft = z.object({
  assessment: z
    .array(
      z.object({
        requirementId: z.string(),
        status: z.enum(["met", "partial", "not_shown"]),
        evidence: evidence.nullable().describe("Verbatim CV quote supporting the status, or null if nothing in the CV"),
      }),
    )
    .describe("One entry per role requirement"),
  strengths: z
    .array(z.object({ point: z.string(), evidence }))
    .min(1)
    .max(2)
    .describe("Genuine, specific strengths of this application"),
  nextSteps: z
    .array(
      z.object({
        kind: z
          .enum(["show_it", "build_it"])
          .describe("show_it = CV hints they have it but didn't show it clearly; build_it = a genuine gap"),
        requirementId: z.string(),
        advice: z.string().describe("One concrete, realistic action"),
        evidence: evidence.nullable().describe("Required for show_it: the CV text that hints at the skill"),
      }),
    )
    .min(1)
    .max(3),
  redirects: z
    .array(
      z.object({
        jobId: z.string(),
        why: z.string().describe("Why they fit this role better, in one sentence"),
        evidence,
      }),
    )
    .max(2)
    .describe("0-2 other open roles from the list where this person clearly fits better. Empty if none fit."),
  subject: z.string(),
  message: z.string().describe("The email to the applicant, 110-170 words"),
});
export type Draft = z.infer<typeof Draft>;

export const Critique = z.object({
  issues: z.array(
    z.object({
      type: z.enum(["protected_ground", "unsupported_claim", "generic", "harsh", "false_promise"]),
      ground: Ground.nullable().describe("Which prohibited ground, if type is protected_ground"),
      excerpt: z.string().describe("The exact problematic words from the message"),
      explanation: z.string(),
      fix: z.string().describe("How to fix it"),
    }),
  ),
  noteIssue: z
    .object({ ground: Ground.nullable(), explanation: z.string() })
    .nullable()
    .describe("Set if the recruiter's private note relies on a prohibited ground or an unexplained 'fit' judgement"),
});
export type Critique = z.infer<typeof Critique>;
