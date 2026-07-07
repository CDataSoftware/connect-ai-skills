---
name: connect-ai-exchange
description: Use when querying Microsoft Exchange data through CData Connect AI. Exchange exposes two different API surfaces — Microsoft Graph (MSGraph) and the legacy Exchange Web Services (EWS) — that present entirely different data models, table names, and column conventions. This skill identifies which surface a connection uses and routes to the matching reference for the data model, query patterns, stored procedures, write operations, and conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Exchange
  family: collaboration
---

# CData Connect AI — Exchange Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Exchange-specific guidance for querying Microsoft Exchange data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the Exchange driver. Do not call `getInstructions` for Exchange — the guidance it provides is already incorporated here and in the per-surface references. Proceed directly to `getSchemas` (to identify the surface — see below) and then schema discovery (`getTables` / `getColumns`) after identifying the Exchange connection via `getCatalogs`.

## Exchange exposes two API surfaces

An Exchange connection presents one of **two completely different surfaces**, determined by the CData `Schema` connection property. The surface changes the entire object model — table names, the way mailbox folders are exposed, column-naming conventions, available stored procedures, and write mechanics all differ. **The surface cannot be inferred from the connection name**, so the first move on any Exchange connection is to identify it with `getSchemas`.

> **Always run `getSchemas` as the FIRST tool call against any Exchange connection** — before any `queryData`, `getTables`, or `getColumns` call. **Do not infer the surface from the connection name.** A name may carry an `_MSGraph`, `_EWS`, or similar hint, but this is not a reliable surface indicator. The schema returned by `getSchemas` is the only authoritative signal: `MSGraph` → Graph surface, `EWS` → EWS surface.

| Surface | `Schema` property | Schema returned by `getSchemas` | Object model | Column convention |
|---|---|---|---|---|
| **Microsoft Graph** (recommended) | `MSGraph` | `MSGraph` | One `Messages` table for all mail plus `Events` / `CalendarView` / `Contacts`, directory objects (`Users`, `Groups`), and tenant-wide M365 usage-report views | `camelCase`, nested paths flattened with `_` (`from_emailAddress_address`, `start_dateTime`) |
| **Exchange Web Services** (legacy) | `EWS` | `EWS` | Each mailbox folder is its own table (`Inbox`, `SentItems`, `Drafts`, `DeletedItems`, `JunkEmail`, `Outbox`), plus `Calendar`, `Contacts`, `Tasks`, and room/attendee objects | `PascalCase`, nested paths flattened with `_` (`SenderEmailAddress`, `ToRecipients_EmailAddresses`) |

Microsoft recommends the MSGraph surface; EWS is a legacy protocol that Microsoft is deprecating. Prefer MSGraph for new work. EWS remains useful for on-premises Exchange, folder-scoped mail access, tasks, shared-mailbox impersonation, and free/busy scheduling — see its reference.

## Step 1 — Identify the surface with `getSchemas`

Run `getSchemas` on the Exchange connection before anything else:

- Returns **`MSGraph`** → Graph surface → load [references/msgraph.md](references/msgraph.md).
- Returns **`EWS`** → EWS surface → load [references/ews.md](references/ews.md).

## Step 2 — Load the matching surface reference

Each surface has its own reference with the full data model, query workflow, important columns, query patterns, stored procedures, write operations, and conventions. Read the one that matches the surface identified in Step 1 before writing queries:

- **MSGraph** → [references/msgraph.md](references/msgraph.md) — the `Messages` / `Events` / `CalendarView` / `Contacts` model, the flattened `camelCase` column convention, the ORDER BY / WHERE pairing rule, M365 usage-report views, mail and calendar stored procedures, attachment download via base64, and MSGraph conventions.
- **EWS** → [references/ews.md](references/ews.md) — the folder-as-table model (`Inbox`, `SentItems`, `Drafts`, …), `Calendar` / `Contacts` / `Tasks`, the `PascalCase` column convention, attendee and room objects, shared-mailbox impersonation, free/busy and out-of-office procedures, attachment retrieval via base64, and EWS conventions.

The three-part name is always `[Catalog].[Schema].[Table]`:

```sql
-- MSGraph surface
SELECT * FROM [Exchange_MSGraph].[MSGraph].[Messages] LIMIT 10
-- EWS surface
SELECT * FROM [Exchange_EWS].[EWS].[Inbox] LIMIT 10
```

The middle segment is the **schema** (`MSGraph` or `EWS`), not the connection name and not a "driver name." Replace the catalog with the actual Exchange connection name from `getCatalogs`.

## Cross-cutting Exchange conventions

These hold conceptually on both surfaces, though the exact table and column names differ — see each reference for specifics.

- **Identify the surface first.** It dictates the object model, how mail folders are exposed, column conventions, and the stored-procedure set. Never assume — run `getSchemas`.
- **Date-filter mail and calendar queries.** Mailbox and calendar tables are large and paged against a live API. Always constrain by a date column (`receivedDateTime` / `start_dateTime` on MSGraph; `DateTimeReceived` / `Start` on EWS) to avoid timeouts.
- **Use explicit date literals, not date functions.** Prefer `'2025-01-01'` over `GETDATE()` / `DATEADD()` — literal dates push down to the API and perform far better in Connect AI.
- **Booleans use `1`/`0`.** Read/attachment flags are real boolean columns; filter with `= 1` / `= 0` (Connect AI's boolean literals).
- **Confirm before any mail or calendar action.** Sending, forwarding, replying, moving, responding to invitations, or writing rows changes the user's live mailbox — confirm with the user first.
- **Discover columns with `getColumns` before querying.** Both surfaces expose wide tables with many flattened nested columns, and names differ sharply between them. Confirm names on the live connection rather than assuming.
- **Writes are governed by Connect AI catalog permissions.** Check the `PERMISSIONS` column from `getCatalogs`: a connection must show `Insert` / `Update` / `Delete` / `Execute` (not just `Select`) for the corresponding operation to succeed. If a write is rejected, the connection is read-only for the current user and access must be granted in Connect AI.
