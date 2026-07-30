export function withLocals(items: string[]): string {
  const LOCAL_CFG = { retries: 1 };     // 関数内ローカル(起点にも not-a-function にもならない)
  try {
    return items.join(",") + LOCAL_CFG.retries;
  } catch (caughtErr) {                 // catch 節の変数(同上)
    return String(caughtErr);
  }
}

export function loops(items: string[]): number {
  let total = 0;
  for (const loopItem of items) {       // for-of ループ変数(同上)
    total += loopItem.length;
  }
  return total;
}

export function nestedEnumExample(n: number): string {
  enum LocalColor {                      // 関数スコープの enum(resolved-variable では拾えない)
    Red = 0,
    Green = 1,
  }
  return LocalColor[n] ?? 'unknown';
}
