---
name: connect-ai-base
description: Use when the user has CData Connect AI MCP available and is asking business questions that require querying live enterprise data (CRM, HCM, ERP, ticketing, analytics, databases). Enforces the required discovery workflow (getInstructions before any schema/table/column call), covers query construction patterns, error recovery. Load connector-family (cdata-crm, cdata-hcm, cdata-erp) or connector-specific (cdata-salesforce, cdata-workday, etc.) skills on top for deeper patterns.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
---

# CData Connect AI — Base Skill

This skill governs how to use the CData Connect AI MCP server to answer business questions against live enterprise data. It encodes the discovery workflow the MCP requires, plus the error-recovery patterns that resolve the most common failure modes.

## When to use this skill

Load this skill when any of the following hold:

- The user's question asks for live data from an enterprise system (Salesforce, Workday, NetSuite, HubSpot, SQL Server, Snowflake, Zendesk, etc.)
- The user asks to retrieve, look up, or explore data from a connected system, even without naming a specific platform (e.g. "show me my accounts," "what data do I have," "pull up recent orders" and phrases like "pull from / check / query / look up in [system]")
- The user names a connector or data source directly
- The user asks a business-domain question ("top customers", "open tickets", "headcount by dept", "pipeline by stage") and at least one Connect AI connection is available
- The conversation already involves Connect AI tool calls and the user is iterating

## When NOT to use

- The user uploaded a file (CSV, Excel, JSON) and wants analysis of that file — use the data-analysis skill instead
- The user wants to configure connections, manage OAuth, or administer Connect AI — direct them to the CData admin UI
- The user is asking about Connect AI's architecture, pricing, or strategy — this is a product conversation, not a query task

## Step 0 — Confirm tool availability

Call tool_search to verify Connect AI tools exist. MCP server references in system context or artifact configurations do NOT count as confirmation. If tool_search finds nothing, stop — the server is not connected.

If the server is not connected:
- **Do not** attempt workarounds such as building artifacts, fetching the MCP endpoint directly, or using web_fetch against the Connect AI API
- **Do** inform the user that the CData Connect AI MCP server is not currently connected
- **Do** suggest they enable it in their MCP settings, connected apps, or integration settings
- **Do not** infer that Connect AI is connected based on MCP server references in system context or artifact configurations. Only confirm availability through tool_search results.

If the user asks how to connect, direct them to the CData Connect AI integration documentation: https://docs.cloud.cdata.com/en/Integrations#ai-tools. To configure a data source connection within Connect AI, refer to: https://docs.cloud.cdata.com/en/Sources#add-a-connection

## Connect AI MCP — Core Discovery Workflow

### Step 1: Decide how you will answer the request

Before any discovery or data retrieval, ask: **what is the best tool set to answer this prompt?**

**Option 1 — Specific action tools**
Does the available toolset include named action tools that directly address the request? (Examples: `list_accounts`, `update_contact`, `create_task`, `get_opportunity`.) If yes, prefer these. They are purpose-built for the operation and require no discovery workflow. Proceed directly to calling the relevant action tool. Do not run the discovery flow below.

**Option 2 — Universal tools**
If no specific action tool fits the request — or if the request requires ad-hoc querying, exploration, or cross-object work that action tools don't cover — use the universal tools (`queryData`, `getTables`, `getColumns`, etc.) and follow the discovery path below.

---

### Query Naming Convention

All queries in Connect AI use a three-part fully-qualified name:

```
[Catalog].[Schema].[Table]
```

Where:
- `[Catalog]` = the user-defined connection name (discovered via `getCatalogs` or toolkit tool names)
- `[Schema]` = the schema name. For single-schema drivers, this is named after the driver itself (e.g., `Jira`, `SageIntacct`, `BullhornCRM`). Multi-schema sources expose multiple options (e.g., Workday exposes `REST`, `WQL`, `Reports`, and `SOAP`)
- `[Table]` = the target table

Example:
```sql
SELECT * FROM [MyJiraConnection].[Jira].[Issues] LIMIT 10
```

Always verify catalog, schema, and table names via discovery tools rather than assuming.

---

### Universal Tool Discovery Paths

Once you have chosen Option 2, identify which discovery path applies by checking what tools are available.

---

#### Path A: Generic MCP Server
*Signal: a `getCatalogs` tool is present.*

1. **`getCatalogs`** — list available connections. Call once per conversation. Cache the result; do not re-call.

   **Connection disambiguation:** If `getCatalogs` returns multiple connections and the user has not specified which data source to use, do NOT guess. Instead:
   - If the user named a platform (e.g. "Salesforce," "SQL Server"), filter the catalog list to matching connections and ask which specific connection to use if there are multiple
   - If the user's question is ambiguous (e.g. "show me accounts" without naming a system), present a brief summary of available connection types and ask which one they want to query
   - Do not default to a connection based on assumed domain mapping (e.g. "accounts" does not always mean CRM)

2. **Check for a loaded skill** — before calling any schema/table/column tool for a driver, ask: *do I have a driver-specific skill already loaded for this data source?*
   - If **yes** → follow that skill's instructions and proceed to step #4.
   - If **no** → call `getInstructions` before proceeding.

3. **`getInstructions(driverName=<n>)`** — REQUIRED before any `getSchemas`, `getTables`, or `getColumns` call for a driver with no loaded skill. The payload contains driver-specific hints not in the Agent's training data: quoting rules, SQL dialect quirks, required scope parameters, known-unsupported operations, and column-naming idioms. Call once per driver per conversation and read the output carefully — it is the highest-leverage context available.

4. **`getSchemas` / `getTables` / `getColumns`** — discover structure. Do not guess table or column names, even for well-known systems (Salesforce, Workday, SQL Server). Tenants may have custom objects, renamed fields, disabled tables, or non-standard schemas. Call `getColumns` before any `queryData` that references specific columns for the first time.

5. **`queryData`** — execute SQL. Always use the fully-qualified name `[Catalog].[Schema].[Table]`. Always apply `LIMIT` on exploratory queries unless the user explicitly requested full results.

For stored procedures: `getProcedures` → `getProcedureParameters` → `executeProcedure`. The `getInstructions`-first rule applies here too.

---

#### Path B: Toolkit — Universal Tools (connections or workspaces)
*Signal: no `getCatalogs`.*

**Connection targeting:** If the toolkit exposes tools for multiple connections (e.g. `jira1_*`, `confluence_*`, `bullhorn_*`), identify which connection is relevant to the user's request before calling any tools. If ambiguous, ask the user which data source they mean. Do not assume — tools that work on one connection may not exist or may be disabled on another.

1. **Check for a loaded skill** — do I have a driver-specific skill already loaded for this data source?
   - If **yes** → follow that skill's instructions and proceed to step #3.
   - If **no** → check to see if there is a tool `<connection_name>_get_instructions`. If there is, proceed to step #2; if not, proceed to step #3.

2. **`<connection_name>_get_instructions`** *(if present)* — same purpose as Path A. Call once per conversation and read the output carefully before continuing.

3. **`<connection_name>_get_schemas`** *(if present)* — only available when the source has multiple schemas. If `<connection_name>_get_schemas` is not present, skip directly to `<connection_name>_get_tables`.

4. **`<connection_name>_get_tables` / `<connection_name>_get_columns`** *(if present)* — discover structure. Same rules as Path A: do not guess names; call `<connection_name>_get_columns` before referencing specific columns in `<connection_name>_queryData`.

---

### Precondition Decision Tree (Paths A and B)

Before calling tools to retrieve schemas, tables, and columns for any driver:

```
Do I have a driver-specific skill loaded for this source?
├── YES → follow that skill
└── NO → Is getInstructions available?
    ├── YES → call getInstructions first, then proceed
    └── NO  → proceed directly to get schemas or get tables
```

---

### Universal Rules (all paths)

- Never guess table or column names, regardless of how well-known the source system is.
- Always apply `LIMIT` on exploratory or diagnostic queries unless the user explicitly requested full results.
- Cache catalog and instruction results mentally for the conversation — do not re-call unnecessarily.
- For multi-schema sources, always qualify names as `[Catalog].[Schema].[Table]`.

## SQL Dialect & Supported Functions

CData Connect AI drivers are SQL-92 compliant and also support functions from other SQL dialects (e.g., T-SQL). Before assuming a function is unsupported, consult the CData SQL Reference: https://docs.cloud.cdata.com/en/SQL-Reference/SQL-Reference

When a user asks whether a specific function is supported (e.g., DATEADD, ISNULL, CONVERT), either check the reference above or test empirically with a simple query against a known table.

## Common error recovery patterns

### `Column '<x>' not found`

The column name is almost always wrong, not missing. Do NOT retry with a close variant — the combinatorial space is too large. Instead:

1. Call `getColumns` for the table if not already done
2. Find the actual column — watch for casing (`AnnualRevenue` vs `annualrevenue`), prefixes (`c_`, `custom_`), and suffixes (`__c` on Salesforce custom fields)
3. Re-issue `queryData` with the verified name

### Empty result set from `queryData`

Before assuming there's no data:

1. Run a bounded count: `SELECT COUNT(*) FROM [Catalog].[Schema].[Table]` — does the table have rows at all?
2. Check filter value casing and whitespace — string comparisons are usually case-sensitive
3. Verify the connection's access scope with the user — some tenants restrict visibility by user/role at the connector level

### Timeout or very slow query

1. Add `LIMIT` — most business questions want top-N, not everything
2. Set filters in queries early — prefer date fields like CreatedDate or LastModifiedDate for large tables
3. Avoid `SELECT *` — specify only the relevant fields needed for the task
4. Remove unnecessary JOINs — simplify to only the joins required to answer the question
5. Check the driver instructions for result-size and pagination hints specific to that connector — some drivers (e.g. SAP, API Connector) support configurable page sizes or require explicit pagination handling

### `getTables` returns an incomplete or empty list

Almost always means `getInstructions` was skipped, or that the driver needs a scope/database parameter that was revealed in the instructions output. Re-read `getInstructions` for that driver.

### User says "that's the wrong <number / customer / ticket>"

Do not guess a correction. Run `getColumns` on the source table, show the user the column list, and ask which field they expected the query to filter or return on. Tenant-specific column naming is the most common root cause.

### Unexpected results or empty tables on a connection you chose

If a query returns 0 rows on a table you expect to have data, or the data doesn't match what the user described:

1. Before trying alternative tables or queries on the same connection, ask the user: "I'm currently querying [connection name]. Is this the right data source for what you're looking for?"
2. If the user didn't originally specify a connection and you selected one, this is especially important — your initial selection may have been wrong
3. Do not adapt indefinitely within a connection that isn't producing the expected results

## Connector-family and specific skills

When a driver has deep quirks, or when a pattern isn't covered by the discovery workflow and error-recovery guidance above, load the relevant sibling skill. These compose on top of this one:

- **cdata-crm** — Salesforce, HubSpot, Dynamics 365, Pipedrive. Account/Contact/Opportunity patterns, pipeline stages, owner/team queries.
- **cdata-hcm** — Workday, BambooHR, ADP, UKG. Worker/Position/Department triples, effective-dated records, org-hierarchy traversal.
- **cdata-erp** — NetSuite, SAP, Oracle EBS, Microsoft Dynamics F&O. GL/AP/AR patterns, cost centers, fiscal calendar quirks.
- **cdata-ticketing** — Zendesk, ServiceNow, Jira Service Management. Status vocabularies, SLA computations, assignee hierarchies.
- **cdata-analytics** — Snowflake, BigQuery, Databricks, Redshift. Warehouse-specific SQL dialect and performance hints.
- **cdata-files** — S3, Box, OneDrive, Dropbox. File/folder traversal, content-type quirks, and storage-provider auth scopes.
- **cdata-<specific-connector>** — connector-level quirks (e.g. Workday WQL idioms, Salesforce custom-object naming, NetSuite saved-search tables).

When composing a response, load the most specific skill available and fall back to the family, then this base skill.