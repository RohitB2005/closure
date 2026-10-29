import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

/**
 * One function for every LLM call: generateObject({ schema, system, user }).
 * - Primary: OpenRouter (Gemini models). "smart" calls try a stronger model first.
 * - Fallback: the Gemini API directly (JSON mode), if a key is set. Order is configurable
 *   with LLM_ORDER, so a live demo doesn't die on one provider's quota.
 * - Every reply is VALIDATED with zod. A reply that doesn't match the schema counts as a failure
 *   and is retried, then the next provider/model is tried.
 * - Returns null if everything fails, so callers can degrade gracefully.
 */

type Provider = { name: "gemini" | "openrouter"; model: string; mustThink?: boolean };

// Bring your own key: a visitor's OpenRouter key arrives in a request header and is used for that
// request only (never stored or logged). AsyncLocalStorage carries it to every call the request makes,
// so the pipeline code doesn't have to pass it around. Without one, the server's env key is used.
export const KEY_HEADER = "x-openrouter-key";
const requestKey = new AsyncLocalStorage<string | undefined>();

export function withUserKey<T>(req: Request, fn: () => T): T {
  return requestKey.run(req.headers.get(KEY_HEADER)?.trim() || undefined, fn);
}

const openRouterKey = () => requestKey.getStore() || process.env.OPENROUTER_API_KEY;

export function llmConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || openRouterKey());
}

export const NO_KEY = "Add your OpenRouter API key (top right) to run this live.";

// Order of providers. OpenRouter first: the hackathon's shared Gemini key stalled for 40s+ per call
// under load at midday, while the same family of models via OpenRouter answered in ~2s.
// The shared key stays as the fallback. Override with LLM_ORDER=gemini,openrouter.
function providers(smart = false): Provider[] {
  const list = (v: string | undefined, d: string) =>
    (v || d).split(",").map((m) => m.trim()).filter(Boolean);
  const byName: Record<string, Provider[]> = {
    gemini: process.env.GEMINI_API_KEY ? list(process.env.GEMINI_MODELS, "gemini-flash-latest").map((model) => ({ name: "gemini" as const, model })) : [],
    openrouter: openRouterKey()
      ? list(process.env.OPENROUTER_MODELS, "google/gemini-2.5-flash").map((model) => ({ name: "openrouter" as const, model }))
      : [],
  };
  // "smart" calls (the critic: safety judgement) go to a stronger model first. On OpenRouter it can't
  // turn thinking off, so it runs with low reasoning effort.
  const smartFirst: Provider[] =
    smart && openRouterKey()
      ? list(process.env.OPENROUTER_SMART_MODELS, "google/gemini-3.8-flash").map((model) => ({ name: "openrouter" as const, model, mustThink: true }))
      : [];
  return [...smartFirst, ...list(process.env.LLM_ORDER, "openrouter,gemini").flatMap((n) => byName[n] ?? [])];
}

/** Pull the first JSON object/array out of a model reply (handles ```json fences and chatter). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in model reply");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type FilePart = { mimeType: string; data: string }; // base64

// Hard per-call limits so a stalled provider is abandoned quickly (Vercel kills the whole request at 60s).
const timeoutMs = (fast: boolean) => (fast ? 20_000 : 35_000);

async function callGemini(model: string, system: string, user: string, temperature: number, fast: boolean, file?: FilePart): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [...(file ? [{ inline_data: { mime_type: file.mimeType, data: file.data } }] : []), { text: user }] }],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        // fast = no "thinking" tokens: ~3-4x lower latency, used where speed matters more than deliberation.
        ...(fast ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
    signal: AbortSignal.timeout(timeoutMs(fast)),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
}

async function callOpenRouter(model: string, system: string, user: string, temperature: number, fast: boolean, file?: FilePart, mustThink = false): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey()}`,
      "Content-Type": "application/json",
      "X-Title": "closure",
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
      // fast = no thinking tokens (only some models allow this; others reject it and we fall through)
      ...(mustThink ? { reasoning: { effort: "low" } } : fast ? { reasoning: { enabled: false } } : {}),
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: file
            ? [
                { type: "file", file: { filename: "upload.pdf", file_data: `data:${file.mimeType};base64,${file.data}` } },
                { type: "text", text: user },
              ]
            : user,
        },
      ],
    }),
    signal: AbortSignal.timeout(mustThink ? 25_000 : timeoutMs(fast)),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export async function generateObject<T extends z.ZodTypeAny>(opts: {
  schema: T;
  system: string;
  user: string;
  temperature?: number;
  fast?: boolean;
  smart?: boolean; // judgement-critical call: try the stronger model first
  file?: FilePart; // e.g. a PDF CV, read natively by Gemini
}): Promise<{ data: z.infer<T>; model: string } | null> {
  const jsonSchema = z.toJSONSchema(opts.schema);
  const system = `${opts.system}

Respond with ONLY valid JSON (no prose, no markdown) matching this JSON Schema:
${JSON.stringify(jsonSchema)}`;
  const temperature = opts.temperature ?? 0.3;

  const errors: string[] = [];
  for (const p of providers(opts.smart)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text =
          p.name === "gemini"
            ? await callGemini(p.model, system, opts.user, temperature, opts.fast ?? false, opts.file)
            : await callOpenRouter(p.model, system, opts.user, temperature, opts.fast ?? false, opts.file, p.mustThink);
        const parsed = opts.schema.safeParse(extractJson(text));
        if (!parsed.success) throw new Error(`Schema mismatch: ${parsed.error.message.slice(0, 300)}`);
        return { data: parsed.data, model: `${p.name}:${p.model}` };
      } catch (e) {
        errors.push(`${p.name}:${p.model} #${attempt + 1}: ${(e as Error).message.slice(0, 200)}`);
        // Stalled, rate-limited or erroring provider: don't wait on it, move to the next one now.
        // (Only a malformed/schema-mismatched reply is worth one retry on the same model.)
        if (e instanceof HttpError || (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") break;
      }
    }
  }
  console.error("[llm] all providers failed:\n" + errors.join("\n"));
  return null;
}
