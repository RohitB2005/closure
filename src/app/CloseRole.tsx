"use client";

import { useEffect, useState } from "react";
import type { Applicant, Job, Role } from "@/lib/schemas";
import type { ClosureResult, Problem, Stage } from "@/lib/closure";

type RowState = {
  phase: "idle" | "running" | "done";
  stage?: Stage;
  result?: ClosureResult;
  sent?: boolean;
  // recruiter edits: an edited message must be re-checked by the critic before it can be sent
  message?: string;
  checking?: boolean;
  editProblems?: Problem[];
  editFixed?: Problem[];
  editChecked?: boolean;
};

const CONCURRENCY = 12; // own OpenRouter quota (not the shared key), so the whole batch can run at once
const MANUAL_MINUTES = 8; // assumption for the time-saved estimate: writing one personal, careful rejection by hand

const STATUS: Record<ClosureResult["status"], { label: string; cls: string }> = {
  ready: { label: "Ready to send", cls: "bg-emerald-100 text-emerald-800" },
  revised: { label: "Fixed by critic", cls: "bg-sky-100 text-sky-800" },
  needs_review: { label: "Needs your review", cls: "bg-amber-100 text-amber-800" },
  held: { label: "Held: check your reason", cls: "bg-rose-100 text-rose-800" },
};

const groundLabel = (g?: string | null) => (g ? g.replace(/_/g, " ") : "");

export default function CloseRole({ role, applicants, jobs, guide = false }: { role: Role; applicants: Applicant[]; jobs: Job[]; guide?: boolean }) {
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(applicants.map((a) => [a.id, a.note])));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function runOne(id: string) {
    setRows((r) => ({ ...r, [id]: { phase: "running" } }));
    const body = JSON.stringify({ role, applicant: applicants.find((a) => a.id === id), note: notes[id], stream: true });
    // Streams {stage} lines while the pipeline runs, then {result}.
    const attempt = async (): Promise<ClosureResult> => {
      const res = await fetch("/api/close", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.stage) setRows((r) => ({ ...r, [id]: { ...r[id], stage: msg.stage } }));
          if (msg.result) return msg.result;
        }
      }
      throw new Error("Stream ended early");
    };
    try {
      // One automatic retry: cold starts and the shared Gemini quota occasionally fail a single request.
      const result = await attempt().catch(attempt);
      setRows((r) => ({ ...r, [id]: { phase: "done", result, message: result.draft?.message } }));
    } catch (e) {
      const result = { applicantId: id, status: "needs_review", draft: null, firstDraft: null, problemsFound: [], remaining: [], noteIssue: null, cvManipulation: null, trace: [], error: (e as Error).message } as ClosureResult;
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

  // Ticks the live timer while a role is closing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!started || elapsed) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [started, elapsed]);

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
        {guide && (
          <div className="mb-4 grid gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 md:grid-cols-3">
            <p>
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">1</span>
              You&apos;re the recruiter. You&apos;ve hired for this role; these 12 weren&apos;t progressed. Click <b>Close role</b>.
            </p>
            <p>
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">2</span>
              Click any applicant to open their feedback. Try <b>Aroha</b> (normal), <b>Ahmed</b> (held), <b>Sam</b> (edit the message).
            </p>
            <p>
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">3</span>
              In an open applicant, switch to <b>What they see</b> to compare with today&apos;s template rejection.
            </p>
          </div>
        )}
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
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Would be ghosted" value={applicants.length - results.length} tone={results.length === applicants.length ? "good" : "bad"} sub={started ? `of ${applicants.length}` : "today"} />
            <Stat label="Personal feedback ready" value={count("ready") + count("revised")} tone="good" sub={count("revised") ? `${count("revised")} fixed by critic` : "checked by critic"} />
            <Stat label="Held for your review" value={count("held") + count("needs_review")} tone="warn" sub={
              count("held") + count("needs_review") === 0
                ? "nothing flagged"
                : [count("held") && `${count("held")} unlawful reason${count("held") > 1 ? "s" : ""}`, count("needs_review") && `${count("needs_review")} to check`].filter(Boolean).join(" · ")
            } />
            <Stat label="Time" value={started ? `${Math.round(((elapsed ?? now - started) as number) / 1000)}s` : "–"} tone="neutral" sub={`vs ~${Math.round((applicants.length * MANUAL_MINUTES) / 6) / 10}h by hand`} />
          </div>
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
                  {row?.phase === "running" && <Pipeline stage={row.stage} />}
                  {!row && running && <span className="text-sm text-stone-400">Queued</span>}
                  {r && (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS[r.status].cls}`}>
                      {row.sent ? "Sent ✓" : STATUS[r.status].label}
                    </span>
                  )}
                  <span className={`text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
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
          {d0 && (
            <p className="mt-2 font-medium">
              Against the role&apos;s own requirements, {a.name.split(" ")[0]} meets {d0.assessment.filter((x) => x.status === "met").length} of{" "}
              {d0.assessment.length}.
            </p>
          )}
          <p className="mt-2">
            Closure won&apos;t send a message that covers this with a different reason, so the draft is withheld. Reconsider this application, or
            record the job-related reason in your note and re-draft.
          </p>
        </div>
      )}

      {r?.cvManipulation && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">This CV contains instructions aimed at AI screening. They were ignored.</p>
          <p className="mt-1 italic">“{r.cvManipulation}”</p>
          <p className="mt-1">The message below is based only on the applicant&apos;s actual experience. You may want to consider this when reviewing.</p>
        </div>
      )}

      {r && d && r.status === "held" && (
        <div className="text-sm">
          <Block title="Against the role's requirements">
            {d.assessment.map((x) => (
              <AssessRow key={x.requirementId} x={x} role={role} />
            ))}
          </Block>
        </div>
      )}

      {r && d && r.status !== "held" && (
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
            <CandidateView d={d} job={job} name={a.name} company={role.company} />
          ) : (
            <>
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
                {(edited || !!row?.editFixed?.length) && row?.editChecked && (
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
                    : edited && !row?.editChecked
                        ? "Check your edits first"
                        : "Approve & send"}
                </button>
              </div>

              {/* Why it's safe to send */}
              <div className="space-y-4 text-sm">
                <Block title="Against the role's requirements">
                  {d.assessment.map((x) => (
                    <AssessRow key={x.requirementId} x={x} role={role} />
                  ))}
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
            <CvPanel cv={a.cv} quotes={quotesOf(d)} name={a.name} manipulation={r.cvManipulation} />
            </>
          )}
        </>
      )}
    </div>
  );
}

const quotesOf = (d: NonNullable<ClosureResult["draft"]>) =>
  [...d.assessment.map((x) => x.evidence), ...d.strengths.map((x) => x.evidence), ...d.nextSteps.map((x) => x.evidence), ...d.redirects.map((x) => x.evidence)].filter(
    (q): q is string => !!q,
  );

/** Character ranges in the CV covered by the quotes (quotes were already verified server-side). */
function highlightRanges(cv: string, quotes: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const q of quotes)
    for (const part of q.split(/\.\.\.|…/)) {
      const p = part.trim().replace(/^["'“‘]+|["'”’.,;:]+$/g, "");
      if (p.length < 3) continue;
      const pattern = p
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+")
        .replace(/['‘’]/g, "['‘’]")
        .replace(/[–—-]/g, "[–—-]");
      for (const m of cv.matchAll(new RegExp(pattern, "gi"))) ranges.push([m.index!, m.index! + m[0].length]);
    }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

function CvPanel({ cv, quotes, name, manipulation }: { cv: string; quotes: string[]; name: string; manipulation?: string | null }) {
  const ranges = highlightRanges(cv, quotes).map(([s, e]) => [s, e, false] as [number, number, boolean]);
  // Text aimed at the AI is shown in red so the recruiter sees exactly what was attempted.
  if (manipulation) {
    const i = cv.indexOf(manipulation.slice(0, 40));
    if (i >= 0) {
      const end = Math.min(cv.length, i + manipulation.length);
      for (let k = ranges.length - 1; k >= 0; k--) if (ranges[k][0] < end && ranges[k][1] > i) ranges.splice(k, 1);
      ranges.push([i, end, true]);
      ranges.sort((x, y) => x[0] - y[0]);
    }
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e, bad], i) => {
    if (s > at) parts.push(cv.slice(at, s));
    parts.push(
      <mark key={i} className={`rounded px-0.5 ${bad ? "bg-rose-200 text-rose-900 line-through decoration-rose-500" : "bg-yellow-200 text-stone-900"}`}>
        {cv.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  parts.push(cv.slice(at));
  return (
    <div className="mt-5 rounded-lg border border-stone-200 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
        {name.split(" ")[0]}&apos;s CV · <span className="normal-case text-stone-400">highlighted text is what the feedback quotes. Code checked every quote is really here.</span>
      </p>
      <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700">{parts}</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone: "good" | "bad" | "warn" | "neutral" }) {
  const col = { good: "text-emerald-700", bad: "text-rose-600", warn: "text-amber-700", neutral: "text-stone-900" }[tone];
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${col}`}>{value}</p>
      <p className="text-xs text-stone-500">{sub}</p>
    </div>
  );
}

const STAGES: { key: Stage | "verify"; label: string }[] = [
  { key: "writing", label: "Writer drafts" },
  { key: "checking", label: "Code checks quotes · critic reviews" },
];

/** Live per-row view of the two-model pipeline. */
function Pipeline({ stage }: { stage?: Stage }) {
  const label =
    stage === "revising" ? "Critic sent it back · writer revising" : stage === "rechecking" ? "Re-checking the revision" : STAGES.find((s) => s.key === stage)?.label ?? "Queued";
  const step = stage === "writing" ? 1 : stage === "checking" ? 2 : stage === "revising" ? 3 : stage === "rechecking" ? 4 : 0;
  return (
    <span className="flex items-center gap-2 text-sm text-violet-700">
      <span className="flex gap-1">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 w-5 rounded-full ${step >= n ? (stage === "revising" && n === 3 ? "bg-amber-500" : "bg-violet-600") : "bg-stone-200"} ${step === n ? "animate-pulse" : ""}`} />
        ))}
      </span>
      <span className={stage === "revising" ? "text-amber-700" : ""}>{label}…</span>
    </span>
  );
}

function AssessRow({ x, role }: { x: NonNullable<ClosureResult["draft"]>["assessment"][number]; role: Role }) {
  const req = role.requirements.find((q) => q.id === x.requirementId);
  const icon = x.status === "met" ? "✓" : x.status === "partial" ? "◐" : "✗";
  const col = x.status === "met" ? "text-emerald-700" : x.status === "partial" ? "text-amber-700" : "text-rose-700";
  return (
    <div className="flex gap-2">
      <span className={`${col} w-4 shrink-0`}>{icon}</span>
      <span>
        {req?.text ?? x.requirementId}
        {x.evidence && <Quote q={x.evidence} />}
      </span>
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

// The rejection a real applicant (the author) received from most employers, word for word.
const TEMPLATE = "Unfortunately, we've picked a candidate whose experience aligns more closely with the role at this time. We wish you the best in your job search.";

function CandidateView({ d, job, name, company }: { d: NonNullable<ClosureResult["draft"]>; job: (id: string) => Job | undefined; name: string; company: string }) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <div>
        <p className="mb-2 text-center text-sm font-semibold uppercase tracking-wide text-stone-400">Today</p>
        <div className="mx-auto max-w-sm rounded-[2rem] border-8 border-stone-300 bg-white p-5 text-stone-500">
          <p className="text-xs font-semibold">Email · {company}</p>
          <p className="mt-1 font-semibold">Your application</p>
          <p className="mt-3 text-sm leading-relaxed">
            Hi {name.split(" ")[0]},
            <br />
            <br />
            {TEMPLATE}
          </p>
          <p className="mt-6 text-center text-xs italic">…or, for about half of applicants, nothing at all.</p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-center text-sm font-semibold uppercase tracking-wide text-violet-600">With Closure</p>
        <ClosurePhone d={d} job={job} />
      </div>
    </div>
  );
}

function ClosurePhone({ d, job }: { d: NonNullable<ClosureResult["draft"]>; job: (id: string) => Job | undefined }) {
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
