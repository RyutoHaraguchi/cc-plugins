"""設計書 HTML の図（mermaid）を SVG にして埋め込む。

使い方: python3 render_mermaid.py <design.html> [--force]
- <figure class="fig"> の中の <script type="text/x-mermaid"> を、ライト用とダーク用の 2 枚の SVG にして
  同じ figure の <div class="mm"></div> に入れる。ページはテーマに合わせて片方を表示する。
- 定義が前回と同じ図は描き直さない（--force で全部描き直す）。
- 描画には mermaid-cli（npx で取得）と Chrome を使う。構文エラーは図の番号付きで止まる（終了コード 1）。
  Chrome の場所は環境変数 MERMAID_CHROME で指定できる。見つからなければ puppeteer が取得する。
"""

import html as htmlmod
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import SLOT_RE, iter_figures, src_hash  # noqa: E402

MERMAID_CLI = "@mermaid-js/mermaid-cli@11.17.1"
FONT = '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", "BIZ UDPGothic", sans-serif'
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]


class RenderError(Exception):
    pass


def _prefix_plain_ids(svg, svg_id):
    """SVG の中で svg_id で始まらず、どこからも参照されていない id に svg_id を付ける（同じページの別の図と衝突させない）"""
    def repl(m):
        ident = m.group(1)
        if ident == svg_id or ident.startswith(svg_id):
            return m.group(0)
        if re.search(r"#%s\b" % re.escape(ident), svg):
            return m.group(0)
        return f'id="{svg_id}--{ident}"'
    return re.sub(r'id="([^"]+)"', repl, svg)


def _clean_svg(svg, svg_id):
    svg = re.sub(r"<\?xml[^>]*\?>\s*", "", svg).strip()
    return _prefix_plain_ids(svg, svg_id)


def render_html(html, renderer, force=False):
    """(新しい HTML, 描いた図の数) を返す。renderer(source, svg_id, theme) は SVG 文字列を返す"""
    out, pos, count = [], 0, 0
    for fig, raw_source, slot, fm in iter_figures(html):
        if slot is None:
            raise RenderError(f'図 {fig}: SVG の枠 <div class="mm"></div> が無い')
        h = src_hash(raw_source)
        hm = re.search(r'data-src-hash="([^"]*)"', slot.group("attrs"))
        if not force and hm and hm.group(1) == h and slot.group("body"):
            continue
        source = htmlmod.unescape(raw_source).strip() + "\n"
        base = "mm-" + re.sub(r"[^A-Za-z0-9-]", "-", fig)
        parts = []
        for theme, suffix, cls in (("default", "l", "mm-light"), ("dark", "d", "mm-dark")):
            svg_id = f"{base}-{suffix}"
            try:
                svg = renderer(source, svg_id, theme)
            except RenderError as e:
                raise RenderError(f"図 {fig}（{theme}）: {e}") from None
            parts.append(f'<div class="{cls}">{_clean_svg(svg, svg_id)}</div>')
        new_slot = f'<div class="mm" data-src-hash="{h}"><!--mm:start-->{"".join(parts)}<!--mm:end--></div>'
        start = fm.start(1) + slot.start()
        end = fm.start(1) + slot.end()
        out.append(html[pos:start])
        out.append(new_slot)
        pos = end
        count += 1
    out.append(html[pos:])
    return "".join(out), count


def _find_chrome():
    env = os.environ.get("MERMAID_CHROME")
    if env:
        return env
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    return None


def make_cli_renderer(workdir):
    npx = shutil.which("npx")
    if not npx:
        raise RenderError("npx が見つからない（Node.js が要る）")
    chrome = _find_chrome()
    pconf = os.path.join(workdir, "puppeteer.json")
    with open(pconf, "w", encoding="utf-8") as f:
        json.dump({"executablePath": chrome, "args": ["--no-sandbox"]} if chrome else {"args": ["--no-sandbox"]}, f)
    mconf = os.path.join(workdir, "mermaid.json")
    with open(mconf, "w", encoding="utf-8") as f:
        # htmlLabels=false: ラベルを foreignObject ではなく SVG の text で描く。描画時と表示時でフォントが違っても文字が切れない
        json.dump({"fontFamily": FONT, "htmlLabels": False, "flowchart": {"htmlLabels": False}}, f)
    env = dict(os.environ)
    if chrome:
        env["PUPPETEER_SKIP_DOWNLOAD"] = "true"

    def render(source, svg_id, theme):
        src = os.path.join(workdir, f"{svg_id}.mmd")
        dst = os.path.join(workdir, f"{svg_id}.svg")
        with open(src, "w", encoding="utf-8") as f:
            f.write(source)
        proc = subprocess.run(
            [npx, "-y", MERMAID_CLI, "-q", "-i", src, "-o", dst, "-t", theme, "-b", "transparent",
             "-I", svg_id, "-c", mconf, "-p", pconf],
            capture_output=True, text=True, env=env, timeout=300,
        )
        if proc.returncode != 0 or not os.path.exists(dst):
            msg = "\n".join(line for line in (proc.stderr + proc.stdout).splitlines() if "npm warn" not in line)
            raise RenderError(msg.strip() or f"mermaid-cli が終了コード {proc.returncode} で失敗")
        with open(dst, encoding="utf-8") as f:
            return f.read()

    return render


def main(argv):
    args = [a for a in argv[1:] if a != "--force"]
    if len(args) != 1:
        print("使い方: python3 render_mermaid.py <design.html> [--force]", file=sys.stderr)
        return 2
    path = args[0]
    with open(path, encoding="utf-8") as f:
        html = f.read()
    with tempfile.TemporaryDirectory() as tmp:
        try:
            new_html, n = render_html(html, make_cli_renderer(tmp), force="--force" in argv)
        except RenderError as e:
            print(f"ERROR: {e}")
            return 1
    if n:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_html)
    print(f"結果: {n} 枚の図を SVG にした（変更の無い図はそのまま）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
