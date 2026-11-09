"""basic-design-doc の設計書 HTML を機械的に検査する。

使い方: python3 check.py <design.html>
終了コード: 0 = ERROR なし（WARN はあってもよい）, 1 = ERROR あり, 2 = 引数・読み込みの誤り
標準ライブラリだけで動く。検査の目印は template.html の data-* 属性。
"""

import hashlib
import re
import sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

REQUIRED_CHAPTERS = ["cover", "overview", "architecture", "process", "errors", "test", "evidence"]
OPTIONAL_CHAPTERS = {"data": "4", "nfr": "6"}

# 表の種類 -> (置く章, 列見出し, 最低行数)
TABLES = {
    "omitted": ("cover", ["章", "扱わない理由"], 0),
    "open-issues": ("cover", ["No", "論点", "推奨", "影響する箇所"], 0),
    "revisions": ("cover", ["版数", "日付", "内容", "作成"], 1),
    "approvals": ("cover", ["役割", "担当", "結果", "日付"], 1),
    "scope": ("overview", ["対象", "変更内容", "関係する決定"], 1),
    "out-of-scope": ("overview", ["対象外", "理由"], 0),
    "terms": ("overview", ["用語", "意味"], 0),
    "alternatives": ("architecture", ["方式", "仕組み", "判定", "理由"], 1),
    "decisions": ("architecture", ["No", "論点", "決定", "理由"], 1),
    "paths": ("process", ["No", "入口・きっかけ", "条件", "動作", "関係"], 1),
    "errors": ("errors", ["No", "事象・発生箇所", "分類", "応答・挙動", "理由"], 1),
    "risks": ("nfr", ["No", "内容", "扱い", "理由"], 0),
    "tests": ("test", ["No", "種別", "観点", "期待結果", "対応"], 1),
    "sources": ("evidence", ["内容", "出典", "確度"], 1),
    "reviews": ("evidence", ["版数", "レビュー者", "結果", "主な指摘と対応"], 1),
}
# 空欄を許す表（承認欄の日付など）
EMPTY_CELLS_ALLOWED = {"approvals"}

ID_PREFIX = {"open-issues": "Q", "decisions": "D", "paths": "P", "errors": "X", "risks": "R", "tests": "UE"}
ENUMS = {
    ("alternatives", 2): ("判定", {"採用", "不採用", "見送り"}),
    ("errors", 2): ("分類", {"拒否", "障害", "部分失敗", "競合"}),
    ("risks", 2): ("扱い", {"受容", "別対応", "対策済み"}),
    ("tests", 1): ("種別", {"単体", "結合"}),
    ("sources", 2): ("確度", {"公式", "コード", "実測", "引用", "未検証"}),
}
STATUSES = {"作成中", "レビュー中", "承認済み"}
REF_RE = re.compile(r"(?<![A-Za-z0-9_])([DPXUERQ])-(\d+)(?![0-9])")
SECRET_RES = [
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"(?i)(password|passwd|secret|api[_-]?key)\s*[:=]\s*\S{6,}"),
]


FIG_RE = re.compile(r'<figure\b[^>]*class="fig"[^>]*>(.*?)</figure>', re.S)
FIG_ID_RE = re.compile(r'<figure\b[^>]*data-fig="([^"]*)"')
SRC_RE = re.compile(r'<script type="text/x-mermaid">(.*?)</script>', re.S)
SLOT_RE = re.compile(r'<div class="mm"(?P<attrs>[^>]*)>(?:<!--mm:start-->(?P<body>.*?)<!--mm:end-->)?</div>', re.S)
PRE_MERMAID_RE = re.compile(r'<pre\b[^>]*class="[^"]*\bmermaid\b[^"]*"')


def src_hash(source):
    """図の定義のハッシュ。render_mermaid.py が SVG と一緒に記録し、check.py が描き直し漏れを見る"""
    return hashlib.sha256(source.strip().encode("utf-8")).hexdigest()[:16]


def iter_figures(html):
    """(図の番号, 図の定義, 枠の match, figure の match) を順に返す。定義の無い figure は飛ばす"""
    for i, fm in enumerate(FIG_RE.finditer(html), 1):
        src = SRC_RE.search(fm.group(1))
        if not src:
            continue
        idm = FIG_ID_RE.match(fm.group(0))
        yield (idm.group(1) if idm else str(i)), src.group(1), SLOT_RE.search(fm.group(1)), fm


def figure_errors(html):
    errors = []
    if PRE_MERMAID_RE.search(re.sub(r"<!--.*?-->", "", html, flags=re.S)):
        errors.append('<pre class="mermaid"> は使わない（ダウンロードした HTML で図にならない）。figure + <script type="text/x-mermaid"> で書き、render_mermaid.py で SVG にする')
    for fig, source, slot, _ in iter_figures(html):
        if slot is None:
            errors.append(f'図 {fig} に SVG の枠 <div class="mm"></div> が無い')
            continue
        body = slot.group("body") or ""
        hm = re.search(r'data-src-hash="([^"]*)"', slot.group("attrs"))
        if "mm-light" not in body or "mm-dark" not in body or "<svg" not in body:
            errors.append(f"図 {fig} が SVG になっていない。render_mermaid.py を実行する")
        elif not hm or hm.group(1) != src_hash(source):
            errors.append(f"図 {fig} の定義が SVG にした後で変わっている。render_mermaid.py を実行する")
    return errors


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []  # Node または str

    def text(self):
        if self.tag in ("style", "script"):
            return ""
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)

    def iter(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.iter()

    def classes(self):
        return self.attrs.get("class", "").split()

    def find_all(self, pred):
        return [n for n in self.iter() if pred(n)]


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, [(k, v or "") for k, v in attrs], self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, [(k, v or "") for k, v in attrs], self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def rows_of(table):
    """(thead の見出し, tbody の各行のセル Node のリスト)"""
    heads = [norm(th.text()) for th in table.find_all(lambda n: n.tag == "th" and _in(n, "thead"))]
    rows = []
    for tr in table.find_all(lambda n: n.tag == "tr" and _in(n, "tbody")):
        rows.append([c for c in tr.children if isinstance(c, Node) and c.tag in ("td", "th")])
    return heads, rows


def _in(node, tag):
    p = node.parent
    while p is not None:
        if p.tag == tag:
            return True
        p = p.parent
    return False


def section_of(node):
    p = node
    while p is not None:
        if p.tag == "section" and "panel" in p.classes():
            return p.attrs.get("id")
        p = p.parent
    return None


def check(html):
    errors, warnings = [], []
    no_comments = re.sub(r"<!--.*?-->", "", html, flags=re.S)

    # 1. 置き換え忘れ
    count = no_comments.count("【記入")
    if count:
        errors.append(f"【記入 …】が {count} 箇所残っている")

    tb = TreeBuilder()
    tb.feed(no_comments)
    tb.close()
    root = tb.root

    # 2. 章
    sections = {n.attrs.get("id"): n for n in root.find_all(lambda n: n.tag == "section" and "panel" in n.classes())}
    for sid in sections:
        if sid not in REQUIRED_CHAPTERS and sid not in OPTIONAL_CHAPTERS:
            errors.append(f"章 id=\"{sid}\" は雛形に無い（必須: {', '.join(REQUIRED_CHAPTERS)}、任意: data, nfr）")
    for sid in REQUIRED_CHAPTERS:
        if sid not in sections:
            errors.append(f"必須の章 id=\"{sid}\" が無い")

    # 3. 表
    tables = {}
    for t in root.find_all(lambda n: n.tag == "table" and "data-table" in n.attrs):
        tables.setdefault(t.attrs["data-table"], []).append(t)
    parsed = {}
    for name, (chapter, heads, min_rows) in TABLES.items():
        if chapter not in sections:
            continue
        found = tables.get(name, [])
        if not found:
            errors.append(f"表 data-table=\"{name}\" が章 {chapter} に無い")
            continue
        if len(found) > 1:
            errors.append(f"表 data-table=\"{name}\" が {len(found)} 個ある（1 個にする）")
        t = found[0]
        if section_of(t) != chapter:
            errors.append(f"表 data-table=\"{name}\" は章 {chapter} に置く（今は {section_of(t)}）")
        got_heads, rows = rows_of(t)
        if got_heads != heads:
            errors.append(f"表 {name} の列が雛形と違う: {got_heads} （正: {heads}）")
            continue
        if len(rows) < min_rows:
            errors.append(f"表 {name} に行が無い（{min_rows} 行以上必要）")
        for i, cells in enumerate(rows, 1):
            if len(cells) != len(heads):
                errors.append(f"表 {name} の {i} 行目の列数が {len(cells)}（正: {len(heads)}）")
                continue
            if name not in EMPTY_CELLS_ALLOWED:
                for h, c in zip(heads, cells):
                    if not norm(c.text()):
                        errors.append(f"表 {name} の {i} 行目「{h}」が空")
        parsed[name] = rows
    for name in tables:
        if name not in TABLES:
            errors.append(f"表 data-table=\"{name}\" は雛形に無い")

    def cell(row, i):
        return norm(row[i].text()) if i < len(row) else ""

    # 4. 省いた章の申告
    omitted = {m.group(1) for m in (re.match(r"\D*(\d)", cell(r, 0)) for r in parsed.get("omitted", [])) if m}
    for sid, no in OPTIONAL_CHAPTERS.items():
        if sid not in sections and no not in omitted:
            errors.append(f"章 {no}（id=\"{sid}\"）を省いたのに、表紙の「扱わない章」に理由が無い")
        if sid in sections and no in omitted:
            errors.append(f"章 {no}（id=\"{sid}\"）があるのに「扱わない章」に載っている")

    # 5. ヘッダー
    fields = {n.attrs["data-field"]: norm(n.text()) for n in root.find_all(lambda n: "data-field" in n.attrs)}
    for f in ("version", "date", "status", "base"):
        if not fields.get(f):
            errors.append(f"ヘッダーの data-field=\"{f}\" が空")
    if fields.get("status") and fields["status"] not in STATUSES:
        errors.append(f"status「{fields['status']}」は {sorted(STATUSES)} のどれかにする")
    if fields.get("date") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fields["date"]):
        errors.append(f"date「{fields['date']}」は YYYY-MM-DD にする")
    version = fields.get("version", "")

    # 6. 要旨
    summaries = root.find_all(lambda n: n.attrs.get("data-block") == "summary")
    if not summaries or not norm(summaries[0].text()):
        errors.append("要旨 data-block=\"summary\" が無いか空")

    # 7. 番号
    defined = {}
    row_text = {}
    for name, prefixes in ID_PREFIX.items():
        for i, r in enumerate(parsed.get(name, []), 1):
            el = r[0] if r else None
            ident = el.attrs.get("data-id", "") if el is not None else ""
            m = re.fullmatch(r"([A-Z])-(\d+)", ident)
            if not m or m.group(1) not in prefixes:
                errors.append(f"表 {name} の {i} 行目の data-id「{ident}」は {'/'.join(prefixes)}-n にする")
                continue
            if ident in defined:
                errors.append(f"番号 {ident} が重複している（{defined[ident]} と {name}）")
            defined[ident] = name
            row_text[ident] = " ".join(norm(c.text()) for c in r)
            if norm(el.text()) != ident:
                errors.append(f"番号 {ident} のセルの表示が「{norm(el.text())}」になっている")
    body_text = root.text()
    for m in REF_RE.finditer(body_text):
        ref = m.group(0)
        if ref not in defined:
            errors.append(f"{ref} が参照されているが、どの表にも定義が無い")
            defined[ref] = "reported"

    # 8. 列の値
    for (name, idx), (label, allowed) in ENUMS.items():
        for i, r in enumerate(parsed.get(name, []), 1):
            v = cell(r, idx)
            if v and v not in allowed:
                errors.append(f"表 {name} の {i} 行目「{label}」の「{v}」は {sorted(allowed)} のどれかにする")
    if "alternatives" in parsed and not any(cell(r, 2) == "採用" for r in parsed["alternatives"]):
        errors.append("方式の比較に「採用」の行が無い")
    for r in parsed.get("tests", []):
        ident = r[0].attrs.get("data-id", "") if r else ""
        kind = cell(r, 1)
        if (ident.startswith("U-") and kind != "単体") or (ident.startswith("E-") and kind != "結合"):
            errors.append(f"{ident} の種別「{kind}」が番号と合わない（U=単体、E=結合）")

    # 9. 版数
    revs = parsed.get("revisions", [])
    if revs and version and cell(revs[-1], 0) != version:
        errors.append(f"改訂履歴の最終行の版数「{cell(revs[-1], 0)}」がヘッダーの版数「{version}」と違う")
    for n in root.find_all(lambda n: "data-rev" in n.attrs):
        if n.attrs["data-rev"] != version:
            errors.append(f"版数の印 data-rev=\"{n.attrs['data-rev']}\" が最新版 {version} ではない（前の版の印は消す）")

    # 10. 承認済みの条件
    if fields.get("status") == "承認済み":
        if parsed.get("open-issues"):
            errors.append("未決事項が残っているのに状態が「承認済み」")
        approved = [r for r in parsed.get("approvals", []) if cell(r, 0) == "承認" and cell(r, 2) not in ("", "未")]
        if not approved:
            errors.append("承認欄の「承認」行の結果が入っていないのに状態が「承認済み」")

    # 10b. 独立レビューが済むまでは「作成中」
    if fields.get("status") in ("レビュー中", "承認済み"):
        if any(cell(r, 2) == "未実施" for r in parsed.get("reviews", [])):
            errors.append(f"レビュー経過に「未実施」の行があるのに状態が「{fields['status']}」")

    # 11. 図
    if "process" in sections and not sections["process"].find_all(lambda n: n.tag == "script" and n.attrs.get("type") == "text/x-mermaid"):
        errors.append("処理設計（id=\"process\"）に図（figure + <script type=\"text/x-mermaid\">）が無い")
    errors.extend(figure_errors(html))

    # WARN: テスト観点との対応
    covered = " ".join(cell(r, 4) for r in parsed.get("tests", []))
    for ident, name in defined.items():
        if name in ("decisions", "errors") and "テスト不要" not in row_text.get(ident, "") and not re.search(r"(?<![A-Za-z0-9_])%s(?![0-9])" % re.escape(ident), covered):
            warnings.append(f"{ident} がテスト観点の対応欄に無い（テストしないなら、その行の理由に「（テスト不要: 理由）」と書く）")

    # WARN: 機密
    for rx in SECRET_RES:
        for m in rx.finditer(body_text):
            warnings.append(f"機密の可能性: 「{m.group(0)[:24]}…」 公開前に確認する")

    return errors, warnings


def main(argv):
    if len(argv) != 2:
        print("使い方: python3 check.py <design.html>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            html = f.read()
    except OSError as e:
        print(f"読み込めない: {e}", file=sys.stderr)
        return 2
    errors, warnings = check(html)
    for e in errors:
        print(f"ERROR: {e}")
    for w in warnings:
        print(f"WARN: {w}")
    print(f"結果: ERROR {len(errors)} 件 / WARN {len(warnings)} 件")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
