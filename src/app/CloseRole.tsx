"use client";

import { useState } from "react";
import type { Applicant, Job, Role } from "@/lib/schemas";
import type { ClosureResult, Problem } from "@/lib/closure";

type RowState = {
  phase: "idle" | "running" | "done";
  result?: ClosureResult;
  sent?: boolean;
  // recruiter edits: an edited message must be re-checked by the critic before it can be sent
  message?: string;
  checking?: boolean;
  editProblems?: Problem[];
  editFixed?: Problem[];
  editChecked?: boolean;
};

const CONCURRENCY = 4;
const MANUAL_MINUTES = 8; // assumption for the time-saved estimate: writing one personal, careful rejection by hand

const STATUS: Record<ClosureResult["status"], { label: string; cls: string }> = {
  ready: { label: "Ready to send", cls: "bg-emerald-100 text-emerald-800" },
  revised: { label: "Fixed by critic", cls: "bg-sky-100 text-sky-800" },
  needs_review: { label: "Needs your review", cls: "bg-amber-100 text-amber-800" },
  held: { label: "Held: check your reason", cls: "bg-rose-100 text-rose-800" },
};

const groundLabel = (g?: string | null) => (g ? g.replace(/_/g, " ") : "");

export default function CloseRole({ role, applicants, jobs }: { role: Role; applicants: Applicant[]; jobs: Job[] }) {
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(applicants.map((a) => [a.id, a.note])));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function runOne(id: string) {
    setRows((r) => ({ ...r, [id]: { phase: "running" } }));
    try {
      const res = await fetch("/api/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, applicant: applicants.find((a) => a.id === id), note: notes[id] }),
      });
      const result: ClosureResult = await res.json();
      setRows((r) => ({ ...r, [id]: { phase: "done", result, message: result.draft?.message } }));
    } catch (e) {
      const result = { applicantId: id, status: "needs_review", draft: null, firstDraft: null, problemsFound: [], remaining: [], noteIssue: null, trace: [], error: (e as Error).message } as ClosureResult;
      setRows((r) => ({ ...r, [id]: { phase: "done", result } }));
    }
  }

  const patch = (id: string, p: Partial<RowState>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));

  async function checkEdit(id: string, fix: boolean) {
    const row = rows[id];
    patch(id, { checking: true });
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, applicant: applicants.find((a) => a.id === id), note: notes[id], message: row.message, fix }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      patch(id, {
        checking: false,
        message: j.message,
        editProblems: j.problems,
        editFixed: fix ? j.fixed : row.editFixed,
        editChecked: j.problems.length === 0,
      });
    } catch {
      patch(id, { checking: false });
    }
  }

  async function closeRole() {
    const t = Date.now();
    setStarted(t);
    setElapsed(null);
    const queue = applicants.map((a) => a.id);
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) await runOne(queue.shift()!);
      }),
    );
    setElapsed(Date.now() - t);
  }

  const results = Object.values(rows).map((r) => r.result).filter(Boolean) as ClosureResult[];
  const count = (s: ClosureResult["status"]) => results.filter((r) => r.status === s).length;
  const running = Object.values(rows).some((r) => r.phase === "running");
  // Bulk send only what's safe: checked by the critic, not held, and any edits re-checked.
  const sendable = Object.entries(rows)
    .filter(([, r]) => {
      const st = r.result?.status;
      const edited = r.result?.draft && r.message !== r.result.draft.message;
      return !r.sent && (st === "ready" || st === "revised") && (!edited || r.editChecked);
    })
    .map(([id]) => id);
  const sentCount = Object.values(rows).filter((r) => r.sent).length;
  const job = (id: string) => jobs.find((j) => j.id === id);

  return (
    <div>
        {/* Role being closed */}
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-violet-600">Closing role</p>
              <h1 className="text-2xl font-semibold">{role.title}</h1>
              <p className="text-sm text-stone-600">
                {role.company} · {role.location} · {role.workType}
                {role.applicantCount > 0 && ` · ${role.applicantCount} applicants`}
              </p>
              {role.hired && <p className="mt-1 text-sm text-emerald-700">✓ {role.hired}</p>}
            </div>
            <button
              onClick={closeRole}
              disabled={running}
              className="rounded-lg bg-violet-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              {running ? "Drafting…" : `Close role: draft feedback for ${applicants.length} applicant${applicants.length > 1 ? "s" : ""}`}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {role.requirements.map((r) => (
              <span key={r.id} className="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-600">
                {r.kind === "must" ? "Must" : "Nice"}: {r.text}
              </span>
            ))}
          </div>
          {started && (
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <span>{results.length}/{applicants.length} drafted</span>
              <span className="text-emerald-700">{count("ready")} ready</span>
              <span className="text-sky-700">{count("revised")} fixed by critic</span>
              <span className="text-amber-700">{count("needs_review")} need review</span>
              <span className="text-rose-700">{count("held")} held</span>
              {elapsed && <span className="text-stone-500">in {(elapsed / 1000).toFixed(0)}s</span>}
            </div>
          )}
          {elapsed && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-violet-50 px-4 py-3 text-sm">
              <span className="text-violet-900">
                {sendable.length + sentCount} of {applicants.length} applicants get specific feedback and a next step instead of silence.
                Roughly {Math.round((applicants.length * MANUAL_MINUTES) / 60 * 10) / 10}h of writing saved
                <span className="text-violet-600"> (est. {MANUAL_MINUTES} min each by hand)</span>.
                {count("held") > 0 && ` ${count("held")} held for you to review your reason.`}
              </span>
              <button
                onClick={() => sendable.forEach((id) => patch(id, { sent: true }))}
                disabled={sendable.length === 0}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {sendable.length ? `Send all ${sendable.length} ready` : sentCount ? `${sentCount} sent ✓` : "Nothing ready to send"}
              </button>
            </div>
          )}
        </section>

        {/* Applicants */}
        <section className="mt-6 space-y-2">
          {applicants.map((a) => {
            const row = rows[a.id];
            const r = row?.result;
            const isOpen = open === a.id;
            return (
              <div key={a.id} className="rounded-xl border border-stone-200 bg-white">
                <button
                  onClick={() => setOpen(isOpen ? null : a.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left"
                >
                  <span className="w-40 shrink-0 font-medium">{a.name}</span>
                  <span className="flex-1 truncate text-sm text-stone-500">
                    {notes[a.id] ? `Your note: “${notes[a.id]}”` : "No note"}
                  </span>
                  {row?.phase === "running" && <span className="animate-pulse text-sm text-violet-600">drafting & checking…</span>}
                  {r && (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS[r.status].cls}`}>
                      {row.sent ? "Sent ✓" : STATUS[r.status].label}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <Detail
                    a={a}
                    note={notes[a.id]}
                    setNote={(v) => setNotes((n) => ({ ...n, [a.id]: v }))}
                    row={row}
                    rerun={() => runOne(a.id)}
                    send={() => patch(a.id, { sent: true })}
                    edit={(m) => patch(a.id, { message: m, editChecked: false, editProblems: undefined })}
                    checkEdit={(fix) => checkEdit(a.id, fix)}
                    role={role}
                    job={job}
                  />
                )}
              </div>
            );
          })}
        </section>
    </div>
  );
}

function Detail({
  a,
  note,
  setNote,
  row,
  rerun,
  send,
  edit,
  checkEdit,
  role,
  job,
}: {
  a: Applicant;
  note: string;
  setNote: (v: string) => void;
  row?: RowState;
  rerun: () => void;
  send: () => void;
  edit: (m: string) => void;
  checkEdit: (fix: boolean) => void;
  role: Role;
  job: (id: string) => Job | undefined;
}) {
  const [view, setView] = useState<"recruiter" | "candidate">("recruiter");
  const r = row?.result;
  const d0 = r?.draft;
  // What the candidate sees is always the current (possibly edited) message.
  const d = d0 && row?.message !== undefined ? { ...d0, message: row.message } : d0;
  const edited = !!d0 && row?.message !== d0.message;
  const canSend = r?.status !== "held" && !row?.sent && (!edited || row?.editChecked);

  return (
    <div className="border-t border-stone-100 px-4 pb-5 pt-4">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 text-sm">
          <span className="text-stone-500">Your private note (never sent to the applicant)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: the job-related reason, e.g. 'needed commercial React experience'"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <button onClick={rerun} disabled={row?.phase === "running"} className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 disabled:opacity-50">
          {r ? "Re-draft" : "Draft this one"}
        </button>
      </div>

      {!r && <p className="text-sm text-stone-500">{row?.phase === "running" ? "Drafting and checking…" : "Not drafted yet."}</p>}
      {r?.error && <p className="text-sm text-rose-700">Couldn&apos;t draft: {r.error}. Try again.</p>}

      {r?.status === "held" && r.noteIssue && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-semibold">Held. Your reason appears to rely on {groundLabel(r.noteIssue.ground) || "an unexplained judgement"}.</p>
          <p className="mt-1">{r.noteIssue.explanation}</p>
          <p className="mt-2">
            Closure won&apos;t send a message that covers this with a different reason. Reconsider this application, or record the
            job-related reason in your note and re-draft.
          </p>
        </div>
      )}

      {r && d && (
        <>
          <div className="mb-3 flex gap-2 text-sm">
            {(["recruiter", "candidate"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 ${view === v ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`}
              >
                {v === "recruiter" ? "Review" : `What ${a.name.split(" ")[0]} sees`}
              </button>
            ))}
          </div>

          {view === "candidate" ? (
            <CandidateView d={d} job={job} />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {/* The message */}
              <div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs text-stone-500">Subject</p>
                  <p className="mb-3 font-medium">{d.subject}</p>
                  <textarea
                    value={d.message}
                    onChange={(e) => edit(e.target.value)}
                    rows={14}
                    className="w-full resize-y rounded border border-transparent bg-transparent text-sm leading-relaxed hover:border-stone-300 focus:border-violet-400 focus:bg-white focus:outline-none"
                  />
                  <p className="text-xs text-stone-400">You can edit this. Edits are re-checked before sending.</p>
                </div>

                {edited && !row?.editChecked && (
                  <button
                    onClick={() => checkEdit(false)}
                    disabled={row?.checking}
                    className="mt-3 w-full rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                  >
                    {row?.checking ? "Checking…" : "Check my edits"}
                  </button>
                )}
                {row?.editProblems && row.editProblems.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-medium text-amber-900">Your edit needs another look:</p>
                    {row.editProblems.map((p, i) => (
                      <ProblemRow key={i} p={p} />
                    ))}
                    <button
                      onClick={() => checkEdit(true)}
                      disabled={row.checking}
                      className="w-full rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {row.checking ? "Fixing…" : "Fix the wording for me"}
                    </button>
                  </div>
                )}
                {edited && row?.editChecked && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    ✓ Your edited message passed the check.
                    {row.editFixed && row.editFixed.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs font-semibold uppercase">Fixed in your edit</p>
                        {row.editFixed.map((p, i) => (
                          <ProblemRow key={i} p={p} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={send}
                  disabled={!canSend}
                  className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {row?.sent
                    ? "Sent ✓"
                    : r.status === "held"
                      ? "Can't send while held"
                      : edited && !row?.editChecked
                        ? "Check your edits first"
                        : "Approve & send"}
                </button>
              </div>

              {/* Why it's safe to send */}
              <div className="space-y-4 text-sm">
                <Block title="Against the role's requirements">
                  {d.assessment.map((x) => {
                    const req = role.requirements.find((q) => q.id === x.requirementId);
                    const icon = x.status === "met" ? "✓" : x.status === "partial" ? "◐" : "✗";
                    const col = x.status === "met" ? "text-emerald-700" : x.status === "partial" ? "text-amber-700" : "text-rose-700";
                    return (
                      <div key={x.requirementId} className="flex gap-2">
                        <span className={`${col} w-4 shrink-0`}>{icon}</span>
                        <span>
                          {req?.text ?? x.requirementId}
                          {x.evidence && <Quote q={x.evidence} />}
                        </span>
                      </div>
                    );
                  })}
                </Block>

                <Block title="Next steps for the applicant">
                  {d.nextSteps.map((n, i) => (
                    <div key={i}>
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${n.kind === "show_it" ? "bg-violet-100 text-violet-800" : "bg-stone-200 text-stone-800"}`}>
                        {n.kind === "show_it" ? "Show it" : "Build it"}
                      </span>
                      {n.advice}
                      {n.evidence && <Quote q={n.evidence} />}
                    </div>
                  ))}
                </Block>

                {d.redirects.length > 0 && (
                  <Block title="Better-fit roles on ZEIL">
                    {d.redirects.map((x) => (
                      <div key={x.jobId}>
                        <span className="font-medium">{job(x.jobId)?.title}</span> · {job(x.jobId)?.company}
                        <p className="text-stone-600">{x.why}</p>
                      </div>
                    ))}
                  </Block>
                )}

                <Block title="Checks before sending">
                  <p className="text-stone-600">Every quote above was found word-for-word in the CV. Unverifiable claims are removed.</p>
                  {r.problemsFound.length > 0 ? (
                    <div className="space-y-2">
                      <p className="font-medium text-sky-800">Caught in the first draft and fixed:</p>
                      {r.problemsFound.map((p, i) => (
                        <ProblemRow key={i} p={p} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-emerald-700">✓ Critic found no problems in the first draft.</p>
                  )}
                  {r.remaining.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-medium text-amber-800">Still needs your eye:</p>
                      {r.remaining.map((p, i) => (
                        <ProblemRow key={i} p={p} />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-stone-500">
                    {r.trace.map((t, i) => (
                      <span key={i}>
                        {t.step}
                        {t.ms ? ` ${(t.ms / 1000).toFixed(1)}s` : ""}: {t.note}
                      </span>
                    ))}
                  </div>
                </Block>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Quote({ q }: { q: string }) {
  return <span className="ml-1 rounded bg-yellow-100 px-1 text-xs text-stone-700">“{q}”</span>;
}

function ProblemRow({ p }: { p: Problem }) {
  const label = p.type === "protected_ground" ? `Prohibited ground: ${groundLabel(p.ground)}` : p.type.replace(/_/g, " ");
  return (
    <div className="rounded border border-stone-200 p-2">
      <p className="text-xs font-semibold uppercase text-stone-500">{label}</p>
      <p className="line-through decoration-rose-400">“{p.excerpt}”</p>
      <p className="text-stone-600">{p.explanation}</p>
    </div>
  );
}

function CandidateView({ d, job }: { d: NonNullable<ClosureResult["draft"]>; job: (id: string) => Job | undefined }) {
  return (
    <div className="mx-auto max-w-sm rounded-[2rem] border-8 border-stone-900 bg-white p-5 shadow-xl">
      <p className="text-xs font-semibold text-violet-600">ZEIL · Application update</p>
      <p className="mt-1 font-semibold">{d.subject}</p>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{d.message}</p>
      {d.nextSteps.length > 0 && (
        <div className="mt-4 rounded-lg bg-violet-50 p-3 text-sm">
          <p className="mb-1 font-semibold">Your next steps</p>
          <ul className="list-disc space-y-1 pl-4">
            {d.nextSteps.map((n, i) => (
              <li key={i}>{n.advice}</li>
            ))}
          </ul>
        </div>
      )}
      {d.redirects.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold">Roles you&apos;re a stronger fit for</p>
          {d.redirects.map((x) => {
            const j = job(x.jobId);
            return (
              <div key={x.jobId} className="rounded-lg border border-stone-200 p-3 text-sm">
                <p className="font-medium">{j?.title}</p>
                <p className="text-stone-500">
                  {j?.company} · {j?.location} · {j?.salaryRange}
                </p>
                <p className="mt-1 text-stone-700">{x.why}</p>
                <button className="mt-2 w-full rounded-lg bg-violet-600 py-1.5 font-medium text-white">Apply with one swipe →</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
