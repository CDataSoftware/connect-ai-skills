---
name: connect-ai-googlesheets
description: Use when querying Google Sheets data through CData Connect AI. Covers the Google Sheets data model (Spreadsheets and Sheets metadata, dynamic per-sheet data tables), the spreadsheet→sheet→data query flow, the create-spreadsheet/add-sheet/insert workflow, stored procedures, and Google Sheets-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: GoogleSheets
  family: collaboration
---

# CData Connect AI — Google Sheets Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Google Sheets-specific guidance for querying Google Sheets data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Google Sheets driver. Do not call `getInstructions` for Google Sheets — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Google Sheets connection via `getCatalogs`.

## Schema

Google Sheets is a single-schema driver. The schema name is `GoogleSheets`.

Use the three-part name `[Catalog].[Schema].[Table]`, where the catalog is the connection name:

```sql
SELECT * FROM [GoogleSheets_DB].[GoogleSheets].[Spreadsheets]
```

## Query Process

Google Sheets data is organized as spreadsheets → sheets → cell data. Work down that hierarchy:

1. **Identify the spreadsheet.** If you know the spreadsheet or sheet name, call `getTables` with a `tableName` filter (e.g. `%budget%`) to find the matching data tables directly. If you don't, query the `Spreadsheets` table first, filtering on `ModifiedTime` or `OwnerEmail` to narrow the list rather than returning everything.
2. **Explore the sheets within it.** Query the `Sheets` table filtered by `SpreadsheetId` to see the worksheets, their dimensions, and their names.
3. **Query the sheet's data.** Each worksheet is exposed as its own data table named `[SpreadsheetName_SheetName]`. Run `getColumns` on that table first — its columns come from the sheet's header row and are not knowable in advance — then query the data.

## Data Model

### Key Tables

- **Spreadsheets** — metadata for every Google Sheets document the connected user can access (one row per spreadsheet). Read-only.
- **Sheets** — one row per worksheet (tab) across all accessible spreadsheets, with dimensions and properties. Read-only.
- **Folders** — the Google Drive folder structure containing the spreadsheets.
- **`[SpreadsheetName_SheetName]`** — dynamic data tables. `getTables` returns one of these for every worksheet in every accessible spreadsheet, presented as a flat list alongside the metadata tables. These hold the actual cell data and are where reads and writes of sheet content happen.

### Key Relationships

- `Sheets.SpreadsheetId` → `Spreadsheets.Id` — each sheet belongs to one spreadsheet.
- `Spreadsheets.ParentIds` → `Folders.Id` — a spreadsheet's parent folders (comma-separated list).
- A `[SpreadsheetName_SheetName]` data table corresponds to one row in `Sheets` (its `SpreadsheetName` + `SheetName`).

## Important Columns

### Spreadsheets

- **Id** — unique spreadsheet identifier (primary key); used as the `Id` argument to the spreadsheet stored procedures.
- **Name** — display name of the spreadsheet.
- **Description** — short description.
- **OwnerName**, **OwnerEmail** — the owner's name and email.
- **ModifiedTime**, **CreatedTime** — last-modified and creation timestamps (TIMESTAMP); use these for time-based filtering.
- **Trashed** — whether the spreadsheet is in the trash (BOOLEAN).
- **Starred**, **Viewed** — whether the user has starred / viewed it (BOOLEAN).
- **ParentIds** — comma-separated list of parent folder Ids.

### Sheets

- **SpreadsheetId**, **SpreadsheetName** — the parent spreadsheet's Id and name.
- **SheetId** — identifier for the worksheet within the spreadsheet.
- **SheetName** — display name of the worksheet.
- **SheetIndex** — zero-based position of the sheet within the spreadsheet.
- **SheetType** — sheet type; defaults to `GRID`.
- **RowCount**, **ColumnCount** — grid dimensions (INTEGER).
- **FrozenRowCount**, **FrozenColumnCount** — frozen rows/columns (INTEGER).
- **Hidden** — whether the sheet is hidden in the UI (BOOLEAN).

### `[SpreadsheetName_SheetName]` data tables

- **id** — auto-generated primary key, present when the driver can derive one.
- Remaining columns come from the sheet's header row. Always run `getColumns` before querying — column names, spaces, and special characters vary per sheet.

## Common Query Patterns

### Recently modified spreadsheets

```sql
SELECT [Id], [Name], [ModifiedTime], [OwnerEmail]
FROM [GoogleSheets_DB].[GoogleSheets].[Spreadsheets]
WHERE [ModifiedTime] >= '2026-01-01'
ORDER BY [ModifiedTime] DESC
```

### Spreadsheets by owner

```sql
SELECT [Id], [Name], [OwnerName], [OwnerEmail]
FROM [GoogleSheets_DB].[GoogleSheets].[Spreadsheets]
WHERE [OwnerEmail] = 'user@example.com'
```

### Sheets within a specific spreadsheet

```sql
SELECT [SheetId], [SheetName], [RowCount], [ColumnCount]
FROM [GoogleSheets_DB].[GoogleSheets].[Sheets]
WHERE [SpreadsheetId] = '<spreadsheet-id>'
ORDER BY [SheetIndex]
```

### Data from a specific sheet

The data table is named `[SpreadsheetName_SheetName]`. Run `getColumns` first to confirm the column names (they come from the header row), then query:

```sql
SELECT *
FROM [GoogleSheets_DB].[GoogleSheets].[Engineering OKR_Sheet1]
WHERE [Progress %] < 50
ORDER BY [Progress %] ASC
```

## Stored Procedures

Call these with `executeProcedure`. Parameter names are passed with an `@` prefix (e.g. `@Title`).

### CreateSpreadsheet
Creates a new spreadsheet in the user's Google Drive. Returns the new spreadsheet Id.

```json
{
  "procedure": "CreateSpreadsheet",
  "parameters": { "@Title": "New Spreadsheet" }
}
```
Optional: `@Description`, `@Starred`, `@Hidden`, `@Restricted`, `@Parents` (parent folder Ids).

### AddSheet
Adds a worksheet to an existing spreadsheet. Supply `@HeaderNames` so the new sheet has a header row you can insert against afterward. `@SheetId` must be a non-negative integer and cannot be changed once set.

```json
{
  "procedure": "AddSheet",
  "parameters": {
    "@SpreadsheetId": "<spreadsheet-id>",
    "@SheetId": "1",
    "@Title": "New Sheet",
    "@HeaderNames": "Header1,Header2,Header3"
  }
}
```
Enclose a header in double quotes inside `@HeaderNames` if it contains special characters. Optional: `@Index`, `@RowCount`, `@ColumnCount`, `@FrozenRowCount`, `@FrozenColumnCount`, `@Hidden`, `@HideGridlines`, `@RightToLeft`.

### UpdateSheet
Updates properties of an existing **worksheet/tab** — `@Title` (the tab's name), dimensions, frozen rows/columns, visibility — identified by `@SpreadsheetId` and `@SheetId` (both required). `@Title` renames the *tab*, not the spreadsheet document. There is no procedure to rename a spreadsheet: the `Spreadsheets` table is read-only, so set a spreadsheet's name at creation via `CreateSpreadsheet @Title`, or rename it in the Google Sheets UI.

### CopySheet
Copies a sheet from one spreadsheet into another.

### DeleteSheet
Deletes a worksheet from a spreadsheet (by `@SpreadsheetId` and `@SheetId`).

### DeleteSpreadsheet
Deletes an entire spreadsheet by its Id.

### FormatRange
Applies cell formatting to a specified range within a sheet.

### AddDataSource / AddDataSourceTable
Attach a BigQuery data source (and data-source-backed table) to a spreadsheet. These require a custom OAuth app with the `bigquery.readonly` scope and are only relevant for BigQuery-connected sheets.

### DownloadDocument — Not currently supported in cloud

`DownloadDocument` returns the exported file via `LocalFile` (server-side disk path, unavailable in cloud) or `FileStream` (Java `OutputStream`, unable to pass through the MCP interface). It also exposes an `Encoding` (base64) retrieval path, but that path is **not functional in the cloud either** — do not attempt it as a workaround, and do not invent parameter names the driver does not accept. Treat document download as a current limitation: to read a spreadsheet's contents, query its data tables directly, or download it from the Google Sheets UI. Support for file downloads via stored procedures is planned — check for updates if this capability is needed.

### UploadDocument — Not currently supported in cloud

`UploadDocument` accepts `LocalFile` (server-side disk path, unavailable in cloud) or `Content` (Java `InputStream`, unable to pass through the MCP interface). It also accepts a base64 string via `FileData` + `Encoding`, but that path is **not functional in the cloud either** — do not attempt it as a workaround, and do not invent parameter names the driver does not accept. Treat file uploads as a current limitation. To build a spreadsheet from scratch, use `CreateSpreadsheet` + `AddSheet` + INSERT (see Write Operations) instead. Support for file uploads via stored procedures is planned — check for updates if this capability is needed.

## Write Operations

Write spreadsheet content by inserting and updating rows on the `[SpreadsheetName_SheetName]` data tables. Run `getColumns` first so you reference the sheet's real header columns.

```sql
INSERT INTO [GoogleSheets_DB].[GoogleSheets].[Engineering OKR_Sheet1] ([Objective], [Owner], [Progress %])
VALUES ('Ship v2', 'A. Patel', '40')
```

```sql
-- Preferred: target the derived [id] for a deterministic single-row update
UPDATE [GoogleSheets_DB].[GoogleSheets].[Engineering OKR_Sheet1]
SET [Progress %] = '75'
WHERE [id] = 4
```

Key UPDATE and DELETE statements on the derived `[id]` column when the data table has one — this matches the driver's documented `WHERE Id = <expression>` grammar and affects exactly one row. A `WHERE` clause on a non-key column is accepted but updates *every* row whose value matches (e.g. `WHERE [Name] = 'Smoke Test'` updates all rows named "Smoke Test"). When the driver derived no `id` for the sheet, there is no guaranteed single-row key, so scope the filter deliberately. Parameterize values with `@param` (or `?`) and pass them as strings for VARCHAR cells.

To build a new spreadsheet end to end: call `CreateSpreadsheet`, then `AddSheet` (with `@HeaderNames` to lay down the header row), then INSERT into the resulting `[SpreadsheetName_SheetName]` data table.

Write access is governed by the connection's mode in Connect AI. If inserts, updates, or write stored procedures are rejected, the connection is likely set to read-only — have the user enable write access in the Connect AI connection settings.

## Google Sheets-Specific Conventions

- **Data tables are dynamic and per-sheet.** Every worksheet becomes its own table named `[SpreadsheetName_SheetName]`. `getTables` returns these as a flat list mixed in with the `Spreadsheets`, `Sheets`, and `Folders` metadata tables.
- **Always `getColumns` a data table before querying it.** Its columns derive from the sheet's header row, so they are unknown until inspected and differ from sheet to sheet.
- **Special characters in names are replaced.** When spreadsheet or sheet names contain characters that aren't SQL-safe, they are substituted (typically with underscores) in the table name.
- **Bracket every identifier.** Spreadsheet, sheet, and column names routinely contain spaces and symbols (e.g. `[Progress %]`); always wrap them in `[ ]`.
- **Column data types default to VARCHAR.** Sheet cell columns are typically untyped text. Be deliberate about numeric and date comparisons, and pass values as strings in INSERT/UPDATE.
- **Primary keys are not guaranteed.** A data table only has an `id` primary key when the driver can derive one; many sheets have none.
- **Preview before pulling full sheets.** Use `LIMIT` to sample large sheets before running unbounded queries.
- **Metadata tables are read-only.** `Spreadsheets` and `Sheets` cannot be written to — manage spreadsheets and sheets through the stored procedures, and write cell data through the data tables.
