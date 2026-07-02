---
name: connect-ai-gmail
description: Use when querying Gmail data through CData Connect AI. Covers the Gmail data model (messages, threads, drafts, labels, attachments, and account settings), the label-as-view pattern, SearchQuery-based filtering, attachment retrieval via base64, mail-sending and labeling stored procedures, and Gmail-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Gmail
  family: collaboration
---

# CData Connect AI — Gmail Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Gmail-specific guidance for querying Gmail data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Gmail driver. Do not call `getInstructions` for Gmail — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Gmail connection via `getCatalogs`.

## Schema

Gmail is a single-schema driver. The schema name is `REST`. (IMAP is a legacy schema that can be selected through connection properties; the REST schema is the default and is assumed throughout this skill.)

The middle segment of every three-part name must be `REST` — always `[Gmail_DB].[REST]`. Note that the cai-toolkit `gmail_db_*` tool descriptions may advertise the schema as "Gmail", but the live schema is `REST`; using `[Gmail]` fails with an invalid-schema error.

Three-part names take the form:

```sql
SELECT [Subject], [From], [Date]
FROM [Gmail_DB].[REST].[Messages]
WHERE [SearchQuery] = 'is:unread'
ORDER BY [Date] DESC
LIMIT 10
```

Replace `Gmail_DB` with the actual Gmail connection (catalog) name from `getCatalogs`.

## Query Process

1. **Identify the object you need.** Most requests target `Messages` (or a label view), `Threads`, `Labels`, or `Attachments`. Use `getColumns` on the target before querying.
2. **Filter messages with `SearchQuery`.** For the `Messages` table, the `SearchQuery` pseudo-column is the most efficient filter — it passes native Gmail search operators to the server and takes precedence over any other SQL `WHERE` criteria. Fall back to ordinary column predicates only for fields Gmail search does not cover.
3. **Fetch a single message for full detail.** Some columns (`AttachmentIds`) and the Labels count columns are only populated when you filter to a single row by `Id`. If a bulk list shows those columns empty, re-query the one row by `Id`.
4. **Retrieve attachment content** by filtering the `Attachments` table on `MessageId`, or by calling the `DownloadAttachments` procedure — both return base64 in cloud environments (see Stored Procedures).

## Data Model

### Key Tables and Views

- **Messages** — Core email data (subject, sender, recipients, date, snippet, body, labels, attachment IDs). The central table for most queries.
- **Draft** — Unsent draft messages; the same email fields as Messages plus a `MessageId`. Supports INSERT to create a draft.
- **Sent** — Sent messages.
- **Threads** — Email conversation threads, keyed by `Id`, with a `Snippet` and `HistoryID`.
- **Labels** — Gmail labels: display `Name`, `Type` (`system` or `user`), and message/thread counts.
- **MessageLabels** — Join table with one row per (message `Id`, `LabelId`) pair. Use it to find which labels a message carries, or which messages carry a label, without parsing the comma-separated `Labels` string on Messages.
- **Attachments** — Attachment metadata and base64 content, keyed by `MessageId` + `Id`.
- **Settings tables** — `AutoForwarding`, `Delegates`, `Filters`, `ForwardingAddresses`, `Language`, `SendAs`, `SendAsAliasSmimeInfo`, `Vacation`, `Users`. Query these for account configuration rather than mail content.

### The label-as-view pattern

Every Gmail label — system and user-created — surfaces as its own **view** named after the label. Each view is a pre-filtered set of messages that shares the Messages columns.

- **System label views:** `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, `SENT`, `SPAM`, `TRASH`, `CHAT`, and the categories `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`.
- **User label views:** one per user-created label (e.g. `Work`, `Receipts`, and any nested `Parent/Child` labels).

Because of this, a full `getTables` listing is long and volatile — it grows and changes as the account's labels change, and includes many ad-hoc user labels. Do not rely on the full table list being stable. To filter by a well-known set, query the matching system view (e.g. `UNREAD`); to discover labels programmatically, query the `Labels` table; to filter Messages by arbitrary label IDs, use the `LabelsFilter` pseudo-column.

### Key Relationships

- `Messages.ThreadId` → `Threads.Id` — messages belong to a thread.
- `Messages.Id` → `MessageLabels.Id`, and `MessageLabels.LabelId` → `Labels.Id` — the many-to-many message↔label relationship.
- `Attachments.MessageId` → `Messages.Id` — attachments belong to a message; `Messages.AttachmentIds` lists the IDs.

## Important Columns

### Messages
- `Id` — Unique message ID (primary key).
- `Subject`, `From`, `To`, `CC`, `BCC` — Subject and addresses. (In `getColumns`, the `CC`/`BCC` descriptions are mislabeled by the driver as "the primary email address of the user"; they are in fact the CC and BCC recipients.)
- `Content` — Full message body.
- `Snippet` — Short preview of the body.
- `Date` — Timestamp the email was sent.
- `Size` — Size of the email in bytes.
- `Labels` — Comma-separated list of label IDs applied to the message.
- `AttachmentIds` — Comma-separated attachment IDs; populated only when fetching a single message by `Id`.
- `AttachmentPath` — Path used when supplying attachments on write.
- `ThreadId` — ID of the containing thread.
- `HistoryId`, `Headers` — History record ID and full header list.
- `RawMessage` — Full RFC 2822, base64url-encoded message; only returned when `MessageFormat=raw`.
- `SearchQuery` (filter-only pseudo-column) — Native Gmail search string; evaluated server-side and takes precedence over other SQL criteria.
- `LabelsFilter` (pseudo-column) — Comma-separated label IDs to restrict results. Multiple IDs are ANDed — results are messages carrying **all** listed labels (e.g. `'UNREAD,IMPORTANT'` returns messages that are both unread AND important).
- `IncludeSpamTrash` (pseudo-column) — Set to `true` to include SPAM and TRASH messages, which are excluded by default.
- `MessageFormat` (pseudo-column) — `minimal`, `full`, `raw`, or `metadata` (default `full`).

### Labels
- `Id` — Immutable label ID (e.g. `INBOX`, `UNREAD`, or a user-label ID). Primary key, read-only.
- `Name` — Display name (writable).
- `Type` — `system` or `user` (read-only).
- `MessageListVisibility` — `SHOW` or `HIDE`.
- `LabelListVisibility` — `LabelShow`, `LabelHide`, or `LabelShowIfUnread`.
- `MessagesTotal`, `MessagesUnread`, `ThreadsTotal`, `ThreadsUnread` — Counts; populated only when filtering to a single label by `Id`, not in bulk list queries.

### Attachments
- `Id` — Attachment identifier within the message (returned as a sequential index, e.g. `1`, `2`, `3`).
- `MessageId` — ID of the containing message. **Required as a filter** — the table cannot be queried without it.
- `Filename` — Attachment file name.
- `Size` — Size in bytes. Not populated in metadata-only mode (`IncludeAttachmentData = false`); returned only on a full data pull or via `DownloadAttachments`.
- `Data` — Attachment content encoded as **URL-safe base64** (uses `-` and `_` instead of `+` and `/`). Decode with a URL-safe base64 decoder (e.g. Python `base64.urlsafe_b64decode`), not a standard base64 decoder.
- `IncludeAttachmentData` (pseudo-column) — Whether to include `Data` (default `true`); set to `false` to fetch metadata only. In metadata-only mode `Size` comes back empty — a full data pull (or `DownloadAttachments`) is required to get `Size`.

### MessageLabels
- `Id` — Message ID (key).
- `LabelId` — Label ID applied to that message (key). One row per applied label.

## Common Query Patterns

### Search messages with Gmail search syntax
`SearchQuery` is the most efficient filter for Messages and takes precedence over other SQL criteria.
```sql
SELECT [Subject], [From], [Date]
FROM [Gmail_DB].[REST].[Messages]
WHERE [SearchQuery] = 'has:attachment from:google.com newer_than:30d'
ORDER BY [Date] DESC
LIMIT 10
```

### Recent unread messages
Gmail has no `isRead` column — read state is a label — so query the `UNREAD` view (or `is:unread` in `SearchQuery`). The view returns newest-first natively, so `LIMIT 10` alone is enough — do not add `ORDER BY [Date]` here (sorting the full UNREAD set times out; see Gmail-Specific Conventions).
```sql
SELECT [Subject], [From], [Date], [Snippet]
FROM [Gmail_DB].[REST].[UNREAD]
LIMIT 10
```

### List labels
Count columns are not populated when listing all labels.
```sql
SELECT [Id], [Name], [Type]
FROM [Gmail_DB].[REST].[Labels]
ORDER BY [Name]
```

### Get message and thread counts for one label
Filter to a single label by `Id` to populate the count columns.
```sql
SELECT [Id], [Name], [MessagesTotal], [MessagesUnread], [ThreadsTotal]
FROM [Gmail_DB].[REST].[Labels]
WHERE [Id] = 'INBOX'
```

### Restrict messages to specific labels
Use `LabelsFilter` with a comma-separated list of label IDs. The list is ANDed — this returns messages carrying **all** listed labels (below: messages that are both unread AND important).
```sql
SELECT [Subject], [From], [Date]
FROM [Gmail_DB].[REST].[Messages]
WHERE [LabelsFilter] = 'UNREAD,IMPORTANT'
```

### Retrieve attachment content
Query the `Attachments` table filtered by `MessageId`. `Data` is returned as base64. (The `DownloadAttachments` procedure returns the same content — see Stored Procedures.)
```sql
SELECT [Id], [Filename], [Size], [Data]
FROM [Gmail_DB].[REST].[Attachments]
WHERE [MessageId] = '19f1c11dc1070717'
```
To list attachment metadata without pulling the (potentially large) `Data` payload, set `IncludeAttachmentData` to `false`. Note `Size` is not populated in this mode, so omit it:
```sql
SELECT [Id], [Filename]
FROM [Gmail_DB].[REST].[Attachments]
WHERE [MessageId] = '19f1c11dc1070717' AND [IncludeAttachmentData] = false
```

## Stored Procedures

### SendMailMessage
Sends an email. Parameters: `To`, `Subject`, `Content` (body), and optional `From`, `CC`, `BCC`, `Attachments` (a temp-table name or JSON aggregate of attachment content). **Always confirm with the user before sending.**
```sql
EXEC [Gmail_DB].[REST].[SendMailMessage] To = 'recipient@example.com', Subject = 'Status update', Content = 'The report is attached.'
```
JSON form:
```json
{
  "procedure": "SendMailMessage",
  "parameters": {
    "To": "recipient@example.com",
    "Subject": "Status update",
    "Content": "The report is attached."
  }
}
```

### ReplyToMailMessage
Replies to an existing message, preserving the thread. Supply the message ID being replied to plus the reply body.

### SendDraft
Sends an existing draft to the recipients in its To/Cc/Bcc headers. Supply the draft ID.

### UpdateMessageLabels
Adds or removes labels on one or more messages (mark read/unread, archive, star, etc.). Parameters: `MessageIds` (up to 1000, comma-separated), `LabelsToAdd`, `LabelsToRemove` (label IDs, up to 100 each). Marking a message read means removing the `UNREAD` label.
```sql
EXEC [Gmail_DB].[REST].[UpdateMessageLabels] MessageIds = '19f1c11dc1070717', LabelsToRemove = 'UNREAD'
```

### TrashMessage / UntrashMessage
Move a message to or from the trash by message ID. Confirm before trashing.

### DownloadAttachments
Downloads all attachments of a single message. Parameters: `MessageId` (required), and optional `AttachmentId` and `FileStream`. **Do not pass `FileStream`** — it is an output-stream object that the Connect AI interface cannot supply (and there is no `DownloadLocation` disk-path parameter on this driver). Calling with just `MessageId` (optionally `AttachmentId` for a single attachment) **does** return a row per attachment with columns `Success`, `MessageId`, `AttachmentId`, `Size`, `Data` (base64), and `Filename` — validated over both the generic Connect AI MCP and the cai-toolkit surface.
```json
{
  "procedure": "DownloadAttachments",
  "parameters": { "MessageId": "19f1c11dc1070717" }
}
```
This is the procedure equivalent of querying the `Attachments` table — the two are interchangeable, not one a workaround for the other. Use whichever fits: `DownloadAttachments` returns every attachment for a message in one call; the `Attachments` table lets you select individual columns and skip the payload via `IncludeAttachmentData = false`.

### Settings and account procedures
`GetUserProfile`, `GetAutoForwarding` / `UpdateAutoForwarding`, `GetVacations` / `UpdateVacations`, `GetLanguage` / `UpdateLanguage`, `GetImap` / `UpdateImap`, `GetPop` / `UpdatePop`, `ImportMessage`, `StartNotifications` / `StopNotifications`, and the send-as S/MIME procedures (`SetDefaultSendAsAliasSmimeConfig`, `VerifySendAs`). Use these for account configuration and mailbox administration.

## Write Operations

Gmail supports writes through both stored procedures (sending, replying, labeling, trashing — above) and direct DML on writable tables:

- **Create a draft** — INSERT into `Draft` (`To`, `Subject`, `Content`, and optionally `From`, `CC`, `BCC` are writable).
- **Create or rename a label** — INSERT or UPDATE `Labels` (`Name`, `MessageListVisibility`, `LabelListVisibility` are writable).
- **Forwarding, vacation, delegates, send-as** — the corresponding settings tables/procedures.

Write access is governed by the Connect AI catalog permissions for the Gmail connection. Check the `PERMISSIONS` column from `getCatalogs`: a connection must show `Insert` / `Update` / `Delete` / `Execute` (not just `Select`) for the corresponding operation to succeed. If a write is rejected, the connection is read-only for the current user and access must be granted in Connect AI.

**No DELETE path over MCP.** The Connect AI MCP surface exposes no delete operation (there is no `execute_delete`), even when the connection has `Delete` permission — so a row cannot be removed with `DELETE FROM ...` over MCP. To discard a draft, call the `TrashMessage` procedure with the draft's `MessageId` (from the `Draft` table's `MessageId` column).

## Gmail-Specific Conventions

- **Every label is a view.** The table list contains one view per Gmail label (system and user), so it is long and changes with the account. Discover labels via the `Labels` table; filter via system views (`UNREAD`, `INBOX`, …) or the `LabelsFilter` pseudo-column rather than trusting the raw table list.
- **`SearchQuery` beats SQL predicates.** It runs server-side and takes precedence over other `WHERE` criteria. Use Gmail operators (`from:`, `to:`, `subject:`, `has:attachment`, `after:`, `before:`, `newer_than:`, `is:unread`, `label:`) for the fastest, most accurate filtering.
- **`has:attachment` over-matches.** It also matches delivery-status-notification and `message/rfc822` messages whose `AttachmentIds` is empty (no downloadable file parts). Treat an empty `AttachmentIds` as "no files to download" even when `has:attachment` matched the message.
- **Avoid `ORDER BY [Date]` on large or unfiltered sets.** Sorting a big result set (e.g. all `UNREAD`, ~20k rows) times out and drops the MCP connection. It is fine over a `SearchQuery`-filtered small set. Prefer narrowing with `SearchQuery` before sorting, or rely on Gmail's native newest-first order.
- **No read/unread column.** Read state is the `UNREAD` label. Query the `UNREAD` view or `is:unread`; mark read by removing the `UNREAD` label via `UpdateMessageLabels`.
- **Single-fetch-only columns.** `AttachmentIds` on Messages and the count columns on Labels populate only when you query one row by its `Id`, not in bulk list queries.
- **Attachments require a `MessageId` filter** and return content as base64 in `Data`. Set `IncludeAttachmentData = false` to skip the payload when you only need metadata.
- **SPAM and TRASH are excluded by default.** Set `IncludeSpamTrash = true` to include them.
- **`CC`/`BCC` column descriptions are mislabeled** by the driver as "the primary email address of the user"; they are the CC and BCC recipients.
- **Confirm before any mail action** — sending, replying, trashing, or relabeling changes the user's live mailbox.