import type { JsonValue } from "../contracts/generated.ts";

export interface HtmlAction {
  type: "opendirector.action";
  version: 1;
  requestId: string;
  action: "submit" | "compose";
  payload: Record<string, JsonValue>;
}

/** Only plain, bounded JSON crosses the boundary. No targets or command strings. */
export function parseHtmlAction(value: unknown): HtmlAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "action,payload,requestId,type,version" ||
      input.type !== "opendirector.action" || input.version !== 1 ||
      typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestId) ||
      !["submit", "compose"].includes(String(input.action)) ||
      !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return null;
  let count = 0;
  const json = (item: unknown, depth: number): boolean => {
    if (++count > 10000 || depth > 32) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(entry => json(entry, depth + 1));
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.entries(item).every(([key, entry]) =>
      !["__proto__", "prototype", "constructor"].includes(key) && json(entry, depth + 1));
  };
  if (!json(input.payload, 0)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(input.payload)).length > 65536) return null;
  } catch { return null; }
  return input as unknown as HtmlAction;
}

/** A model may wrap an otherwise complete HTML result in one Markdown fence. */
export function htmlSource(text: string): string {
  const match = text.trim().match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1]! : text;
}
