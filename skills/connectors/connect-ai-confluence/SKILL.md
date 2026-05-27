---
name: connect-ai-confluence
description: Use when querying Confluence data through CData Connect AI. Covers the Confluence data model (spaces, pages, comments, attachments, users), the space → page → refine query workflow, page-version history, image/attachment retrieval via base64, and Confluence-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: Confluence
  family: knowledge
---

# CData Connect AI — Confluence Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Confluence-specific guidance for querying Confluence data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Confluence driver. Do not call `getInstructions` for Confluence — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Confluence connection via `getCatalogs`.

## Schema

Confluence is a single-schema driver. The schema name is `Confluence`.

```sql
SELECT * FROM [YourConnection].[Confluence].[Spaces] LIMIT 10
```

## Query Process

Most Confluence questions follow a natural drill-down: find the space, locate the pages, then refine by date, author, or content. Page IDs and space keys do most of the routing work, and the `Storage` column on `Pages` carries the actual page body.

### Step 1: Identify the Space

Locate the space the user is interested in. Space keys and display names often differ, so use a `LIKE` filter on `Name` when you don't know the exact key.

```sql
SELECT [Key], [Id], [Name], [Type]
FROM [YourConnection].[Confluence].[Spaces]
WHERE [Name] LIKE '%<space-name>%'
```

To list all spaces:

```sql
SELECT [Key], [Id], [Name], [Type], [CreatedDate]
FROM [YourConnection].[Confluence].[Spaces]
```

### Step 2: Identify Pages in the Space

Once you have the `SpaceKey`, query pages directly. Always filter by `SpaceKey` — the `Pages` table can be very large.

```sql
SELECT [Id], [Title], [CreatedDate], [LastUpdatedDatetime]
FROM [YourConnection].[Confluence].[Pages]
WHERE [SpaceKey] = '<space-key>'
```

### Step 3: Refine with Filters

Apply additional filters on date, owner, or status to narrow down to the pages of interest.

```sql
SELECT [Id], [Title], [CreatedDate], [LastUpdatedDatetime], [CreatedByUserName]
FROM [YourConnection].[Confluence].[Pages]
WHERE [SpaceKey] = '<space-key>'
  AND [CreatedDate] >= '2025-01-01'
ORDER BY [LastUpdatedDatetime] DESC
```

### Step 4: Pull Body, Comments, or Attachments

When you need the page body, fetch the `Storage` column. For comments or attachments, join via the page `Id`.

```sql
SELECT [Id], [Title], [Storage], [URL]
FROM [YourConnection].[Confluence].[Pages]
WHERE [Id] = '<page-id>'
```

## Data Model

### Key Tables

- **Spaces** — Organizational containers for pages. Each space has a `Key` (used in URLs and as the foreign key from `Pages.SpaceKey`) and an internal `Id`.
- **Pages** — Main content. Holds the page body as storage-format XHTML in the `Storage` column, plus metadata, hierarchy (`ParentId`), and version info.
- **Comments** — Comments on pages, blog posts, and attachments. Linked to their parent via `SpaceKey` and a container reference.
- **Attachments** — Files attached to pages (images, PDFs, documents). `ContainerId` references the page.
- **Users** — User account information and profiles.

### Key Relationships

- Pages → Spaces: `Pages.SpaceKey` = `Spaces.Key` (note: spaces have both `Key` and `Id` — pages join on `Key`)
- Pages → Pages: `Pages.ParentId` = `Pages.Id` (for page hierarchy)
- Attachments → Pages: `Attachments.ContainerId` = `Pages.Id`
- Comments → Spaces: `Comments.SpaceKey` = `Spaces.Key`

### Page Body Format

The `Pages.Storage` column contains Confluence's storage format — XHTML with custom `<ac:*>` macro tags. Embedded images appear as `<ac:image>` tags that reference attachment IDs and do not render directly. To retrieve the actual image bytes, see the **Retrieving Page Images** pattern in Common Query Patterns.

## Important Columns

### Spaces

- `Key` — Unique space key (used in URLs and as the foreign key from `Pages.SpaceKey`)
- `Id` — Internal space identifier
- `Name` — Display name (may differ from `Key`)
- `Type` — `personal`, `team`, `global`, etc.
- `Description` — Space description
- `Url` — Direct space URL
- `CreatedDate` / `LastModified` — Timestamps

### Pages

- `Id` — Unique page identifier
- `Title` — Page title
- `Type` — Content type (`page`, `blogpost`, etc.)
- `Status` — Page status
- `Storage` — Page body in storage format (XHTML with `<ac:*>` tags)
- `AtlasDocFormat` — Page body in Atlas Doc Format (alternative to `Storage`)
- `SpaceKey` / `SpaceId` / `SpaceType` — Containing space (note: there is no `SpaceName` column on Pages — join to `Spaces.Name` via `SpaceKey = Spaces.Key` when you need the display name)
- `ParentId` — Parent page ID for hierarchy (BIGINT)
- `OwnerId` — Page owner
- `URL` — Direct page URL
- `CreatedDate` / `CreatedByUserName` — Creation metadata (`CreatedByUserName` is NOT deprecated on Pages)
- `LastUpdatedDatetime` / `LastUpdatedMessage` — Last-update metadata
- `LastUpdatedUserPublicName` / `LastUpdatedAccountId` — Last-update user (prefer these — `LastUpdatedUserName` is marked `[DEPRECATED]`)
- `VersionNumber` / `VersionDatetime` / `VersionMessage` / `VersionUserPublicName` / `VersionUserAccountId` — Version metadata (prefer `*UserPublicName` / `*AccountId` — `VersionUserName` is `[DEPRECATED]`)
- `PreviousVersionNumber` / `PreviousVersionDatetime` / `PreviousVersionUserPublicName` — Previous-version metadata (`PreviousVersionUserName` is `[DEPRECATED]`)
- `IsLatest` — Whether this row represents the latest version

### Comments

- `Id` — Unique comment identifier
- `Title` — Comment title/subject
- `Status` — Comment status
- `Excerpt` — Short text snippet (preview)
- `StorageBody` — Full comment body in storage format (note: column is `StorageBody` on Comments, not `Storage` like on Pages)
- `AtlasDocFormatBody` — Full body in Atlas Doc Format
- `ContainerId` / `ContainerType` — Parent content (page or blog post); use `ContainerId = <page-id>` to find comments on a specific page
- `SpaceKey` / `SpaceType` — Containing space (no `SpaceName` column — join to `Spaces.Name` via `SpaceKey = Spaces.Key` for the display name)
- `CreatedDate` — Creation timestamp
- `CreatedByUserPublicName` / `CreatedByAccountId` — Comment author (prefer these — `CreatedByUserName` is `[DEPRECATED]` on Comments)
- `LastUpdatedDatetime` / `LastUpdatedMessage` — Last-update metadata
- `LastUpdatedUserPublicName` / `LastUpdatedAccountId` — Last-update user (`LastUpdatedUserName` is `[DEPRECATED]`)

### Attachments

- `Id` — Unique attachment identifier (passed to `DownloadAttachment` as `AttachmentId`)
- `Title` — File name
- `MediaType` — MIME type (e.g., `image/png`, `application/pdf`)
- `DownloadLink` — Confluence-hosted link (requires Confluence auth — use `DownloadAttachment` to retrieve bytes through Connect AI)
- `ContainerId` — Parent page ID
- `SpaceKey` — Containing space
- `CreatedByUserName` / `CreatedDate` — Creation metadata

### Users

- `AccountId` — Unique account identifier
- `Email` — User email
- `DisplayName` — Name displayed in the Confluence UI
- `PublicName` — Full name

## Common Query Patterns

### Recently Updated Pages in a Space

```sql
SELECT [Id], [Title], [LastUpdatedDatetime], [LastUpdatedUserPublicName]
FROM [YourConnection].[Confluence].[Pages]
WHERE [SpaceKey] = '<space-key>'
  AND [LastUpdatedDatetime] >= '2025-01-01'
ORDER BY [LastUpdatedDatetime] DESC
LIMIT 25
```

### Active Spaces (by Recent Page Updates)

`Pages` has no `SpaceName` column — join to `Spaces` on `SpaceKey = Spaces.Key` to get the display name.

```sql
SELECT p.[SpaceKey], s.[Name] AS SpaceName, MAX(p.[LastUpdatedDatetime]) AS LastActivity
FROM [YourConnection].[Confluence].[Pages] p
INNER JOIN [YourConnection].[Confluence].[Spaces] s ON p.[SpaceKey] = s.[Key]
WHERE p.[LastUpdatedDatetime] >= '2025-01-01'
GROUP BY p.[SpaceKey], s.[Name]
ORDER BY LastActivity DESC
```

### Recent Comment Activity in a Space

```sql
SELECT [Title], [SpaceKey], [CreatedByUserPublicName], [CreatedDate], [LastUpdatedDatetime], [Excerpt]
FROM [YourConnection].[Confluence].[Comments]
WHERE [SpaceKey] = '<space-key>'
ORDER BY [LastUpdatedDatetime] DESC
LIMIT 10
```

### Version History for a Page

```sql
SELECT
    [Title],
    [VersionNumber],
    [VersionDatetime],
    [VersionUserPublicName],
    [VersionMessage],
    [LastUpdatedDatetime],
    [LastUpdatedUserPublicName],
    [LastUpdatedMessage],
    [IsLatest]
FROM [YourConnection].[Confluence].[Pages]
WHERE [SpaceKey] = '<space-key>'
  AND [Title] = '<page-title>'
ORDER BY [VersionNumber] DESC
```

### Page Hierarchy (Children of a Page)

```sql
SELECT [Id], [Title], [LastUpdatedDatetime]
FROM [YourConnection].[Confluence].[Pages]
WHERE [ParentId] = '<parent-page-id>'
ORDER BY [Title]
```

### Pages Created by a User

```sql
SELECT [Id], [Title], [SpaceKey], [CreatedDate]
FROM [YourConnection].[Confluence].[Pages]
WHERE [CreatedByUserName] = '<user-name>'
  AND [CreatedDate] >= '2025-01-01'
ORDER BY [CreatedDate] DESC
```

### Attachments on a Page

```sql
SELECT [Id], [Title], [MediaType], [CreatedByUserName], [CreatedDate]
FROM [YourConnection].[Confluence].[Attachments]
WHERE [ContainerId] = '<page-id>'
ORDER BY [CreatedDate] DESC
```

### Retrieving Page Images

When a page contains embedded images, the `Pages.Storage` column returns `<ac:image>` tags that reference attachments rather than the image bytes. Three steps to get the actual image:

1. Query the page to confirm the page exists and see the storage markup:

```sql
SELECT [Id], [Title], [Storage], [SpaceKey], [URL]
FROM [YourConnection].[Confluence].[Pages]
WHERE [Id] = '<page-id>'
```

2. Find the image's attachment ID:

```sql
SELECT [Id], [Title], [MediaType], [DownloadLink]
FROM [YourConnection].[Confluence].[Attachments]
WHERE [ContainerId] = '<page-id>'
  AND [MediaType] LIKE 'image/%'
```

3. Call `DownloadAttachment` to retrieve the bytes as base64 (see the Stored Procedures section).

## Stored Procedures

Parameter binding syntax may differ between the Confluence cai-toolkit and the generic Connect AI MCP. If a procedure call fails with a JDBC null-pointer error (`JDBCStatementImpl Cannot invoke String.startsWith because <local12> is null`), drop the `@` prefix and retry with bare-name parameters; the toolkit requires bare-name binding while the generic MCP requires `@`-prefixed names.

### DownloadAttachment

Downloads an attachment. Pass `Encoding=BASE64` to retrieve the file content as base64 directly through Connect AI. Do **not** pass `FileLocation` or `FileStream` — both require local disk or Java stream access that the MCP layer cannot satisfy.

```json
{
  "procedure": "DownloadAttachment",
  "parameters": {
    "Id": "<page-id>",
    "AttachmentId": "<attachment-id>",
    "Encoding": "BASE64"
  }
}
```

`Id` is the page (container) ID — fetch from `Attachments.ContainerId` or `Pages.Id`. `AttachmentId` is the attachment's own `Id` from the `Attachments` table (note: attachment IDs are prefixed `att`, e.g., `att507937155`). Both are required despite the parameter metadata showing `Id` as optional. Decode the base64 response to retrieve the original file content.

**Empirical note (Confluence driver 25.0.9586):** A call against the generic Connect AI MCP using both `Id` and `AttachmentId` returned a JDBC error (`[JDBCStatementImpl] can't parse argument number: id=<value>`). This appears to be a parameter-binding issue at the driver level. The procedure may work correctly through the Confluence cai-toolkit surface or through a Connect AI client that submits parameters via a different binding path. If you hit the same error, fall back to constructing the download URL from `Attachments.DownloadLink` and authenticating against Confluence directly outside Connect AI.

### Search

Executes a global Confluence content search. Returns a single `Results` column containing a JSON array of matching content items (pages, blog posts, comments) with nested space and history metadata.

```json
{
  "procedure": "Search",
  "parameters": {
    "SearchTerm": "<keyword or phrase>"
  }
}
```

Use specific search terms — broad searches against an active tenant easily return thousands of items and exceed typical response-size limits. For day-to-day content discovery prefer targeted `WHERE` clauses on `Pages` or `Comments` (filtered by `SpaceKey`, `Title LIKE`, or date ranges) over `Search`.

### UploadAttachment — Not currently supported in cloud

`UploadAttachment` accepts either `FileLocation` (server-side disk path, unavailable in cloud) or `FileStream` (Java `InputStream`, unable to pass through the MCP interface). There is no base64 string alternative for the upload path. Treat file uploads as a current limitation — do not invent parameter names the driver does not accept. Support for base64 string uploads is planned across CData drivers; check for updates if this capability is needed.

## Write Operations

Confluence supports INSERT and UPDATE through Connect AI where the Confluence user's permissions and the underlying API allow it. Use `getColumns` to confirm the writable column set before constructing INSERT or UPDATE statements — many fields on `Pages` are derived or read-only.

If a write operation is blocked, two layers control access: the Confluence user's permissions in Confluence itself, and the Connect AI connection's read-only setting. Check both.

## Confluence-Specific Conventions

- **`Key` vs `Id` on Spaces**: Use `Key` for joins from `Pages.SpaceKey` and for URL/reference work; `Id` is the internal numeric identifier. They are not interchangeable.
- **Space key vs display name**: Space keys often differ from display names (e.g., display "Engineering Wiki" / key `ENG`). When you don't know the exact key, filter on `Name` with `LIKE` rather than guessing the key.
- **`Pages.Storage` is XHTML with macros**: The page body is Confluence's storage format, not rendered HTML. Embedded images, links, and macros appear as `<ac:*>` and `<ri:*>` tags. Plain-text extraction requires stripping or parsing those tags.
- **Images don't render from `Storage` alone**: `<ac:image>` tags reference attachment IDs. To get actual image bytes, follow the **Retrieving Page Images** pattern: query `Attachments` for the page, then call `DownloadAttachment`.
- **Deprecated `*UserName` columns**: The live schema marks several legacy username columns as `[DEPRECATED]`: `LastUpdatedUserName`, `VersionUserName`, `PreviousVersionUserName` on `Pages`; `CreatedByUserName`, `LastUpdatedUserName`, `PreviousVersionUserName` on `Comments`. They often return NULL or empty strings. Prefer the `*UserPublicName` (display name) or `*AccountId` (stable ID) variants for any user-attribution work. Exceptions: `Pages.CreatedByUserName` and `Attachments.CreatedByUserName` are NOT deprecated and remain reliable.
- **`Comments.StorageBody` vs `Pages.Storage`**: The full body column is named differently on the two tables. Comments use `StorageBody` (and `AtlasDocFormatBody`); Pages use `Storage` (and `AtlasDocFormat`). Do not assume `Storage` works on `Comments`.
- **No `SpaceName` column on Pages or Comments**: Both tables expose `SpaceKey` and `SpaceType` but not the space display name. To include the name in results, join to `Spaces.Name` on `Pages.SpaceKey = Spaces.Key` (or `Comments.SpaceKey = Spaces.Key`).
- **Check user existence before activity**: When asked "what did user X do," first confirm the user exists in `Users` (by `AccountId`, `Email`, or `DisplayName`), then query `Pages`/`Comments` separately. Mismatched names between Confluence's display layer and the API are common.
- **Explicit dates over `DATEADD()`**: For better performance in Connect AI, prefer literal date strings (`'2025-01-01'`) over computed expressions like `DATEADD(month, -3, GETDATE())` when filtering large tables.
- **Date filters are essential**: The `Pages` table can be very large in mature Confluence instances. Always include a `SpaceKey` filter, and add a `CreatedDate` or `LastUpdatedDatetime` filter when exploring without a specific page in mind.
- **`DownloadLink` is not directly downloadable**: The `Attachments.DownloadLink` value points back to Confluence and still requires authentication — use the `DownloadAttachment` procedure to retrieve bytes through Connect AI instead of trying to fetch the link directly.
