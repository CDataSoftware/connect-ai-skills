# Workday WQL Connection Reference

> Connection type: `ConnectionType = WQL`. Workday Query Language. **Read-only.**
>
> Load this reference when the live connection's `getSchemas` returns a single `WQL` schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema

A single `WQL` schema exposes two kinds of data source:

- **Prism data sources** — `cds_` prefix. Served from dedicated Prism infrastructure.
- **Core data sources** — names often ending in `Parms`. Backed by live tenant resources.

```sql
SELECT * FROM [WorkdayWQL].[WQL].[cds_Prism_Test_From_Report]
```

## Query Process

- **Prism sources (`cds_` prefix)** typically expose no `_Prompt` columns — query directly.
- **Core data sources** (names often ending in `Parms`) do expose `_Prompt` columns. Inspect with `getColumns` first and supply each required prompt.

Prefer Prism over Core where available — Prism is served from dedicated infrastructure and doesn't compete for tenant resources. If a Core source has multiple filters and you need any beyond the first, the user must enable `UseSplitTables` on the connection.

## Common Query Patterns

### Prism data source (`UseSplitTables = False`)

```sql
SELECT [employee_ID], [full_Name], [job_Profile_Name],
       [location___Name], [manager_Name], [compa_Ratio], [rating_String]
FROM [YourConnection].[WQL].[cds_Prism_Test_From_Report]
LIMIT 10
```

### Prism joined across split tables

```sql
SELECT t1.[employee_ID], t1.[full_Name], t2.[manager_Name], t2.[compa_Ratio]
FROM [YourConnection].[WQL].[cds_Prism_Test_From_Report_1] t1
INNER JOIN [YourConnection].[WQL].[cds_Prism_Test_From_Report_2] t2
  ON t1.[employee_ID] = t2.[employee_ID]
LIMIT 10
```

### Core data source with required prompts

Core data sources expose `_Prompt` columns just like REST tables do. `absenceCasesByWorkerForOrganizationAndDateRangeParms` requires `organizations_Prompt` (VARCHAR GUID), `startDate_Prompt` / `endDate_Prompt` (DATE), `includeSubordinateOrganizations_Prompt` (BOOLEAN):

```sql
SELECT *
FROM [YourConnection].[WQL].[absenceCasesByWorkerForOrganizationAndDateRangeParms]
WHERE [organizations_Prompt] = 'abc123def4567890...'
  AND [startDate_Prompt] = '2024-01-01'
  AND [endDate_Prompt] = '2024-12-31'
  AND [includeSubordinateOrganizations_Prompt] = 1
LIMIT 20
```

Resolve `organizations_Prompt` via a value table on a REST connection (or via a Workday admin if no value table is exposed in WQL). The prompt-column and value-table mechanics are shared across connection types — see [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables).

## WQL-Specific Conventions

- **Prefer Prism (`cds_`) over Core.** Prism uses dedicated infrastructure; Core shares tenant resources and can degrade Workday for other users on heavy queries.
- **WQL Core sources still use `_Prompt` columns** (often named `*Parms`). Only Prism is prompt-free.
- **WQL exposes only one filter per data source.** For additional filters, enable `UseSplitTables` to fan the source into joinable narrower views.
- **WQL reference fields surface as paired `<entity>.descriptor` and `<entity>.id`** dotted columns — quote with `[]` (e.g., `[employee.id]`).
- **WQL column names mix conventions:** camelCase (`checkDt`), snake_case-with-caps (`hire_Date`), and a triple-underscore (`___`) separator for hyphens/dashes in the original field (`cost_Center___ID`, `location___Name`). Always `getColumns` first.
- **Read-only by design** — WQL cannot be made writable. For writes, use a REST connection.
