import { hugeFunction } from "./huge.js";

export function callHuge(id: string): string {
  return hugeFunction(id);
}
