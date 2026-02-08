# cc-plugins

Personal Claude Code plugin marketplace.

## Available Plugins

| Plugin | Description |
|--------|-------------|
| [cc-plan-flow](./plugins/cc-plan-flow/) | Manage plan files through a ToDo → InProgress → Done lifecycle with auto-renaming and directory setup |

## Usage

### Add the marketplace

```bash
/plugin marketplace add <owner>/cc-plugins
```

### Install a plugin

```bash
/plugin install cc-plan-flow
```

### Local development

```bash
claude --plugin-dir ./plugins/cc-plan-flow
```
