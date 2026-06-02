# CData Connect AI Skills

> [!IMPORTANT]
> This repository is under development. Additional connector-family skills (`connect-ai-crm`, `connect-ai-erp`, `connect-ai-hcm`, `connect-ai-ticketing`, `connect-ai-analytics`, `connect-ai-files`) and connector-specific skills are in development.

## Installation

> [!NOTE]
> `connect-ai-base` must be enabled alongside any other skill in this repo — all connector-family and connector-specific skills build on top of it. Always include `--skill connect-ai-base` when installing other skills individually.

Install every skill in this repo:

```
npx skills add CDataSoftware/connect-ai-skills
```

Install a specific skill by name (the folder name under [`skills/`](skills/)). Pair it with `connect-ai-base`:

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base --skill connect-ai-crm
```

Pass `--skill` multiple times to install several skills in one command:

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base --skill connect-ai-crm --skill connect-ai-salesforce
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

Each skill lives in its own folder under [`skills/`](skills/) with a `SKILL.md` file (YAML frontmatter plus the skill body) at its root. The folder name is the skill's installable name (e.g. `--skill connect-ai-base` maps to [`skills/connect-ai-base/`](skills/connect-ai-base/)).

A skill may optionally add a `references/` subdirectory for supporting files that `SKILL.md` links to and loads on demand. This keeps `SKILL.md` itself high-level while deeper material lives alongside it — for example, multi-schema Connectors will contain references for each supported schema.

To add a new skill:

1. Create a new folder under `skills/` named after the skill (e.g. `skills/connect-ai-crm/`).
2. Add a `SKILL.md` file with the required frontmatter (`name`, `description`, `license`, `metadata`). Use [`skills/connect-ai-base/SKILL.md`](skills/connect-ai-base/SKILL.md) as the reference for frontmatter fields and section conventions.
3. Optionally add a `references/` subdirectory for supporting files the skill loads on demand, and link to them from `SKILL.md`.
4. Add a row for the new skill to the **Available skills** table above.

## License

[MIT](LICENSE)
