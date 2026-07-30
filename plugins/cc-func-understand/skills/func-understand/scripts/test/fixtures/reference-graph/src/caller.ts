import { readSettings } from "./reader.js";

export function handler(): number {
  return readSettings();                // reads した関数の上流(direct-call)
}

export function passes(): Array<() => number> {
  return [readSettings];                // 名前渡し(上流パス addCallbackEdges の確認用)
}
