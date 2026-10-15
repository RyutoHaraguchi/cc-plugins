import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../templates/page.html", import.meta.url), "utf8");
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
assert.ok(m, 'templates/page.html に <script id="core"> がない');
const ctx = vm.createContext({ TextEncoder });
vm.runInContext(m[1], ctx);
const c = ctx;

const q = (over = {}) => ({
  id: "Q1", status: "open", title: "題", situation: "", recommended: "a", recommendWhy: "",
  options: [{ key: "a", label: "案A", effect: "" }, { key: "b", label: "案B", effect: "" }],
  ...over,
});

test("layoutNode は列と行からマス目の座標を出す", () => {
  const r = c.layoutNode({ col: 1, row: 2 });
  assert.equal(r.x, 32 + 240);
  assert.equal(r.y, 28 + 220);
  assert.equal(r.cx, r.x + 98);
  assert.equal(r.cy, r.y + 28);
});

test("edgePath: 同じ列は縦の直線、違う列は直交の折れ線、同じ行は横線", () => {
  const a = { col: 0, row: 0, kind: "process" };
  assert.match(c.edgePath(a, { col: 0, row: 1, kind: "process" }), /^M130,84 V136$/);
  assert.match(c.edgePath(a, { col: 1, row: 1, kind: "process" }), /^M130,84 V\d+(\.\d+)? H370 V136$/);
  assert.match(c.edgePath(a, { col: 1, row: 0, kind: "process" }), /^M228,56 H270$/);
});

test("edgePath: ひし形に向かう矢印は先端を少し手前で止める", () => {
  const a = { col: 0, row: 0, kind: "process" };
  assert.equal(c.edgePath(a, { col: 0, row: 1, kind: "decision" }), "M130,84 V126");
});

test("wrapLabel: 指定文字数で折り返し、3 行を超えたら … で切る", () => {
  assert.deepEqual(Array.from(c.wrapLabel("あいうえおか", 3)), ["あいう", "えおか"]);
  const long = c.wrapLabel("あ".repeat(20), 4);
  assert.equal(long.length, 3);
  assert.equal(long[2], "あああ…");
});

test("idsOf: 空白区切りの文字列と配列の両方を受け取る", () => {
  assert.deepEqual(Array.from(c.idsOf("Q1 Q1R")), ["Q1", "Q1R"]);
  assert.deepEqual(Array.from(c.idsOf(["Q2"])), ["Q2"]);
  assert.deepEqual(Array.from(c.idsOf(undefined)), []);
});

test("markerInfo: 状態ごとの印。回答待ちで送信済みなら … を出す", () => {
  assert.equal(c.markerInfo(q({ status: "done" })).mark, "✓");
  assert.equal(c.markerInfo(q({ status: "revoked" })).cls, "m-revoked");
  assert.equal(c.markerInfo(q({ status: "recheck" })).text, "要確認");
  assert.equal(c.markerInfo(q(), ["Q1"]).text, "送信済み");
  assert.equal(c.markerInfo(q({ status: "done" }), ["Q1"]).text, "決定");
  assert.equal(c.markerInfo(q({ status: "unknown" })).text, "回答待ち");
});

test("progress と progressText", () => {
  const counts = c.progress([q({ status: "done" }), q({ status: "done" }), q(), q({ status: "recheck" }), q({ status: "revoked" })]);
  assert.deepEqual({ ...counts }, { done: 2, open: 1, recheck: 1, revoked: 1 });
  assert.equal(c.progressText(counts), "決定 2 ／ 回答待ち 1 ／ 要確認 1");
  assert.equal(c.progressText({ done: 1, open: 0, recheck: 0, revoked: 0 }), "決定 1 ／ 回答待ち 0");
});

test("answerBody: 選んだ案と補足。補足が空なら行を出さない。知らない案は投げる", () => {
  assert.equal(c.answerBody(q(), "b", "  "), "選択：b「案B」");
  assert.equal(c.answerBody(q(), "a", "理由"), "選択：a「案A」\n補足：理由");
  assert.throws(() => c.answerBody(q(), "z", ""), /unknown option z/);
});

test("buildMessage: 形式と、UTF-8 で 4000 バイト以内への切り詰め", () => {
  assert.equal(c.buildMessage("壁打ち", q(), "への回答", "選択：a"), "[壁打ち] Q1「題」への回答\n選択：a");
  const msg = c.buildMessage("壁打ち", q(), "への回答", "あ".repeat(1500));
  assert.ok(new TextEncoder().encode(msg).length <= 4000);
  assert.ok(!msg.endsWith("�"));
});

test("orphanQuestions: 本文にも図にも目印が無い問いを返す", () => {
  const diagrams = { main: { nodes: [{ id: "n1", col: 0, row: 0, label: "", q: "Q1 Q1R" }], edges: [] } };
  const qs = [q({ id: "Q0" }), q({ id: "Q1" }), q({ id: "Q1R" }), q({ id: "Q5" })];
  assert.deepEqual(Array.from(c.diagramQuestionIds(diagrams)), ["Q1", "Q1R"]);
  assert.deepEqual(Array.from(c.orphanQuestions(qs, ["Q0"], diagrams)), ["Q5"]);
});

test("diagramQuestionIds / orphanQuestions は nodes なし・未定義の入力に耐える", () => {
  assert.deepEqual([...c.diagramQuestionIds({ a: {} })], []);
  assert.deepEqual([...c.orphanQuestions([q()], undefined, undefined)], ["Q1"]);
  assert.deepEqual([...c.orphanQuestions([q()], ["Q1"], { a: {} })], []);
});
