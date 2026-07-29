import { transform } from "fake-pkg";
import { basename } from "node:path";

export function label(s: string): string {
  return `[${s}]`;
}

export function summarize(items: string[]): string {
  const blocks: string[] = [];
  const seen = new Map<string, string>();
  seen.get("k");
  blocks.push(label(basename("/tmp/x")));
  const mapped = items.map((i) => i);
  return transform(mapped.join("\n")) + blocks.join("");
}
