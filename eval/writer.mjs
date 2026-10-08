// Writer eval: is Closure's feedback actually personal, or a template with the name swapped?
//
//   node eval/writer.mjs                      # against http://localhost:3000
//   node eval/writer.mjs https://your-url
//
// Drafts all demo applicants through the real POST /api/close, then measures:
//  - repetition: average word-trigram overlap between every pair of messages (a template = 100%)
//  - about-this-person: share of messages that overlap their OWN applicant's CV more than anyone else's
//  - grounding: verified CV quotes per message; actionability: has a next step / a redirect
// Writes eval/writer-results.json.
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";
const applicants = JSON.parse(readFileSync(new URL("../src/data/applicants.json", import.meta.url)));
const TEMPLATE =
  "Unfortunately, we've picked a candidate whose experience aligns more closely with the role at this time. We wish you the best in your job search.";

const words = (s) => s.toLowerCase().replace(/[^a-z0-9ā-ūĀ-Ū' ]+/g, " ").split(/\s+/).filter(Boolean);
// Boilerplate every message is SUPPOSED to share (greeting, sign-off, role/company name) is removed first,
// so the score measures the substance, not "Kia ora" and "The Kauri Labs team".
const BOILER = /kia ora \w+|ngā mihi|the kauri labs team|junior frontend developer|kauri labs|thank(s| you) for applying( for)?( the)?( position| role)?/gi;
const trigrams = (s) => {
  const w = words(s.replace(BOILER, " "));
  return new Set(w.slice(2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`));
};
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
};

async function draft(a) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/api/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId: a.id }),
    });
    if (res.ok) {
      const r = await res.json();
      if (r.draft) return r;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return null;
}

const queue = [...applicants];
const results = [];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const a = queue.shift();
      results.push({ a, r: await draft(a) });
    }
  }),
);
const ok = applicants.map((a) => results.find((x) => x.a.id === a.id)).filter((x) => x.r);

// 1. Repetition between messages
const tri = ok.map((x) => trigrams(x.r.draft.message));
const pairs = [];
for (let i = 0; i < tri.length; i++) for (let j = i + 1; j < tri.length; j++) pairs.push(overlap(tri[i], tri[j]));
const avgPair = pairs.reduce((s, v) => s + v, 0) / pairs.length;
const maxPair = Math.max(...pairs);

// 2a. About this person (strict, v1): exact trigram overlap with own CV beats every other CV.
//     Undercounts paraphrase ("your FlatMate project"), so it's reported but not the headline.
const cvTri = ok.map((x) => trigrams(x.a.cv));
const ownStrict = ok.map((x, i) => {
  const mine = overlap(tri[i], cvTri[i]);
  const others = Math.max(...cvTri.filter((_, j) => j !== i).map((c) => overlap(tri[i], c)));
  return mine > others;
});

// 2b. About this person (v2): distinctive details = words found in this applicant's CV and in no other
//     CV or job listing (e.g. "flatmate", "spring", "latte"). A message is clearly about its applicant if it
//     uses >= 2 of theirs and more of theirs than of anyone else's.
const jobsText = readFileSync(new URL("../src/data/jobs.json", import.meta.url), "utf8") + readFileSync(new URL("../src/data/role.json", import.meta.url), "utf8");
const jobWords = new Set(words(jobsText));
const STOP = new Set("that this have with from into your about after while which their there been were will would could should more most some such than then them they what when where also just like over very much many only other being does make made work worked working move moving recent current currently".split(" "));
const cvWords = ok.map((x) => new Set(words(x.a.cv).filter((w) => w.length >= 4 && !jobWords.has(w) && !STOP.has(w))));
const distinct = cvWords.map((ws, i) => new Set([...ws].filter((w) => cvWords.every((o, j) => j === i || !o.has(w)))));
const own = ok.map((x, i) => {
  const msg = new Set(words(x.r.draft.message));
  const count = (set) => [...set].filter((w) => msg.has(w)).length;
  const mine = count(distinct[i]);
  const others = Math.max(...distinct.filter((_, j) => j !== i).map(count));
  return mine >= 2 && mine > others;
});

// 3. Grounding + actionability
const quotes = ok.map((x) => {
  const v = x.r.trace.filter((t) => t.step === "verify").pop()?.note ?? "0/0";
  return Number(v.split("/")[0]);
});
const pct = (n, d) => `${Math.round((100 * n) / d)}%`;
const summary = {
  messages: ok.length,
  avgOverlapBetweenMessages: pct(avgPair, 1),
  worstPairOverlap: pct(maxPair, 1),
  templateOverlap: "100% (same text every time)",
  clearlyAboutTheirOwnApplicant: `${own.filter(Boolean).length}/${ok.length}`,
  sameButExactPhrasesOnly: `${ownStrict.filter(Boolean).length}/${ok.length}`,
  avgVerifiedCvQuotes: +(quotes.reduce((s, v) => s + v, 0) / ok.length).toFixed(1),
  withANextStep: `${ok.filter((x) => x.r.draft.nextSteps.length > 0).length}/${ok.length}`,
  withABetterFitRole: `${ok.filter((x) => x.r.draft.redirects.length > 0).length}/${ok.length}`,
  templateCitesFromCv: 0,
};
console.table(summary);
console.log("Template for comparison:", TEMPLATE);
writeFileSync(
  new URL("./writer-results.json", import.meta.url),
  JSON.stringify(
    { base: BASE, at: new Date().toISOString(), summary, messages: ok.map((x) => ({ id: x.a.id, name: x.a.name, status: x.r.status, message: x.r.draft.message })) },
    null,
    2,
  ),
);
