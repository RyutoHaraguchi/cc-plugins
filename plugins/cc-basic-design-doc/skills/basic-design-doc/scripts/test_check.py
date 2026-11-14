import json
import os
import re
import shutil
import subprocess
import urllib.parse
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import check  # noqa: E402

with open(os.path.join(HERE, "fixtures", "valid.html"), encoding="utf-8") as f:
    VALID = f.read()


def mutate(old, new, src=None):
    src = VALID if src is None else src
    assert old in src, f"fixture does not contain: {old!r}"
    return src.replace(old, new, 1)


def remove_section(section_id, src=None):
    src = VALID if src is None else src
    out, n = re.subn(r'<section class="panel[^"]*" id="%s".*?</section>' % section_id, "", src, flags=re.S)
    assert n == 1
    return out


BASE = '<td data-field="base" data-repo="https://github.com/example/orders" data-sha="abc1234def5678901234567890abcdef12345678">main abc1234</td>'
SRC = "<code data-src>src/sync.ts</code> の"


class CheckTest(unittest.TestCase):
    def assertError(self, html, fragment):
        errors, _ = check.check(html)
        self.assertTrue(any(fragment in e for e in errors), f"expected error containing {fragment!r}, got {errors}")

    def assertWarning(self, html, fragment):
        _, warnings = check.check(html)
        self.assertTrue(any(fragment in w for w in warnings), f"expected warning containing {fragment!r}, got {warnings}")

    def test_valid_fixture_passes(self):
        errors, warnings = check.check(VALID)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_template_reports_placeholders(self):
        with open(os.path.join(HERE, "..", "template.html"), encoding="utf-8") as f:
            self.assertError(f.read(), "【記入")

    def test_placeholder_left(self):
        self.assertError(mutate("再試行を追加", "【記入】"), "【記入")

    def test_required_chapter_missing(self):
        self.assertError(remove_section("errors"), "errors")

    def test_unknown_chapter(self):
        self.assertError(mutate('id="nfr"', 'id="misc"'), "misc")

    def test_optional_chapter_omitted_without_reason(self):
        self.assertError(remove_section("nfr"), "6")

    def test_optional_chapter_omitted_with_reason(self):
        html = remove_section("nfr")
        html = mutate("<tr><td>4 データ設計</td><td>スキーマ変更なし</td></tr>",
                      "<tr><td>4 データ設計</td><td>スキーマ変更なし</td></tr><tr><td>6 非機能・制約</td><td>影響なし</td></tr>", html)
        html = html.replace("R-1", "Q-1")
        errors, _ = check.check(html)
        self.assertEqual(errors, [])

    def test_present_chapter_listed_as_omitted(self):
        html = mutate("<tr><td>4 データ設計</td><td>スキーマ変更なし</td></tr>",
                      "<tr><td>4 データ設計</td><td>スキーマ変更なし</td></tr><tr><td>6 非機能・制約</td><td>影響なし</td></tr>")
        self.assertError(html, "6")

    def test_header_field_empty(self):
        self.assertError(mutate(BASE, '<td data-field="base"></td>'), "base")

    def test_status_enum(self):
        self.assertError(mutate(">レビュー中<", ">確認中<"), "status")

    def test_date_format(self):
        self.assertError(mutate('<td data-field="date">2026-11-09</td>', '<td data-field="date">11/9</td>'), "date")

    def test_summary_empty(self):
        self.assertError(re.sub(r'(<div class="summary" data-block="summary">).*?(</div>)', r"\1\2", VALID, flags=re.S), "summary")

    def test_required_table_missing(self):
        self.assertError(mutate('data-table="decisions"', 'data-table="x-decisions"'), "decisions")

    def test_table_header_changed(self):
        self.assertError(mutate("<th>論点</th><th>決定</th><th>理由</th>", "<th>論点</th><th>決定</th><th>備考</th>"), "decisions")

    def test_required_table_without_rows(self):
        html = re.sub(r'(data-table="paths">.*?<tbody>).*?(</tbody>)', r"\1\2", VALID, flags=re.S)
        html = html.replace("P-1", "D-1")
        self.assertError(html, "paths")

    def test_empty_cell(self):
        self.assertError(mutate("<td>既存の仕組みで済む</td>", "<td></td>"), "decisions")

    def test_approval_date_may_be_empty(self):
        errors, _ = check.check(VALID)
        self.assertEqual(errors, [])

    def test_id_prefix_mismatch(self):
        html = mutate('<td data-id="X-1">X-1</td>', '<td data-id="D-9">D-9</td>')
        self.assertError(html, "D-9")

    def test_duplicate_id(self):
        html = mutate('<tr><td data-id="U-1">U-1</td>', '<tr><td data-id="U-1">U-1</td><td>単体</td><td>a</td><td>b</td><td>D-1</td></tr><tr><td data-id="U-1">U-1</td>')
        self.assertError(html, "U-1")

    def test_undefined_reference(self):
        self.assertError(mutate("<td>再試行を追加</td>", "<td>再試行を追加（D-7）</td>"), "D-7")

    def test_enum_alternatives(self):
        self.assertError(mutate(">採用<", ">検討中<"), "判定")

    def test_alternatives_needs_adopted(self):
        self.assertError(mutate(">採用<", ">見送り<"), "採用")

    def test_enum_errors(self):
        self.assertError(mutate("<td>障害</td>", "<td>エラー</td>"), "分類")

    def test_enum_risks(self):
        self.assertError(mutate("<td>受容</td>", "<td>様子見</td>"), "扱い")

    def test_test_kind_matches_prefix(self):
        self.assertError(mutate("<td>単体</td><td>5xx", "<td>結合</td><td>5xx"), "U-1")

    def test_enum_cert(self):
        self.assertError(mutate('data-cert="コード">コード<', 'data-cert="伝聞">伝聞<'), "確度")

    def test_revision_last_matches_version(self):
        self.assertError(mutate('<td data-field="version">1.1</td>', '<td data-field="version">1.2</td>'), "版数")

    def test_rev_mark_must_be_current(self):
        self.assertError(mutate('data-rev="1.1">v1.1', 'data-rev="1.0">v1.0'), "1.0")

    def test_approved_with_open_issues(self):
        html = mutate(">レビュー中<", ">承認済み<")
        html = mutate("<td>承認</td><td>山田</td><td>未</td><td></td>", "<td>承認</td><td>山田</td><td>承認</td><td>2026-11-09</td>", html)
        self.assertError(html, "未決")

    def test_approved_without_approval(self):
        html = re.sub(r'(data-table="open-issues">.*?<tbody>).*?(</tbody>)', r"\1\2", VALID, flags=re.S)
        html = html.replace("未決は Q-1", "未決なし").replace("<td>3 回</td>", "")
        html = mutate(">レビュー中<", ">承認済み<", html)
        self.assertError(html, "承認")

    def test_approved_ok(self):
        html = re.sub(r'(data-table="open-issues">.*?<tbody>).*?(</tbody>)', r"\1\2", VALID, flags=re.S)
        html = html.replace("、未決は Q-1", "")
        html = mutate(">レビュー中<", ">承認済み<", html)
        html = mutate("<td>承認</td><td>山田</td><td>未</td><td></td>", "<td>承認</td><td>山田</td><td>承認</td><td>2026-11-09</td>", html)
        errors, _ = check.check(html)
        self.assertEqual(errors, [])

    def test_process_needs_diagram(self):
        self.assertError(re.sub(r'<figure class="fig".*?</figure>', "", VALID, flags=re.S), "図")

    def test_pre_mermaid_forbidden(self):
        self.assertError(mutate("</section>\n<section class=\"panel off\" id=\"errors\"", "<pre class=\"mermaid\">flowchart LR\n A --> B</pre></section>\n<section class=\"panel off\" id=\"errors\""), "pre")

    def test_unrendered_figure(self):
        html = re.sub(r'(<div class="mm")[^>]*>.*?<!--mm:end--></div>', r'\1></div>', VALID, flags=re.S)
        self.assertError(html, "render_mermaid.py")

    def test_stale_figure(self):
        self.assertError(mutate("A --> B", "A --> C"), "render_mermaid.py")

    def test_decision_not_covered_by_tests_warns(self):
        html = VALID.replace("<td>キューに 1 件</td><td>D-1・X-1</td>", "<td>キューに 1 件</td><td>X-1</td>")
        self.assertNotEqual(html, VALID)
        self.assertWarning(html, "D-1")

    def test_no_test_marker_suppresses_warning(self):
        html = VALID.replace("<td>キューに 1 件</td><td>D-1・X-1</td>", "<td>キューに 1 件</td><td>X-1</td>")
        html = mutate("<td>既存の仕組みで済む</td>", "<td>既存の仕組みで済む（テスト不要: 方式の選択でありコードの分岐ではない）</td>", html)
        _, warnings = check.check(html)
        self.assertEqual(warnings, [])

    def test_review_not_done_allowed_while_drafting(self):
        html = mutate(">レビュー中<", ">作成中<")
        html = mutate("<td>独立レビュー</td><td>穴なし</td><td>なし</td>", "<td>独立レビュー</td><td>未実施</td><td>—</td>", html)
        errors, _ = check.check(html)
        self.assertEqual(errors, [])

    def test_review_not_done_blocks_review_status(self):
        html = mutate("<td>独立レビュー</td><td>穴なし</td><td>なし</td>", "<td>独立レビュー</td><td>未実施</td><td>—</td>")
        self.assertError(html, "未実施")

    def _approved_base(self):
        html = re.sub(r'(data-table="open-issues">.*?<tbody>).*?(</tbody>)', r"\1\2", VALID, flags=re.S)
        html = html.replace("、未決は Q-1", "")
        return mutate(">レビュー中<", ">承認済み<", html)

    def test_approved_requires_approval_result(self):
        html = mutate("<td>承認</td><td>山田</td><td>未</td><td></td>", "<td>承認</td><td>山田</td><td>却下</td><td>2026-11-09</td>", self._approved_base())
        self.assertError(html, "承認")

    def test_approved_requires_approval_date(self):
        html = mutate("<td>承認</td><td>山田</td><td>未</td><td></td>", "<td>承認</td><td>山田</td><td>承認</td><td></td>", self._approved_base())
        self.assertError(html, "日付")

    def test_reference_like_words_in_code_are_ignored(self):
        html = mutate("<td>再試行を追加</td>", "<td>再試行を追加（署名は <code>P-256</code>）</td>")
        errors, _ = check.check(html)
        self.assertEqual(errors, [])

    def test_source_outside_figure(self):
        html = mutate("</section>\n<section class=\"panel off\" id=\"errors\"", "<script type=\"text/x-mermaid\">flowchart LR\n A --> B</script></section>\n<section class=\"panel off\" id=\"errors\"")
        self.assertError(html, "figure")

    def test_blocker_in_design_review_blocks_review_status(self):
        html = mutate("<td>承認</td><td>山田</td><td>未</td><td></td>", "<td>設計レビュー</td><td>独立レビュー</td><td>ブロッカーあり</td><td>2026-11-09</td></tr><tr><td>承認</td><td>山田</td><td>未</td><td></td>")
        self.assertError(html, "ブロッカー")

    def test_publish_skeleton_left_in_file(self):
        html = '<!doctype html><html><head><meta charset=utf8><style>body{margin:0}</style></head><body>\n' + VALID + '</body></html>'
        self.assertError(html, "外枠")

    def test_secret_warns(self):
        self.assertWarning(mutate("<td>再試行を追加</td>", "<td>token=sk-abcdefghijklmnopqrstuvwx</td>"), "機密")

    def test_base_without_link_attrs_passes(self):
        """0.1.0 の雛形で作った文書（属性なし・data-src なし・data-tpl なし）はそのまま通る"""
        html = mutate(BASE, '<td data-field="base">main abc1234</td>')
        html = html.replace("<code data-src>", "<code>").replace(' data-tpl="2"', "")
        self.assertEqual(check.check(html)[0], [])

    def test_src_marks_without_base_attrs_pass(self):
        """リンクにできないとき: data-repo・data-sha が空でも、data-src は残してよい"""
        html = mutate(BASE, '<td data-field="base" data-repo="" data-sha="">なし（新規）</td>')
        self.assertEqual(check.check(html)[0], [])

    def test_repo_without_sha(self):
        self.assertError(mutate(' data-sha="abc1234def5678901234567890abcdef12345678"', ' data-sha=""'), "両方")

    def test_repo_must_be_github(self):
        for bad in ("https://gitlab.com/example/orders", "https://github.com/example/orders/", "https://github.com/example/orders.git/x",
                    "git@github.com:example/orders.git", "http://github.com/example/orders"):
            self.assertError(mutate("https://github.com/example/orders", bad), "data-repo")

    def test_sha_must_be_full(self):
        self.assertError(mutate("abc1234def5678901234567890abcdef12345678", "abc1234"), "40 桁")

    def test_base_attrs_with_surrounding_whitespace(self):
        for ws in (" ", "\n", "\u0085", "\u00a0", "\u3000"):
            self.assertError(mutate('data-repo="https://github.com/example/orders"', 'data-repo="https://github.com/example/orders%s"' % ws), "data-repo")
            self.assertError(mutate('data-sha="abc1234', 'data-sha="%sabc1234' % ws), "40 桁")

    @unittest.skipUnless(shutil.which("node"), "Node.js が無い")
    def test_template_script_agrees_on_base_attrs(self):
        """ヘッダーの data-repo・data-sha を、表示時の script と check.py が同じに受理・不受理すること"""
        with open(os.path.join(HERE, "..", "template.html"), encoding="utf-8") as f:
            js = re.search(r"/\* SRC-BEGIN.*?\*/(.*?)/\* SRC-END \*/", f.read(), re.S).group(1)
        good_repo, good_sha = "https://github.com/example/orders", "abc1234def5678901234567890abcdef12345678"
        pairs = [(good_repo, good_sha)]
        for ws in (" ", "\t", "\n", "\u0085", "\u00a0", "\u3000", "\u200b"):
            pairs += [(ws + good_repo, good_sha), (good_repo + ws, good_sha), (good_repo, ws + good_sha), (good_repo, good_sha + ws)]
        pairs += [("https://gitlab.com/example/orders", good_sha), (good_repo + "/", good_sha), (good_repo + ".git/x", good_sha),
                  (good_repo, good_sha[:7]), (good_repo, good_sha.upper()), (good_repo, ""), ("", good_sha), ("", "")]
        code = "var repo = '', sha = '';\n%s\nconsole.log(JSON.stringify(%s.map(function (p) { return srcLinkable(p[0], p[1]) })));" % (js, json.dumps(pairs))
        out = subprocess.run(["node", "-e", code], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        for (repo, sha), linkable in zip(pairs, json.loads(out.stdout)):
            html = mutate(BASE, '<td data-field="base" data-repo="%s" data-sha="%s">main abc1234</td>' % (repo, sha))
            errors = [e for e in check.check(html)[0] if "data-repo" in e or "data-sha" in e]
            # 両方空は「リンクにしない」正しい文書。それ以外は、script がリンクにする ⇔ check.py が ERROR を出さない
            self.assertEqual(linkable, not errors and bool(repo), f"{repo!r} {sha!r}: script={linkable} check={errors}")

    def test_base_text_must_carry_short_sha(self):
        self.assertError(mutate(">main abc1234</td>", ">main fff9999</td>"), "短縮 SHA")
        self.assertError(mutate(">main abc1234</td>", ">fix/abc1234 fff9999</td>"), "短縮 SHA")
        self.assertError(mutate(">main abc1234</td>", ">abc1234 main</td>"), "短縮 SHA")
        self.assertEqual(check.check(mutate(">main abc1234</td>", ">origin/main abc1234def56</td>"))[0], [])

    def test_src_format(self):
        for bad in ("/src/sync.ts", "./src/sync.ts", "src//sync.ts", "src/../sync.ts", "src/sync.ts:0", "src/sync.ts:9-3",
                    "src/:3", "src/sync.ts:", "src/sync.ts:1-", "/", "src\\sync.ts", "a:b.txt:5", "localhost:3000/x",
                    "src/sync.ts:１０", "src/sync.ts:１０-１２"):
            self.assertError(mutate(SRC, "<code data-src>%s</code> の" % bad), "data-src")
        for ok in ("src/sync.ts", "src/sync.ts:1", "src/sync.ts:3-3", "src/sync.ts:10-24", "src/", "docs/設計 メモ.md:2",
                   "Makefile"):
            self.assertEqual(check.check(mutate(SRC, "<code data-src>%s</code> の" % ok))[0], [], ok)

    def test_parse_src(self):
        self.assertEqual(check.parse_src("src/sync.ts:10-24"), ("src/sync.ts", 10, 24))
        self.assertEqual(check.parse_src("src/sync.ts:10"), ("src/sync.ts", 10, None))
        self.assertEqual(check.parse_src("src/"), ("src/", None, None))
        self.assertIsNone(check.parse_src("a:b.txt:5"))

    def test_src_attribute_value(self):
        self.assertError(mutate(SRC, '<code data-src="src/sync.ts">run</code> の'), "値")

    def test_template_has_no_src_format_error(self):
        with open(os.path.join(HERE, "..", "template.html"), encoding="utf-8") as f:
            errors, _ = check.check(f.read())
        self.assertFalse([e for e in errors if "data-src" in e], errors)

    def test_src_on_non_code(self):
        self.assertError(mutate(SRC, "<span data-src>src/sync.ts</span> の"), "code 要素")

    def test_src_inside_anchor(self):
        self.assertError(mutate(SRC, '<a href="https://github.com/example/orders/blob/old/src/sync.ts"><code data-src>src/sync.ts</code></a> の'), "a 要素")

    def test_src_needs_current_template(self):
        self.assertError(mutate('<script data-tpl="2">', "<script>"), "<script>")
        self.assertError(mutate('<style data-tpl="2">', "<style>"), "<style>")
        self.assertError(mutate('<script data-tpl="2">', '<script data-tpl="1">'), "<script>")

    def test_template_script_matches_parse_src(self):
        """表示時の script の判定式が check.py と同じ形であること（片方だけ直すのを防ぐ）"""
        with open(os.path.join(HERE, "..", "template.html"), encoding="utf-8") as f:
            tpl = f.read()
        self.assertIn("/^" + check.SRC_RE.pattern + "$/", tpl)
        self.assertIn("/" + check.SRC_BAD_RE.pattern + "/", tpl)
        self.assertIn("/^" + check.REPO_RE.pattern.replace("/", "\\/") + "$/", tpl)
        self.assertIn("/^" + check.SHA_RE.pattern + "$/", tpl)
        self.assertIn('data-tpl="%d"' % check.TEMPLATE_GEN, tpl)

    @unittest.skipUnless(shutil.which("node"), "Node.js が無い")
    def test_template_script_agrees_with_parse_src(self):
        """同じ入力を、表示時の script（Node で実行）と check.py に通し、受理・不受理と path・行が一致すること"""
        with open(os.path.join(HERE, "..", "template.html"), encoding="utf-8") as f:
            js = re.search(r"/\* SRC-BEGIN.*?\*/(.*?)/\* SRC-END \*/", f.read(), re.S).group(1)
        sha = "abc1234def5678901234567890abcdef12345678"
        raws = ["src/sync.ts", "src/sync.ts:10", "src/sync.ts:10-24", "src/sync.ts:7-7", "src/", "docs/設計 メモ.md:2",
                "docs/a  b.md:1", "a#b/c?d%20.ts:1", "  src/pad.ts:3\n ", "\tsrc/tab.ts\n", "Makefile", "src/sync.ts:007",
                "", " ", "/", "/abs.ts", "./x.ts", "src/../x.ts", "src//x.ts", "src/x.ts:0", "src/x.ts:9-3", "src/:3", "src/x.ts:",
                "src/x.ts:1-", "localhost:3000/x", "a:b.txt:5", "src\\x.ts", "src/x.ts:１０", "src/x.ts:١", "\u0085src/x.ts:1",
                "src/x\u00a0y.ts", "src/x\u3000y.ts", "src/x\ty.ts", "src/x\ny.ts", "src/ x.ts", "src/x.ts /y", "\u200bsrc/x.ts",
                "src/x.ts:1 ", "src/x.ts :1", "src/x.ts: 1", "src/x.ts:9999999", "src/x.ts:10000000",
                "src/x.ts:9007199254740993", "src/x.ts:1-10000000"]
        code = ("var repo = 'https://github.com/o/r', sha = '%s';\n%s\n"
                "console.log(JSON.stringify(%s.map(function (r) { return srcHref(srcText(r)) })));" % (sha, js, json.dumps(raws)))
        out = subprocess.run(["node", "-e", code], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        hrefs = json.loads(out.stdout)

        class T:  # src_text に渡す、text() だけ持つ代わりの要素
            def __init__(self, raw):
                self.raw = raw

            def text(self):
                return self.raw

        for raw, href in zip(raws, hrefs):
            parsed = check.parse_src(check.src_text(T(raw)))
            self.assertEqual(parsed is None, href is None, f"{raw!r}: check.py={parsed} script={href}")
            if parsed is None:
                continue
            path, start, end = parsed
            kind = "tree" if path.endswith("/") else "blob"
            want = f"https://github.com/o/r/{kind}/{sha}/" + urllib.parse.quote(path.rstrip("/"), safe="/-_.!~*'()")
            if start:
                want += f"?plain=1#L{start}" + (f"-L{end}" if end and end != start else "")
            self.assertEqual(href, want, raw)

    def test_cli_exit_codes(self):
        script = os.path.join(HERE, "check.py")
        ok = subprocess.run([sys.executable, "-I", script, os.path.join(HERE, "fixtures", "valid.html")], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        ng = subprocess.run([sys.executable, "-I", script, os.path.join(HERE, "..", "template.html")], capture_output=True, text=True)
        self.assertEqual(ng.returncode, 1)
        self.assertIn("ERROR", ng.stdout)


if __name__ == "__main__":
    unittest.main()
