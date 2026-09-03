---
name: connect-ai-hubspot
description: Use when querying HubSpot data through CData Connect AI. HubSpot exposes three different schemas — HubSpotV3, HubSpotV4, and a legacy HubSpot schema — that present entirely different data models, table sets, primary keys, and stored procedures. This skill identifies which surface a connection uses and routes to the matching reference for the data model, query patterns, stored procedures, write operations, and conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: HubSpot
  family: crm
---

# CData Connect AI — HubSpot Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides HubSpot-specific guidance for querying HubSpot data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the HubSpot driver. Do not call `getInstructions` for HubSpot — the guidance it provides is already incorporated here and in the per-surface references. Proceed directly to `getSchemas` (to identify the surface — see below) and then schema discovery (`getTables` / `getColumns`) after identifying the HubSpot connection via `getCatalogs`.

## HubSpot exposes three schemas

A HubSpot connection presents one of **three completely different surfaces**, determined by the CData `Schema` connection property. The surface changes the entire object model — which tables exist, how primary keys are named, how enum values are cased, how relationships are traversed, and which stored procedures are available. **The surface cannot be inferred from the connection name**, so the first move on any HubSpot connection is to identify it with `getSchemas`.

> **Always run `getSchemas` as the FIRST tool call against any HubSpot connection** — before any `queryData`, `getTables`, or `getColumns` call. **Do not infer the surface from the connection name.** A name may carry a `_V3`, `_V4`, or `_Legacy` hint, but this is not a reliable surface indicator and may be misleading. The schema returned by `getSchemas` is the only authoritative signal.

| Surface | `Schema` property | Schema returned by `getSchemas` | Object model | Stored procedures |
|---|---|---|---|---|
| **V3 catalog** | `HubSpotV3` | `HubSpotV3` | The full catalog (~137 tables): CRM objects, property/pipeline metadata, owners and users, lists, marketing, CMS. `Id` primary keys, lowercase enum values | Yes — custom object/property definition, GDPR delete, file management, `GetAccountDetails` |
| **V4 records** | `HubSpotV4` | `HubSpotV4` | A lean record view (~62 tables): CRM objects, association tables, property history, email subscriptions. `Id` primary keys, lowercase enum values | Yes — email subscription management, `GetAccountDetails` |
| **Legacy** | `HubSpot` | `HubSpot` | The original model (~60 tables): smaller CRM set plus marketing, analytics, social, forms, CMS. **`VID` / `DealId` primary keys, TitleCase enum values** | Yes — `InsertEngagement`, `UpdateWorkflowContacts`, file upload/delete |

## Step 1 — Identify the surface with `getSchemas`

Run `getSchemas` on the HubSpot connection before anything else:

- Returns **`HubSpotV3`** → V3 catalog → load [references/v3.md](references/v3.md).
- Returns **`HubSpotV4`** → V4 records → load [references/v4.md](references/v4.md).
- Returns **`HubSpot`** → legacy → load [references/legacy.md](references/legacy.md).

## Step 2 — Load the matching surface reference

Each surface has its own reference with the full data model, query workflow, important columns, query patterns, stored procedures, write operations, and conventions. Read the one that matches the surface identified in Step 1 before writing queries:

- **V3** → [references/v3.md](references/v3.md) — the full CRM object set, the `*Properties` / `*Pipelines` / `*PipelineStages` metadata families, `Owners` / `UserProvisioning` / `Teams` / `Roles`, `Lists` / `ListMemberships`, custom-object metadata, marketing and CMS tables, and the custom object/property and file procedures.
- **V4** → [references/v4.md](references/v4.md) — the CRM object set, `*PropertiesHistory` views, `SubscriptionTypes` / `SubscriptionPreferences`, the subscription procedures, and what to do when a request needs owner names or stage labels this surface does not carry.
- **Legacy** → [references/legacy.md](references/legacy.md) — the `VID` / `DealId` key model, the combined `Engagements` table, `CrmAssociations` and how to obtain a `DefinitionId`, `DealPipelineStages` with its `StageId` / `StageName` columns, `DealStages` and the `[DealId]` filter that silently truncates it, and the email-campaign, forms, analytics, social, and CMS tables.

Read the reference before writing queries for that surface. The summaries above name what each reference covers; they are not a substitute for it, and where a one-line summary and a reference appear to disagree, the reference is authoritative.

The three-part name is always `[Catalog].[Schema].[Table]`:

```sql
-- V3 catalog
SELECT [Id], [Deal Name], [Amount] FROM [YourConnection].[HubSpotV3].[Deals] LIMIT 10
-- V4 records
SELECT [Id], [Deal Name], [Amount] FROM [YourConnection].[HubSpotV4].[Deals] LIMIT 10
-- Legacy
SELECT [DealId], [Deal Name], [Amount] FROM [YourConnection].[HubSpot].[Deals] LIMIT 10
```

Replace `[YourConnection]` with your actual HubSpot connection name from `getCatalogs`. The middle segment is the **schema** (`HubSpotV3`, `HubSpotV4`, or `HubSpot`), not the connection name and not a "driver name."

## Cross-cutting HubSpot conventions

These hold conceptually on all three surfaces, though the exact table and column names differ — see each reference for specifics.

### Bracket-quote every column

HubSpot exposes CRM properties under their **display-name labels**, so most columns contain spaces and some contain punctuation. This is the most common source of syntax failures on this connector.

```sql
SELECT [Deal Name], [Total open deal value], [Is Deal Closed?], [State/Region]
```

`[Is Deal Closed?]` carries a literal question mark. Capitalization is also inconsistent across objects — `Create Date` on contacts and deals, but `Create date` on tickets; `Company name` with a lowercase `n`; `Is closed lost` with a lowercase `c` and `l`. Never construct a label from a rule; take it from `getColumns`.

### Relationships live in junction tables, not foreign-key columns

This is the single most important thing to understand about the HubSpot data model, and it applies to every surface. Object tables do **not** carry foreign keys to each other. To get a company's deals, or a deal's line items, you go through an association table.

On V3 and V4 the shape depends on the `ExpandAssociations` connection property, and the two shapes are queried differently — a per-object shape with an `[Id]` / `[AssociationId]` / `[Type]` layout, or a pairwise shape with two typed id columns and no `[Type]` column at all. The legacy surface uses `CrmAssociations` instead. **Run one filtered `getTables` call to learn which shape is active before writing an association join** — see each reference for the exact tables, columns, and join patterns.

Association joins **fan out**: a record associated with several others produces one row per association. Use `DISTINCT` or aggregate when the duplication is not meaningful.

### Stored values are often ids, not labels

Stage, pipeline, and owner columns hold ids rather than display text. Whether you can resolve them to names depends on the surface: V3 carries `Owners` and `*PipelineStages` lookup tables, legacy carries `DealPipelineStages`, and V4 carries neither. When a request needs a person's name or a portal's custom stage label, check that the surface can supply it before answering with ids.

The format of the stored value varies by object as well as by surface — a deal's stage may be a readable internal name (`closedwon`) while a ticket's status on the same connection is a bare numeric id. Sample the column before assuming either.

### Creating a record goes through a Source Tool, never a raw `INSERT`

`UPDATE` against the object tables works on all three surfaces, because the primary key is supplied in the `WHERE` clause. A raw `INSERT` does **not** work anywhere: HubSpot assigns each record's primary key server-side and exposes that column as read-only, while the insert path requires a value for every non-nullable column that has no default and does not skip the read-only key. The statement is rejected before the driver sees it.

**This is a property of the insert path, not a limit on creating records.** Creation is supported through the connection's dedicated create tool for the object — contacts, companies, deals, tickets, and engagements each have one — which reaches the driver by a path that lets HubSpot generate the key.

- **Never supply the primary key** on a create.
- If a raw `INSERT` has already produced an error naming the key column as *"neither nullable nor has a default value"*, treat it as a signal to switch paths. Do not retry with variants, do not conclude creation is impossible, and do not invent a key value.
- **Confirm a create by reading the record back** by the id the tool returns, rather than trusting the success response.
- If no create tool is listed in this session, say plainly that creation is unavailable here and offer the alternatives — update an existing record, or create it in the HubSpot UI.
- A **read-only connection** is a separate and unrelated cause of blocked writes. Do not send a user to change connection settings over an insert-path error.

Two procedure-level exceptions sidestep this entirely: the legacy surface creates **engagements** via `InsertEngagement`, and V3 creates **metadata** (custom object types and custom properties) via its `Create*` procedures.

Primary key names vary by surface and object: `Id` on V3 and V4; on legacy, `VID` on contacts, `CompanyId` on companies, `DealId` on deals, and `Id` on tickets and most others.

### Custom properties are the norm

Every HubSpot portal adds its own properties, so a documented column list is the floor and never the ceiling. When a user names a field that is not in the reference, run `getColumns` with a `columnName` filter. On V3 and legacy you can also query the object's `*Properties` table by `[Label]`.

Portals can also define custom **objects**. With `IncludeCustomTables=true` they appear as their own tables, named from the object's plural label with a `__c` suffix, and their association table drops the suffix.

### Some tables require a filter in the WHERE clause

Several HubSpot tables error, or silently return nothing, without a specific filter. Others do the reverse: a predicate on a perfectly readable column silently returns nothing (`ListMemberships.[ObjectTypeId]` on V3). Each reference names its own: `ListMemberships` on V3 (needs `[ListId]`, must not be filtered on `[ObjectTypeId]`); `SubscriptionPreferences` and the `*PropertiesHistory` views on V4; `CrmAssociations`, `EmailSubscriptions`, and `FormSubmissions` on legacy. Legacy `DealStages` is the mirror image — a `[DealId]` filter silently truncates it. When a table reports a required column, supply it rather than removing filters.

Which filters are required is itself surface-specific — the `*PropertiesHistory` views need a `[PropertyName]` filter on V4 but not on V3. Trust the error message over any assumption carried from another surface.

### One schema per connection

The schema is fixed by the connection's `Schema` property and cannot be changed per query. If a request needs a table that lives on a different surface, say that a separate connection is required rather than qualifying a query with another schema name — it will not resolve.

### Do not carry filter values between surfaces

Enum casing differs. `[Lifecycle Stage]` is `opportunity` on V3 and V4 but `Opportunity` on legacy. A filter copied across surfaces returns zero rows rather than erroring, which reads as "no data" when it is really a casing mismatch.

### Never `SELECT *` on an object table

HubSpot object tables carry hundreds of properties, and some metadata tables carry large aggregate columns. Name the columns you need.
