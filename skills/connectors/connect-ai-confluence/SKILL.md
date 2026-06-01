---
name: connect-ai-confluence
description: Use when querying Confluence Cloud data through CData Connect AI. Covers the Confluence data model (spaces, pages, comments, attachments, users, plus the PageChildren/PageAncestors/PageComments/Labels/Tasks/ViewsAnalytics views), the space → page → refine query workflow, image/attachment retrieval via base64, and Confluence-specific conventions. Composes on top of the connect-ai-base skill.
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

This skill replaces `getInstructions` for the Confluence driver. Do not call `getInstructions` for Confluence — the guidance it provides is already incorporated here, and the live `getInstructions` payload contains at least one example that references a non-existent column (`SpaceName` on `Comments`). Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Confluence connection via `getCatalogs`.

## Deployment Scope

This skill targets **Confluence Cloud**. The `Users` view's columns are explicitly marked "available only for Confluence Cloud" in the driver metadata, and most of the patterns in this skill assume Cloud's `AccountId`-based user model. Server / Data Center deployments may expose a different column set — if you're working against a Server or Data Center connection, verify each column reference with `getColumns` before relying on it.

## When to Use This Skill

Load this skill when the user's question touches Confluence content: pages, spaces, wikis, internal documentation, runbooks, meeting notes, comments and discussions, attachments and embedded images, page hierarchy or organization, page authorship and edit history, inline tasks (Confluence checkboxes), or labels/tags applied to content. Also load it when the user names Confluence explicitly or refers to "the wiki" / "the docs site" in a context where a Confluence Connect AI connection is available.

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
- **Pages** — Main content. Holds the page body as storage-format XHTML in the `Storage` column, plus metadata and N-1 version info (the column set exposes the latest version and immediately previous version only; see "Page versions are not a history" in Conventions).
- **Blogposts** — Separate from `Pages`. Use this when the user asks about blog posts specifically; otherwise expect `Pages` to be the right table.
- **Comments** — Comments on pages, blog posts, and attachments. `ContainerId` references the parent content. The `Location` column distinguishes `footer` (page-level) from `inline` (anchored to selected text); `Resolution` carries `open` / `resolved`.
- **Attachments** — Files attached to pages (images, PDFs, documents). `ContainerId` references the page.
- **Users** — User account information and profiles (Cloud only).
- **Groups** — Confluence groups.

### Key Views

These views cover specific patterns that supplement the base tables:

- **PageChildren** — Direct children of a page. Filter on `WHERE [PageId] = '<parent-id>'`. **Use this instead of `Pages WHERE [ParentId] = ...`** — the view is purpose-built and reliable; the `ParentId` filter on `Pages` has been observed to drop the MCP connection when bound as an integer literal (see Conventions).
- **PageAncestors** — Walk up the hierarchy from a page to its root. Filter on `WHERE [PageId] = '<page-id>'`.
- **PageComments** — Comments scoped to a specific page. Note: this view exposes mostly link/expandable columns, not the rich relational columns (`CreatedDate`, `CreatedByUserPublicName`, `Excerpt`, `Location`, `Resolution`); for ordinary "comments on this page" queries, prefer filtering `Comments` by `ContainerId` and `ContainerType = 'page'`.
- **PageContents** — Page body content surfaced as a separate view.
- **Labels** — Confluence labels (tags) applied to content. Use for "find pages tagged X." Requires a `WHERE` filter on `ContentId`, `ContentType`, or `LabelName`; unfiltered scans error out.
- **Tasks** — Confluence inline tasks (the checkbox items embedded in page bodies).
- **ViewsAnalytics** / **ViewersAnalytics** — Total views and distinct viewers for a piece of content. Per-page lookup only (requires a `ContentId` filter); cannot be used to rank "most-viewed across the tenant" in a single query.
- **Contributors** — Users who have contributed to a piece of content.
- **SpacePermissions** / **GroupsContentRestrictions** / **UsersContentRestrictions** — Access controls and content restrictions.
- **AuditRecords** — Audit log entries.
- **Whiteboards** — Confluence whiteboards.

### Key Relationships

- Pages → Spaces: `Pages.SpaceKey` = `Spaces.Key` (note: spaces have both `Key` and `Id` — pages join on `Key`)
- Page hierarchy: prefer `PageChildren` / `PageAncestors` (each takes a `PageId` filter) over `Pages.ParentId`
- Attachments → Pages: `Attachments.ContainerId` = `Pages.Id`
- Comments → Container (page/blogpost/attachment): `Comments.ContainerId` = the parent's `Id`; `Comments.ContainerType` indicates which kind (`page`, `blogpost`, `attachment`)
- Comments → Spaces: `Comments.SpaceKey` = `Spaces.Key`
- Labels / ViewsAnalytics / ViewersAnalytics → content: each uses `ContentId` (matching `Pages.Id` or `Attachments.Id` depending on `ContentType`) and requires a filter on `ContentId` / `ContentType` / or another column
- PageComments / PageChildren / PageAncestors / Tasks → Pages: each uses `PageId` (matching `Pages.Id`)

### Page Body Format

The `Pages.Storage` column contains Confluence's storage format — XHTML with custom `<ac:*>` macro tags. Embedded images appear as `<ac:image>` tags that reference attachment IDs and do not render directly. To retrieve the actual image bytes, see the **Retrieving Page Images** pattern in Common Query Patterns.

## Important Columns

### Spaces

- `Key` — Unique space key (used in URLs and as the foreign key from `Pages.SpaceKey`)
- `Id` — Internal space identifier
- `Name` — Display name (may differ from `Key`)
- `Type` — `personal`, `team`, `global`, etc.
- `Status` — Space status
- `Alias` — Identifier used in some Confluence page URLs; distinct from `Key`. Worth checking when a user has only a copied URL to work from
- `Description` — Space description
- `Url` — Direct space URL
- `CreatedDate` / `LastModified` — Timestamps (note: `Spaces` uses `LastModified`, while `Pages`/`Comments`/`Attachments` use `LastUpdatedDatetime` — this naming inconsistency is real)

### Pages

- `Id` — Unique page identifier (VARCHAR — quote string literals when filtering)
- `Title` — Page title
- `Type` — Content type (`page`, `blogpost`, etc.)
- `Status` — Page status
- `Storage` — Page body in storage format (XHTML with `<ac:*>` tags)
- `AtlasDocFormat` — Page body in Atlas Doc Format (alternative to `Storage`)
- `Excerpt` — Short preview snippet; useful when you want a summary without pulling Storage XHTML
- `SpaceKey` / `SpaceId` / `SpaceType` — Containing space (note: there is no `SpaceName` column on Pages — join to `Spaces.Name` via `SpaceKey = Spaces.Key` when you need the display name)
- `ParentId` — Parent page ID (BIGINT-typed but **must be filtered with a quoted string literal** — integer-literal filters have been observed to drop the MCP connection; see Conventions). For multi-level hierarchy work, prefer the `PageChildren` / `PageAncestors` views
- `OwnerId` — Page owner
- `URL` / `ItemURL` / `LinksWebui` / `LinksTinyui` — URL forms for the page
- `CreatedDate` / `CreatedByUserName` / `CreatedByUserPublicName` / `CreatedByAccountId` — Creation metadata. **`CreatedByUserName` on `Pages` is NOT marked deprecated** and remains reliable (unlike on Comments and Attachments)
- `LastUpdatedDatetime` / `LastUpdatedMessage` / `LastUpdatedNumber` — Last-update metadata
- `LastUpdatedUserPublicName` / `LastUpdatedUserType` — Last-update user (prefer `LastUpdatedUserPublicName` — `LastUpdatedUserName` is marked `[DEPRECATED]`). **There is no `LastUpdatedAccountId` column on `Pages`**, despite the equivalent existing on `Comments` and `Attachments`. Use `LastUpdatedUserPublicName` for display, and fall back to `VersionUserAccountId` if you need a stable account ID for the latest edit (the latest version's account ID is the same person who last updated the page).
- `IsLatest` — Whether this row represents the latest version. In practice the `Pages` table only returns latest-version rows; see "Page versions are not a history" in Conventions
- `VersionNumber` / `VersionDatetime` / `VersionMessage` / `VersionUserPublicName` / `VersionUserAccountId` — Metadata for the currently latest version (`VersionUserName` is `[DEPRECATED]`)
- `PreviousVersionNumber` / `PreviousVersionDatetime` / `PreviousVersionUserPublicName` / `PreviousVersionUserAccountId` — Metadata for the **immediately previous** version only, carried on the latest-version row (`PreviousVersionUserName` is `[DEPRECATED]`)

### Comments

- `Id` — Unique comment identifier
- `Title` — Comment title/subject
- `Status` — Comment status
- `Excerpt` — Short text snippet (preview)
- `StorageBody` — Full comment body in storage format (note: column is `StorageBody` on Comments, not `Storage` like on Pages)
- `AtlasDocFormatBody` — Full body in Atlas Doc Format
- `ContainerId` / `ContainerType` — Parent content (page, blog post, or attachment); use `ContainerId = '<page-id>'` to find comments on a specific page, or use the `PageComments` view for the same purpose
- `Location` — `footer` for page-level comments, `inline` for comments anchored to selected text in the page body
- `Resolution` — `open` or `resolved`. Useful for "show me unresolved review comments"
- `SpaceKey` / `SpaceType` — Containing space (no `SpaceName` column — join to `Spaces.Name` via `SpaceKey = Spaces.Key` for the display name)
- `CreatedDate` — Creation timestamp
- `CreatedByUserPublicName` / `CreatedByAccountId` — Comment author (prefer these — `CreatedByUserName` is `[DEPRECATED]` on Comments)
- `LastUpdatedDatetime` / `LastUpdatedMessage` — Last-update metadata
- `LastUpdatedUserPublicName` / `LastUpdatedAccountId` — Last-update user (`LastUpdatedUserName` is `[DEPRECATED]`)
- `VersionNumber` — **Note:** `VersionNumber` on Comments is typed `VARCHAR`, unlike Pages where it is `INTEGER`. Quote string literals when filtering on Comments

### Attachments

- `Id` — Unique attachment identifier (passed to `DownloadAttachment` as `AttachmentId`)
- `Title` — File name
- `MediaType` — MIME type (e.g., `image/png`, `application/pdf`)
- `DownloadLink` — Confluence-hosted link (requires Confluence auth — use `DownloadAttachment` to retrieve bytes through Connect AI)
- `ContainerId` — Parent page ID
- `SpaceKey` — Containing space
- `CreatedDate` — Creation timestamp
- `CreatedByUserPublicName` / `CreatedByAccountId` — Creation metadata (prefer these — `CreatedByUserName` is `[DEPRECATED]` on Attachments, despite the same column being reliable on Pages)
- `LastUpdatedDatetime` — Last-update timestamp
- `LastUpdatedUserPublicName` / `LastUpdatedAccountId` — Last-update user (`LastUpdatedUserName` is `[DEPRECATED]`)

### Users

A view (not a base table). All columns are explicitly marked as available only for Confluence Cloud.

- `AccountId` — Unique account identifier (the stable user reference; matches `*AccountId` columns on other tables)
- `AccountType` — Account type
- `Email` — User email
- `DisplayName` — Name displayed in the Confluence UI
- `PublicName` — Full name
- `Type` — User type (internal, external, system)
- `LastModified` — When the profile was last updated

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

This pattern is intentionally cross-space (no `SpaceKey` filter), so it can be expensive on large tenants. Keep the `LastUpdatedDatetime` filter narrow.

```sql
SELECT p.[SpaceKey], s.[Name] AS SpaceName, MAX(p.[LastUpdatedDatetime]) AS LastActivity
FROM [YourConnection].[Confluence].[Pages] p
INNER JOIN [YourConnection].[Confluence].[Spaces] s ON p.[SpaceKey] = s.[Key]
WHERE p.[LastUpdatedDatetime] >= '2025-01-01'
GROUP BY p.[SpaceKey], s.[Name]
ORDER BY LastActivity DESC
LIMIT 25
```

### Recent Comment Activity in a Space

```sql
SELECT [Title], [SpaceKey], [CreatedByUserPublicName], [CreatedDate], [LastUpdatedDatetime], [Excerpt]
FROM [YourConnection].[Confluence].[Comments]
WHERE [SpaceKey] = '<space-key>'
ORDER BY [LastUpdatedDatetime] DESC
LIMIT 10
```

### Latest + Previous Version Metadata for a Page

**Important:** The `Pages` table does NOT expose historical versions as separate rows. Each page returns a single latest-version row, with `PreviousVersion*` columns carrying the **immediately previous** version's metadata only. A page with `VersionNumber = 7` returns one row, not seven. The skill cannot retrieve version 5 or version 3 through this table.

```sql
SELECT
    [Id],
    [Title],
    [VersionNumber],
    [VersionDatetime],
    [VersionUserPublicName],
    [VersionMessage],
    [PreviousVersionNumber],
    [PreviousVersionDatetime],
    [PreviousVersionUserPublicName],
    [PreviousVersionMessage]
FROM [YourConnection].[Confluence].[Pages]
WHERE [Id] = '<page-id>'
```

If the user genuinely needs full version history (every version of a page), the Connect AI Confluence driver does not currently surface that. Tell the user this is a driver limitation and suggest the Confluence UI's page-history view or the Confluence REST API directly.

### Page Hierarchy (Children of a Page)

Use the **`PageChildren` view** for direct children. The view is purpose-built for hierarchy traversal and is reliable; filtering `Pages` directly by `ParentId` is unreliable (see Conventions).

```sql
SELECT [Id], [Title], [Status]
FROM [YourConnection].[Confluence].[PageChildren]
WHERE [PageId] = '<parent-page-id>'
ORDER BY [Title]
```

For ancestors (the chain from a page up to its root), use `PageAncestors` the same way:

```sql
SELECT [Id], [Title]
FROM [YourConnection].[Confluence].[PageAncestors]
WHERE [PageId] = '<page-id>'
```

### Pages Created by a User

`Pages.CreatedByUserName` is the one `*UserName` column on Pages that is NOT deprecated, so it's a valid filter target. For stable identity across other tables, prefer `CreatedByAccountId`.

```sql
SELECT [Id], [Title], [SpaceKey], [CreatedDate]
FROM [YourConnection].[Confluence].[Pages]
WHERE [CreatedByUserName] = '<user-name>'
  AND [CreatedDate] >= '2025-01-01'
ORDER BY [CreatedDate] DESC
```

### Comments on a Specific Page

Filter `Comments` by `ContainerId` and `ContainerType = 'page'`. The `PageComments` view also exists, but it exposes mostly link/expandable columns rather than the rich relational columns (`CreatedDate`, `CreatedByUserPublicName`, `Excerpt`) you typically want — prefer the `Comments` table for ordinary "who commented on this page" questions.

```sql
SELECT [Id], [Title], [CreatedDate], [CreatedByUserPublicName], [Excerpt], [Location], [Resolution]
FROM [YourConnection].[Confluence].[Comments]
WHERE [ContainerId] = '<page-id>'
  AND [ContainerType] = 'page'
ORDER BY [CreatedDate] DESC
```

### Unresolved Inline Comments in a Space

Inline comments anchor to selected text in a page. Filtering on `Location = 'inline'` and `Resolution = 'open'` surfaces review threads that still need attention.

```sql
SELECT [Id], [Title], [ContainerId], [CreatedByUserPublicName], [CreatedDate], [Excerpt]
FROM [YourConnection].[Confluence].[Comments]
WHERE [SpaceKey] = '<space-key>'
  AND [Location] = 'inline'
  AND [Resolution] = 'open'
ORDER BY [CreatedDate] DESC
```

### Pages by Label

Note: `Labels` uses `ContentId` (not `PageId`) and `LabelName` (not `Name`). `ContentId` matches `Pages.Id` for page-typed content; filter `ContentType = 'page'` to exclude blog post and attachment labels.

```sql
SELECT [ContentId], [ContentType], [LabelName], [LabelPrefix]
FROM [YourConnection].[Confluence].[Labels]
WHERE [LabelName] = '<label-name>'
  AND [ContentType] = 'page'
```

Then join back to `Pages` on `ContentId = Pages.Id` for titles and metadata.

### Views for a Specific Page

`ViewsAnalytics` is a per-page lookup: it requires a `ContentId` filter in the WHERE clause, so it cannot be used to rank "most-viewed pages" across the tenant in a single query. To answer a "top N most-viewed" question, the caller has to iterate the candidate page IDs and call this view for each, then rank in the calling code.

```sql
SELECT [ContentId], [NumberOfViews]
FROM [YourConnection].[Confluence].[ViewsAnalytics]
WHERE [ContentId] = '<page-id>'
```

`NumberOfViews` is typed `VARCHAR` despite holding numeric values — cast it before comparing or sorting.

### Attachments on a Page

```sql
SELECT [Id], [Title], [MediaType], [CreatedByUserPublicName], [CreatedDate]
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

Consuming the result: parse the `Results` JSON to pull content IDs and titles, then run targeted `queryData` calls against `Pages` (or `Comments`) for the rich relational columns. The Search payload is intentionally lean — treat it as a discovery index, not a final result set.

### UploadAttachment — Not currently supported in cloud

`UploadAttachment` accepts either `FileLocation` (server-side disk path, unavailable in cloud) or `FileStream` (Java `InputStream`, unable to pass through the MCP interface). There is no base64 string alternative for the upload path. Treat file uploads as a current limitation — do not invent parameter names the driver does not accept. Support for base64 string uploads is planned across CData drivers; check for updates if this capability is needed.

## Write Operations

Confluence supports INSERT and UPDATE through Connect AI where the Confluence user's permissions and the underlying API allow it. Use `getColumns` to confirm the writable column set before constructing INSERT or UPDATE statements — many fields on `Pages` are derived or read-only.

If a write operation is blocked, two layers control access: the Confluence user's permissions in Confluence itself, and the Connect AI connection's read-only setting. Check both.

## Confluence-Specific Conventions

- **`Key` vs `Id` on Spaces**: Use `Key` for joins from `Pages.SpaceKey` and for URL/reference work; `Id` is the internal numeric identifier. They are not interchangeable.
- **Space key vs display name**: Space keys often differ from display names (e.g., display "Engineering Wiki" / key `ENG`). When you don't know the exact key, filter on `Name` with `LIKE` rather than guessing the key. `Spaces.Alias` is also used in some Confluence URLs and is distinct from `Key`.
- **Pages versions are not a history**: The `Pages` table only returns latest-version rows. A page with `VersionNumber = 7` returns exactly one row, with `PreviousVersion*` columns carrying metadata for version 6 only. The Connect AI Confluence driver does not expose versions 1 through 5 through SQL. If full version history is needed, point the user at the Confluence UI's page-history view or the REST API directly.
- **`Pages.ParentId` requires a quoted-string literal despite being BIGINT-typed**: Filters of the form `WHERE [ParentId] = 65676` (integer literal) have been observed to drop the MCP connection, while `WHERE [ParentId] = '65676'` works. For multi-level hierarchy traversal, prefer the `PageChildren` / `PageAncestors` views.
- **`Pages.Storage` is XHTML with macros**: The page body is Confluence's storage format, not rendered HTML. Embedded images, links, and macros appear as `<ac:*>` and `<ri:*>` tags. Plain-text extraction requires stripping or parsing those tags.
- **Images don't render from `Storage` alone**: `<ac:image>` tags reference attachment IDs. To get actual image bytes, follow the **Retrieving Page Images** pattern: query `Attachments` for the page, then call `DownloadAttachment`.
- **Deprecated `*UserName` columns**: Several legacy username columns are marked `[DEPRECATED]` in the live schema and often return NULL or empty strings: `LastUpdatedUserName`, `VersionUserName`, `PreviousVersionUserName` on `Pages`; `CreatedByUserName`, `LastUpdatedUserName`, `PreviousVersionUserName` on `Comments`; and `CreatedByUserName`, `LastUpdatedUserName`, `PreviousVersionUserName` on `Attachments`. Prefer `*UserPublicName` (display name) or `*AccountId` (stable ID) variants. **One exception:** `Pages.CreatedByUserName` is NOT marked deprecated and remains reliable. The same column on `Attachments` IS deprecated.
- **`Comments.StorageBody` vs `Pages.Storage`**: The full body column is named differently on the two tables. Comments use `StorageBody` (and `AtlasDocFormatBody`); Pages use `Storage` (and `AtlasDocFormat`). Do not assume `Storage` works on `Comments`.
- **`VersionNumber` type differs across tables**: INTEGER on `Pages`, VARCHAR on `Comments`. Quote the literal when filtering on Comments.
- **No `SpaceName` column on Pages or Comments**: Both tables expose `SpaceKey` and `SpaceType` but not the space display name. To include the name in results, join to `Spaces.Name` on `Pages.SpaceKey = Spaces.Key` (or `Comments.SpaceKey = Spaces.Key`). Note: the live `getInstructions` payload for this driver contains an example that references `[SpaceName]` on `Comments` — that example will fail; ignore it.
- **Some views require a WHERE-clause filter**: At least `Labels` and `ViewsAnalytics` enforce that the query include a filter on a specific column (e.g., `ContentId`, `ContentType`, or `LabelName` for Labels; `ContentId` for ViewsAnalytics). An unfiltered scan returns an error rather than a result set. Plan queries with this in mind — these views are for targeted lookups, not bulk listing.
- **`Pages.ParentId` vs hierarchy views**: `PageChildren` (children of a page) and `PageAncestors` (path to the root) are purpose-built and reliable. Use them rather than self-joining `Pages` on `ParentId` for any non-trivial hierarchy work.
- **`PageComments` is a thin view**: The `PageComments` view exists but exposes mostly link / expandable columns rather than the rich relational columns (`CreatedDate`, `CreatedByUserPublicName`, `Excerpt`, `Location`, `Resolution`) you typically want. For ordinary "comments on this page" queries, filter `Comments` by `ContainerId` and `ContainerType = 'page'`.
- **Check user existence before activity**: When asked "what did user X do," first confirm the user exists in `Users` (by `AccountId`, `Email`, or `DisplayName`), then query `Pages`/`Comments` separately. Mismatched names between Confluence's display layer and the API are common.
- **Explicit dates over `DATEADD()`**: For better performance in Connect AI, prefer literal date strings (`'2025-01-01'`) over computed expressions like `DATEADD(month, -3, GETDATE())` when filtering large tables.
- **Date filters are essential**: The `Pages` table can be very large in mature Confluence instances. Always include a `SpaceKey` filter, and add a `CreatedDate` or `LastUpdatedDatetime` filter when exploring without a specific page in mind.
- **`DownloadLink` is not directly downloadable**: The `Attachments.DownloadLink` value points back to Confluence and still requires authentication — use the `DownloadAttachment` procedure to retrieve bytes through Connect AI instead of trying to fetch the link directly.
- **No direct CQL access**: Connect AI exposes Confluence through SQL and the `Search` procedure. Confluence's native query language (CQL) is not directly accessible. Users familiar with CQL should translate the intent to SQL filters on `Pages` / `Comments` / `Labels` or to a `Search` procedure call.
