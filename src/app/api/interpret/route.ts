import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { claudeConfigured, interpretWithClaude } from "@/lib/interpret/claude.server";
import { DocSchema } from "@/lib/schema";

const MAX_BODY_BYTES = 256 * 1024;

const BodySchema = z.object({
  command: z.string().min(1).max(500),
  doc: DocSchema,
  selectedId: z.string().nullable(),
});

/** Provider discovery: the client uses Claude only when a key is configured here. */
export async function GET() {
  return Response.json({ available: claudeConfigured() });
}

export async function POST(request: Request) {
  if (!claudeConfigured()) return Response.json({ error: "Model interpreter not configured" }, { status: 501 });
  // A demo document is a few kilobytes; anything far larger is not a FORM workspace
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });

  const body = BodySchema.safeParse((() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })());
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  try {
    const result = await interpretWithClaude(body.data.command, body.data.doc, body.data.selectedId);
    return Response.json(result);
  } catch (error) {
    // Any failure makes the client fall back to the deterministic demo parser
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited" }, { status: 429 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `Upstream ${error.status ?? "error"}` }, { status: 502 });
    return Response.json({ error: "Interpretation failed" }, { status: 502 });
  }
}
