import { z } from "zod";

/**
 * One function for every LLM call: generateObject(schema, system, user).
 * - Calls OpenRouter (OpenAI-compatible chat API).
 * - Asks for JSON matching the zod schema, then VALIDATES it with zod.
 * - Tries each model in OPENROUTER_MODELS in order (fallback), with one retry per model.
 * - If there is no API key, returns null so callers can use their deterministic fallback.
 *   The demo never hard-fails because the AI is down.
 */

const API_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function models(): string[] {
  const list = process.env.OPENROUTER_MODELS || "openai/gpt-4o-mini,google/gemini-2.0-flash-001";
  return list.split(",").map((m) => m.trim()).filter(Boolean);
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

export async function generateObject<T extends z.ZodTypeAny>(opts: {
  schema: T;
  system: string;
  user: string;
  temperature?: number;
}): Promise<{ data: z.infer<T>; model: string } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  const jsonSchema = z.toJSONSchema(opts.schema);
  const system = `${opts.system}

Respond with ONLY valid JSON (no prose, no markdown) matching this JSON Schema:
${JSON.stringify(jsonSchema)}`;

  const errors: string[] = [];
  for (const model of models()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "X-Title": "zeil-hackathon",
          },
          body: JSON.stringify({
            model,
            temperature: opts.temperature ?? 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: opts.user },
            ],
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const json = await res.json();
        const text: string = json.choices?.[0]?.message?.content ?? "";
        const parsed = opts.schema.safeParse(extractJson(text));
        if (!parsed.success) throw new Error(`Schema mismatch: ${parsed.error.message.slice(0, 300)}`);
        return { data: parsed.data, model };
      } catch (e) {
        errors.push(`${model} #${attempt + 1}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  console.error("[llm] all models failed:\n" + errors.join("\n"));
  return null;
}
