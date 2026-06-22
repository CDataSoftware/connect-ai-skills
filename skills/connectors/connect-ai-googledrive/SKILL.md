---
name: connect-ai-googledrive
description: Use when querying Google Drive data through CData Connect AI. Covers the Google Drive data model (Files as the central files+folders table, type views, Permissions, Comments, Revisions, Drives), file-content access via stored procedures (download as base64, Google Docs text), the upload/move/trash lifecycle, and Google Drive-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: GoogleDrive
  family: files
---

# CData Connect AI — Google Drive Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Google Drive-specific guidance for querying Google Drive data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the GoogleDrive driver. Do not call `getInstructions` for Google Drive — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Google Drive connection via `getCatalogs`.

## Schema

Google Drive is a single-schema driver. The schema name is `GoogleDrive`.

```sql
SELECT [Id], [Name], [MIMEType], [ModifiedTime]
FROM [YourConnection].[GoogleDrive].[Files]
WHERE [Name] LIKE '%report%'
LIMIT 50
```

## What this connector can and can't do

- **Can:** list files/folders and their metadata with SQL; read the text of Google Docs (`GetDocumentContent`); download any file as base64 (`DownloadFile`); create/copy/move/trash files and folders and manage sharing via stored procedures and table writes.
- **Can't (directly):** read the *contents* of non-Google-Docs files (CSV, Excel, PDF, images, JSON, …) through SQL. To use a file's content, either **download it** with `DownloadFile` and attach the result, or — for structured data files (CSV/Excel/JSON/XML) — point a **dedicated CData Connect AI connection** at that file type so the data is queryable without downloading.

## Query Process

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'GoogleDrive'`.
2. **Find the file or folder** — query `Files` by `Name` (use `LIKE`), and narrow with `ModifiedTime`, `OwnerEmail`, `Starred`, `ParentIds` (folder), or `Folder` (true = folder, false = file). Always include a filter — large Drives time out on unfiltered scans.
3. **Get the `Id`** from the result.
4. **Access content** (if needed) — **check `MIMEType` first** to choose the right procedure:
   - `application/vnd.google-apps.document` → `GetDocumentContent` (returns the doc as JSON; extract the text). **Only use this for Google Docs** — it returns empty/failure on all other file types.
   - Any other MIMEType → `DownloadFile` with `@Encoding = 'BASE64'` (returns base64 you decode). This includes PDFs, Office files, images, text files, Google Sheets, Google Slides, etc.
5. **Act** — create/copy/move/trash files and folders, or manage sharing, via the stored procedures and table writes below.

## Data Model

### Files — the central table

`Files` holds **both files and folders** (and shortcuts). The `Folder` boolean distinguishes them (`true` = folder). It is a very wide table (~115 columns): core metadata, a large `Can*` capability/permission family, checksums, links, and media metadata. Use `getColumns` to see the full set.

Folder membership is expressed by `ParentIds` (the parent folder id). `ParentIds` is **read-only on the table** — change it with the `MoveResource` procedure, not UPDATE.

### Type-specific views (read-only)

These are filtered views over the same underlying file objects:

- **Folders** — folders only
- **Docs** — Google Docs. **Note:** this view also returns plain-text files (e.g. `.txt`) and has no `MIMEType` column to filter on; if you need only true Google Docs, query the `Files` table with `WHERE [MIMEType] = 'application/vnd.google-apps.document'` instead of using this view.
- **Sheets** — Google Sheets
- **Photos** — image files
- **Videos** — video files
- **Activities** — activity history on files/folders/drives

### Other tables

- **Permissions** — sharing/ACL entries per file or folder (role, type, email/domain). Writable.
- **Comments** / **Replies** — comments on a file and their threaded replies
- **Revisions** — per-file revision metadata
- **Drives** — shared drives (create/delete/query)

### Key Relationships

- File → parent folder: `Files.[ParentIds]` references a folder's `Files.[Id]`.
- Permission → resource: `Permissions.[ResourceId]` references `Files.[Id]`.
- Comment → file, Reply → comment, Revision → file: each keyed by the file id.
- Shortcut → target: `Files.[ShortcutTargetId]` points to the real file/folder a shortcut references.

## Important Columns

### Files
- `Id` — Drive file/folder identifier (PK)
- `Name` — display name (not unique within a folder; filter with `LIKE`)
- `Folder` — BOOLEAN; `true` = folder, `false` = file
- `MIMEType` — e.g. `application/pdf`, `image/jpeg`, `application/vnd.google-apps.document` (Google Doc), `…spreadsheet` (Sheet), `…shortcut`
- `Extension` / `FileExtension` — file extension(s)
- `Size` — bytes (null for folders and native Google Workspace files)
- `ParentIds` — parent folder id (**read-only — change via `MoveResource`**)
- `DriveId` — containing personal or shared drive
- `Description` — user description (writable)
- `CreatedTime`, `ModifiedTime` — timestamps (use for date filters)
- `OwnerName`, `OwnerEmail` — owner identity
- `LastModifiedByName`, `LastModifiedByEmail` — last editor (only when a signed-in user)
- `Starred`, `Trashed`, `Viewed` — BOOLEAN status flags (`Starred`/`Trashed` writable)
- `IsShared`, `IsOwnedByMe` — sharing/ownership flags
- `WebViewLink` — open in browser; `WebContentLink` — direct download link; `ExportLinks` — export-format URLs for Workspace files
- `MD5Checksum`, `SHA1Checksum`, `SHA256Checksum`, `Version`, `HeadRevisionId` — integrity/version
- `ShortcutTargetId`, `ShortcutTargetMIMEType` — for shortcut entries
- `Can*` family (e.g. `CanEdit`, `CanShare`, `CanDownload`, `CanDelete`) — the current user's capabilities on the item
- `Query` — a pseudo-column that accepts a raw Google Drive SDK query string and **overrides** the WHERE clause (advanced)

### Folders (view)
- `Id`, `Name`, `Description`, `ParentIds`
- `CreatedTime`, `ModifiedTime`
- `OwnerEmail`, `OwnerName`, `IsShared`
- `FolderColorRGB`, `WebViewLink`
(The `Folders` view exposes the folder-relevant subset of `Files`; `Size` is not meaningful for folders.)

### Permissions
- `PermissionId` — permission entry id (PK)
- `ResourceId` — the file/folder the permission applies to (key)
- `Role` — `READER`, `COMMENTER`, `WRITER`, `OWNER`, `FILE_ORGANIZER`, `ORGANIZER`
- `Type` — `USER`, `GROUP`, `DOMAIN`, `ANYONE`
- `EmailAddress` — user/group email (for `USER`/`GROUP`)
- `Domain` — domain (for `DOMAIN`)
- `AllowFileDiscovery` — whether the item is discoverable via search (for `DOMAIN`/`ANYONE`)

## Common Query Patterns

### Recently modified files

```sql
SELECT [Id], [Name], [MIMEType], [ModifiedTime], [OwnerEmail]
FROM [YourConnection].[GoogleDrive].[Files]
WHERE [Folder] = false
  AND [ModifiedTime] >= '2025-01-01'
ORDER BY [ModifiedTime] DESC
LIMIT 100
```

### Find a file by name

```sql
SELECT [Id], [Name], [MIMEType], [Size], [ParentIds]
FROM [YourConnection].[GoogleDrive].[Files]
WHERE [Name] LIKE '%budget%'
```

### Files inside a specific folder

```sql
SELECT [Id], [Name], [MIMEType], [ModifiedTime]
FROM [YourConnection].[GoogleDrive].[Files]
WHERE [ParentIds] = '<folder-id>'
ORDER BY [Name]
```

### Folders only

```sql
SELECT [Id], [Name], [ParentIds], [ModifiedTime]
FROM [YourConnection].[GoogleDrive].[Folders]
ORDER BY [Name]
```

### A user's starred files

```sql
SELECT [Id], [Name], [MIMEType], [ModifiedTime]
FROM [YourConnection].[GoogleDrive].[Files]
WHERE [OwnerEmail] = 'user@example.com'
  AND [Starred] = true
```

### Who can access a file

```sql
SELECT [PermissionId], [Role], [Type], [EmailAddress], [Domain]
FROM [YourConnection].[GoogleDrive].[Permissions]
WHERE [ResourceId] = '<file-id>'
```

## Stored Procedures

Google Drive exposes ~21 procedures. Discover them with `getProcedures` and inspect parameters with `getProcedureParameters`. The most useful:

### DownloadFile — download any file as base64

**Cloud-compatible call shape** — omit `LocalFile` (server-side disk path) and `FileStream` (output stream), and set `@Encoding = 'BASE64'`; the response returns the file content as base64 in a `FileData` column (with a `Success` column). Decode `FileData` to recover the file.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleDrive",
  "procedureName": "DownloadFile",
  "parameters": {
    "@Id": "<file-id>",
    "@Encoding": "BASE64"
  }
}
```

For Google Workspace files (Docs/Sheets/Slides), set `@FileFormat` to export — e.g. `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Use `@RevisionId` to download a specific revision.

### GetDocumentContent — Google Docs text

Returns the document as Google Docs API **JSON** in a `Content` column (not plain text). Extract readable text from `body.content[].paragraph.elements[].textRun.content`.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleDrive",
  "procedureName": "GetDocumentContent",
  "parameters": {
    "@Id": "<google-doc-id>"
  }
}
```

### UploadFile — add or update a file

**Cloud-compatible call shape** — supply the content as base64 via `@FileData` with `@Encoding = 'BASE64'` (the default). Do not use `@LocalFile` (disk path) or `@Content` (InputStream), which don't work through the MCP interface. Pass `@Id` to update an existing file's content; omit it to create a new one. `@ParentIds` places the file in a folder; `@MIMEType` is auto-detected if omitted.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleDrive",
  "procedureName": "UploadFile",
  "parameters": {
    "@Name": "notes.txt",
    "@FileData": "SGVsbG8gd29ybGQ=",
    "@Encoding": "BASE64",
    "@ParentIds": "<folder-id>"
  }
}
```

### Folder & resource lifecycle

- **CreateFolder** — new folder (`@Name`, optional parent)
- **CopyResource** — duplicate a file/folder to a destination
- **CreateShortcut** — shortcut pointing at an existing file/folder
- **MoveResource** — change an item's parent folder (this is how you "move" — `ParentIds` is read-only on the table). Parameters: `@Id` (required, the file/folder to move) and `@ParentIds` (required, the destination folder id).

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleDrive",
  "procedureName": "MoveResource",
  "parameters": {
    "@Id": "<file-or-folder-id>",
    "@ParentIds": "<destination-folder-id>"
  }
}
```
- **MoveToTrash** / **RestoreFromTrash** / **DeleteResource** / **EmptyTrash** — trash lifecycle (`DeleteResource` permanently deletes if already trashed)
- **UpdateResource** — modify metadata/content/sharing
- **LockFile** / **UnlockFile** — toggle read-only restriction
- **GetInfo** / **GetAuthenticatedUserInfo** — drive/user details

### Not usable through Connect AI MCP

`SubscribeToFileChanges`, `SubscribeToUserChanges`, and `StopWatchingResources` register/cancel push-notification (webhook) channels — they need a publicly reachable callback and return no queryable data, so they aren't useful in an interactive MCP session.

## Write Operations

- **Metadata edits** — `UPDATE` the `Files` table for writable fields (`Name`, `Description`, `Starred`, `Trashed`, `WritersCanShare`, etc.).
- **File content / new files** — use `UploadFile` (base64), not table INSERT.
- **Moving** — use `MoveResource` (`ParentIds` is read-only).
- **Deleting** — `MoveToTrash` (recoverable) or `DeleteResource` (permanent); or `DELETE` on `Files`.
- **Sharing** — INSERT/UPDATE/DELETE on `Permissions` (set `Role`, `Type`, `EmailAddress`/`Domain`).

If writes are blocked, the Connect AI connection may be in readonly mode — guide the user to enable write access in the connection settings.

## Google Drive-Specific Conventions

- **`Files` contains both files and folders.** Filter with `[Folder] = true/false`. The `Folders`, `Docs`, `Sheets`, `Photos`, and `Videos` tables are read-only type-filtered views over the same objects.
- **You can't read non-Google-Docs file *contents* via SQL.** Download the file with `DownloadFile` (base64), or use a dedicated CData connection for CSV/Excel/JSON/XML data files. Only Google Docs expose text directly (`GetDocumentContent`).
- **`DownloadFile` returns base64 in a `FileData` column** when `LocalFile`/`FileStream` are omitted and `@Encoding=BASE64`. For Google Workspace files, set `@FileFormat` to export to PDF/DOCX/plain text.
- **`GetDocumentContent` is only for Google Docs** (`MIMEType = 'application/vnd.google-apps.document'`). It returns Google Docs API JSON, not plain text — parse `textRun.content` for the readable text. On any other file type it returns empty content with `Success=false`. For non-Google-Docs files, use `DownloadFile` instead.
- **`ParentIds` is read-only** — use `MoveResource` to move an item between folders; the table won't accept an UPDATE to `ParentIds`.
- **Date filters are essential** — large Drives time out without a `ModifiedTime`/`CreatedTime` (or other) filter. Prefer explicit date literals (`'2025-01-01'`) over `DATEADD()`.
- **Booleans use `true`/`false` (or `1`/`0`)** — e.g. `[Starred] = true`, `[Folder] = false`, `[Trashed] = false`.
- **The `Files` table is very wide (~115 columns)**, including a large `Can*` capability family (`CanEdit`, `CanShare`, `CanDownload`, …). Select only what you need and run `getColumns` to discover fields.
- **`Query` pseudo-column** lets you pass a raw Google Drive SDK query that overrides the WHERE clause — useful for Drive-native filters the SQL layer doesn't expose, but bypasses normal WHERE handling.
- **Shortcuts are real rows** with `MIMEType = 'application/vnd.google-apps.shortcut'`; follow `ShortcutTargetId` to the actual item.
