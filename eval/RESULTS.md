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

---

# Writer eval: is it actually personal?

**The claim being tested:** Closure's feedback is *not* a template with the name swapped. The baseline is the real rejection a student actually received (`"Unfortunately, we've picked a candidate whose experience aligns more closely with the role at this time…"`), which every applicant gets word for word.

[`writer.mjs`](writer.mjs) drafts all 12 demo applicants through the real `POST /api/close` and measures the messages. Greeting, sign-off and role name are stripped first, since every message is meant to share those.

| | Generic template | Closure (3 runs) |
|---|---|---|
| Wording shared between two messages (average) | 100% | **5–6%** |
| Wording shared by the most similar pair | 100% | 13–19% |
| CV facts cited, each verified by code as word-for-word in the CV | 0 | **~7.3 per message** |
| Gives a concrete next step | 0/12 | **12/12** |
| Points to a better-fit open role | 0/12 | 11/12 |

The one message without a redirect: no open role was a clearly better fit, and the writer is told not to force one.

**A metric that didn't hold up:** I also tried to score whether each message is "clearly about its own applicant" by matching words that only appear in that person's CV. It moved between 9/12 and 12/12 across runs. Exact-phrase matching misses paraphrase ("your FlatMate project"), and word matching is thrown by details that also appear in job ads (e.g. "patient-facing"). Reading the messages shows they are specific, but this heuristic is too crude to quote as a number, so it isn't one of the headline results.
