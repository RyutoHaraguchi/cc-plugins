---
name: html
description: Use when the user invokes /html or asks for a local HTML artifact, human-readable HTML view, visual explainer, comparison board, review page, learning brief, or decision document from files, links, GitHub issues, PRs, comments, conversation context, or agent output.
---

# HTML Understanding Artifact

## Purpose

`/html` creates a local HTML artifact that reduces human cognitive load. It is not a Markdown-to-HTML converter. It restructures the current context into an operational brief for understanding, review, decision-making, learning, or sharing.

The goal is: **a busy reader understands the situation faster from the HTML than from the original source text.**

## When To Use

Use this skill when the user explicitly asks with `/html ...`, asks for an HTML artifact, or asks to turn files, links, GitHub issues, PRs, comments, code context, research, plans, or agent output into a human-readable HTML view.

Do not use this automatically for every task. Normal agent work, scratch reasoning, implementation logs, and short answers should remain in the existing workflow unless the user asks for HTML.

## Output Contract

Create a local `.html` file and return its absolute path. Do not paste the full HTML into chat unless the user explicitly asks for inline code.

Default path:

```text
<project-root>/docs/html/YYYY-MM-DD-HHMM-descriptive-slug.html
```

Use the user's current project root when clear. Create `docs/html/` if needed. Use a short ASCII kebab-case slug derived from the target and purpose. Keep the visible HTML title in the user's language.

## Core Principle: Decompose by Case

This is the most important rule. Most failed artifacts violate it.

- **Do not pack everything into one giant diagram.** Break the topic into **cases, options, branches, lifecycles, or scenarios**, and draw a **separate small diagram per case**.
- Each diagram answers exactly one question (e.g. "what happens on the first webhook?", "what happens when the node dies?", "what does the rollout look like in canary mode?").
- The reader builds understanding by stacking small, focused diagrams — not by parsing one dense mega-diagram.
- When you find yourself writing prose like "in case A this happens, but in case B that happens...", **stop and draw two diagrams instead.**

## Context Gathering

Before generating the HTML, read enough source context to make the artifact useful.

- For files: read the provided file and nearby referenced files when needed.
- For GitHub issues, PRs, comments, or reviews: inspect the body, comments, review threads, diffs, and status when available.
- For links: fetch the linked content when tools allow it; cite the source URL in the artifact.
- For conversation context or agent output: summarize the relevant state without inventing missing facts.

If gathering full context would become a large investigation, gather the most relevant context, then include a visible "Not inspected / needs follow-up" section in the HTML.

For broad topics such as "OAuth2について教えて" or "this architectureを説明して", do not default to a shallow introduction. Create a practical working-level brief that helps the user think, decide, or continue implementation. Prefer structure, tradeoffs, gotchas, examples, checklists, and decision tables over generic definitions.

## Visual Stack (Default ON)

Mermaid is **always loaded** unless there is a strong reason not to. Additional CDN JS libraries are loaded when they materially improve a specific diagram.

### Mermaid (always)

Place this in `<head>`:

```html
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "default", sequence: { showSequenceNumbers: true } });
</script>
```

Each diagram goes in `<pre class="mermaid">...</pre>`.

### Optional CDN JS libraries (add when they help)

| Library | Best for | CDN |
|---|---|---|
| **Cytoscape.js** | topology, dependency graph, force layout | `https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js` |
| **ECharts** | sankey, heatmap, treemap, radar, large interactive charts | `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js` |
| **Chart.js** | simple line/bar/pie/radar charts | `https://cdn.jsdelivr.net/npm/chart.js` |
| **vis-timeline** | interactive timelines (incidents, rollouts) | `https://cdn.jsdelivr.net/npm/vis-timeline@7/standalone/umd/vis-timeline-graph2d.min.js` |
| **Frappe Gantt** | gantt chart for roadmaps | `https://cdn.jsdelivr.net/npm/frappe-gantt@0.6.1/dist/frappe-gantt.umd.js` |
| **highlight.js** | code syntax highlighting | `https://cdn.jsdelivr.net/npm/highlight.js@11/lib/core.min.js` (+ language packs) |
| **Prism.js** | code syntax highlighting (alt) | `https://cdn.jsdelivr.net/npm/prismjs@1/prism.min.js` |
| **diff2html** | render git diff as HTML | `https://cdn.jsdelivr.net/npm/diff2html@3/bundles/js/diff2html.min.js` |
| **KaTeX** | math formulas | `https://cdn.jsdelivr.net/npm/katex@0/dist/katex.min.js` |
| **dagre-d3** | DAG layouts beyond mermaid's defaults | `https://cdn.jsdelivr.net/npm/dagre-d3@0.6/dist/dagre-d3.min.js` |

Plain SVG/CSS is also fully acceptable for responsibility maps, layered architectures, or annotated diagrams.

**Selection principle:** Pick the tool that most directly renders the information's *structure*. Mix libraries freely on one page when each makes a specific diagram clearer. Pin a major version in the CDN URL.

**Fallback:** Even when JS is used, the page must remain understandable if a script fails. Always back diagrams with a short text summary or table nearby.

## Common Rendering Pitfalls

These are landmines that look fine in code but break the page in the browser. Always apply these patterns.

### Chart.js — wrap canvas in a sized div

Chart.js with `responsive: true` reads the **parent element's height**. If you set height directly on `<canvas>`, layout calculation can loop and the canvas grows unboundedly, which causes "everything below goes blank when you scroll". Always wrap:

```html
<div class="chart-wrap"><canvas id="myChart"></canvas></div>
```

```css
.chart-wrap { position: relative; height: 280px; max-height: 320px; margin: 12px 0; }
.chart-wrap canvas { display: block; width: 100% !important; height: 100% !important; }
```

Initialize on `window load` (not `DOMContentLoaded`) so deferred CDN scripts are ready:

```html
<script>
window.addEventListener("load", () => {
  if (typeof Chart === "undefined") return;
  new Chart(document.getElementById("myChart"), { /* ... */ });
});
</script>
```

### Mermaid — disable startOnLoad, call run() explicitly

When the page has many Mermaid diagrams (5+), `startOnLoad: true` can race with DOM readiness and skip some. Always do this instead:

```html
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: "default", sequence: { showSequenceNumbers: true } });
  window.addEventListener("DOMContentLoaded", () => { mermaid.run(); });
</script>
```

Also allow horizontal scroll on diagrams so wide ones don't break layout:

```css
pre.mermaid { overflow-x: auto; }
```

### KaTeX auto-render — exclude pre/code

KaTeX's `renderMathInElement` walks the whole body and treats `$...$` as math. If a Mermaid block or a code sample happens to contain `$` (or even matched pairs of math-looking tokens), KaTeX corrupts it. Always exclude:

```js
renderMathInElement(document.body, {
  delimiters: [
    {left: '$$', right: '$$', display: true},
    {left: '$',  right: '$',  display: false}
  ],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
});
```

### Generic rule

Whenever using a CDN library that manipulates the DOM (Chart.js, ECharts, vis-timeline, Cytoscape, KaTeX, Prism, dagre-d3):
- **Give it a sized parent** with explicit `height` (and sometimes `width`); never set those directly on the canvas/svg the lib generates.
- **Initialize on `window load`** (not `DOMContentLoaded`) when relying on deferred CDN scripts.
- **Confine the library's effect** — limit its scan scope via `ignoredTags` / explicit element targeting.

## Visual Form Selection

Choose the form by what you are trying to convey. **A good artifact uses at least 3 distinct visual forms.**

### Table A — Mermaid diagram types

| Diagram | Conveys | Typical use |
|---|---|---|
| `sequenceDiagram` | time-ordered interaction | API call path, controller reconcile, request lifecycle |
| `flowchart` (`graph`) | branching, decisions, pipelines | decision tree, CI/CD pipeline |
| `stateDiagram-v2` | states and transitions | resource lifecycle, rollout phases |
| `classDiagram` | structure, responsibility, inheritance | component responsibilities |
| `erDiagram` | entities and relationships | data model, resource ownership |
| `gitGraph` | branching strategy | GitOps flow, canary release |
| `journey` | experience flow with sentiment | developer/operator experience |
| `timeline` | chronology | incident timeline, feature evolution |
| `mindmap` | concept decomposition | topic overview map |
| `quadrantChart` | 2-axis 4-quadrant | priority matrix, build-vs-buy |
| `C4Context` / `C4Container` | C4 model | system context, container boundaries |
| `architecture-beta` | cloud/infrastructure layout | VPC/subnet/node placement |
| `block-beta` | layered responsibility blocks | abstraction layers |
| `requirementDiagram` | requirements and dependencies | NFR vs design choices |
| `sankey-beta` | flow quantity | request distribution, cost breakdown |
| `xychart-beta` | 2D time series | latency, cost, scaling |
| `gantt` | schedule | roadmap, migration plan |
| `pie` | proportion | composition |

### Table B — HTML/CSS/SVG-native visuals

| Form | Conveys |
|---|---|
| **Responsibility map (grid table)** | who owns what (rows × columns of intersections) |
| **Layered box stack** | abstraction or trust layers |
| **Impact map (radial)** | center → blast radius |
| **Risk matrix** | severity × likelihood |
| **Before/After pair** | migration or refactor outcome |
| **Annotated snippet** | code/YAML with callout overlays |
| **Decision tree (horizontal)** | guided selection |
| **Comparison matrix with severity colors** | multi-option evaluation |

### Table C — When to reach for the JS libraries

| Want to show... | Use |
|---|---|
| Network of services / dependency graph | Cytoscape.js or dagre-d3 |
| Flow with quantities | ECharts sankey |
| Heatmap of usage / health | ECharts heatmap |
| Composition / hierarchy by size | ECharts treemap |
| Simple metric over time | Chart.js |
| Roadmap with bars | Frappe Gantt |
| Incident reconstruction | vis-timeline |
| YAML/code highlighting | highlight.js or Prism |
| Before/after manifest | diff2html |
| Math formula (HPA, SLO budget, etc.) | KaTeX |

## Mermaid Quality Tips

Mermaid's default `dagre` renderer often produces **overlapping edges and crossed lines** on non-trivial graphs. The fixes below are all zero-cost (apply during generation, not as a post-process). Use them in this order.

### 1. Cut nodes first — the cheapest fix

If a single Mermaid diagram has **more than ~8 nodes**, the layout is almost certainly going to look bad. **Split it into two diagrams by case** (this is the Core Principle restated). Most "lines overlap" complaints are really "too many nodes in one diagram".

### 2. Use `subgraph` to group related nodes

Grouping forces the layout engine to keep related nodes close, which dramatically reduces crossings.

```text
flowchart LR
  subgraph CP[Control Plane]
    API[apiserver]
    Etcd[etcd]
    Sched[scheduler]
  end
  subgraph DP[Data Plane]
    Kube[kubelet]
    Pod
  end
  API --> Etcd
  API --> Sched
  API --> Kube
  Kube --> Pod
```

### 3. Try both `direction` orientations

`flowchart TB` vs `flowchart LR` can completely change the result. For graphs that are wider than they are tall (many actors, few layers), prefer `LR`. For pipelines and decision trees, prefer `TB`. **Spend 5 seconds switching and pick the one with fewer crossings.**

### 4. Switch to the `elk` renderer for complex flowcharts

Mermaid v10 ships an experimental **ELK** layout engine that produces noticeably better edge routing than dagre on dense graphs. Put this directive on the first line of the diagram:

```text
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart LR
  ...
```

Only applies to `flowchart`. Use it whenever a diagram has 10+ nodes or many cross-connections. Fall back to dagre if rendering looks broken.

### 5. Spacing knobs (last resort)

If lines still cross, tune spacing:

```text
%%{init: {"flowchart": {"nodeSpacing": 60, "rankSpacing": 80, "curve": "basis"}} }%%
```

For `sequenceDiagram`:

```text
%%{init: {"sequence": {"actorMargin": 40, "boxMargin": 10}} }%%
```

### 6. Sequence diagrams: cap participants

`sequenceDiagram` with **more than 6 participants** becomes a wall of overlapping arrows. Either split into multiple sequences (per phase / per case), or wrap related participants in `box` blocks (v10+).

### 7. When to give up on Mermaid

If after the above the diagram is still unreadable, **switch the visual to a different library**:

- **Dense topology / dependency graph** → Cytoscape.js (force-directed layouts) or dagre-d3 (manual control).
- **Multi-attribute relationships** → ECharts graph series.
- **Hierarchy of sizes** → ECharts treemap.
- **Static system architecture** → hand-rolled SVG or CSS-grid responsibility map.

This is not a fallback failure — it is the right tool for a different kind of picture. Mermaid is best at *linear* flows (sequence, decision tree, lifecycle). Branching meshes belong elsewhere.

## Required Style (Operational Brief)

Calm, dense, work-focused. Avoid decorative landing-page aesthetics. Avoid styled-Markdown dumps.

### Actors declared upfront

If the artifact uses any `sequenceDiagram`, list the **participants/actors** in a small box near the top of the page (e.g. "Seller / Shopify / CLT / DB / TTS"). The names you list must match the `participant` names in your diagrams.

### Five callout types (required CSS)

Embed this CSS (or equivalent) so severity and intent are visually obvious:

```css
.ok    { color: #1f7a1f; font-weight: bold; }
.ng    { color: #c0392b; font-weight: bold; }
.warn  { color: #d68910; font-weight: bold; }
.insight  { background: #fff8e1; border-left: 5px solid #f1c40f; padding: 12px 16px; margin: 16px 0; }
.decision { background: #e8f5e9; border-left: 5px solid #2e7d32; padding: 12px 16px; margin: 16px 0; }
.box { border: 1px solid #d0d0d0; border-radius: 6px; padding: 16px; margin: 12px 0; background: #fafafa; }
```

- `.ok` / `.ng` / `.warn` color **inline text and table cells** (e.g. status, severity).
- `.insight` boxes highlight what was discovered, why it matters.
- `.decision` boxes hold the final recommendation.
- `.box` holds the 30-second summary up top.

### Sequence rect highlights

Inside `sequenceDiagram`, wrap critical regions to make outcomes obvious:

```text
rect rgb(255,230,230)
Note over A,B: → infinite loop / failure
end

rect rgb(220,250,220)
Note over A,B: → recovers / no API calls
end
```

### Layout basics

- Responsive (desktop and mobile).
- All CSS embedded.
- Max width around 1000–1100px is comfortable for dense briefs.
- Use the `lang` attribute matching the user's content language.

## Required Structure

Adapt freely, but the default order is:

1. **Header**: title, source, generated date, purpose.
2. **30-second box** (`.box`): 2–4 lines covering *target / actors / core conclusion or core question*. Replaces the old "executive summary" — it must be readable in one glance.
3. **Current state**: facts, status, scope, constraints.
4. **Visual explanation by case**: **multiple** small diagrams, each labeled with the case it explains. Use at least 3 different visual forms across the page.
5. **Evidence**: source excerpts, code snippets, diffs, comments — annotate inside Notes/captions with actual computed values (e.g. `(undefined ?? []).map(...) = []`).
6. **Comparison matrix**: when 2+ options exist, a horizontal table with severity-colored cells. Required for `review` and `decision` patterns.
7. **Decision points**: what needs human judgment, ideally in a `.decision` box if a recommendation exists.
8. **Risks & unknowns**: what could be wrong, incomplete, or ambiguous.
9. **Next actions / change list**: concrete follow-up steps; for design docs include the specific sections to amend.

## Pattern Hints

If the user specifies a pattern, follow it. Otherwise infer from the target.

| Pattern | Required visuals | Required tables |
|---|---|---|
| `concept` | 1+ mindmap or block-beta; case-split sequence/flowchart; layered box | gotchas table |
| `design` | C4 or architecture-beta; component responsibility (classDiagram or grid); erDiagram for data; sequence for key flow | responsibility map |
| `review` | changed-file map; impact map; per-finding sequence for non-trivial cases; annotated diff | severity-colored finding table |
| `decision` | one diagram per option; same "scenario" run through each option | comparison matrix with severity colors + recommendation box |
| `learning` | mindmap overview; multiple case-by-case sequences; state diagram for lifecycle; comparison or risk matrix; gantt/timeline if a roadmap is implied | quick-reference table |
| `status` | timeline; gantt; kanban or block grid for in-flight work | blockers table |

When patterns are ambiguous, choose the one that best supports the user's likely next decision. Do not stop to ask unless the ambiguity would materially change the artifact.

## Anti-patterns (do not produce these)

- **Styled Markdown dump** — paragraphs and bullet lists with light CSS and no diagrams.
- **Single mega-diagram** — one giant flowchart that tries to cover every case.
- **Zero visuals** — only tables of text.
- **Undeclared actors** — `sequenceDiagram` participants that are not introduced anywhere in the prose.
- **Colorless comparison table** — multi-option comparison with no severity coloring; the reader has to re-read every cell.
- **Bullet-only decision points** — "decisions" rendered as a plain `<ul>` with no structure, severity, or recommendation.
- **Prose-only evidence** — quotes without annotation, without showing the computed/observed values that drove the conclusion.
- **Decorative-only diagrams** — a chart that adds no information beyond the prose next to it.

## Self-check (run mentally before finishing)

- [ ] Are there **at least 2 Mermaid diagrams**, and at least 3 distinct visual forms total?
- [ ] Is the topic **decomposed by case**, with one focused diagram per case?
- [ ] Is there a **30-second box** at the top with target / actors / core point?
- [ ] If `sequenceDiagram` is used, are the **participants declared upfront** in the prose?
- [ ] Are the **5 callout styles** (`.ok` / `.ng` / `.warn` / `.insight` / `.decision`) all used where appropriate, not just one or two?
- [ ] If comparing options, is there a **severity-colored comparison matrix**?
- [ ] Do **sequence Notes show actual values** (`x = ...`, `set = Set()`, etc.) rather than just narrating?
- [ ] Could a busy reader **understand faster from this page** than from the source text?
- [ ] Source links, file paths, issue/PR numbers preserved?
- [ ] Renders cleanly on mobile and desktop, no overflow?
- [ ] **Scroll test passes**: scrolling top-to-bottom never produces a blank lower half (most often caused by an unwrapped Chart.js canvas — see *Common Rendering Pitfalls*).
- [ ] All CDN libraries follow their pitfall patterns (Chart.js wrapped, Mermaid `mermaid.run()`, KaTeX `ignoredTags`)?
- [ ] **No Mermaid diagram has >8 nodes or visibly overlapping edges?** If yes, apply the *Mermaid Quality Tips* (split / subgraph / direction / elk renderer) or move to another library.

If any check fails, fix it before saving.

## Final Response

After creating the file, respond briefly:

```text
HTML artifact created: <absolute path>
Summary: <one sentence>
```

Mention any important context that could not be inspected.
