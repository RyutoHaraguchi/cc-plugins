import { extify } from "ext-pkg";

// 型解決先が node_modules/ext-pkg/test/index.d.ts になる外部呼び出し。
// testExclude の "**/test/**" に偶然マッチしても境界ノードが落ちないことの確認用。
export function decorate(name: string): string {
  return extify(name);
}
