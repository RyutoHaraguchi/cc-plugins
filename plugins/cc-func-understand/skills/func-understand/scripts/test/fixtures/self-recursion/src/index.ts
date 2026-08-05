// countdown は自分自身を呼ぶ(from === to のエッジになる)。
// dagre は自己ループをランク付けできないため viewer 側で経路を作らず、
// cytoscape 既定のループ描画に任せる分岐へ入る。
export function countdown(n: number): number {
  if (n <= 0) return 0;
  return countdown(n - 1) + 1;
}

export function boot(): number {
  return countdown(3);
}
