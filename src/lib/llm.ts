import { z } from "zod";

/**
 * One function for every LLM call: generateObject({ schema, system, user }).
 * - Primary: Gemini API (the hackathon key), JSON mode + response schema.
 * - Fallback: OpenRouter (Gemini models) if Gemini is rate-limited or down, so a live demo
 *   doesn't die on the shared quota.
 * - Every reply is VALIDATED with zod. A reply that doesn't match the schema counts as a failure
 *   and is retried, then the next provider/model is tried.
 * - Returns null if everything fails, so callers can degrade gracefully.
 */

type Provider = { name: "gemini" | "openrouter"; model: string };

export function llmConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}

function providers(): Provider[] {
  const list = (v: string | undefined, d: string) =>
    (v || d).split(",").map((m) => m.trim()).filter(Boolean);
  const out: Provider[] = [];
  if (process.env.GEMINI_API_KEY)
    for (const model of list(process.env.GEMINI_MODELS, "gemini-flash-latest")) out.push({ name: "gemini", model });
  if (process.env.OPENROUTER_API_KEY)
    for (const model of list(process.env.OPENROUTER_MODELS, "google/gemini-2.5-flash"))
      out.push({ name: "openrouter", model });
  return out;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FilePart = { mimeType: string; data: string }; // base64

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
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
}

async function callOpenRouter(model: string, system: string, user: string, temperature: number, file?: FilePart): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "closure",
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
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
    signal: AbortSignal.timeout(45_000),
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
  file?: FilePart; // e.g. a PDF CV, read natively by Gemini
}): Promise<{ data: z.infer<T>; model: string } | null> {
  const jsonSchema = z.toJSONSchema(opts.schema);
  const system = `${opts.system}

Respond with ONLY valid JSON (no prose, no markdown) matching this JSON Schema:
${JSON.stringify(jsonSchema)}`;
  const temperature = opts.temperature ?? 0.3;

  const errors: string[] = [];
  for (const p of providers()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text =
          p.name === "gemini"
            ? await callGemini(p.model, system, opts.user, temperature, opts.fast ?? false, opts.file)
            : await callOpenRouter(p.model, system, opts.user, temperature, opts.file);
        const parsed = opts.schema.safeParse(extractJson(text));
        if (!parsed.success) throw new Error(`Schema mismatch: ${parsed.error.message.slice(0, 300)}`);
        return { data: parsed.data, model: `${p.name}:${p.model}` };
      } catch (e) {
        errors.push(`${p.name}:${p.model} #${attempt + 1}: ${(e as Error).message.slice(0, 200)}`);
        // Shared quota: back off before retrying instead of hammering it.
        if (e instanceof HttpError && (e.status === 429 || e.status >= 500)) await sleep(1500 * (attempt + 1));
        // Bad key / unknown model won't fix itself on retry: move to the next provider.
        else if (e instanceof HttpError) break;
      }
    }
  }
  console.error("[llm] all providers failed:\n" + errors.join("\n"));
  return null;
}
