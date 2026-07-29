import { basename } from "node:path";

export function formatName(id: string): string {
  return `user-${id}-${basename("/tmp/y")}`;
}
