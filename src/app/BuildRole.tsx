"use client";

import { useState } from "react";
import type { Applicant, Role } from "@/lib/schemas";
import { keyHeaders } from "./ApiKey";

type Dropped = { text: string; reason: string };

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(f);
  });

/** Bring your own role: paste a job ad, review the screening requirements, add applicants (PDF or text). */
export default function BuildRole({
  onReady,
  apiKey,
  live,
  requireKey,
}: {
  onReady: (role: Role, applicants: Applicant[]) => void;
  apiKey: string | null;
  live: boolean;
  requireKey: () => boolean;
}) {
  const [ad, setAd] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [dropped, setDropped] = useState<Dropped[]>([]);
  const [readingAd, setReadingAd] = useState(false);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [reading, setReading] = useState<string[]>([]); // file names being read
  const [form, setForm] = useState({ name: "", cv: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  async function readAd() {
    if (!requireKey()) return;
    setReadingAd(true);
    setError(null);
    try {
      const res = await fetch("/api/role", { method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders(apiKey) }, body: JSON.stringify({ jobAd: ad }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setRole(j.role);
      setDropped(j.dropped);
    } catch (e) {
      setError((e as Error).message);
    }
    setReadingAd(false);
  }

  async function addPdfs(files: File[]) {
    if (!requireKey()) return;
    setError(null);
    await Promise.all(
      files.map(async (f) => {
        setReading((r) => [...r, f.name]);
        try {
          if (f.size > 3_000_000) throw new Error(`${f.name} is over 3MB`);
          const res = await fetch("/api/cv", { method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders(apiKey) }, body: JSON.stringify({ pdfBase64: await toBase64(f) }) });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error);
          setApps((a) => [...a, { id: `u${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: j.name, cv: j.cv, note: "" }]);
        } catch (e) {
          setError((e as Error).message);
        }
        setReading((r) => r.filter((n) => n !== f.name));
      }),
    );
  }

  function addPasted() {
    const name = form.name.trim() || form.cv.trim().split("\n")[0].slice(0, 40) || "Applicant";
    setApps((a) => [...a, { id: `u${Date.now()}`, name, cv: form.cv.trim(), note: form.note.trim() }]);
    setForm({ name: "", cv: "", note: "" });
  }

  const setReq = (i: number, patch: Partial<Role["requirements"][number]>) =>
    role && setRole({ ...role, requirements: role.requirements.map((q, k) => (k === i ? { ...q, ...patch } : q)) });

  return (
    <div className="space-y-6">
      {!live && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
          This tab runs the models live on your role and CVs, so it needs{" "}
          <button onClick={requireKey} className="text-violet-700 underline">
            your OpenRouter API key
          </button>
          .
        </p>
      )}
      {/* 1. Job ad */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-600">Step 1 · The role</p>
        <h2 className="text-lg font-semibold">Paste the job ad</h2>
        <textarea
          value={ad}
          onChange={(e) => setAd(e.target.value)}
          rows={7}
          placeholder="Paste the full job ad: title, company, what the role needs…"
          className="mt-2 w-full rounded-lg border border-stone-300 p-3 text-sm"
        />
        <button onClick={readAd} disabled={readingAd || ad.trim().length < 40} className="mt-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {readingAd ? "Reading…" : role ? "Read again" : "Read job ad"}
        </button>

        {role && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <input value={role.title} onChange={(e) => setRole({ ...role, title: e.target.value })} className="flex-1 rounded border border-stone-300 px-2 py-1 font-semibold" />
              <input value={role.company} onChange={(e) => setRole({ ...role, company: e.target.value })} className="flex-1 rounded border border-stone-300 px-2 py-1" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Screening requirements (edit freely)</p>
            {role.requirements.map((q, i) => (
              <div key={q.id} className="flex gap-2 text-sm">
                <select value={q.kind} onChange={(e) => setReq(i, { kind: e.target.value as "must" | "nice" })} className="rounded border border-stone-300 px-1">
                  <option value="must">Must</option>
                  <option value="nice">Nice</option>
                </select>
                <input value={q.text} onChange={(e) => setReq(i, { text: e.target.value })} className="flex-1 rounded border border-stone-300 px-2 py-1" />
                <button onClick={() => setRole({ ...role, requirements: role.requirements.filter((_, k) => k !== i) })} className="px-2 text-stone-400 hover:text-rose-600" aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setRole({ ...role, requirements: [...role.requirements, { id: `r${Date.now()}`, text: "", kind: "must" }] })}
              className="text-sm text-violet-700"
            >
              + Add requirement
            </button>
            {dropped.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Left out of screening: these aren&apos;t lawful job requirements</p>
                {dropped.map((d, i) => (
                  <p key={i} className="mt-1">
                    <span className="line-through decoration-amber-500">“{d.text}”</span> · {d.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Applicants */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-600">Step 2 · Applicants not progressed</p>
        <h2 className="text-lg font-semibold">Add their CVs</h2>

        <label className="mt-3 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-stone-300 p-5 text-sm text-stone-600 hover:border-violet-400">
          <span className="font-medium">Upload PDF CVs</span>
          <span className="text-xs text-stone-400">Gemini reads each PDF and transcribes it word for word</span>
          <input
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              // Copy the files, then clear the input so picking the same PDF again still fires onChange.
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              addPdfs(files);
            }}
          />
        </label>
        {reading.map((n) => (
          <p key={n} className="mt-1 animate-pulse text-sm text-violet-600">
            Reading {n}…
          </p>
        ))}

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-stone-600">…or paste a CV as text</summary>
          <div className="mt-2 space-y-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Applicant name" className="w-full rounded border border-stone-300 px-2 py-1" />
            <textarea value={form.cv} onChange={(e) => setForm({ ...form, cv: e.target.value })} rows={5} placeholder="CV text" className="w-full rounded border border-stone-300 p-2" />
            <button onClick={addPasted} disabled={form.cv.trim().length < 20} className="rounded-lg bg-stone-900 px-3 py-1.5 text-white disabled:opacity-40">
              Add applicant
            </button>
          </div>
        </details>

        {apps.length > 0 && (
          <div className="mt-4 space-y-2">
            {apps.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2 text-sm">
                <span className="w-40 font-medium">{a.name}</span>
                <input
                  value={a.note}
                  onChange={(e) => setApps((x) => x.map((y) => (y.id === a.id ? { ...y, note: e.target.value } : y)))}
                  placeholder="Your private note: why not progressed (optional)"
                  className="flex-1 rounded border border-stone-300 px-2 py-1"
                />
                <button onClick={() => setApps((x) => x.filter((y) => y.id !== a.id))} className="px-2 text-stone-400 hover:text-rose-600" aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button
        onClick={() => role && onReady({ ...role, requirements: role.requirements.filter((q) => q.text.trim()) }, apps)}
        disabled={!role || apps.length === 0 || reading.length > 0}
        className="w-full rounded-lg bg-violet-600 px-5 py-3 font-medium text-white hover:bg-violet-700 disabled:opacity-40"
      >
        {!role ? "Read a job ad first" : apps.length === 0 ? "Add at least one applicant" : `Continue: close this role for ${apps.length} applicant${apps.length > 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
