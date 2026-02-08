# cc-plan-flow

A Claude Code plugin that manages plan files through a **ToDo → InProgress → Done** lifecycle.

## Features

- **Auto directory creation** — On session start, automatically creates `.claude/plans/{ToDo,InProgress,Done}/` directories via a SessionStart hook.
- **Auto rename of plan files** — After exiting plan mode, renames plan files in `ToDo/` using the `plan-name` field from YAML frontmatter (PostToolUse hook on ExitPlanMode).
- **Lifecycle rules skill** — A model-invoked skill that Claude automatically applies when working with plans, enforcing the ToDo → InProgress → Done flow.
- **Setup verification** — Run `/cc-plan-flow:setup` to verify your project is correctly configured for plan management.

## Installation

### Via marketplace

```bash
# Add the marketplace
/plugin marketplace add <owner>/cc-plugins

# Install the plugin
/plugin install cc-plan-flow
```

### Local testing

```bash
claude --plugin-dir ./plugins/cc-plan-flow
```

## Setup

The only manual step required is to configure the plans directory in your project settings.

Add the following to `.claude/settings.json`:

```json
{
  "plansDirectory": "./.claude/plans/ToDo"
}
```

Alternatively, run `/cc-plan-flow:setup` for guided setup that verifies your configuration.

## Workflow

1. **Enter plan mode** — Start a new plan in Claude Code's plan mode.
2. **Write your plan** — Include a `plan-name` field in the YAML frontmatter:
   ```markdown
   ---
   plan-name: 2025-01-15_add-user-dashboard
   ---
   # Plan: Add User Dashboard
   ...
   ```
3. **Exit plan mode** — The plan is auto-saved to `ToDo/` and automatically renamed based on the `plan-name` value.
4. **Implement** — When you start working on the plan, it moves from `ToDo/` to `InProgress/`.
5. **Complete** — After implementation is verified, the plan moves from `InProgress/` to `Done/`.

## Optional: Always-on rules

For projects where you always want plan lifecycle rules active, create a `.claude/rules/plan-lifecycle.md` file that references the lifecycle skill. This ensures the rules are applied even without the plugin being explicitly invoked.
