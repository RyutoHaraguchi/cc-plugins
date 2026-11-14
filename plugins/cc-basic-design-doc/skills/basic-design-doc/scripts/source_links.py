"""設計書のファイル参照（data-src）を GitHub リンクにするための補助。

使い方:
  python3 source_links.py base <ref> [--repo DIR] [--remote origin]
      ベースの commit とリポジトリの URL を調べ、ヘッダーに貼る <td data-field="base" …> を出す。
      リンクにできないとき（remote が無い・GitHub でない・commit が remote に無い）は理由と、属性が空の <td> を出す。
  python3 source_links.py verify <design.html> [--repo DIR] [--remote origin]
      文書の data-src が、data-sha の時点のリポジトリに実在するか（ファイル・ディレクトリ・行番号）を確かめる。
      data-sha が空（リンクにしない文書）のときは、ベース欄の短縮 SHA が解決できれば、それで実在だけを確かめる。

終了コード: 0 = 問題なし（リンクにできない場合も含む）, 1 = ERROR あり, 2 = 引数・読み込み・git の誤り
標準ライブラリと git だけで動く。ネットワークには出ない。push 済みかは、URL を取ったのと同じ remote の追跡ブランチ
（refs/remotes/<remote>/）で見る。追跡ブランチは手元の情報なので、古いと思ったら先に git fetch <remote> する。
対応するのは github.com だけ（GitHub Enterprise・GitLab などはリンクにしない）。
"""

import argparse
import html as htmlmod
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402

REMOTE_RES = [
    re.compile(r"^(?:ssh://)?(?:[^@/]+@)?(?P<host>[^:/]+):(?!\d+/)(?P<path>[^/].*)$"),  # git@host:owner/repo
    re.compile(r"^(?:https?|ssh|git)://(?:[^@/]+@)?(?P<host>[^:/]+)(?::\d+)?/(?P<path>.+)$"),
]


class GitError(Exception):
    pass


def git(repo, *args, check_rc=True):
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    except OSError as e:
        raise GitError(f"git を実行できない: {e}")
    if check_rc and p.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {p.stderr.decode('utf-8', 'replace').strip()}")
    return p


def normalize_remote(url):
    """remote の URL を https://github.com/<owner>/<repo> にする。github.com でない・形が違うときは None。

    ~/.ssh/config の別名ホスト（github-work:o/r など）は github.com と判定できないので None（リンクにしない）。
    """
    url = url.strip()
    for rx in REMOTE_RES:
        m = rx.match(url)
        if not m:
            continue
        host = m.group("host").lower()
        path = m.group("path").strip("/")
        if path.endswith(".git"):
            path = path[:-4]
        url = f"https://{host}/{path}"
        return url if check.REPO_RE.fullmatch(url) else None
    return None


def remote_branches(repo, sha, remote):
    """sha を含む、その remote の追跡ブランチの名前（origin/main など。origin/HEAD は除く）。"""
    out = git(repo, "for-each-ref", "--contains", sha, "--format=%(refname:short)", f"refs/remotes/{remote}/",
              check_rc=False).stdout.decode("utf-8", "replace")
    return [b for b in out.split() if b != f"{remote}/HEAD" and b != remote]


def default_branch(repo, remote):
    out = git(repo, "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD", check_rc=False).stdout.decode().strip()
    return out or None


def repo_url_of(repo, remote):
    """(remote の生の URL, 正規化した GitHub の URL か None)"""
    raw = git(repo, "remote", "get-url", remote, check_rc=False).stdout.decode().strip()
    return raw, (normalize_remote(raw) if raw else None)


def base_td(label, repo_url="", sha=""):
    return (f'<td data-field="base" data-repo="{htmlmod.escape(repo_url)}" data-sha="{sha}">'
            f"{htmlmod.escape(label)}</td>")


def cmd_base(args):
    sha = git(args.repo, "rev-parse", "--verify", "--quiet", args.ref + "^{commit}", check_rc=False).stdout.decode().strip()
    if not sha:
        raise GitError(f"ref「{args.ref}」が commit として解決できない")
    short = git(args.repo, "rev-parse", "--short", sha).stdout.decode().strip()
    label = f"{args.ref} {short}"
    reason = None
    remote_url, repo_url = repo_url_of(args.repo, args.remote)
    branches = remote_branches(args.repo, sha, args.remote) if repo_url else []
    if not remote_url:
        reason = f"remote「{args.remote}」が無い"
    elif not repo_url:
        reason = f"remote「{remote_url}」が github.com の owner/repo の形でない"
    elif not branches:
        reason = (f"commit {short} が {args.remote} の追跡ブランチに無い"
                  f"（push すればリンクにできる。push 済みなら git fetch {args.remote} してからやり直す）")
    print(f"sha: {sha}")
    print(f"short: {short}")
    if reason:
        print(f"リンク: 不可 — {reason}")
        print(base_td(label))
    else:
        print(f"repo: {repo_url}")
        print("リンク: 可")
        main_branch = default_branch(args.repo, args.remote)
        if main_branch and main_branch not in branches:
            print(f"注意: commit {short} は {main_branch} に無い（{', '.join(branches[:3])} にある）。"
                  "そのブランチが消されると、リンクが切れることがある")
        print(base_td(label, repo_url, sha))
    return 0


def line_count(repo, sha, path, cache):
    if path not in cache:
        data = git(repo, "cat-file", "blob", f"{sha}:{path}").stdout
        cache[path] = data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)
    return cache[path]


def verify(html, repo, remote):
    """(errors, 情報の行) を返す。"""
    errors, info = [], []
    tb = check.TreeBuilder()
    tb.feed(re.sub(r"<!--.*?-->", "", html, flags=re.S))
    tb.close()
    bases = tb.root.find_all(lambda n: n.attrs.get("data-field") == "base")
    refs = tb.root.find_all(lambda n: "data-src" in n.attrs)
    if not bases:
        return ["ヘッダーの data-field=\"base\" が無い"], info
    sha = bases[0].attrs.get("data-sha", "")
    linked = bool(sha)
    if not linked:
        # リンクにしない文書でも、ベース欄の短縮 SHA がこのリポジトリで解決できれば、実在だけは確かめる
        info.append(f"data-sha が空なので、data-src {len(refs)} 件はリンクにならない（文字のまま）")
        short = check.base_short_sha(check.norm(bases[0].text()))
        if short:
            sha = git(repo, "rev-parse", "--verify", "--quiet", short + "^{commit}", check_rc=False).stdout.decode().strip()
        if not sha:
            info.append("ベース欄の commit がこのリポジトリで解決できないので、実在は確かめていない")
            return errors, info
    elif not check.SHA_RE.fullmatch(sha):
        return [f"data-sha「{sha}」は 40 桁の 16 進にする"], info
    if git(repo, "cat-file", "-e", sha + "^{commit}", check_rc=False).returncode != 0:
        return [f"data-sha {sha[:12]} がこのリポジトリ（{os.path.abspath(repo)}）に無い。"
                "git fetch するか、--repo で対象のリポジトリを指定する"], info
    data_repo = bases[0].attrs.get("data-repo", "")
    remote_url, repo_url = repo_url_of(repo, remote)
    if not linked:
        pass
    elif (repo_url or "").lower() != data_repo.lower():
        errors.append(f"data-repo「{data_repo}」が、このリポジトリの remote {remote}（{remote_url or '無い'}）と違う。"
                      "--repo・--remote で対象を合わせるか、data-repo を直す")
    elif not remote_branches(repo, sha, remote):
        errors.append(f"data-sha {sha[:12]} が {remote} の追跡ブランチに無い（リンクが 404 になる）。"
                      "push するか、data-repo・data-sha を空にする")
    cache = {}
    for n in refs:
        text = check.src_text(n)
        parsed = check.parse_src(text)
        if not parsed:
            errors.append(f"data-src「{text}」は path・path:N・path:N-M の形にする")
            continue
        path, start, end = parsed
        kind = git(repo, "cat-file", "-t", f"{sha}:{path.rstrip('/')}", check_rc=False).stdout.decode().strip()
        if not kind:
            errors.append(f"data-src「{text}」: {path} がベース {sha[:7]} に無い（これから作るファイルなら data-src を外す）")
        elif kind == "tree":
            if not path.endswith("/"):
                errors.append(f"data-src「{text}」: {path} はディレクトリ。末尾に / を付ける")
            elif start:
                errors.append(f"data-src「{text}」: ディレクトリに行番号は付けられない")
        elif kind != "blob":
            errors.append(f"data-src「{text}」: {path} はファイルでもディレクトリでもない（{kind}。submodule など）。data-src を外す")
        elif path.endswith("/"):
            errors.append(f"data-src「{text}」: {path} はファイル。末尾の / を外す")
        elif start:
            total = line_count(repo, sha, path, cache)
            if (end or start) > total:
                errors.append(f"data-src「{text}」: {path} はベース {sha[:7]} で {total} 行しかない")
    info.append(f"data-src {len(refs)} 件をベース {sha[:7]} で確かめた")
    return errors, info


def cmd_verify(args):
    try:
        with open(args.file, encoding="utf-8") as f:
            html = f.read()
    except OSError as e:
        print(f"読み込めない: {e}", file=sys.stderr)
        return 2
    errors, info = verify(html, args.repo, args.remote)
    for e in errors:
        print(f"ERROR: {e}")
    for i in info:
        print(i)
    print(f"結果: ERROR {len(errors)} 件")
    return 1 if errors else 0


def main(argv):
    ap = argparse.ArgumentParser(prog="source_links.py", description="設計書のファイル参照を GitHub リンクにするための補助")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("base", help="ヘッダーに貼る <td data-field=\"base\"> を出す")
    b.add_argument("ref")
    b.set_defaults(func=cmd_base)
    v = sub.add_parser("verify", help="data-src がベースに実在するかを確かめる")
    v.add_argument("file")
    v.set_defaults(func=cmd_verify)
    for p in (b, v):
        p.add_argument("--repo", default=".", help="対象のリポジトリ（既定: 今のディレクトリ）")
        p.add_argument("--remote", default="origin")
    args = ap.parse_args(argv[1:])
    try:
        return args.func(args)
    except GitError as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
