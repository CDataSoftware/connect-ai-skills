# CData Connect AI Skills

> [!IMPORTANT]
> This repository is under development. Additional connector-family skills (`connect-ai-crm`, `connect-ai-erp`, `connect-ai-hcm`, `connect-ai-ticketing`, `connect-ai-analytics`, `connect-ai-files`) and connector-specific skills are in development.

## Installation

Install every skill in this repo:

```
npx skills add CDataSoftware/connect-ai-skills
```

Install a specific skill by name (the folder name under [`skills/`](skills/)):

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base
```

Pass `--skill` multiple times to install several skills in one command:

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base --skill connect-ai-crm
```

### Available skills

| Skill | Description |
|---|---|
| [`connect-ai-base`](skills/connect-ai-base/SKILL.md) | **Base skill.** Required connection confirmation, discovery workflow for the generic MCP Server and Toolkits, and common error recovery. Load this first — all other skills compose on top of it. |

Additional connector-family skills (`connect-ai-crm`, `connect-ai-erp`, `connect-ai-hcm`, `connect-ai-ticketing`, `connect-ai-analytics`, `connect-ai-files`) and connector-specific skills will be listed here as they ship.

## Prerequisites

- **CData Connect AI** account with at least one connection configured
- The **Connect AI MCP server** added to your AI integration (see [Connect AI Integrations - AI Tools](https://docs.cloud.cdata.com/en/Integrations#ai-tools))


## Contributing

Each skill lives in its own folder under [`skills/`](skills/) and consists of a single `SKILL.md` file with YAML frontmatter. The folder name is the skill's installable name (e.g. `--skill connect-ai-base` maps to [`skills/connect-ai-base/`](skills/connect-ai-base/)).

To add a new skill:

1. Create a new folder under `skills/` named after the skill (e.g. `skills/connect-ai-crm/`).
2. Add a `SKILL.md` file with the required frontmatter (`name`, `description`, `license`, `metadata`). Use [`skills/connect-ai-base/SKILL.md`](skills/connect-ai-base/SKILL.md) as the reference for frontmatter fields and section conventions.
3. Add a row for the new skill to the **Available skills** table above.

Connector-family skills (e.g. `connect-ai-crm`, `connect-ai-erp`) and connector-specific skills (e.g. `connect-ai-salesforce`, `connect-ai-jira`) follow the same flat layout — there is no plugin manifest or marketplace registration step.

## License

[MIT](LICENSE)
