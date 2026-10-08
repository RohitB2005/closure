"use client";

import { useState } from "react";
import type { Applicant, Job, Role } from "@/lib/schemas";
import CloseRole from "./CloseRole";
import BuildRole from "./BuildRole";

type Mode = { kind: "demo" } | { kind: "build" } | { kind: "custom"; role: Role; applicants: Applicant[] };

export default function App({ role, applicants, jobs }: { role: Role; applicants: Applicant[]; jobs: Job[] }) {
  const [mode, setMode] = useState<Mode>({ kind: "demo" });
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
            <button className={tab(mode.kind !== "demo")} onClick={() => setMode({ kind: "build" })}>
              Your own role
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {mode.kind === "demo" && <CloseRole key="demo" role={role} applicants={applicants} jobs={jobs} />}
        {mode.kind === "build" && <BuildRole onReady={(r, a) => setMode({ kind: "custom", role: r, applicants: a })} />}
        {mode.kind === "custom" && <CloseRole key={mode.applicants.map((a) => a.id).join()} role={mode.role} applicants={mode.applicants} jobs={jobs} />}
      </div>
    </main>
  );
}
