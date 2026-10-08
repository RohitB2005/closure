# Closure

**Closure helps recruiters give every rejected applicant honest, specific, lawful feedback and a next step, in one click.**

Live: **https://closure-mu.vercel.app** (no login: click *Close role*)
Built by **Rohit Balaji** (solo) at the ZEIL Hackathon, 9 October 2026.

## The problem

I'm a third-year software engineering student. I've applied for 50 to 75 roles. About half never replied, and every rejection I did get was the same line, *"we've picked a candidate whose experience aligns more closely with the role"*. Not one told me anything I could act on.

I'm not unusual. Most applicants never hear back. Surveys put it at around two in three job seekers being ghosted, and roughly 8 in 10 hiring managers admit to doing it. Those who do hear back usually get a copy-paste template with nothing they can act on. For a marketplace like ZEIL that's a real loss: nearly half of ghosted candidates say they won't apply again. Swipe-to-apply makes applying effortless, so the volume (and the silence) is higher still.

ZEIL's team told me they can't see this either: whether an applicant hears back happens between the employer and the applicant, so it's invisible to the marketplace in the middle.

Recruiters don't ghost because they don't care. They ghost because writing 147 honest, personal messages takes hours, and a careless reason ("overqualified", "worried about your availability with kids") is a legal risk under the NZ Human Rights Act.

## What it does

A recruiter closes a role. For every applicant who didn't pass the CV screen, Closure drafts a message that:

1. **Gives the honest reason:** how their application compared with what the role needed. Every claim is backed by a quote from their CV, and code checks each quote really is in the CV.
2. **Gives a next step:** either **"Show it"** (you have this, but your CV didn't show it clearly) or **"Build it"** (a genuine gap, with one concrete action).
3. **Points them to 0–2 other open ZEIL roles** they're a stronger fit for, so a rejection becomes their next application.

Before anything can be sent, a second model (the **critic**) checks the message and the recruiter's private note:

- **Prohibited grounds** under the NZ Human Rights Act 1993 s21, including proxies such as "overqualified", "earlier career stage", "digital native" or caring-related career breaks.
- **Claims the CV doesn't support,** template filler and false promises.
- **If the recruiter's own reason is discriminatory, the message is held.** In early testing the writer, told to ignore a note like "he uses a wheelchair and our office has stairs", invented a plausible-sounding reason to cover for it. Closure will not do that: it holds the message and asks the recruiter to reconsider or record a lawful, job-related reason.
- **Recruiter edits are re-checked before sending,** with an optional "fix the wording for me" that changes only the flagged words.

## How it works

```
recruiter clicks "Close role"
  └─ for each applicant (4 at a time):
       writer   (Gemini)  → structured draft: per-requirement assessment with CV quotes,
                            strengths, show-it/build-it next steps, redirects, message
       verify   (code)    → every quote must appear verbatim in the CV; job IDs must exist
       critic   (Gemini)  → issues in the message + any issue with the recruiter's note
       revise   (Gemini)  → one round, given the exact problems found
       status   (code)    → ready | fixed by critic | needs review | held
```

- **Models:** `gemini-flash-latest` (currently Gemini 3.8 Flash) through the Gemini API, with OpenRouter (Gemini models) as an automatic fallback if the shared quota returns a 429. Both writer and critic run with thinking turned off. The eval showed no accuracy loss at about 3× lower latency (see below).
- **Strict shapes:** every model reply is JSON validated against a zod schema ([`src/lib/schemas.ts`](src/lib/schemas.ts)). A reply that doesn't match is retried, then the next provider is tried. If everything fails, the row shows "Couldn't draft, try again" and never sends anything unchecked.
- **The model judges, code decides:** status, quote verification and redirect validation are deterministic ([`src/lib/closure.ts`](src/lib/closure.ts)).

### Key files
- [`src/lib/closure.ts`](src/lib/closure.ts): the pipeline and prompts
- [`src/lib/llm.ts`](src/lib/llm.ts): Gemini + OpenRouter calls, zod validation, retry/backoff/fallback
- [`src/app/CloseRole.tsx`](src/app/CloseRole.tsx): recruiter UI and candidate preview
- [`src/app/api/close`](src/app/api/close/route.ts) and [`src/app/api/check`](src/app/api/check/route.ts): API routes
- [`eval/`](eval): critic eval and results

## Does it work? (eval)

27 hand-labelled cases run through the real API ([`eval/RESULTS.md`](eval/RESULTS.md)):

| | Critic with thinking | Critic without thinking |
|---|---|---|
| Cases passed | 26/27 | **27/27** |
| Average time per check | 9.0 s | **2.9 s** |

**The change it caused:** we had assumed the critic needed thinking to catch subtle proxies. It didn't, and the thinking version was *over*-cautious: it stripped a helpful returners-programme suggestion from a candidate who had disclosed her own career break. So the critic now runs without thinking.

Run it yourself: `npm run dev`, then `node eval/run.mjs` (or `node eval/run.mjs https://closure-mu.vercel.app`).

## Run it locally

```bash
npm install
# .env (never committed):
#   GEMINI_API_KEY=...            required (or OPENROUTER_API_KEY)
#   OPENROUTER_API_KEY=...        optional fallback
#   GEMINI_MODELS=gemini-flash-latest
#   OPENROUTER_MODELS=google/gemini-2.5-flash,google/gemini-3.5-flash-lite
npm run dev   # http://localhost:3000
```

## Decisions and trade-offs

- **Started from a different idea and dropped it.** My first pick was detecting hidden prompt-injection text in CVs. On reflection, detection is already commodity (applicant tracking systems do it) and the attack rarely works on current models, so the demo would have needed a deliberately weak baseline. Closure solves a problem people actually live with.
- **CV-screen rejections only.** That's where the volume and most of the ghosting are. Post-interview feedback needs interview notes; that's next.
- **The real risk was the human, not the AI.** Across 12 demo applicants the writer never produced discriminatory wording on its own. 4 of 12 recruiter notes were unlawful, which is why the critic checks notes and edits, and why discriminatory reasons are held rather than reworded.
- **A human approves every message.** Closure drafts and checks; the recruiter sends.
- **Considered and dropped:** Jev (TypeSafe's decision model) as a cheap critic gate. Only the Jev *router* is reachable on OpenRouter, so it didn't earn its place today.

## What I didn't write

- **Pre-event starter (my own, written 8 Oct before the challenge was known):** the Next.js + Tailwind scaffold, the original `generateObject` helper (since rewritten for Gemini), and part of the sample job data.
- **Built with Claude Code** as a coding assistant. I made and can explain the decisions; Claude wrote much of the code with me.
- Demo applicants, CVs and jobs are fictional. Statistics in "The problem" come from public surveys (Resume Genius / CV Genius, HR Reporter).
- Libraries: Next.js, React, Tailwind CSS, zod.

## What's next

- Plug into ZEIL's real applicant flow: the "Close role" action on a listing, and messages delivered in-app with one-swipe apply on redirects.
- Give ZEIL a metric it can't see today: **closure rate** (the share of applicants who heard back, with a reason) per employer, and use it to reward responsive employers.
- Post-interview feedback using structured interview notes.
- Measure what matters: re-application rate of rejected candidates, and recruiter edit rate.
- A larger eval with cases written by recruiters and employment lawyers.
