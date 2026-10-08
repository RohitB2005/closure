// Eval for Closure's critic: labelled feedback messages + recruiter notes -> does the critic
// catch what it should, and leave clean messages alone?
//
//   node eval/run.mjs                      # against http://localhost:3000, both critic modes
//   node eval/run.mjs https://your-url     # against a deployed copy
//
// Each case goes through the real POST /api/check endpoint. Writes eval/results.json.
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const CONCURRENCY = 3; // shared Gemini quota: don't hammer it

async function check(c, criticFast) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = Date.now();
    const res = await fetch(`${BASE}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId: c.applicantId, note: c.note, message: c.message, criticFast }),
    });
    if (res.ok) return { ...(await res.json()), ms: Date.now() - t };
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return null;
}

function score(c, r) {
  if (!r) return { pass: false, why: "no response" };
  const e = c.expect;
  const flagged = r.problems.length > 0;
  const noteFlagged = !!r.noteIssue;
  const fails = [];
  if (e.clean && flagged) fails.push(`false positive: ${r.problems.map((p) => p.type).join(", ")}`);
  if (!e.clean) {
    if (!flagged) fails.push("missed: no issues found");
    else if (e.types && !r.problems.some((p) => e.types.includes(p.type)))
      fails.push(`wrong type: got ${r.problems.map((p) => p.type).join(", ")}`);
    else if (e.grounds && !r.problems.some((p) => e.grounds.includes(p.ground)))
      fails.push(`wrong ground: got ${r.problems.map((p) => p.ground).join(", ")}`);
  }
  if (e.noteFlag !== noteFlagged) fails.push(e.noteFlag ? "missed note issue" : "false positive on note");
  else if (e.noteFlag && e.noteGrounds && !e.noteGrounds.includes(r.noteIssue.ground))
    fails.push(`note ground: got ${r.noteIssue.ground}`);
  return { pass: fails.length === 0, why: fails.join("; ") };
}

async function runMode(criticFast) {
  const queue = [...cases];
  const out = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const c = queue.shift();
        const r = await check(c, criticFast);
        out.push({ id: c.id, label: c.label, expect: c.expect, ...score(c, r), ms: r?.ms, problems: r?.problems, noteIssue: r?.noteIssue });
      }
    }),
  );
  return cases.map((c) => out.find((o) => o.id === c.id));
}

function summary(rows) {
  const n = (f) => rows.filter(f).length;
  const bad = rows.filter((r) => !r.expect.clean);
  const clean = rows.filter((r) => r.expect.clean);
  const notesBad = rows.filter((r) => r.expect.noteFlag);
  const notesOk = rows.filter((r) => !r.expect.noteFlag);
  return {
    passed: `${n((r) => r.pass)}/${rows.length}`,
    messageProblemsCaught: `${bad.filter((r) => r.problems?.length).length}/${bad.length}`,
    cleanMessagesLeftAlone: `${clean.filter((r) => r.problems && r.problems.length === 0).length}/${clean.length}`,
    badNotesCaught: `${notesBad.filter((r) => r.noteIssue).length}/${notesBad.length}`,
    lawfulNotesLeftAlone: `${notesOk.filter((r) => r.noteIssue === null).length}/${notesOk.length}`,
    avgSeconds: +(rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length / 1000).toFixed(1),
  };
}

const modes = process.env.MODES ? process.env.MODES.split(",") : ["fast", "think"];
const results = {};
for (const m of modes) {
  console.log(`\n=== critic: ${m === "fast" ? "no thinking" : "thinking"} ===`);
  const rows = await runMode(m === "fast");
  for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}${r.pass ? "" : `  <- ${r.why}`}`);
  results[m] = { summary: summary(rows), rows };
  console.table(results[m].summary);
}
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
