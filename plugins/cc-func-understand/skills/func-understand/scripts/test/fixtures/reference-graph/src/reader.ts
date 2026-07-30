import { SETTINGS, Mode } from "./config.js";

export function readSettings(): number {
  return SETTINGS.retries;              // 関数内からの読み取り(reads)
}

export function pickMode(): Mode {
  return Mode.Fast;                     // enum の読み取り(reads)
}

export function localShadow(): number {
  const SETTINGS = { retries: 9 };      // 同名ローカル(別シンボルなので拾われない)
  return SETTINGS.retries;
}
