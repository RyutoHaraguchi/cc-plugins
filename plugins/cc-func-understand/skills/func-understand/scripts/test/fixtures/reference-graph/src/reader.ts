import { SETTINGS, Mode } from "./config.js";

export function readSettings(): number {
  return SETTINGS.retries;              // 関数内からの読み取り(reads)
}

export function pickMode(): Mode {
  return Mode.Fast;                     // enum の読み取り(reads)
}

export function describeMode(m: Mode): string {
  return "mode";                        // 型注釈のみの参照(reads になるか検証用)
}

export function localShadow(): number {
  const SETTINGS = { retries: 9 };      // 同名ローカル(別シンボルなので拾われない)
  return SETTINGS.retries;
}
