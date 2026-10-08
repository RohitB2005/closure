import { z } from "zod";

/** Shared shapes for the jobs domain. Edit freely once the challenge is known. */

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

export const Candidate = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  headline: z.string(),
  yearsExperience: z.number(),
  skills: z.array(z.string()),
  preferences: z.object({
    workTypes: z.array(z.string()),
    locations: z.array(z.string()),
  }),
  summary: z.string(),
});
export type Candidate = z.infer<typeof Candidate>;

/** What the AI returns when it reads a CV / free text. */
export const ExtractedProfile = z.object({
  name: z.string().describe("Full name, or 'Unknown'"),
  headline: z.string().describe("One-line professional headline"),
  location: z.string().describe("City/region, or 'Unknown'"),
  yearsExperience: z.number().describe("Best estimate of years of relevant experience"),
  skills: z.array(z.string()).describe("Concrete skills, tools and qualifications"),
  summary: z.string().describe("2 sentence plain-English summary"),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfile>;

/** One explained match. Reasons must be grounded in the job/candidate text. */
export const MatchResult = z.object({
  jobId: z.string(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).describe("Why this is a good match, citing specific skills/preferences"),
  gaps: z.array(z.string()).describe("Missing skills or mismatches the candidate should know about"),
});
export const MatchResponse = z.object({ matches: z.array(MatchResult) });
export type MatchResult = z.infer<typeof MatchResult>;
