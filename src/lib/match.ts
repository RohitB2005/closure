import type { Candidate, Job, MatchResult } from "./schemas";

/**
 * Deterministic baseline matcher. No AI.
 * Used (1) as the fallback when the LLM is unavailable and
 * (2) to sanity-check AI scores: "AI explains, code checks".
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");

export function skillOverlap(candidateSkills: string[], jobSkills: string[]) {
  const have = new Set(candidateSkills.map(norm));
  const matched = jobSkills.filter((s) => have.has(norm(s)));
  const missing = jobSkills.filter((s) => !have.has(norm(s)));
  return { matched, missing, ratio: jobSkills.length ? matched.length / jobSkills.length : 0 };
}

export function baselineMatch(candidate: Candidate, jobs: Job[]): MatchResult[] {
  return jobs
    .map((job) => {
      const { matched, missing, ratio } = skillOverlap(candidate.skills, job.skills);
      const locationOk =
        candidate.preferences.locations.some((l) => job.location.toLowerCase().includes(l.toLowerCase())) ||
        job.location.toLowerCase().includes("remote");
      const typeOk = candidate.preferences.workTypes.includes(job.workType);
      const score = Math.round(ratio * 70 + (locationOk ? 15 : 0) + (typeOk ? 15 : 0));
      const reasons = [
        matched.length ? `Has ${matched.length}/${job.skills.length} required skills: ${matched.join(", ")}` : "",
        locationOk ? `Location fits (${job.location})` : "",
        typeOk ? `Wants ${job.workType} work` : "",
      ].filter(Boolean);
      const gaps = [
        missing.length ? `Missing: ${missing.join(", ")}` : "",
        !locationOk ? `Location mismatch (${job.location})` : "",
        !typeOk ? `Prefers ${candidate.preferences.workTypes.join("/")}, job is ${job.workType}` : "",
      ].filter(Boolean);
      return { jobId: job.id, score, reasons, gaps };
    })
    .sort((a, b) => b.score - a.score);
}
