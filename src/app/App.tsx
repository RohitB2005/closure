"use client";

import { useEffect, useState } from "react";
import type { Applicant, Job, Role } from "@/lib/schemas";
import type { ClosureResult } from "@/lib/closure";
import { KeyPanel, loadKey } from "./ApiKey";
import CloseRole from "./CloseRole";
import BuildRole from "./BuildRole";
import HowItWorks from "./HowItWorks";

type Mode = { kind: "demo" } | { kind: "how" } | { kind: "build" } | { kind: "custom" };

export default function App({
  role,
  applicants,
  jobs,
  recorded,
  serverKey,
}: {
  role: Role;
  applicants: Applicant[];
  jobs: Job[];
  recorded: ClosureResult[];
  serverKey: boolean; // the server has its own key (local dev); the public deployment doesn't
}) {
  const [mode, setMode] = useState<Mode>({ kind: "demo" });
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  useEffect(() => setApiKey(loadKey()), []);
  const live = serverKey || !!apiKey;
  // Anything that needs a live model calls this first: without a key it opens the key panel instead.
  const requireKey = () => {
    if (!live) setShowKey(true);
    return live;
  };
  const keyed = { apiKey, live, requireKey };
  const [custom, setCustomState] = useState<{ role: Role; applicants: Applicant[] } | null>(null);
  const setCustom = (c: { role: Role; applicants: Applicant[] }) => {
    setCustomState(c);
    setMode({ kind: "custom" });
  };
  const tab = (active: boolean) => `rounded-full px-3 py-1 text-sm ${active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`;

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-tight">
              Closure<span className="text-violet-600">.</span>
            </span>
            <span className="hidden text-sm text-stone-500 sm:inline">Every applicant hears back, with a reason and a next step.</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            <button className={tab(mode.kind === "demo")} onClick={() => setMode({ kind: "demo" })}>
              Demo role
            </button>
            <button className={tab(mode.kind === "build" || mode.kind === "custom")} onClick={() => setMode({ kind: custom ? "custom" : "build" })}>
              Your own role
            </button>
            <button className={tab(mode.kind === "how")} onClick={() => setMode({ kind: "how" })}>
              How it works
            </button>
            <button
              onClick={() => setShowKey((s) => !s)}
              className={`ml-2 rounded-full border px-3 py-1 text-sm ${apiKey ? "border-emerald-300 text-emerald-800" : "border-violet-300 text-violet-700 hover:bg-violet-50"}`}
            >
              {apiKey ? "API key ✓" : "Add API key"}
            </button>
          </nav>
        </div>
      </header>
      {showKey && <KeyPanel apiKey={apiKey} setApiKey={setApiKey} onClose={() => setShowKey(false)} />}

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Tabs stay mounted (just hidden) so switching tabs mid-demo never loses drafted results. */}
        <div className={mode.kind === "demo" ? "" : "hidden"}>
          <CloseRole role={role} applicants={applicants} jobs={jobs} recorded={recorded} guide {...keyed} />
        </div>
        <div className={mode.kind === "how" ? "" : "hidden"}>
          <HowItWorks />
        </div>
        <div className={mode.kind === "build" ? "" : "hidden"}>
          <BuildRole onReady={(r, a) => setCustom({ role: r, applicants: a })} {...keyed} />
        </div>
        {custom && (
          <div className={mode.kind === "custom" ? "" : "hidden"}>
            <button onClick={() => setMode({ kind: "build" })} className="mb-3 text-sm text-violet-700">
              ← Edit role and applicants
            </button>
            <CloseRole key={custom.applicants.map((a) => a.id).join() + custom.role.title} role={custom.role} applicants={custom.applicants} jobs={jobs} {...keyed} />
          </div>
        )}
      </div>
    </main>
  );
}
