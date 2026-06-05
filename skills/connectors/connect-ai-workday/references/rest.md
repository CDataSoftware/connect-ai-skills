# Workday REST Connection Reference

> Connection type: `ConnectionType = REST`. The Workday REST API — the most common configuration. Supports inserts, updates, and limited deletes.
>
> Load this reference when the live connection's `getSchemas` returns **functional-area schemas** (e.g., `Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`) rather than a single `WQL` / `Reports` / `SOAP` schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema partitioning

REST connections do **not** expose a single `REST` schema. Instead the driver partitions REST tables across **multiple functional-area schemas** named after Workday modules — e.g., `Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`, `Payroll`, `Connect`. **Never assume a table's schema. Always run `getSchemas`, then `getTables` (with a `tableName` LIKE filter), on the live connection to discover where a table lives before querying it.**

A REST-typed connection may also expose a `Wql` schema alongside its functional-area schemas. It is a valid, queryable schema (not an artifact) and appears on both the generic MCP and toolkit surfaces. It does not replace a dedicated WQL-typed connection, which remains the right choice for full WQL work (see [references/wql.md](wql.md)).

### Discovering table locations

Because table-to-schema placement is tenant- and version-specific, treat discovery as mandatory rather than optional:

1. `getSchemas` on the connection to see which functional-area schemas the tenant exposes.
2. `getTables` with a `tableName` LIKE filter (e.g. `Requisition%`, `Job%`, `Worker%`) to find the table and the schema it lives in. A single logical entity may surface as several tables/views across more than one schema.
3. `getColumns` on the resolved `[catalog].[schema].[table]` before referencing any column.

Some entities documented in older Workday connector material (e.g. bare `Workers`, `Jobs`, `companies`, `journals`, `journalLines`) may not be present at all — their availability depends on which Workday modules the tenant has enabled. Confirm with `getTables`; do not assume a table exists.

### Three-part name examples

```sql
-- REST connection: tables live in functional schemas. The schema names below
-- are illustrative placeholders — confirm the real schema with getTables.
SELECT * FROM [YourConnection].[<schema>].[Organizations]
SELECT * FROM [YourConnection].[<schema>].[Requisitions]
SELECT * FROM [YourConnection].[<schema>].[Cases]
```

## Query Process

The REST connection requires a Workday-specific workflow built around **prompt columns** and **value tables**. Most non-trivial REST queries cannot be issued directly — they require resolving one or more Workday-internal GUIDs first.

1. **Locate the schema** for the target table on the live connection (`getSchemas` → `getTables` with a LIKE filter). Do not assume placement.
2. **Inspect with `getColumns`** on `[catalog].[schema].[table]` and find any `_Prompt` columns. Some are required, some optional. Required prompts typically scope to a date range or parent ID.
3. **For each required `_Prompt`, resolve the GUID via the matching value table** (ends in `Values`, lives in the same schema). See [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables).
4. **Chains may be multi-level** — a value table may itself require a `_Prompt`. Resolve backward from the target.
5. **Execute the target query** with literal GUIDs or date strings in `yyyy-mm-dd` format.

## Data Model

### Entity Type Categories

The REST API exposes entities in four categories. Category controls how the entity is queried, which prompts it inherits, what its primary key looks like, and whether it supports writes.

- **Base** — read directly; one row per primary object (e.g., Requisitions, Organizations).
- **Child** — belong to a parent; accessed via the parent. Example: `RequisitionsWorktags`.
- **Owned** — require an owner record reference. Example: `RequisitionsRequisitionLines` needs a specific Requisition.
- **Owned child** — require both parent and owner.

### Primary Key Structures

| Entity Type | Primary Key |
|---|---|
| Base | Single `Id` |
| Child | `Id` + Parent reference |
| Owned | `Id` + Owner reference |
| Owned Child | `Id` + Parent + Owner |

### Prompt Columns (REST entity categories)

> The generic prompt-column and value-table mechanics — `_Prompt` semantics, literal date/boolean prompts, never-guess-GUIDs, value-table structure, and hierarchical navigation — are documented once in the base [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables), since they also apply to WQL Core sources. This section covers only what REST adds on top.

On REST, **which prompts an entity exposes follows its entity category** (see [Entity Type Categories](#entity-type-categories) above):

- **Base** — own prompts only
- **Child** — parent's prompts
- **Owned** — own + owner's prompts
- **Owned child** — parent's + owner's prompts

Value tables for REST prompts live in the **same functional-area schema** as the target table and end in `Values`.

### Filter Push-Down

Server-side filtering is more efficient. Push-down rules by category:

- **Base** — `Id` filters pushed down; Workday returns only the matching row.
- **Child** — only parent `Id` is pushed down. Filters on the child entity itself are evaluated client-side after the full result is fetched (inefficient).
- **Owned** — owner `Id` is pushed down; the owner reference must be valid.
- **Owned Child** — both parent `Id` and owner `Id` filters can be pushed down.

### Change Resources

Business-process modifications (job changes, org assignment changes, time off) use a paired `Begin`/`Submit` stored procedure pattern:

1. Call `Begin<ChangeName>` to initiate the change event; returns a change ID.
2. Apply changes via queries/updates against change-specific tables.
3. Call `Submit<ChangeName>` with the change ID to commit and run the Workday business process.

**Single value changes** modify one record directly. **Collection changes** modify multiple related records — use `CollectionToken` for iterative navigation. See [Stored Procedures](#stored-procedures) for the Begin/Submit pairing details.

## Columns

Column names are tenant- and module-dependent and are **not** enumerated here — discover them with `getColumns` on the resolved table before writing a query. A few cross-cutting conventions hold widely enough to rely on:

- **`Id` vs. business identifiers.** A table's `Id` column is the Workday WID (internal GUID). Human-facing identifiers (employee IDs, requisition numbers, case IDs) are separate columns. When a stored procedure needs a worker/entity reference, it almost always wants the **WID**, not the human-facing ID — resolve the WID first (e.g. read it from the relevant table's `Id` / `*_Id` column).
- **Reference fields surface as paired `<entity>_Descriptor` and `<entity>_Id`** (dotted in some surfaces, e.g. `Worker.Descriptor` / `Worker.Id`). Quote with `[]`.
- **`_Prompt` columns** are inputs, not output data — see the prompt-column guidance above.
- **Required classification/scope filters** (e.g. an `OrganizationType_Prompt` on an organizations table) return 0 rows when omitted. If a base table returns nothing, check `getColumns` for a required `_Prompt`.

## Common Query Patterns

> Schema names in the examples below are illustrative placeholders. Resolve the real schema for each table with `getTables` on the live connection first.

### Direct date-column filter (non-prompt)

Some columns are plain filterable columns, not prompts. Don't append `_Prompt` to a column that isn't one — `getColumns` tells you which is which.

```sql
SELECT [Id], [Title], [StartDate], [EndDate]
FROM [YourConnection].[<schema>].[JobPostings]
WHERE [StartDate] >= '2024-01-01'
ORDER BY [StartDate] DESC
```

### Date-range query via prompt columns

```sql
SELECT [Id], [Descriptor], [Status_Descriptor]
FROM [YourConnection].[<schema>].[Requisitions]
WHERE [FromDate_Prompt] = '2020-01-01'
  AND [ToDate_Prompt] = '2021-12-31'
ORDER BY [Descriptor] DESC
```

`FromDate_Prompt` / `ToDate_Prompt` accept literal dates in `yyyy-mm-dd` format.

### Entity requiring a value-table GUID lookup

```sql
-- Step 1: resolve the GUID from the matching value table (filter by Descriptor)
SELECT [Id], [Descriptor]
FROM [YourConnection].[<schema>].[<Entity>TypeValues]
WHERE [Descriptor] = '<human-readable value>'

-- Step 2: feed the resolved GUID into the required _Prompt
SELECT [Id], [Descriptor]
FROM [YourConnection].[<schema>].[Organizations]
WHERE [OrganizationType_Prompt] = '<GUID from step 1>'
```

### Multi-step prompt-column lookup chain *(illustrative)*

> The `companies` / `journals` / `journalLines` chain below depends on the Workday Financials module and may not be present in every tenant. Use it as a pattern for any REST table with multi-level `_Prompt` dependencies, not as a guaranteed set of tables.

To query a deeply-prompted table, resolve each required GUID in dependency order, then issue the final query with all prompts supplied:

1. Resolve the parent scope (e.g. a company `Id` from a companies table filtered by `Descriptor`).
2. Resolve dependent prompts that themselves need the parent (e.g. fiscal-year / status GUIDs from a journals table filtered by the company prompt and a date range).
3. Issue the target query with all resolved prompts plus any date-range prompts:

```sql
SELECT [workdayId], [accountingDate]
FROM [YourConnection].[<schema>].[journalLines]
WHERE [company_Prompt] = '<from_step_1>'
  AND [year_Prompt] = '<from_step_2>'
  AND [journalEntryStatus_Prompt] = '<from_step_2>'
  AND [entryMomentFrom_Prompt] = '2017-01-01'
  AND [entryMomentTo_Prompt] = '2017-06-01'
LIMIT 10
```

## Stored Procedures

**Procedures share a flat global namespace; tables do not.** On the Workday REST driver, `getProcedures`, `getProcedureParameters`, and `executeProcedure` resolve a procedure by **name alone** — the schema parameter is required by the tool signature but is ignored for procedure resolution. Consequences:

- `getProcedures` returns the same complete procedure list under every functional-area schema, so a given procedure appears under all of them. This is the flat namespace being enumerated, **not** duplication or a scoping defect. Use `getProcedures` for name discovery (e.g. a `procedureName` LIKE filter), not to infer which schema a procedure "lives" in.
- You can call any business-process procedure under any valid schema and it will resolve. For readability, prefer the schema closest to the procedure's domain (e.g. `Staffing` for worker-lifecycle procedures, `Procurement` for requisition procedures, `Common` for cross-cutting ones). This is convention, not enforcement.
- **Tables do not share this behavior** — table schema membership is real and must be discovered with `getTables`.

> Provenance: the flat-namespace behavior is observed in testing and is consistent with how the driver resolves procedures, but it has not been confirmed across every Workday tenant and driver version. If a procedure unexpectedly fails to resolve, fall back to discovering it by name with `getProcedures`.

Discover the available procedures with `getProcedures` (any valid schema works). Representative business-process procedures follow the `Begin*` / `Submit*` paired pattern:

- `Begin<ChangeName>` / `Submit<ChangeName>` (e.g. job changes, organization-assignment changes, contact-information changes)
- worker-scoped action procedures (time-off requests, one-time payments, etc.)
- requisition lifecycle procedures (cancel, close)

`Begin*` / `Submit*` are always called in pairs — `Begin*` returns the change ID via the generic `Id` output column; `Submit*` then consumes it as `<ChangeName>_Id` (e.g., a job-change `Submit*` takes `JobChange_Id`, **not** `Id`). Don't call `Submit*` without `Begin*`, and don't forget `Submit*` after applying changes (otherwise the change isn't committed to Workday). This naming convention is expected to generalize across `Submit*` procedures.

### Cross-cutting messaging / action procedures

Procedures such as a `SendMessage`-style notification procedure follow the flat-namespace behavior — reachable from any valid schema; use the most domain-appropriate one (e.g. `Common`) as the call site. Their object-reference inputs (notification type, recipients) are Workday GUIDs — resolve them via the appropriate value tables before calling.

### Error code legend

`executeProcedure` and query failures surface error codes from distinct layers. Distinguishing them tells you whether to fix the call shape or look elsewhere:

| Code prefix | Layer | Trigger | What to do |
|---|---|---|---|
| `STMT RSB <name> is not a valid stored procedure` | CData driver (procedure resolution) | Procedure name doesn't exist | Fix the procedure name (discover via `getProcedures`). Call never reached Workday. |
| `STMT SQL [60003] The input [X] must have a value...` | CData driver (input validation) | Required input parameter missing or empty | Supply the parameter. Call never reached Workday. |
| `STMT HTTP [40002] [S22] permission denied` | Workday API (authorization) | The integration user lacks security access for the operation/domain | See permissions guidance below. **Not** a query-shape problem. |
| `STMT HTTP [40006] [S21] not found: <X>` | Workday API (entity resolution) | GUID malformed, nonexistent, or wrong entity type for the endpoint | Fix the GUID or entity-type match. Call reached Workday. |

- `STMT RSB` and `STMT SQL [60003]` mean the call never left the driver — fix the procedure name or parameter set and retry.
- `STMT HTTP [40002]` and `STMT HTTP [40006]` mean Workday received the call and rejected it — the fix is on the Workday side (GUID, entity-type, or security policy), not the call shape.

### Permission errors (`40002`) — diagnosing scope

`HTTP [40002] permission denied` means the connection's integration system user (ISU) doesn't have the Workday security access the operation requires. Two distinct cases, with different fixes:

- **Operation-level gap.** A specific procedure or write fails with `40002` while reads on the same schema succeed. The ISU's security group lacks the domain permission for that particular business process or the connection is read-only on the CData side.
- **Module/domain-wide gap.** *Both* reads (`SELECT`) **and** procedure calls fail with `40002` across an entire schema family (e.g. every `Student*` schema, or all of Financials). This points to the ISU's security group missing the whole functional domain's access, not a per-call issue.

How to tell them apart and respond:

1. Run a minimal read against a table in the affected schema (`SELECT * FROM [conn].[schema].[table] LIMIT 1`). If that also returns `40002`, the gap is domain-wide — the ISU simply cannot see that module.
2. **Do not** try to fix a `40002` by changing the query, adding/removing parameters, or supplying different GUIDs — none of those grant access. Adding valid inputs to a call that's blocked on authorization will return the same `40002`.
3. The fix is a **Workday tenant administration change**: grant the integration system user's security group the relevant domain security policy (and, for writes, the business-process security policy), then activate pending security policy changes. This is outside CData/Connect AI — surface it to a Workday security administrator rather than continuing to retry.
4. Also confirm the Connect AI connection isn't configured read-only when a **write** specifically fails — see [Write Operations](#write-operations) for the two layers that gate writes.

## Write Operations

REST connections support writes where the underlying Workday API allows it; **WQL and Reports are read-only by design** and cannot be made writable.

- **Insert** — supported on base/owned entities where the Workday API permits creation. Supply all Workday-mandatory fields; respect parent/owner dependencies.
- **Update** — must include `Id`. Child/owned entities require their compound keys. Prompt columns may be required depending on entity type.
- **Delete** — many entities cannot be deleted directly; use the change-resource pattern (Begin/Submit) instead.

**Two layers control write access:** the Workday business object's own security rules (Workday side), and the Connect AI connection's read-only setting (CData side). When a write fails with a permissions error, check both — a `40002` here may mean either the ISU lacks the business-process security policy, or the connection is configured read-only.

## REST-Specific Conventions

> Prompt-column and value-table conventions (never guess GUIDs, literal date/boolean prompts, multi-level lookup chains, NULL `CollectionToken` = leaf) are shared across connection types and live in [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables). The conventions below are REST-only.

- **Discover schema placement; never assume it.** REST has no literal `REST` schema — tables live in functional-area schemas that vary by tenant and driver version. Resolve with `getSchemas` → `getTables` before querying.
- **Prompt inheritance follows entity category** (Base / Child / Owned / Owned child). Value tables for REST prompts live in the same functional-area schema as the target.
- **`Id` push-down depends on entity category** (base = fast; child = client-side after full fetch). For child entities, filter on the parent `Id` instead.
- **Change resources use a strict Begin/Submit pair** — neither stands alone.
- **Procedures share a flat namespace; tables don't.** `getProcedures` / `getProcedureParameters` / `executeProcedure` resolve procedures by name and ignore the schema parameter; tables require correct schema membership. Use `getProcedures` for name discovery, not schema-membership inference.
- **Driver `Required=false` on procedure parameters is often misleading.** Both the CData driver and Workday business-process rules may reject calls that omit parameters reported as `Required=false`. The driver surfaces these as `STMT SQL [60003] The input [X] must have a value...` before the call leaves the driver; Workday business-process rules surface as `STMT HTTP [40006]` or `STMT HTTP [40002]`. Treat any parameter named in a procedure's primary semantics — the ID of the entity being acted on, reason codes for state changes, comments for business-process steps — as functionally required regardless of metadata.
- **A correctly-formed query that returns 0 rows is usually data availability, not a malformed query.** If `getColumns` confirms your columns and all required `_Prompt`s are supplied with valid GUIDs/dates, an empty result typically means no matching records (e.g. nothing in the date window). Don't keep "fixing" a query that's already correct — verify the data exists.
