---
name: connect-ai-airtable
description: Use when querying Airtable data through CData Connect AI. Covers Airtable's multi-schema model (the Information metadata schema plus one dynamic schema per base), per-base table/view anatomy, attachment and collaborator field handling, comments, stored procedures, and Airtable-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: Airtable
  family: collaboration
---

# CData Connect AI — Airtable Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Airtable-specific guidance for querying Airtable data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Airtable driver. Do not call `getInstructions` for Airtable — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getSchemas` / `getTables` / `getColumns`) after identifying the Airtable connection via `getCatalogs`.

## Schema

**Airtable is a multi-schema driver.** Unlike most connectors, the middle segment of the three-part name is *not* a fixed driver name — it is either the `Information` metadata schema or the name of a specific **base**:

- **`Information`** — a read-only metadata schema describing your bases, tables, users, groups, and collaborators. Use it to discover what exists.
- **One schema per base** — every Airtable base you can access is exposed as its own schema, named after the base (e.g. `[Project tracker]`, `[Untitled Base]`). Base and table names frequently contain spaces, commas, and emojis, so they **must** be bracket-quoted.
- A `CData` system schema may also appear in `getSchemas`; it holds driver system objects, not your Airtable data — ignore it.

```sql
-- Metadata (Information schema):
SELECT [Id], [Name], [PermissionLevel] FROM [YourConnection].[Information].[Bases]

-- Records (a base schema):
SELECT * FROM [YourConnection].[Project tracker].[👀 Overview] LIMIT 10
```

> **Source correction:** older instructions show `[Connection].[Airtable].[Bases]`. There is **no `Airtable` schema** — metadata lives in `[Information]`, and record data lives in `[<BaseName>]`. Always use one of those two forms.

## Query Process

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'Airtable'`.
2. **Find the base** — call `getSchemas`, or query `[Information].[Bases]` to list bases by name and `PermissionLevel`. The base name *is* the schema name.
3. **Find the table** — call `getTables` for that base schema, or query `[Information].[Tables] WHERE [BaseName] = '<base>'`. Each base contains your record TABLEs plus auto-generated VIEWs (see Data Model).
4. **Inspect columns** — `getColumns` on the target table. Airtable columns are user-defined per table and often contain spaces/emojis; never assume column names.
5. **Query / write** — query the base table, filtering on `[CreatedTime]` or user fields. Write with INSERT/UPDATE/DELETE (targeting `[Internal_Id]`), add comments via the `Comments` table, or call a stored procedure.

## Data Model

### Information schema (read-only metadata)

- **Bases** — every base you can access: `Id`, `Name`, `PermissionLevel`
- **Tables** — every table across your bases: `BaseId`, `BaseName`, `Id`, `Name`, `Description`, `PrimaryFieldId`, `Fields`, `Views`
- **Users** — workspace users: `Id`, `Active`, `UserName`, `GivenName`, `FamilyName`, `CreatedAt`, `Groups`
- **Groups** — user groups: `Id`, `DisplayName`
- **GroupCollaborators** / **GroupMembers** / **IndividualCollaborators** — collaborator and group-membership detail (identifiers, permission levels, direct vs. inherited access)

All Information views are read-only.

### Per-base anatomy

Within a base schema, `getTables` returns more than just your tables. For a table `T`, you will typically see:

- **`T`** (TABLE) — the actual records. Read/write.
- **`[T.<view name>]`** (VIEW) — one queryable view per saved Airtable view (Grid, Gallery, Calendar, Gantt/Block), carrying that view's filtering/sorting. The name contains a dot and is a **single** identifier — bracket the whole thing: `[👀 Overview.3. Review project deadlines]`. Read-only.
- **`[T_Attachments]`** (VIEW) — one row per attachment in `T`, exposing `URL`, `FileName`, `Size`, `Type`, thumbnail URLs, the attachment `Internal_Id`, the source `ColumnName`, and `RowId`. Read-only.
- **`[T_Collaborators]`** (VIEW) — collaborator detail for `T`.

Each base also has a **`Comments`** table for querying and adding record comments.

### Base-table system columns

Every record table includes driver-managed columns alongside your fields:

- `Internal_Id` — the row's primary key (the Airtable record id). **Target this in UPDATE/DELETE WHERE clauses.**
- `BaseId`, `TableId` — identifiers of the containing base/table (read-only)
- `CreatedTime` — record creation timestamp (read-only) — use for date filtering

### Field expansion (collaborator / linked / attachment fields)

Rich Airtable field types expand into multiple columns:

- A **collaborator / "user" field** named `Project lead` expands into `[Project lead.ID]`, `[Project lead.Email]`, `[Project lead.Name]`, `[Project lead.ProfilePicUrl]`. These dotted names are single identifiers — bracket-quote them.
- An **attachment field** surfaces both as a column on the table and as the dedicated `[T_Attachments]` view (use the view to get file URLs).
- A **linked-record field** (e.g. `📝 Tasks`) holds references to rows in another table.

## Important Columns

### Information.Bases
- `Id` — base identifier (key)
- `Name` — base display name (also the schema name for that base's data)
- `PermissionLevel` — your access on the base (`read`, `comment`, `edit`, `create`) — gates writes

### Information.Tables
- `BaseId` / `BaseName` — containing base (key: `BaseId`)
- `Id` / `Name` — table identifier / display name
- `Description` — table purpose
- `PrimaryFieldId` — the table's primary field
- `Fields` — JSON of the table's fields (names, types, config)
- `Views` — JSON of the table's saved views

### Comments (per base)
- `Id` — comment identifier (key, read-only)
- `RecordId` — record the comment belongs to (key, writable — set on insert)
- `TableName` — table containing the record (writable — set on insert). **Required filter on SELECT queries** — querying Comments without `WHERE [TableName] = '...'` returns error `A value is required for ... [TableName]`. Always include a TableName filter when reading comments; optionally also filter by `RecordId` for a specific record.
- `Text` — comment body, may include user mentions (writable)
- `ParentCommentId` — parent comment for threaded replies (writable)
- `CreatedTime` / `LastUpdatedTime` — timestamps (read-only)
- `AuthorId` / `AuthorEmail` / `AuthorName` — author identity (read-only)
- `Mentioned` — users mentioned in the text (read-only)
- `Reactions` — emoji reactions with reactor metadata (read-only)

### `[T_Attachments]` view (per table)
- `URL` — direct download URL for the attachment (the cloud-friendly way to fetch a file)
- `FileName`, `Size`, `Type` — file metadata
- `Internal_Id` — attachment id
- `ColumnName` — the attachment field the file came from
- `RowId` — the record the attachment belongs to
- `thumbnails.{small,large,full}.url` — thumbnail URLs (images only)

## Common Query Patterns

### List bases you can access

```sql
SELECT [Id], [Name], [PermissionLevel]
FROM [YourConnection].[Information].[Bases]
```

### List tables in a base

```sql
SELECT [Id], [Name], [Description], [PrimaryFieldId]
FROM [YourConnection].[Information].[Tables]
WHERE [BaseName] = 'Project tracker'
```

### Query records from a base table

```sql
SELECT [Name], [Status], [Due date], [Budget]
FROM [YourConnection].[Project tracker].[👀 Overview]
WHERE [CreatedTime] >= '2025-01-01'
ORDER BY [CreatedTime]
LIMIT 100
```

### Filter on an expanded collaborator field

```sql
SELECT [Name], [Status], [Project lead.Email]
FROM [YourConnection].[Project tracker].[👀 Overview]
WHERE [Project lead.Email] = 'lead@example.com'
```

### Use a saved view (pre-filtered/sorted)

```sql
-- The view name contains a dot and is one bracketed identifier
SELECT *
FROM [YourConnection].[Project tracker].[👀 Overview.3. Review project deadlines]
```

### Get attachment file URLs for a table

```sql
SELECT [RowId], [ColumnName], [FileName], [Type], [Size], [URL]
FROM [YourConnection].[Project tracker].[👀 Overview_Attachments]
```

### Read comments on a record

```sql
SELECT [CreatedTime], [AuthorName], [Text], [ParentCommentId]
FROM [YourConnection].[Project tracker].[Comments]
WHERE [TableName] = '👀 Overview'
  AND [RecordId] = '<record-internal-id>'
ORDER BY [CreatedTime]
```

## Stored Procedures

Airtable stored procedures live in the **base** schema (set `schemaName` to the base name when calling). Discover them with `getProcedures` per base; parameters via `getProcedureParameters`.

### UploadAttachment — not currently usable in cloud

`UploadAttachment` accepts `LocalPath` (server-side disk path, unavailable in cloud), `InputStream` (Java `InputStream`, unable to pass through the MCP interface), or `FileData` (a base64 string). Although the `FileData` parameter looks like a cloud-compatible path, the upload still requires server-side disk access, so the procedure does not work in cloud regardless of how the file is supplied. Treat file uploads as a current limitation — do not invent parameter names the driver does not accept. Support for file uploads via stored procedures is planned — check for updates if this capability is needed.

### DownloadAttachment — cloud-compatible

Downloads an attachment's content. **In cloud Connect AI, omit `LocalPath` (server-side disk path) and `FileStream` (a Java output stream)** — the procedure then returns the file as a base64 string in a `FileData` result column (alongside `Success` and `Details`).

```json
{
  "catalogName": "YourConnection",
  "schemaName": "Project tracker",
  "procedureName": "DownloadAttachment",
  "parameters": {
    "@SchemaIdentifier": "Project tracker",
    "@TableIdentifier": "👀 Overview",
    "@AttachmentId": "<attachment-id>"
  }
}
```

Result columns: `FileData` (base64 content), `Success`, `Details`. Decode `FileData` to recover the file.

Get the `<attachment-id>` from the table's `[T_Attachments]` view (the attachment id is its `Internal_Id`):

```sql
SELECT [Internal_Id] AS AttachmentId, [FileName], [Type], [URL]
FROM [YourConnection].[Project tracker].[👀 Overview_Attachments]
WHERE [RowId] = '<record-internal-id>'
```

For a quick link without decoding base64, `[T_Attachments].[URL]` is itself a direct download URL you can use instead of the procedure.

### SyncCSV — niche; not currently usable in cloud

Syncs raw CSV into a Sync API table. Requires a pre-existing Sync API table and its `SyncId` (from Airtable's sync-table setup flow), so it applies only to that specific Airtable feature. Its file inputs mirror `UploadAttachment` — `LocalPath` (disk), `InputStream`, or `FileData` (base64) — and it shares the same limitation: the sync path requires server-side disk access, so it is not currently usable in cloud. Support for file-based stored procedures is planned — check for updates if this capability is needed.

## Write Operations

Base record tables support INSERT, UPDATE, and DELETE where the connection and your Airtable `PermissionLevel` allow it. The `Information` schema is read-only.

### Insert a record

```sql
INSERT INTO [YourConnection].[Project tracker].[👀 Overview]
([Name], [Status], [Due date], [Budget])
VALUES
('New initiative', 'In progress', '2025-12-01', 25000)
```

### Update a record (target `Internal_Id`)

```sql
UPDATE [YourConnection].[Project tracker].[👀 Overview]
SET [Status] = 'Complete'
WHERE [Internal_Id] = '<record-internal-id>'
```

### Delete a record

```sql
DELETE FROM [YourConnection].[Project tracker].[👀 Overview]
WHERE [Internal_Id] = '<record-internal-id>'
```

### Add a comment to a record

```sql
INSERT INTO [YourConnection].[Project tracker].[Comments]
([TableName], [RecordId], [Text])
VALUES
('👀 Overview', '<record-internal-id>', 'Reviewed — looks good to me')
```

If writes are blocked, check (1) the Connect AI connection's readonly setting (CData side) and (2) your Airtable `PermissionLevel` on the base (`[Information].[Bases].[PermissionLevel]` — needs `edit` or `create`).

## Airtable-Specific Conventions

- **There is no `[Airtable]` schema.** Metadata is `[Information]`; records are `[<BaseName>]`. The base name *is* the schema name.
- **Bracket-quote everything.** Base, table, view, and column names routinely contain spaces, commas, emojis, and dots — e.g. `[📝 Tasks, timelines, and assignees]`. Unquoted names will fail.
- **Saved views are queryable as `[Table.<view name>]`.** The dot is part of a single identifier (not a schema/table separator) — bracket the whole string. Views are read-only and carry the saved view's filters/sorts.
- **Rich fields expand into dotted sub-columns.** Collaborator fields become `[Field.Email]`, `[Field.Name]`, etc.; attachments also surface via the `[Table_Attachments]` view. Run `getColumns` first to see the real expanded names.
- **`Internal_Id` is the row primary key.** Use it (not a user field) in UPDATE/DELETE WHERE clauses; it is the Airtable record id.
- **`CreatedTime` is a system column** present on record tables — use it for date filtering. Prefer explicit date literals (`'2025-01-01'`) over `DATEADD()` for performance.
- **Schemas are per base.** Switching bases means switching the schema segment; there is no cross-base table. Use `[Information].[Tables]` to locate a table's `BaseName` first.
- **`Comments` requires a `TableName` filter on reads.** Querying `[BaseName].[Comments]` without `WHERE [TableName] = '...'` fails with a required-value error. If you hit this error, retry with a `[TableName]` filter set to the target table name. Optionally add `[RecordId]` to scope to a single record. Writes (INSERT) also require `TableName` and `RecordId` as column values.
- **Attachment reads work in cloud; file writes do not.** `DownloadAttachment` returns the file as base64 in a `FileData` column when `LocalPath`/`FileStream` are omitted (or read `[Table_Attachments].[URL]` for a direct link). `UploadAttachment` and `SyncCSV` require server-side disk access and do not work in cloud — even via their `FileData` base64 parameter. Treat file upload/sync as a current limitation.
- **`DisplayObjectIds` connection property** controls whether tables/fields are referenced by display name or by Airtable id. If name-based references are not resolving, the connection may be configured for ids (and vice versa).
- **Single-select and multi-select fields reject unknown values.** Airtable validates that INSERT/UPDATE values for select-type fields match a pre-configured option exactly. If you get an `INVALID_MULTIPLE_CHOICE_OPTIONS` or `INVALID_SELECT_OPTION` error, query the table for `SELECT DISTINCT [FieldName]` to discover the valid options, then retry with an exact match. Do not guess option names — they are tenant-configured and may not match common labels (e.g. the valid status might be `Monitoring/Complete` rather than `Complete`).
