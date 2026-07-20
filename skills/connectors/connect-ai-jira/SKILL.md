---
name: connect-ai-jira
description: Use when querying Jira data through CData Connect AI. Covers the Jira data model, issue hierarchy, query patterns, stored procedures, and Jira-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Jira
  family: collaboration
---

# CData Connect AI — Jira Skill

## ⚠ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Jira-specific guidance for querying Jira data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Jira driver. Do not call `getInstructions` for Jira — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Jira connection via `getCatalogs`.

## Schema

Jira is a single-schema driver. The schema name is `Jira`.

```sql
SELECT * FROM [YourConnection].[Jira].[Issues] LIMIT 10
```

## Query Process

### Step 1: Identify the Project

Start by locating the Jira project the user is interested in.

If you know the project key:
```sql
SELECT * FROM [YourConnection].[Jira].[Projects]
WHERE [Key] LIKE '%<project-key>%'
```

To list all projects:
```sql
SELECT * FROM [YourConnection].[Jira].[Projects]
```

### Step 2: Explore Issues

Once you have the project key, query issues directly:

```sql
SELECT *
FROM [YourConnection].[Jira].[Issues]
WHERE [ProjectKey] = '<project-key>'
```

### Step 3: Inspect Columns

Use `getColumns` on the Issues table to see all available fields before writing targeted queries.

### Step 4: Refine with Filters

Apply filters on issue type, status, dates, or other fields:

```sql
SELECT [Key], [Summary], [Status], [Created]
FROM [YourConnection].[Jira].[Issues]
WHERE [ProjectKey] = '<project-key>'
  AND [Created] >= DATEADD(month, -3, GETDATE())
```

## Data Model

### Key Tables

- **Issues** — Core issue data: summary, type, assignee, reporter, status, priority. Also called "Work Items" in the 2025+ Jira UI, but the API and this data model still use "Issues"
- **Projects** — Project metadata: key, name, lead, category, type
- **Users** — User records: display name, email, account status
- **Comments** — Issue comments with author and timestamps
- **Worklogs** — Time tracking entries per issue
- **IssueTransitions** — Available status transitions per issue
- **IssueTypes** — Available issue types in the Jira instance
- **Attachments** — File attachments on issues (id, filename, mime type, size)

### Issue Hierarchy

Jira issues follow a three-level hierarchy:

- **Top-level** (e.g., Epic) — groups multiple related tickets or focuses on a single major feature
- **Mid-level** (e.g., Bug, Story, Task) — the bulk of Jira issues
- **Bottom-level** (e.g., Sub-task) — minor requirements that are part of a ticket

Each ticket may have at most one parent of the level directly above its type. Use `[ParentKey]` to find hierarchical relationships.

### Key Relationships

- Issues → Comments: join on `Issues.[Id] = Comments.[IssueId]`
- Issues → Worklogs: join on `Issues.[Id] = Worklogs.[IssueId]`
- Issues → IssueTransitions: filter by `IssueTransitions.[IssueKey]`
- Issues → Projects: filter by `Issues.[ProjectKey] = Projects.[Key]`

## Important Columns

### Issues

- `Id` — Internal identifier
- `Key` — Human-readable key (e.g., "PROJ-123")
- `Summary` — Issue title
- `Description` — Detailed description
- `Created` — Creation timestamp
- `Updated` — Last update timestamp
- `DueDate` — Expected completion date
- `IssueTypeName` — Type (Bug, Task, Story, Epic, etc.)
- `StatusName` — Current status (To Do, In Progress, Done, etc.)
- `StatusId` — Internal status identifier
- `PriorityName` — Priority level (Highest, High, Medium, Low, Lowest)
- `PriorityId` — Internal priority identifier
- `AssigneeDisplayName` / `AssigneeAccountId` — Assigned user
- `ReporterDisplayName` / `ReporterAccountId` — Reporting user
- `ProjectKey` / `ProjectName` — Project reference
- `ParentKey` — Parent issue key (for sub-tasks or issues under epics)
- `Labels` — Tags/labels
- `ComponentsAggregate` — Associated components

### Projects

- `Id` — Internal identifier
- `Key` — Project key (e.g., "PROJ")
- `Name` — Display name
- `ProjectTypeKey` — Project type (software, business, etc.)
- `LeadDisplayName` — Project lead
- `ProjectCategoryName` — Optional grouping
- `AssigneeType` — Default assignment strategy for new issues
- `Description` — Project description

### Comments

- `Id` — Internal identifier
- `IssueId` / `IssueKey` — Associated issue
- `Body` — Comment text
- `Created` / `Updated` — Timestamps
- `AuthorDisplayName` / `AuthorId` — Author

### Users

- `Id` — Internal identifier
- `DisplayName` — Full name
- `EmailAddress` — Email
- `Active` — Account status ('true' or 'false')
- `AccountType` — Account type

### Worklogs

- `Id` — Internal identifier
- `IssueId` / `IssueKey` — Associated issue
- `AuthorDisplayName` — User who logged work
- `TimeSpentSeconds` — Time logged in seconds
- `Created` — When the entry was created
- `Started` — When the work actually started
- `Comment` — Optional note

### IssueTransitions

- `Id` — Transition identifier
- `Name` — Transition name (e.g., "Start Progress", "Done")
- `IssueKey` — Issue this transition applies to
- `ToName` — Target status after transition
- `HasScreen` — Whether the transition requires filling a screen

## Common Query Patterns

### Recently Created Issues

```sql
SELECT [Key], [Summary], [Created], [AssigneeDisplayName]
FROM [YourConnection].[Jira].[Issues]
WHERE [Created] >= DATEADD(day, -30, GETDATE())
ORDER BY [Created] DESC
```

### Issue Count Per Developer

```sql
SELECT
    [AssigneeDisplayName] as Developer,
    COUNT(*) as IssueCount
FROM [YourConnection].[Jira].[Issues]
WHERE [Created] >= DATEADD(month, -3, GETDATE())
GROUP BY [AssigneeDisplayName]
ORDER BY IssueCount DESC
```

### Issues by Type and Status

```sql
SELECT [IssueTypeName], [StatusName], COUNT(*) as Count
FROM [YourConnection].[Jira].[Issues]
GROUP BY [IssueTypeName], [StatusName]
ORDER BY Count DESC
```

### Open Bugs

```sql
SELECT [Key], [Summary], [Created], [AssigneeDisplayName], [ReporterDisplayName]
FROM [YourConnection].[Jira].[Issues]
WHERE [IssueTypeName] = 'Bug'
  AND [StatusName] NOT IN ('Done', 'Resolved', 'Closed')
ORDER BY [PriorityName], [Created]
```

### Issues by Priority

```sql
SELECT [Key], [Summary], [PriorityName], [StatusName], [AssigneeDisplayName]
FROM [YourConnection].[Jira].[Issues]
WHERE [PriorityName] = 'High'
  AND [StatusName] NOT IN ('Done', 'Closed')
ORDER BY [Created] DESC
```

### Issues Nearing Due Date

```sql
SELECT [Key], [Summary], [DueDate], [AssigneeDisplayName], [StatusName]
FROM [YourConnection].[Jira].[Issues]
WHERE [DueDate] IS NOT NULL
  AND [DueDate] <= DATEADD(day, 7, GETDATE())
  AND [StatusName] NOT IN ('Done', 'Closed')
ORDER BY [DueDate] ASC
```

### Sprint/Epic Issues

```sql
SELECT [Key], [Summary], [ParentKey], [IssueTypeName], [StatusName]
FROM [YourConnection].[Jira].[Issues]
WHERE [ParentKey] = 'EPIC-123'
ORDER BY [StatusName], [Created]
```

### Unassigned Issues

```sql
SELECT [Key], [Summary], [IssueTypeName], [PriorityName], [Created]
FROM [YourConnection].[Jira].[Issues]
WHERE [AssigneeDisplayName] IS NULL
  AND [StatusName] NOT IN ('Done', 'Closed')
ORDER BY [PriorityName], [Created]
```

### Comment Activity

```sql
SELECT
    [AuthorDisplayName],
    COUNT(*) as CommentCount
FROM [YourConnection].[Jira].[Comments]
WHERE [Created] >= DATEADD(month, -3, GETDATE())
GROUP BY [AuthorDisplayName]
ORDER BY CommentCount DESC
```

### Issues with Comments

```sql
SELECT i.[Key], i.[Summary], COUNT(c.[Id]) as CommentCount
FROM [YourConnection].[Jira].[Issues] i
LEFT JOIN [YourConnection].[Jira].[Comments] c ON i.[Id] = c.[IssueId]
WHERE i.[ProjectKey] = 'PROJ'
GROUP BY i.[Key], i.[Summary]
HAVING COUNT(c.[Id]) > 0
ORDER BY CommentCount DESC
```

### Worklog Hours by User

```sql
SELECT
    [AuthorDisplayName],
    SUM([TimeSpentSeconds]) / 3600.0 as TotalHours
FROM [YourConnection].[Jira].[Worklogs]
WHERE [Created] >= DATEADD(month, -1, GETDATE())
GROUP BY [AuthorDisplayName]
ORDER BY TotalHours DESC
```

## Stored Procedures

### ChangeIssueStatus

Always query `IssueTransitions` first to get the correct `TransitionId`:

```sql
SELECT [Id], [Name], [ToName]
FROM [YourConnection].[Jira].[IssueTransitions]
WHERE [IssueKey] = 'PROJ-123'
```

Then transition the issue:

```sql
EXEC [YourConnection].[Jira].ChangeIssueStatus
  @IssueKey = 'PROJ-123',
  @TransitionId = '41'
```

Alternative JSON format for `executeProcedure` tool parameters:

```json
{
  "procedure": "ChangeIssueStatus",
  "parameters": {
    "IssueKey": "PROJ-123",
    "TransitionId": "41"
  }
}
```

### ArchiveIssues / UnarchiveIssues

```sql
EXEC [YourConnection].[Jira].ArchiveIssues
  @IssueKeys = 'PROJ-123,PROJ-124,PROJ-125'
```

### DownloadAttachment

In cloud-based Connect AI environments, omit `FileLocation` and `FileStream`. The procedure returns the file content as base64 in the `FileData` response column.

```json
{
  "procedure": "DownloadAttachment",
  "parameters": {
    "AttachmentId": "10001"
  }
}
```

Response:
```
Success,FileData
True,<base64-encoded file content>
```

Decode the `FileData` value from base64 to retrieve the original file content. For text-based files (text/plain, text/csv, application/json, text/html), decode and present the contents directly or offer as a downloadable file. For binary files (images, PDFs, spreadsheets, archives), decode the base64 content, save to a file, and present it for download.

To find attachment IDs, query the Attachments table:

```sql
SELECT [Id], [FileName], [MimeType], [Size], [IssueKey]
FROM [YourConnection].[Jira].[Attachments]
WHERE [IssueKey] = 'PROJ-123'
```

### UploadAttachment

**Not currently supported in cloud-based Connect AI environments.** The `FileLocation` parameter requires disk access, which is unavailable in the cloud. The `Content` parameter expects a Java InputStream object, which cannot be passed through the MCP interface. Support for file uploads via stored procedures is planned — check for updates if this capability is needed.

### CreateCustomField

Use `getProcedureParameters` to inspect required parameters before calling.

## Write Operations

Jira supports INSERT and UPDATE through Connect AI where the Jira user's permissions allow it.

### Create a New Issue

```sql
INSERT INTO [YourConnection].[Jira].[Issues]
([ProjectKey], [Summary], [IssueTypeName], [PriorityId], [Description])
VALUES
('PROJ', 'New feature request', 'Task', '3', 'Detailed description here')
```

### Update an Issue

```sql
UPDATE [YourConnection].[Jira].[Issues]
SET [Summary] = 'Updated issue summary',
    [Description] = 'Updated description text'
WHERE [Key] = 'PROJ-123'
```

### Add a Comment

```sql
INSERT INTO [YourConnection].[Jira].[Comments]
([IssueKey], [Body])
VALUES
('PROJ-123', 'This is a new comment on the issue')
```

If write operations are blocked, the Connect AI connection may not have write access enabled. Guide the user to their Connect AI connection settings to ensure write access is enabled.

## Jira-Specific Conventions

- **Key vs Id**: Use `[Key]` for human-readable references (e.g., "PROJ-123") and `[Id]` for internal operations and joins
- **StatusName vs StatusId**: `StatusName` is human-readable; `StatusId` is the internal identifier. Prefer `StatusName` for filtering unless working with transitions
- **ProjectKey vs ProjectName**: `ProjectKey` (e.g., "PROJ") is more stable than `ProjectName` for filtering
- **Updated field instability**: `[Updated]` changes frequently due to automated updates. Use `[Created]` for more stable time-based analysis
- **Work Items rename**: In 2025, Jira renamed "Issues" to "Work Items" in the UI. The API and this data model still use "Issues". Users may refer to either name
- **Time tracking**: `TimeSpentSeconds` is in seconds — divide by 3600 for hours
- **Custom fields**: Many custom fields exist on the Issues table. Use `getColumns` on Issues to discover them. The connection must have `IncludeCustomFields = true` enabled — the user may need to restart Claude after changing this setting
- **Picklist values**: When looking for available options for an enum field, look for a dedicated table that maintains this information and query from that table. Do not use `SELECT DISTINCT` unless no dedicated table exists
- **Null handling**: Optional fields like `AssigneeDisplayName` and `DueDate` can be NULL for unassigned issues or issues without due dates
- **Date filters are essential**: Large Jira instances will timeout without date filters, especially on the Issues table
- **Test transitions first**: Always query `IssueTransitions` before attempting `ChangeIssueStatus`
- **Check stored procedures**: Some tasks (status transitions, archiving, attachments) require stored procedures rather than SQL queries. Use `getProcedures` to discover available procedures when a query-based approach isn't sufficient
