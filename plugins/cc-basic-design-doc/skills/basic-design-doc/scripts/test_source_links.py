import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import source_links  # noqa: E402

GH = "https://github.com/example/orders"


def run_git(cwd, *args):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_CONFIG_NOSYSTEM="1")
    p = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env=env)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def doc(sha, refs, repo=GH):
    codes = "".join(f"<p><code data-src>{r}</code></p>" for r in refs)
    return f'<table><tr><td data-field="base" data-repo="{repo}" data-sha="{sha}">main {sha[:7]}</td></tr></table>{codes}'


class NormalizeRemoteTest(unittest.TestCase):
    def test_github_forms(self):
        for url in ("git@github.com:example/orders.git", "git@github.com:example/orders", "https://github.com/example/orders.git",
                    "https://github.com/example/orders/", "https://user@github.com/example/orders",
                    "ssh://git@github.com/example/orders.git", "ssh://git@github.com:22/example/orders.git",
                    "git://github.com/example/orders", "https://GitHub.com/example/orders"):
            self.assertEqual(source_links.normalize_remote(url), GH, url)

    def test_not_github(self):
        for url in ("git@gitlab.com:example/orders.git", "https://bitbucket.org/example/orders", "github-work:example/orders.git",
                    "/srv/git/orders.git", "https://github.com/example", "https://github.com/example/orders/extra",
                    "https://ghe.example.com/example/orders", ""):
            self.assertIsNone(source_links.normalize_remote(url), url)


class RepoTest(unittest.TestCase):
    """origin（bare）に main を push 済みの作業リポジトリ。origin の URL は GitHub の形に書き換える。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bare = os.path.join(self.tmp, "origin.git")
        self.work = os.path.join(self.tmp, "work")
        run_git(self.tmp, "init", "-q", "--bare", "-b", "main", self.bare)
        run_git(self.tmp, "init", "-q", "-b", "main", self.work)
        os.makedirs(os.path.join(self.work, "src"))
        os.makedirs(os.path.join(self.work, "docs"))
        with open(os.path.join(self.work, "src", "sync.ts"), "w") as f:
            f.write("a\nb\nc\n")
        with open(os.path.join(self.work, "src", "no-newline.ts"), "w") as f:
            f.write("a\nb")
        with open(os.path.join(self.work, "docs", "設計 メモ.md"), "w") as f:
            f.write("x\ny\n")
        run_git(self.work, "add", "-A")
        run_git(self.work, "commit", "-q", "-m", "init")
        run_git(self.work, "remote", "add", "origin", self.bare)
        run_git(self.work, "push", "-q", "-u", "origin", "main")
        run_git(self.work, "remote", "set-head", "origin", "main")
        self.pushed = run_git(self.work, "rev-parse", "HEAD")
        self.use_github_url()

    def use_github_url(self, url="git@github.com:example/orders.git", remote="origin"):
        run_git(self.work, "remote", "set-url", remote, url)

    def commit_local(self, name="src/new.ts"):
        with open(os.path.join(self.work, name), "w") as f:
            f.write("n\n")
        run_git(self.work, "add", "-A")
        run_git(self.work, "commit", "-q", "-m", "local")
        return run_git(self.work, "rev-parse", "HEAD")

    def cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = source_links.main(["source_links.py", *args])
        return rc, out.getvalue(), err.getvalue()

    def verify(self, sha, refs, **kw):
        return source_links.verify(doc(sha, refs, **kw), self.work, "origin")[0]


class BaseTest(RepoTest):
    def test_pushed_commit_is_linkable(self):
        rc, out, _ = self.cli("base", "main", "--repo", self.work)
        self.assertEqual(rc, 0)
        self.assertIn("リンク: 可", out)
        self.assertIn(f'<td data-field="base" data-repo="{GH}" data-sha="{self.pushed}">main {self.pushed[:7]}</td>', out)
        self.assertNotIn("注意", out)

    def test_unpushed_commit_gives_empty_attrs(self):
        self.commit_local()
        rc, out, _ = self.cli("base", "HEAD", "--repo", self.work)
        self.assertEqual(rc, 0)
        self.assertIn("リンク: 不可", out)
        self.assertIn("push", out)
        self.assertIn('data-repo="" data-sha=""', out)

    def test_commit_only_on_another_remote_is_not_linkable(self):
        """upstream にだけある commit を、origin の URL でリンクにしない"""
        other = os.path.join(self.tmp, "upstream.git")
        run_git(self.tmp, "init", "-q", "--bare", "-b", "main", other)
        self.commit_local()
        run_git(self.work, "remote", "add", "upstream", other)
        run_git(self.work, "push", "-q", "upstream", "main")
        rc, out, _ = self.cli("base", "HEAD", "--repo", self.work)
        self.assertIn("リンク: 不可", out)
        self.assertIn('data-repo="" data-sha=""', out)

    def test_non_github_remote(self):
        self.use_github_url("git@gitlab.com:example/orders.git")
        rc, out, _ = self.cli("base", "main", "--repo", self.work)
        self.assertEqual(rc, 0)
        self.assertIn("リンク: 不可", out)
        self.assertIn("github.com", out)

    def test_no_remote(self):
        run_git(self.work, "remote", "remove", "origin")
        rc, out, _ = self.cli("base", "main", "--repo", self.work)
        self.assertEqual(rc, 0)
        self.assertIn("リンク: 不可", out)

    def test_commit_only_on_feature_branch_warns(self):
        run_git(self.work, "checkout", "-q", "-b", "feat")
        self.commit_local()
        self.use_github_url(self.bare)
        run_git(self.work, "push", "-q", "origin", "feat")
        self.use_github_url()
        rc, out, _ = self.cli("base", "HEAD", "--repo", self.work)
        self.assertIn("リンク: 可", out)
        self.assertIn("注意", out)

    def test_unknown_ref(self):
        rc, _, err = self.cli("base", "no-such-ref", "--repo", self.work)
        self.assertEqual(rc, 2)
        self.assertIn("no-such-ref", err)

    def test_not_a_repository(self):
        rc, _, _ = self.cli("base", "main", "--repo", self.tmp)
        self.assertEqual(rc, 2)


class VerifyTest(RepoTest):
    def test_existing_refs_pass(self):
        refs = ["src/sync.ts", "src/sync.ts:1", "src/sync.ts:2-3", "src/", "docs/設計 メモ.md:2", "src/no-newline.ts:2"]
        self.assertEqual(self.verify(self.pushed, refs), [])

    def test_missing_file(self):
        self.assertTrue(any("ベース" in e and "無い" in e for e in self.verify(self.pushed, ["src/none.ts:1"])))

    def test_file_created_after_base(self):
        self.commit_local("src/new.ts")
        self.assertTrue(any("src/new.ts" in e for e in self.verify(self.pushed, ["src/new.ts"])))

    def test_line_out_of_range(self):
        self.assertTrue(any("3 行" in e for e in self.verify(self.pushed, ["src/sync.ts:4"])))
        self.assertTrue(any("3 行" in e for e in self.verify(self.pushed, ["src/sync.ts:2-9"])))
        self.assertTrue(any("2 行" in e for e in self.verify(self.pushed, ["src/no-newline.ts:3"])))

    def test_directory_needs_slash_and_file_must_not_have_one(self):
        self.assertTrue(any("ディレクトリ" in e for e in self.verify(self.pushed, ["src"])))
        self.assertTrue(any("ファイル" in e for e in self.verify(self.pushed, ["src/sync.ts/"])))

    def test_malformed(self):
        self.assertTrue(any("形にする" in e for e in self.verify(self.pushed, ["../x.ts"])))

    def test_unpushed_sha(self):
        sha = self.commit_local()
        self.assertTrue(any("404" in e for e in self.verify(sha, ["src/sync.ts"])))

    def test_sha_not_in_repository(self):
        errors = self.verify("0123456789abcdef0123456789abcdef01234567", ["src/sync.ts"])
        self.assertEqual(len(errors), 1)
        self.assertIn("fetch", errors[0])

    def test_repo_mismatch(self):
        errors = self.verify(self.pushed, ["src/sync.ts"], repo="https://github.com/other/orders")
        self.assertTrue(any("data-repo" in e for e in errors))

    def test_repo_match_ignores_case(self):
        self.assertEqual(self.verify(self.pushed, ["src/sync.ts"], repo="https://github.com/Example/Orders"), [])

    def test_empty_sha_is_not_an_error(self):
        html = '<table><tr><td data-field="base" data-repo="" data-sha="">なし（新規）</td></tr></table><code data-src>src/x.ts</code>'
        errors, info = source_links.verify(html, self.work, "origin")
        self.assertEqual(errors, [])
        self.assertTrue(any("リンクにならない" in i for i in info))
        self.assertTrue(any("確かめていない" in i for i in info))

    def test_empty_sha_still_checks_existence_by_short_sha(self):
        """未 push などでリンクにしない文書でも、ベース欄の短縮 SHA で実在を確かめる"""
        sha = self.commit_local("src/new.ts")
        td = f'<table><tr><td data-field="base" data-repo="" data-sha="">HEAD {sha[:7]}</td></tr></table>'
        self.assertEqual(source_links.verify(td + "<code data-src>src/new.ts:1</code>", self.work, "origin")[0], [])
        errors, _ = source_links.verify(td + "<code data-src>src/none.ts</code><code data-src>src/new.ts:9</code>", self.work, "origin")
        self.assertEqual(len(errors), 2)

    def test_cli_exit_codes(self):
        ok = os.path.join(self.tmp, "ok.html")
        ng = os.path.join(self.tmp, "ng.html")
        with open(ok, "w", encoding="utf-8") as f:
            f.write(doc(self.pushed, ["src/sync.ts:1"]))
        with open(ng, "w", encoding="utf-8") as f:
            f.write(doc(self.pushed, ["src/none.ts"]))
        script = os.path.join(HERE, "source_links.py")
        r = subprocess.run([sys.executable, "-I", script, "verify", ok, "--repo", self.work], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = subprocess.run([sys.executable, "-I", script, "verify", ng, "--repo", self.work], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("ERROR", r.stdout)
        r = subprocess.run([sys.executable, "-I", script, "verify", os.path.join(self.tmp, "none.html")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
