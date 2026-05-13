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

## Core discovery workflow

The Connect AI MCP enforces a discovery order. Three of the discovery tools (`getSchemas`, `getTables`, `getColumns`) carry an explicit precondition: **`getInstructions` must have been called for the relevant driver first**. Skipping this is the single most common cause of wasted turns.

Follow this order:

1. **`getCatalogs`** — list available connections. Call once per conversation. Cache the result mentally; don't re-call unless the user adds a connection mid-session.

**Connection disambiguation:** If `getCatalogs` returns multiple connections and the user has not specified which data source to use, do NOT guess. Instead:
- If the user named a platform (e.g. "Salesforce," "SQL Server"), filter the catalog list to matching connections and ask which specific connection to use if there are multiple
- If the user's question is ambiguous (e.g. "show me accounts" without naming a system), present a brief summary of available connection types and ask which one they want to query
- Do not default to a connection based on assumed domain mapping (e.g. "accounts" does not always mean CRM)

2. **`getInstructions(driverName=<n>)`** — REQUIRED before any schema/table/column call for that driver. The instruction payload contains driver-specific hints that are NOT in the Agent's training data: quoting rules, SQL dialect quirks, required scope parameters, known-unsupported operations, pagination conventions, and column-naming idioms. Call this once per driver per conversation. Re-read the output carefully — it is the highest-leverage context available.

3. **`getSchemas` / `getTables` / `getColumns`** — discover structure. Do not guess table or column names, even for systems that are well-known outside CData (Salesforce, Workday, SQL Server). The tenant may have custom objects, renamed fields, disabled tables, or non-standard schemas. `getColumns` in particular should be called before any `queryData` that references specific columns for the first time.

4. **`queryData`** — execute SQL. Always use the fully-qualified name `Catalog.Table` (or `Catalog.Schema.Table` where applicable). Always apply `LIMIT` on exploratory or aggregate queries unless the user explicitly requested full results.

For stored-procedure work, the parallel sequence is `getProcedures` → `getProcedureParameters` → `executeProcedure`. The same getInstructions-first rule applies.

### Precondition check (decision tree)

Before calling `getSchemas`, `getTables`, or `getColumns` for any driver, ask: **Have I already called `getInstructions` for this driver in this conversation?**

- If yes → proceed
- If no → call `getInstructions` first. Do not proceed until its output is read

## Common error recovery patterns

### `Column '<x>' not found`

The column name is almost always wrong, not missing. Do NOT retry with a close variant — the combinatorial space is too large. Instead:

1. Call `getColumns` for the table if not already done
2. Find the actual column — watch for casing (`AnnualRevenue` vs `annualrevenue`), prefixes (`c_`, `custom_`), and suffixes (`__c` on Salesforce custom fields)
3. Re-issue `queryData` with the verified name

### Empty result set from `queryData`

Before assuming there's no data:

1. Run a bounded count: `SELECT COUNT(*) FROM <catalog>.<table>` — does the table have rows at all?
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

