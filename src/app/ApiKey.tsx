"use client";

import { useState } from "react";

/** Same header name as KEY_HEADER in src/lib/llm.ts (that module is server-only, so it isn't imported here). */
const KEY_HEADER = "x-openrouter-key";
export const keyHeaders = (key: string | null): Record<string, string> => (key ? { [KEY_HEADER]: key } : {});

const STORE = "closure.openrouterKey";
// Kept for this browser tab only: sessionStorage is cleared when the tab closes.
export const loadKey = () => {
  try {
    return sessionStorage.getItem(STORE);
  } catch {
    return null;
  }
};
const saveKey = (key: string | null) => {
  try {
    if (key) sessionStorage.setItem(STORE, key);
    else sessionStorage.removeItem(STORE);
  } catch {}
};

/** Visitors run Closure live on their own OpenRouter key. The key is checked with one tiny call before it's kept. */
export function KeyPanel({ apiKey, setApiKey, onClose }: { apiKey: string | null; setApiKey: (k: string | null) => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setChecking(true);
    setError(null);
    try {
      const j = await (await fetch("/api/health", { headers: keyHeaders(draft.trim()) })).json();
      if (!j.ok || !String(j.model).startsWith("openrouter")) throw new Error(j.reason ?? "OpenRouter didn't accept that key");
      saveKey(draft.trim());
      setApiKey(draft.trim());
      setDraft("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
    setChecking(false);
  }

  function remove() {
    saveKey(null);
    setApiKey(null);
  }

  return (
    <div className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-semibold">Run Closure live with your own OpenRouter API key</p>
            <p className="mt-1 text-stone-600">
              Closure uses Gemini Flash models through OpenRouter, so a full run uses very little credit. Your key stays in this browser tab and is sent with
              each request to this app&apos;s server, which passes it straight to OpenRouter. It&apos;s never stored or logged.{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-violet-700 underline">
                Get a key
              </a>
            </p>
          </div>
          <button onClick={onClose} className="px-2 text-stone-400 hover:text-stone-700" aria-label="Close">
            ×
          </button>
        </div>
        {apiKey ? (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-emerald-700">✓ Using your key (…{apiKey.slice(-4)})</span>
            <button onClick={remove} className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">
              Remove key
            </button>
          </div>
        ) : (
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-or-…"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2"
            />
            <button disabled={checking || draft.trim().length < 10} className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white disabled:opacity-40">
              {checking ? "Checking…" : "Use this key"}
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-rose-700">{error}</p>}
      </div>
    </div>
  );
}
