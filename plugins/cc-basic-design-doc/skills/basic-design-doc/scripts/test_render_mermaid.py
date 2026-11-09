import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import check  # noqa: E402
import render_mermaid  # noqa: E402

SRC = 'flowchart LR\n  A["x < y"] --> B\n'
DOC = (
    '<section class="panel" id="process">\n'
    '<figure class="fig" data-fig="3-1">\n'
    f'  <script type="text/x-mermaid">\n{SRC}  </script>\n'
    '  <div class="mm"></div>\n'
    '  <figcaption class="cap">図 3-1</figcaption>\n'
    '</figure>\n'
    '</section>\n'
)


class FakeRenderer:
    def __init__(self):
        self.calls = []

    def __call__(self, source, svg_id, theme):
        self.calls.append((source, svg_id, theme))
        return f'<?xml version="1.0"?>\n<svg id="{svg_id}"><g id="C"></g><marker id="{svg_id}_arrow"></marker><path marker-end="url(#{svg_id}_arrow)"/></svg>'


class RenderTest(unittest.TestCase):
    def test_fills_slot_with_light_and_dark(self):
        r = FakeRenderer()
        out, n = render_mermaid.render_html(DOC, r)
        self.assertEqual(n, 1)
        self.assertEqual([c[2] for c in r.calls], ["default", "dark"])
        self.assertIn('class="mm-light"', out)
        self.assertIn('class="mm-dark"', out)
        self.assertIn('id="mm-3-1-l"', out)
        self.assertIn('id="mm-3-1-d"', out)
        self.assertNotIn("<?xml", out)
        self.assertIn(f'data-src-hash="{check.src_hash(SRC.strip())}"', out)

    def test_source_is_unescaped_before_rendering(self):
        r = FakeRenderer()
        render_mermaid.render_html(DOC.replace("x < y", "x &lt; y"), r)
        self.assertIn("x < y", r.calls[0][0])

    def test_unreferenced_plain_ids_are_prefixed(self):
        out, _ = render_mermaid.render_html(DOC, FakeRenderer())
        self.assertNotIn('id="C"', out)
        self.assertIn('id="mm-3-1-l--C"', out)
        self.assertIn('id="mm-3-1-l_arrow"', out)

    def test_idempotent(self):
        out, _ = render_mermaid.render_html(DOC, FakeRenderer())
        r2 = FakeRenderer()
        out2, n = render_mermaid.render_html(out, r2)
        self.assertEqual(n, 0)
        self.assertEqual(r2.calls, [])
        self.assertEqual(out, out2)

    def test_rerenders_when_source_changes(self):
        out, _ = render_mermaid.render_html(DOC, FakeRenderer())
        changed = out.replace('A["x < y"] --> B', 'A["x < y"] --> C')
        r2 = FakeRenderer()
        out2, n = render_mermaid.render_html(changed, r2)
        self.assertEqual(n, 1)
        self.assertEqual(out2.count('class="mm-light"'), 1)

    def test_force(self):
        out, _ = render_mermaid.render_html(DOC, FakeRenderer())
        _, n = render_mermaid.render_html(out, FakeRenderer(), force=True)
        self.assertEqual(n, 1)

    def test_figures_without_data_fig_get_index_ids(self):
        out, _ = render_mermaid.render_html(DOC.replace(' data-fig="3-1"', ""), FakeRenderer())
        self.assertIn('id="mm-1-l"', out)

    def test_render_error_names_the_figure(self):
        def broken(source, svg_id, theme):
            raise render_mermaid.RenderError("Parse error on line 2")
        with self.assertRaises(render_mermaid.RenderError) as cm:
            render_mermaid.render_html(DOC, broken)
        self.assertIn("3-1", str(cm.exception))

    def test_rendered_doc_passes_figure_checks(self):
        out, _ = render_mermaid.render_html(DOC, FakeRenderer())
        self.assertEqual(check.figure_errors(out), [])
        self.assertTrue(check.figure_errors(DOC))


if __name__ == "__main__":
    unittest.main()
