"use client";

import { useState } from "react";
import type { Applicant, Job, Role } from "@/lib/schemas";
import CloseRole from "./CloseRole";
import BuildRole from "./BuildRole";
import HowItWorks from "./HowItWorks";

type Mode = { kind: "demo" } | { kind: "how" } | { kind: "build" } | { kind: "custom" };

export default function App({ role, applicants, jobs }: { role: Role; applicants: Applicant[]; jobs: Job[] }) {
  const [mode, setMode] = useState<Mode>({ kind: "demo" });
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
          <nav className="flex gap-1">
            <button className={tab(mode.kind === "demo")} onClick={() => setMode({ kind: "demo" })}>
              Demo role
            </button>
            <button className={tab(mode.kind === "build" || mode.kind === "custom")} onClick={() => setMode({ kind: custom ? "custom" : "build" })}>
              Your own role
            </button>
            <button className={tab(mode.kind === "how")} onClick={() => setMode({ kind: "how" })}>
              How it works
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Tabs stay mounted (just hidden) so switching tabs mid-demo never loses drafted results. */}
        <div className={mode.kind === "demo" ? "" : "hidden"}>
          <CloseRole role={role} applicants={applicants} jobs={jobs} guide />
        </div>
        <div className={mode.kind === "how" ? "" : "hidden"}>
          <HowItWorks />
        </div>
        <div className={mode.kind === "build" ? "" : "hidden"}>
          <BuildRole onReady={(r, a) => setCustom({ role: r, applicants: a })} />
        </div>
        {custom && (
          <div className={mode.kind === "custom" ? "" : "hidden"}>
            <button onClick={() => setMode({ kind: "build" })} className="mb-3 text-sm text-violet-700">
              ← Edit role and applicants
            </button>
            <CloseRole key={custom.applicants.map((a) => a.id).join() + custom.role.title} role={custom.role} applicants={custom.applicants} jobs={jobs} />
          </div>
        )}
      </div>
    </main>
  );
}
