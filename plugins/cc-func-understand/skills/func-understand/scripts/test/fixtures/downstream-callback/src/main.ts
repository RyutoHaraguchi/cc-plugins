import { helper, utils } from "./helpers.js";
import { register, type Fn } from "./register.js";
import { exHelper } from "./excluded.js";

export function target(items: string[]): string {
  const mapped = items.map(helper);     // 裸 Identifier の名前渡し(発見対象)
  const fmted = items.map(utils.fmt);   // PropertyAccess(outgoing calls で既検出 → 二重計上しない)
  register("t", helper);                // 自作関数経由の名前渡し(同じ helper への別行参照)
  return [...mapped, ...fmted].join("\n");
}

export function otherUser(items: string[]): string[] {
  return items.map(helper);             // 後段 addCallbackEdges による上流検出の確認用
}

export function applyEach(items: string[], cb: Fn): string[] {
  return items.map(cb);                 // パラメータ渡し(誤検出されないこと)
}

export function usesExcluded(items: string[]): string[] {
  return items.map(exHelper);           // テスト除外時に発見されないこと(Task 2)
}

export function multiline(items: string[]): string[] {
  return items.map(
    utils
      .fmt,
  );                                    // 複数行 PropertyAccess(direct-call との二重計上防止の確認用)
}
