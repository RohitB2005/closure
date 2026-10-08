/** The approach on one screen: pipeline, the rule behind it, eval numbers, and what changed along the way. */

function Box({ who, title, body, tone }: { who: string; title: string; body: string; tone: "model" | "code" | "human" }) {
  const cls = {
    model: "border-violet-300 bg-violet-50",
    code: "border-emerald-300 bg-emerald-50",
    human: "border-stone-300 bg-white",
  }[tone];
  const tag = { model: "text-violet-700", code: "text-emerald-700", human: "text-stone-500" }[tone];
  return (
    <div className={`flex-1 rounded-xl border-2 p-4 ${cls}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tag}`}>{who}</p>
      <p className="mt-1 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-stone-600">{body}</p>
    </div>
  );
}

const Arrow = () => <div className="hidden shrink-0 self-center text-2xl text-stone-300 md:block">→</div>;

function Metric({ big, label, vs }: { big: string; label: string; vs: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-3xl font-semibold tabular-nums">{big}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="text-xs text-stone-500">{vs}</p>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-violet-600">How it works</p>
        <h1 className="text-2xl font-semibold">The model judges. Code decides.</h1>
        <p className="mt-1 max-w-3xl text-stone-600">
          Two Gemini models do the work: a writer (2.5 Flash, fast) and a critic (3.8 Flash, stronger, for the safety judgement). Everything that decides what can be sent is plain code: every quote
          checked against the CV, every job checked to exist, every status set by rules, and a human approves each message.
        </p>
      </section>

      <section className="flex flex-col gap-3 md:flex-row">
        <Box who="Recruiter" title="Closes the role" body="One click. Optional private note per applicant: the real reason." tone="human" />
        <Arrow />
        <Box who="Gemini · writer" title="Drafts feedback" body="Each requirement checked against the CV, with quotes. Show-it / build-it next step. Better-fit ZEIL roles." tone="model" />
        <Arrow />
        <Box who="Code" title="Verifies" body="Every quote must be word-for-word in the CV. Job IDs must exist. No links. Fails → sent back." tone="code" />
        <Arrow />
        <Box who="Gemini · critic" title="Reviews" body="Human Rights Act grounds and proxies, made-up claims, template filler, false promises, the note, CV manipulation." tone="model" />
        <Arrow />
        <Box who="Code" title="Decides status" body="Problems → one rewrite → re-check. Ready · fixed · needs review · held. Unlawful reason → held, never reworded." tone="code" />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Does it work? Measured, not claimed</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Metric big="8%" label="wording shared between messages" vs="a template shares 100%" />
          <Metric big="~7" label="CV facts cited per message" vs="every one verified by code" />
          <Metric big="27/27" label="critic eval cases passed" vs="bias, proxies, made-up claims, notes" />
          <Metric big="0/5" label="CV prompt-injection attacks worked" vs="5/5 flagged to the recruiter" />
        </div>
        <p className="mt-2 text-xs text-stone-500">Source: eval/RESULTS.md in the repo; every script runs against the live API.</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">What I changed my mind about</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ["The idea", "Started with detecting hidden prompts in CVs. Dropped it: already solved by applicant tracking systems, and it rarely works on current models. Ghosting is a problem people actually live with."],
            ["Where the risk is", "I expected the AI to write biased reasons. It never did. 4 of 12 recruiter notes were unlawful, and the writer covered for one with an invented reason. So: check notes and edits, and hold, never reword."],
            ["Thinking mode", "Assumed the critic needed to think to catch subtle proxies. The eval said no: same or better accuracy (27/27 vs 26/27) at 3× lower latency, and thinking was over-cautious. Switched it off."],
            ["When the shared key stalled", "At lunch the hackathon's shared Gemini key took 40s+ per call, so closing a role took 5 minutes. I measured the options and split the work: writer on Gemini 2.5 Flash (no thinking, ~5s), critic on Gemini 3.8 Flash (~2s). Re-ran every eval: still 27/27, still 0/5 attacks. Now ~14s for all 12."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-stone-600">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-stone-900 p-5 text-stone-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Next, inside ZEIL</p>
        <p className="mt-1">
          A &ldquo;close listing&rdquo; action, with messages delivered in-app and one-swipe apply on suggested roles. ZEIL gets a metric it can&apos;t
          see today, <span className="font-semibold">closure rate</span>: the share of applicants who heard back, per employer.
        </p>
      </section>
    </div>
  );
}
