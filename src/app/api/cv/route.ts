import { NextResponse } from "next/server";
import { z } from "zod";
import { readCvPdf } from "@/lib/intake";

// ~3MB PDF as base64 (Vercel's request limit is 4.5MB)
const Body = z.object({ pdfBase64: z.string().min(100).max(4_000_000) });

/** POST /api/cv { pdfBase64 } -> { name, cv }: Gemini reads the PDF and transcribes it verbatim. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Upload a PDF under 3MB" }, { status: 400 });
  const cv = await readCvPdf(parsed.data.pdfBase64);
  if (!cv) return NextResponse.json({ error: "Couldn't read that PDF, try again or paste the text" }, { status: 503 });
  return NextResponse.json(cv);
}

export const maxDuration = 60;
