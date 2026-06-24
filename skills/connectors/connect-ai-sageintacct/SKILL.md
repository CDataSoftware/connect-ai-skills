---
name: connect-ai-sageintacct
description: Use when querying Sage Intacct data through CData Connect AI. Sage Intacct exposes two different API surfaces — an XML API and a REST API — that present entirely different data models, table names, and column conventions. This skill identifies which surface a connection uses and routes to the matching reference for the data model, query patterns, stored procedures, write operations, and conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: SageIntacct
  family: accounting
---

# CData Connect AI — Sage Intacct Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Sage Intacct-specific guidance for querying Sage Intacct data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the Sage Intacct driver. Do not call `getInstructions` for Sage Intacct — the guidance it provides is already incorporated here and in the per-surface references. Proceed directly to `getSchemas` (to identify the surface — see below) and then schema discovery (`getTables` / `getColumns`) after identifying the Sage Intacct connection via `getCatalogs`.

## Sage Intacct exposes two API surfaces

A Sage Intacct connection presents one of **two completely different surfaces**, determined by the CData `Schema` connection property. The surface changes the entire object model — table names, column-naming conventions, the GL transaction model, available stored procedures, and write mechanics all differ. **The surface cannot be inferred from the connection name**, so the first move on any Sage Intacct connection is to identify it with `getSchemas`.

| Surface | `Schema` property | Schema returned by `getSchemas` | Object model | Stored procedures |
|---|---|---|---|---|
| **XML API** | `SageIntacct` (default) | `SageIntacct` | Lowercase legacy object names: `Glaccount`, `Gldetail`, `Arinvoice`, `Apbill`, `Customer`, `Vendor` | Yes (~14: `ReverseInvoice`, `VoidAPPayment`, `AccountBalanceReport`, …) |
| **REST API** | `SageIntacctRest` | `SageIntacctRest` | PascalCase REST entities: `Account`, `Invoice`, `Bill`, `JournalEntryLine`, `Customer`, `Vendor`; camelCase columns | None |

### A note on `UseLegacy` (XML surface only)

The XML surface has a second property, `UseLegacy`, that toggles between the legacy XML implementation (`UseLegacy=True`) and the newer XML implementation (`UseLegacy=False`, the default). **This toggle is not observable at query time** — both report the schema name `SageIntacct`, expose the same tables, the same columns (the newer implementation adds a few audit/UUID columns such as `Si_uuid`), and the same stored procedures. The SQL you write is identical either way. The only practical difference is performance: the newer implementation pushes `WHERE`, `ORDER BY`, `OFFSET`, and aggregates to the Sage Intacct server, while the legacy implementation emulates them client-side (slower and more timeout-prone on large tables). Because query construction is the same, both modes are covered by the single XML reference below.

## Step 1 — Identify the surface with `getSchemas`

Run `getSchemas` on the Sage Intacct connection before anything else:

- Returns **`SageIntacct`** → XML surface → load [references/xml.md](references/xml.md).
- Returns **`SageIntacctRest`** → REST surface → load [references/rest.md](references/rest.md).

## Step 2 — Load the matching surface reference

Each surface has its own reference with the full data model, query workflow, important columns, query patterns, stored procedures (XML only), write operations, and conventions. Read the one that matches the surface identified in Step 1 before writing queries:

- **XML** → [references/xml.md](references/xml.md) — the `Glaccount` / `Gldetail` / `Arinvoice` / `Apbill` / `Customer` / `Vendor` model, header→line patterns, the `AccountBalance` view, stored procedures, write operations, the `UseLegacy` performance note, and XML conventions.
- **REST** → [references/rest.md](references/rest.md) — the `Account` / `Invoice` / `Bill` / `JournalEntryLine` model, the `key` / `id` / `*_Id` / `*_Key` / `*_Name` reference conventions, `ListAggregate_*` line inserts, camelCase columns, write operations, and REST conventions.

The three-part name is always `[Catalog].[Schema].[Table]`:

```sql
-- XML surface
SELECT * FROM [YourConnection].[SageIntacct].[Glaccount] LIMIT 10
-- REST surface
SELECT * FROM [YourConnection].[SageIntacctRest].[Account] LIMIT 10
```

The middle segment is the **schema** (`SageIntacct` or `SageIntacctRest`), not the connection name and not a "driver name."

## Cross-cutting Sage Intacct conventions

These hold conceptually on both surfaces, though the exact table and column names differ — see each reference for specifics.

- **Identify the surface first.** It dictates the object model, column conventions, and whether stored procedures exist. Never assume — run `getSchemas`.
- **Master vs. transaction records.** Master records (accounts, customers, vendors, items, projects) are keyed by a business ID and carry an active/inactive status. Transaction records (invoices, bills, payments, journal entries) carry a workflow state and a date. Filter masters by status; filter transactions by date.
- **Date filters are essential on transaction tables.** GL-detail and document tables are large — always constrain by date to avoid timeouts, especially on the XML legacy implementation, which filters client-side.
- **Dimensions segment transactions.** Department, Location, Project, Class, Customer, Vendor, and Item act as reporting dimensions on transaction lines on both surfaces.
- **Multi-currency exposes base and transaction amounts.** Both surfaces distinguish a base/home-currency amount from a transaction-currency amount — pick the right one for the question.
- **Discover columns with `getColumns` before querying.** Sage Intacct tenants carry many custom fields, and column names differ sharply between the two surfaces. Confirm names on the live connection rather than assuming.
