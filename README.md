# CData Connect AI Skills for Claude

> [!IMPORTANT]
> This repo is under development. Additional connector-family skills (`cdata-crm`, `cdata-erp`, `cdata-hcm`, `cdata-ticketing`, `cdata-analytics`) and connector-specific skills are in development.

A plugin for **Claude Code** and **Claude Cowork** containing Skills that guide Claude through the correct discovery workflow, query construction patterns, and error-recovery techniques when working with [CData Connect AI](https://www.cdata.com/ai/).

## Skills in this plugin

| Skill | Trigger | Description |
|---|---|---|
| `cdata-base` | Auto / `/cdata-base:base` | **Base skill.** Required discovery workflow (`getInstructions` → schema → query), common error patterns. Load this first — all other skills compose on top of it. |


## Prerequisites

- **CData Connect AI** account with at least one connection configured
- The **Connect AI MCP server** added to your Claude environment (see [Connect AI MCP setup](https://docs.cloud.cdata.com/en/Clients/Claude-Client))

## Installation

### Claude Cowork

1. Select Customize
2. Go to Browse plugins → Personal → +
3. Select Add marketplace from GitHub
4. Enter: CDataSoftware/connect-ai-skills

### Claude Code (CLI)

```
# Step 1: Add the marketplace
/plugin marketplace add CDataSoftware/connect-ai-skills

# Step 2: Install individual plugins
/plugin install cdata-base@connect-ai-skills
```

Skills are available immediately in every new session. To update the plugin later:

```
/plugin marketplace update cdata-base@connect-ai-skills
```

To uninstall the plugin:

```
/plugin uninstall cdata-base@connect-ai-skills
```

## Usage

Skills activate automatically when Claude detects a relevant question. You can also invoke them explicitly:

```
/cdata-base:base
```

## Available Plugins
1. **cdata-base** - Enforces the required Connect AI MCP discovery workflow and covers common query patterns and error recovery for any connector.

## Contributing

Each plugin in this repo lives in its own top-level folder containing a `plugin.json` and a `skills/` directory. Connector-family plugins (e.g. `cdata-crm`, `cdata-ticketing`, `cdata-erp`) and connector-specific plugins (e.g. `cdata-salesforce`, `cdata-jira`) follow the same structure as the base plugin:

Each new plugin must also be registered in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) so it can be installed via `/plugin install <plugin-name>@connect-ai-skills`.

See [`cdata-base/plugin.json`](cdata-base/plugin.json) and [`cdata-base/skills/base/SKILL.md`](cdata-base/skills/base/SKILL.md) as references for `plugin.json` fields and SKILL frontmatter / section conventions.

## License

[MIT](LICENSE)
