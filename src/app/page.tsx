"use client";

import { useState } from "react";
import candidatesData from "@/data/candidates.json";
import jobsData from "@/data/jobs.json";
import type { Candidate, Job, MatchResult } from "@/lib/schemas";

const candidates = candidatesData as Candidate[];
const jobs = jobsData as Job[];
const jobById = (id: string) => jobs.find((j) => j.id === id);

type MatchApi = { source: "ai" | "baseline"; model?: string; matches: MatchResult[] };

export default function Home() {
  const [candidateId, setCandidateId] = useState(candidates[0].id);
  const [result, setResult] = useState<MatchApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const candidate = candidates.find((c) => c.id === candidateId)!;

  async function runMatch() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setResult(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Job Match</h1>
        <p className="mt-1 text-neutral-500">AI-ranked jobs with a clear reason for every match.</p>
      </header>

      <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <label className="text-sm font-medium" htmlFor="cand">Candidate</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <select
            id="cand"
            data-testid="candidate-select"
            className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
            value={candidateId}
            onChange={(e) => { setCandidateId(e.target.value); setResult(null); }}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {c.headline}</option>
            ))}
          </select>
          <button
            data-testid="match-button"
            onClick={runMatch}
            disabled={loading}
            className="rounded-lg bg-violet-600 px-5 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {loading ? "Matching…" : "Find matches"}
          </button>
        </div>
        <p className="mt-3 text-sm text-neutral-500">{candidate.summary}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {candidate.skills.map((s) => (
            <span key={s} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs dark:bg-neutral-800">{s}</span>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="mt-4 text-red-600">{error}</p>}

      {result && (
        <section className="mt-8" aria-live="polite">
          <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            {result.source === "ai" ? `Ranked by AI (${result.model})` : "Ranked by skill overlap (AI unavailable)"}
          </p>
          <ol className="space-y-3">
            {result.matches.slice(0, 5).map((m) => {
              const job = jobById(m.jobId);
              if (!job) return null;
              return (
                <li key={m.jobId} data-testid="match-card" className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold">{job.title}</h2>
                      <p className="text-sm text-neutral-500">{job.company} · {job.location} · {job.workType}{job.salaryRange ? ` · ${job.salaryRange}` : ""}</p>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums">{Math.round(m.score)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div className="h-1.5 rounded-full bg-violet-600" style={{ width: `${Math.min(100, m.score)}%` }} />
                  </div>
                  {m.reasons.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {m.reasons.map((r, i) => <li key={i}>✓ {r}</li>)}
                    </ul>
                  )}
                  {m.gaps.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
                      {m.gaps.map((g, i) => <li key={i}>△ {g}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}
