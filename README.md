# ZEIL hackathon starter

A working Next.js + TypeScript + Tailwind app with AI job matching already wired up, so hackathon time goes on the challenge, not setup.

## Set up tonight (10 minutes)
1. `npm install`
2. Copy `.env.example` to `.env.local` and paste your OpenRouter key into `OPENROUTER_API_KEY`.
3. `npm run dev` → open http://localhost:3000 → click **Find matches**.
4. Check http://localhost:3000/api/health shows `"ok": true`. If it does, your key works.
5. `git init && git add -A && git commit -m "starter"` so you can always roll back.

Tomorrow, follow **DAY_OF.md**. Claude Code reads **CLAUDE.md** automatically. The starter is an optional head start; Claude Code decides the approach once the challenge is known.

## What's inside
- **`src/lib/llm.ts`** – one `generateObject()` for every AI call: schema in the prompt, zod validation, retry and model fallback, `null` if AI is unavailable.
- **`src/lib/match.ts`** – deterministic skill-overlap matcher (no AI) used as the fallback, so the demo never dies.
- **`/api/match`** – ranks jobs for a candidate with reasons and gaps (AI, falling back to the baseline; unknown job IDs are dropped).
- **`/api/extract`** – turns pasted CV text into a structured profile.
- **`src/data/*.json`** – realistic NZ jobs and candidates.

Tested: production build and lint pass; the AI path was tested against a mock model (invalid JSON triggers a retry, fenced JSON is parsed, made-up job IDs are filtered) and the no-key path falls back to the baseline.
