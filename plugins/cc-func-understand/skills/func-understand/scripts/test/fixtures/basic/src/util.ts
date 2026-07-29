import { shorten } from "fake-lib";

export function formatName(id: string): string {
  return `user-${id}-${shorten("/tmp/y")}`;
}
