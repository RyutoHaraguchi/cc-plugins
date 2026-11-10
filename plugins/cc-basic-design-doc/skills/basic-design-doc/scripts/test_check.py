import os
import re
import subprocess
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
        self.assertError(mutate('<td data-field="base">main abc1234</td>', '<td data-field="base"></td>'), "base")

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

    def test_cli_exit_codes(self):
        script = os.path.join(HERE, "check.py")
        ok = subprocess.run([sys.executable, "-I", script, os.path.join(HERE, "fixtures", "valid.html")], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        ng = subprocess.run([sys.executable, "-I", script, os.path.join(HERE, "..", "template.html")], capture_output=True, text=True)
        self.assertEqual(ng.returncode, 1)
        self.assertIn("ERROR", ng.stdout)


if __name__ == "__main__":
    unittest.main()
