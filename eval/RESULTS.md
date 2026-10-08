# Critic eval

**What it tests:** the critic is the safety gate before any feedback reaches an applicant. It checks the message for prohibited grounds under the NZ Human Rights Act 1993 s21 (including proxies), unsupported claims, template filler and false promises. It also checks the recruiter's private note.

**How:** there are 27 hand-labelled cases in [`cases.json`](cases.json), each with an expected result. They cover:
- clean messages, including tricky lawful ones such as "this role needs existing NZ work rights" and praising an applicant's *accessibility skills*
- blatant and subtle protected-ground wording: "overqualified", "earlier career stage", "digital native", "fresh energy", a caring-related career break, "a Kiwi developer"
- messages that contradict the CV
- template filler and false promises
- discriminatory recruiter notes alongside lawful ones

[`run.mjs`](run.mjs) sends every case through the real `POST /api/check` endpoint and scores it. Run it with `npm run dev`, then `node eval/run.mjs`.

## Results (gemini-flash-latest → gemini-3.8-flash)

| | Critic **with** thinking | Critic **without** thinking |
|---|---|---|
| Cases passed | 26/27 | **27/27** |
| Problem messages caught | 14/14 | 14/14 |
| Clean messages left alone | 12/13 | **13/13** |
| Discriminatory notes caught | 5/5 | 5/5 |
| Lawful notes left alone | 22/22 | 22/22 |
| Average time per check | 9.0 s | **2.9 s** |

On the first 21 cases both modes scored 21/21, so I added six harder ones to find where it breaks.

## The change we made because of it

We had assumed the critic needed "thinking" to catch subtle proxies, and it ran with thinking on. The eval showed no accuracy gain for 3× the latency. The thinking critic's one miss was **over-caution**: it flagged a suggestion to apply to a paid *returners programme* as a family-status proxy, even though the applicant herself wrote on her CV that she's returning from a career break, and the suggestion genuinely helps her. Over-flagging has a real cost, because it strips useful next steps from candidates.

**So the critic now runs without thinking.** A full check went from about 9 s to about 3 s, with equal or better accuracy on this set.

## Limits (honest)

- 27 cases written by one person is a smoke test, not proof. The next step would be cases written by recruiters and employment lawyers, plus cases that fail in practice.
- The eval tests the critic, not the writer. Across the 12 demo applicants the writer produced no prohibited-ground wording on its own. The real risk came from recruiter notes and edits, which is what the critic guards.
- "Clean" labels are judgement calls, such as the returners-programme case above.
