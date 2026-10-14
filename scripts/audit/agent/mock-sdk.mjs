// Mock of the Anthropic SDK default export: returns a canned response and runs the REAL beta parser on it.
import { parseBetaMessage } from "@anthropic-ai/sdk/lib/beta-parser.js";
import * as errors from "@anthropic-ai/sdk/core/error.js";
export const canned = { next: null, lastParams: null };
export default class Anthropic {
  static APIError = errors.APIError;
  static RateLimitError = errors.RateLimitError;
  beta = { messages: { parse: async (params) => { canned.lastParams = params; return parseBetaMessage(canned.next, params, { logger: console }); } } };
}
