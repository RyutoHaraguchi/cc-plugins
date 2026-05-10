---
name: html
description: Use when the user invokes /html or asks for a local HTML artifact, human-readable HTML view, visual explainer, comparison board, review page, learning brief, or decision document from files, links, GitHub issues, PRs, comments, conversation context, or agent output.
---

# HTML Understanding Artifact

## Purpose

`/html` creates a local HTML artifact that reduces human cognitive load. It is not a Markdown-to-HTML converter. It restructures the current context into an operational brief for understanding, review, decision-making, learning, or sharing.

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

## Context Gathering

Before generating the HTML, read enough source context to make the artifact useful.

- For files: read the provided file and nearby referenced files when needed.
- For GitHub issues, PRs, comments, or reviews: inspect the body, comments, review threads, diffs, and status when available.
- For links: fetch the linked content when tools allow it; cite the source URL in the artifact.
- For conversation context or agent output: summarize the relevant state without inventing missing facts.

If gathering full context would become a large investigation, gather the most relevant context, then include a visible "Not inspected / needs follow-up" section in the HTML.

For broad topics such as "OAuth2について教えて" or "this architectureを説明して", do not default to a shallow introduction. Create a practical working-level brief that helps the user think, decide, or continue implementation. Prefer structure, tradeoffs, gotchas, examples, checklists, and decision tables over generic definitions.

## Standard Style

Use an operational brief style:

- Dense but readable.
- Calm work-focused UI.
- Prioritize scanability, hierarchy, evidence, and decision points.
- Avoid decorative landing-page aesthetics.
- Avoid turning long prose into decorated prose.
- Prefer structured blocks, compact tables, diagrams, callouts, timelines, and annotated snippets.
- Make it responsive and readable on mobile and desktop.
- Keep CSS embedded in the HTML file.
- JavaScript is allowed when it improves understanding or usability, such as tabs, filters, toggles, copy buttons, interactive diagrams, Mermaid rendering, or lightweight controls.
- Network access can be assumed for browser viewing. CDN scripts are acceptable when they materially improve the artifact, but the page should still contain enough plain HTML content to remain understandable if a script fails.

## Required Structure

Adapt the structure to the input, but start from this default layout:

1. Header: title, source, generated date, purpose.
2. Executive summary: what the human should understand in 30 seconds.
3. Current state: important facts, status, scope, and constraints.
4. Visual explanation: diagram, table, map, timeline, or flow where it reduces cognitive load.
5. Evidence: source excerpts, code snippets, diffs, comments, or links, with concise annotations.
6. Decision points: what needs human judgment.
7. Risks and unknowns: what could be wrong, incomplete, or ambiguous.
8. Next actions: concrete follow-up steps.

## Visual Rules

Use visuals whenever relationships, flow, hierarchy, comparison, state, impact, or causality matter.

Choose the visual form by purpose:

- System behavior: flow diagram, sequence diagram, or state transition map.
- Architecture or design: component map, responsibility map, or dependency graph.
- Multiple options: comparison matrix with tradeoffs and recommendation.
- PR or code review: changed-file map, impact map, annotated diff snippets, and severity table.
- Issue or comments: timeline, stakeholder map, decision log, and open-question list.
- Learning or research: concept map, timeline, layered explanation, and gotchas.

Prefer readable HTML/CSS/SVG diagrams for stable visuals. Use Mermaid or JavaScript-rendered diagrams when they make complex flows, sequences, dependency graphs, or state machines easier to author and maintain. Keep diagrams purposeful; do not add visuals that merely decorate.

## Handling Patterns

If the user specifies a pattern, follow it. If no pattern is specified, infer one from the target:

- `concept`: explain a difficult idea or mechanism.
- `design`: explain architecture, responsibilities, and tradeoffs.
- `review`: explain a PR, diff, issue, or code review context.
- `decision`: compare options and surface a recommendation.
- `learning`: create a study-friendly artifact for later recall.
- `status`: summarize current work, progress, blockers, and next actions.

When patterns are ambiguous, choose the one that best supports the user's likely next decision. Do not stop to ask unless the ambiguity would materially change the artifact.

## Quality Bar

The artifact should help a busy human understand faster than reading the original text.

Before finishing, check:

- The page is not just a styled Markdown dump.
- The key idea is visible without scrolling much.
- Diagrams or tables carry real explanatory weight.
- Important uncertainty is explicit.
- Source links, file paths, issue numbers, or PR numbers are preserved.
- Text fits containers at desktop and mobile widths.
- The final chat response includes the created file path and a one-sentence summary of what it covers.

## Final Response

After creating the file, respond briefly:

```text
HTML artifact created: <absolute path>
Summary: <one sentence>
```

Mention any important context that could not be inspected.
