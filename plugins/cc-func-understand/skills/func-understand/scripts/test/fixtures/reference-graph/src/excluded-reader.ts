import { SETTINGS } from "./config.js";

export function exReader(): number {
  return SETTINGS.retries;              // テスト除外時に拾われないこと
}
