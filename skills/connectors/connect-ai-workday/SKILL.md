---
name: connect-ai-workday
description: Use when querying Workday data through CData Connect AI. Covers Workday's multi-connection-type model (REST/WQL/Reports/SOAP), how to identify which type a connection exposes, and routes to a per-connection-type reference for the data model, prompt-column lookups, value tables, change-resource procedures, query patterns, and Workday conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Workday
  family: hcm
---

# CData Connect AI — Workday Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Workday-specific guidance for querying Workday data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the Workday driver. Do not call `getInstructions` for Workday — the guidance it provides is already incorporated here and in the per-connection-type references. Proceed directly to schema discovery (`getSchemas` / `getTables` / `getColumns`) after identifying the Workday connection via `getCatalogs`.

## Workday is a multi-schema type driver

Workday has four **connection types**, each set via the `ConnectionType` connection property in CData. The connection type changes the entire surface area the driver exposes — the schema list, the data model, write support, and the query workflow all differ. **The connection type can't be inferred from the connection name**, so the first move on any Workday connection is to identify its type.

| Connection type | What it exposes | Writes | Schema(s) returned by `getSchemas` |
|---|---|---|---|
| **REST** | Workday REST API. The most common configuration. | Insert / update / limited delete | **Multiple** functional-area schemas (`Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`, `Payroll`, …) — varies by tenant |
| **WQL** | Workday Query Language. Prism (`cds_`) + Core data sources. | Read-only | A single `WQL` schema |
| **Reports** | Reports as a Service (RaaS). Requires `CustomReportURL`. | Read-only | A single `Reports` schema |
| **SOAP** | Workday SOAP API (legacy). | (legacy) | **Multiple** functional-area schemas with underscore-spaced names (`Human_Resources`, `Staffing`, `Payroll`, …) — varies by tenant. |

## Step 1 — Always start with `getSchemas`

Run `getSchemas` on the Workday connection before anything else. The result tells you which connection type you're on:

- Returns **`WQL`** only → WQL connection.
- Returns **`Reports`** only → Reports connection.
- Returns **multiple underscore-spaced schemas** (`Human_Resources`, `Staffing`, `Payroll`, etc.) → SOAP connection. SOAP does **not** expose a single `SOAP` schema; it uses underscore-spaced functional-area names.
- Returns **multiple PascalCase functional-area schemas** (`Common`, `Procurement`, `Staffing`, etc.) → REST connection. REST does **not** expose a single `REST` schema; the exact set of functional schemas varies by tenant and driver version.

## Step 2 — Load the matching connection-type reference

Each connection type has its own reference with the full data model, query workflow, example queries, and conventions. Read the one that matches the connection type identified in Step 1 before writing queries:

- **REST** → [references/rest.md](references/rest.md) — schema partitioning, entity-type categories, prompt columns, value-table GUID lookups, change-resource procedures, per-schema important columns (Common, Procurement, Recruiting, Staffing, HelpCase), query patterns, stored procedures, write operations.
- **WQL** → [references/wql.md](references/wql.md) — Prism vs Core data sources, `UseSplitTables`, prompt columns on Core, column-naming idioms, query patterns.
- **Reports** → [references/reports.md](references/reports.md) — `CustomReportURL` requirement, dotted/spaced column quoting, query pattern.
- **SOAP** → [references/soap.md](references/soap.md) — legacy surface, discovery-first guidance.

The three-part name is always `[Catalog].[Schema].[Table]`:

```sql
-- REST: tables live in functional schemas
SELECT * FROM [WorkdayProd].[Procurement].[Requisitions]
-- Single-schema connection types name the schema after the type
SELECT * FROM [WorkdayWQL].[WQL].[cds_Prism_Test_From_Report]
SELECT * FROM [WorkdayReports].[Reports].[Employee Directory]
```

## Prompt columns & value tables

Many Workday tables and data sources require **prompt columns** before they'll return data — and this applies across connection types: **REST tables and WQL Core data sources** both use them. (WQL Prism `cds_` sources are the exception — they're prompt-free.) Because the mechanics are shared, they're documented here once rather than per-reference.

### Prompt columns

Prompt columns (`_Prompt` suffix) mirror Workday UI export-form fields. They accept Workday-internal GUIDs or, for date/boolean prompts, literal values. Without the required prompts, queries fail or return empty.

- **Inspect with `getColumns` first** to see which `_Prompt` columns exist and which are required, then resolve every required GUID before issuing the main query.
- **Never guess `_Prompt` GUIDs.** They are tenant-specific and not human-readable. Resolve via the matching value table (below).
- **Date and boolean prompts take literals**, not GUIDs (e.g., `FromDate_Prompt` = `'2024-01-01'`, `includeSubordinateOrganizations_Prompt` = `1`). These don't need a value-table lookup.
- **Lookup chains can be 3+ levels deep.** A value table for one prompt may itself require a prompt sourced elsewhere. Plan backward from the target.

REST layers entity-category rules on top of this — which prompts an entity inherits depends on whether it's Base / Child / Owned / Owned child. See [references/rest.md](references/rest.md#prompt-columns-rest-entity-categories).

### Value tables

Value tables provide the GUID lookups for `_Prompt` columns. They end in `Values` and (on REST) live in the same schema as the target table. WQL Core prompts are typically resolved against a value table on a REST connection. All value tables share these columns:

- **Id** — Workday GUID (the prompt value)
- **Descriptor** — human-readable; filter by this to find a row
- **CollectionToken** — non-NULL when there's a deeper level in the hierarchy
- **Collection_Prompt** — input parameter for hierarchical navigation

**Hierarchical navigation:**

1. Initial query returns top-level categories:
   ```sql
   SELECT * FROM [YourConnection].[Staffing].[JobChangesGroupWorkersValues]
   WHERE [EffectiveDate_Prompt] = '2020-01-01'
   ```
2. Drill down using a `CollectionToken` from the previous result:
   ```sql
   SELECT * FROM [YourConnection].[Staffing].[JobChangesGroupWorkersValues]
   WHERE [Collection_Prompt] = 'abcxyz123'
   ```
3. A row with **NULL `CollectionToken`** is a leaf — use its `Id` as the prompt value.

## Cross-cutting Workday conventions

These hold regardless of connection type. Type-specific conventions live in each reference.

- **Identify the connection type first.** It dictates the schema list, data model, and whether writes are possible. Never assume — run `getSchemas`.
- **Prompt columns and value tables** govern most non-trivial queries on REST and WQL Core — see the section above.
- **WQL and Reports are read-only by design** and cannot be made writable. Only REST supports writes (where the Workday API allows it).
- **Quote columns with `[]`.** Workday surfaces dotted and spaced column names across connection types (`[Worker.Descriptor]`, `[employee.id]`), and WQL mixes casing conventions. Always call `getColumns` before referencing specific columns.
- **Discover, don't assume.** Schema lists, table locations, and column names vary by tenant, enabled modules, and driver version. Confirm with `getSchemas` / `getTables` / `getColumns` on the live connection.
