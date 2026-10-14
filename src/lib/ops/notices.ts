import { z } from "zod";
import type { CaptionPart } from "@/lib/ops/registry/_contract";

/**
 * Fixed notices (plan §5.9): sentences a command appends to its caption that no op or query
 * composes. Their wording is fixed here, never in the parser.
 */
export const NoticeKey = z.enum(["weekendsNow", "demoOneTemplate", "demoReadFailed"]);
export type NoticeKey = z.infer<typeof NoticeKey>;

export const NOTICE_TEXT: Readonly<Record<NoticeKey, string>> = {
  // The migration moved a v0 schedule onto working days (Q5, Q13; plan §7.2 item 11)
  weekendsNow: "Schedule now skips weekends.",
  // /demo creates every project from the website template
  demoOneTemplate: "Demo mode ships one template (website) — rename anything",
  // An unreadable form.demo.v2 was copied to its backup key (plan §7.3)
  demoReadFailed: "FORM couldn't read the saved demo, so a copy was kept.",
};

export function noticePart(key: NoticeKey): CaptionPart {
  return { text: NOTICE_TEXT[key], key: `notice:${key}` };
}
