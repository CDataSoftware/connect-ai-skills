# Exchange — EWS Surface Reference

This reference covers the **Exchange Web Services** surface of the Exchange driver (schema name `EWS`). Load it only after `getSchemas` has returned `EWS` for the connection. For the Microsoft Graph surface, use [msgraph.md](msgraph.md) instead.

EWS is a legacy protocol (Microsoft recommends MSGraph for new work), but it remains the right surface for on-premises Exchange, folder-scoped mail access, tasks, shared-mailbox impersonation, and free/busy scheduling.

The three-part name is always `[Catalog].[EWS].[Table]` — the middle segment is the schema `EWS`, not the connection name:

```sql
SELECT [Subject], [SenderEmailAddress], [DateTimeReceived]
FROM [Exchange_EWS].[EWS].[Inbox]
WHERE [DateTimeReceived] >= '2025-01-01'
ORDER BY [DateTimeReceived] DESC
LIMIT 10
```

## Column-naming convention

EWS uses `PascalCase` columns, flattening nested elements with an underscore:

- `SenderName` / `SenderEmailAddress`, `FromName` / `FromEmailAddress`.
- `ToRecipients_Names` / `ToRecipients_EmailAddresses`, `CcRecipients_Names` / `CcRecipients_EmailAddresses`.
- `OrganizerName` / `OrganizerEmailAddress` on `Calendar`.

`ItemId` is the primary key on every folder/item table (not `id`). Boolean columns (`IsRead`, `HasAttachments`, `IsDraft`, `IsMeeting`, `IsAllDayEvent`, `IsComplete`) filter with `= 1` / `= 0`. Recipient names/addresses arrive as parallel delimited columns rather than a single JSON array.

## Query Process

1. **Pick the folder table.** Mail is exposed per-folder: `Inbox`, `SentItems`, `Drafts`, `DeletedItems`, `JunkEmail`, `Outbox`. Choose the folder that matches the request rather than a single "all mail" table.
2. **Inspect columns with `getColumns`** on the target — item tables are wide (they inherit a large shared item base plus type-specific columns).
3. **Add a date filter** on `DateTimeReceived` (mail), `Start` (calendar), or `DueDate` (tasks), using explicit date literals. **On `Calendar`, only an open-ended lower bound works** — `Start >= '<date>'`. An upper bound or two-sided range returns zero rows (see the Calendar note below); apply any upper bound client-side.
4. **For attendees or attachments, fetch the item first** to get its `ItemId` / attachment ids, then query the attendee tables or call `GetAttachment` (below).
5. **To read another user's mailbox**, use `SharedMailboxEmail` or the `ImpersonationUser` / `ImpersonationType` columns (below).

## Data Model

### Key Tables and Views

- **Inbox / SentItems / Drafts / DeletedItems / JunkEmail / Outbox** (tables) — Mail items, one table per well-known folder. Same message column set on each. Writable (e.g. INSERT a draft into `Drafts`).
- **Folders** (table) — Subfolders of a given folder, for navigating the mailbox tree.
- **Calendar** (table) — Calendar items / meetings. Writable.
- **Calendar_RequiredAttendees** / **Calendar_OptionalAttendees** (tables) — Attendees of an event, with `Name` and `EmailAddress`; **require an `ItemId` filter** (query per event).
- **Calendar_ModifiedOccurrences** (view) — Occurrences of a recurring series that were individually changed.
- **Contacts** (table) — Contact items. Writable.
- **Tasks** (table) — Task items with due dates, status, and completion. Writable.
- **Rooms** / **RoomLists** (views) — Meeting rooms and room lists in the organization. Use the `Rooms` view (filtered by `RoomListEmailAddress`) to list rooms — the `GetRooms` procedure is currently broken (see Stored Procedures). `GetRoomLists` works for the room lists.

### Key Relationships

- `ItemId` is the primary key on every item table; `ParentFolderId` links an item to its folder.
- `ConversationId` / `ConversationTopic` group a mail thread.
- `Calendar_RequiredAttendees` / `Calendar_OptionalAttendees` join to a `Calendar` row by its `ItemId` (supply it as a filter).
- The `Attachments` column on a mail item holds an XML block listing each attachment's `AttachmentId` — feed those ids to `GetAttachment`.

## Important Columns

### Mail items (Inbox, SentItems, Drafts, …)
- `ItemId` — Unique item ID (primary key, read-only).
- `Subject` — Subject line.
- `SenderName` / `SenderEmailAddress` — Sender display name and SMTP address.
- `FromName` / `FromEmailAddress` — From mailbox (differs from Sender for send-on-behalf).
- `ToRecipients_Names` / `ToRecipients_EmailAddresses` — Primary recipients (parallel delimited columns); `CcRecipients_*`, `BccRecipients_*` likewise. **These come back blank in LIST/bulk queries** — bulk EWS `FindItem` returns a limited property set. Get recipients one of two ways: read `DisplayTo` / `DisplayCc` (populated in bulk as display-name strings), or fetch the single item by `ItemId` (`WHERE [ItemId] = '...'`), which hydrates the full parsed name + SMTP-address columns via `GetItem`.
- `DisplayTo` / `DisplayCc` — Concatenated recipient display-name strings; populated in bulk queries (use these when listing, since the structured `*_Names` / `*_EmailAddresses` columns are blank in bulk).
- `DateTimeReceived` / `DateTimeSent` / `DateTimeCreated` — Timestamps (filter and sort on `DateTimeReceived`).
- `IsRead` — Boolean read flag (`0` = unread, `1` = read).
- `HasAttachments` — Boolean attachment flag; `Attachments` — XML listing attachment ids (populated when fetching a single item by `ItemId`).
- `Importance` — `Low` / `Normal` / `High`; `Size` — bytes.
- `Body` / `BodyType` — Body content and format (`HTML` / `Text`).
- `ConversationTopic` / `ConversationId` — Thread grouping.
- `IsDraft` — Draft flag; `Categories` — assigned categories.
- `ImpersonationUser` / `ImpersonationType` — Read as another principal (see Conventions).
- `SharedMailboxEmail` — Set to a shared mailbox address to read its items.

### Calendar
- `ItemId` — Event ID (primary key).
- `Subject` — Event title; `Body` — description.
- `Start` / `End` — Start/end timestamps (filter and sort on `Start`); `OriginalStart` for series. **`Start` supports only an open-ended lower bound**: filter with `Start >= '<date>'` only. An upper bound (`Start <= '<date>'`) or a two-sided range returns **zero rows** — the `Calendar` table maps to the EWS `FindItem` operation, which pages forward from a start point, not the bounded `CalendarView` operation. To scope an end date, add `ORDER BY [Start] ASC` with a `LIMIT` and drop rows past the end date client-side.
- `IsAllDayEvent` — All-day flag; `Duration`; `TimeZone`.
- `Location` — Location text; `When` — human-readable time description.
- `OrganizerName` / `OrganizerEmailAddress` — Organizer.
- `IsMeeting` — Meeting vs plain appointment; `IsCancelled`; `IsRecurring`.
- `LegacyFreeBusyStatus` — Free / Busy / Tentative / OOF; `MyResponseType` — the owner's response.
- `Recurrence_Type`, `Recurrence_Interval`, `Recurrence_StartDate`, `Recurrence_EndDate`, `Recurrence_NumberOfOccurrences` — Recurrence definition.
- `RequiredAttendees` / `OptionalAttendees` — Use the `Calendar_RequiredAttendees` / `Calendar_OptionalAttendees` tables (filter by the event `ItemId`).
- `ImpersonationUser` / `ImpersonationType` / `SharedMailboxEmail` — Cross-mailbox access.

### Contacts
- `ItemId` — Contact ID (primary key).
- `DisplayName` — Full name; `GivenName` / `Surname` / `MiddleName` / `Nickname` — name parts.
- `EmailAddress1` / `EmailAddress2` / `EmailAddress3` — Up to three email addresses (not a JSON array — three discrete columns).
- `BusinessPhone` / `HomePhone` / `MobilePhone` / `CompanyMainPhone` — Phone numbers.
- `CompanyName` / `JobTitle` / `Department` / `OfficeLocation` / `Manager` — Work details.
- `BusinessAddress_Street` / `_City` / `_State` / `_Country` / `_PostalCode` — Structured addresses (`HomeAddress_*`, `OtherAddress_*` likewise).
- `Birthday` / `WeddingAnniversary`; `Notes` — supplementary info.

### Tasks
- `ItemId` — Task ID (primary key).
- `Subject` — Task title; `Body` — details.
- `DueDate` / `StartDate` — Due and start dates; `CompleteDate` — completion date.
- `Status` / `StatusDescription` — Task status; `PercentComplete` — 0–100; `IsComplete` — boolean.
- `Owner` / `Delegator` / `DelegationState` — Ownership and delegation.
- `Importance`; `ReminderDueBy` / `ReminderIsSet`; `Recurrence_*` for recurring tasks.

## Common Query Patterns

### Recent unread inbox mail
```sql
SELECT [Subject], [SenderName], [SenderEmailAddress], [DateTimeReceived]
FROM [Exchange_EWS].[EWS].[Inbox]
WHERE [DateTimeReceived] >= '2025-01-01'
  AND [IsRead] = 0
ORDER BY [DateTimeReceived] DESC
LIMIT 10
```

### Recently sent mail with attachments
Use `DisplayTo` for recipients in a list query — the structured `ToRecipients_*` columns are blank in bulk (see Important Columns).
```sql
SELECT [Subject], [DisplayTo], [DateTimeSent], [HasAttachments]
FROM [Exchange_EWS].[EWS].[SentItems]
WHERE [DateTimeSent] >= '2025-01-01'
  AND [HasAttachments] = 1
ORDER BY [DateTimeSent] DESC
LIMIT 20
```

### Upcoming calendar events
Use an open-ended lower bound only — `Start >= '<date>'` with `ORDER BY [Start] ASC` and a `LIMIT`. Do not add an upper bound on `Start` (it returns zero rows — see the Calendar note under Important Columns); trim to an end date client-side.
```sql
SELECT [Subject], [Start], [End], [Location], [OrganizerName], [LegacyFreeBusyStatus]
FROM [Exchange_EWS].[EWS].[Calendar]
WHERE [Start] >= '2025-01-01'
ORDER BY [Start] ASC
LIMIT 10
```

### Attendees of a specific event
Fetch the event's `ItemId` first, then filter the attendee table by it (the attendee tables key on `ItemId`).
```sql
SELECT [Name], [EmailAddress]
FROM [Exchange_EWS].[EWS].[Calendar_RequiredAttendees]
WHERE [ItemId] = 'AAMkAD...='
```

### Open tasks by due date
```sql
SELECT [Subject], [DueDate], [Status], [PercentComplete]
FROM [Exchange_EWS].[EWS].[Tasks]
WHERE [DueDate] >= '2025-01-01'
  AND [IsComplete] = 0
ORDER BY [DueDate] ASC
```

### Read a shared mailbox
```sql
SELECT [Subject], [SenderEmailAddress], [DateTimeReceived]
FROM [Exchange_EWS].[EWS].[Inbox]
WHERE [SharedMailboxEmail] = 'team-inbox@example.com'
  AND [DateTimeReceived] >= '2025-01-01'
ORDER BY [DateTimeReceived] DESC
LIMIT 10
```

## Stored Procedures

Recipient lists on EWS `SendMail` are **comma-separated** (`a@x.com, b@y.com`).

### SendMail
Composes and sends a new message. `Subject`, `Content`, and `ToRecipients` are required. **Always confirm with the user before sending.**
```sql
EXEC [Exchange_EWS].[EWS].[SendMail]
  Subject = 'Status update',
  Content = 'The report is ready.',
  ToRecipients = 'recipient@example.com'
```
JSON form:
```json
{
  "procedure": "SendMail",
  "parameters": {
    "@Subject": "Status update",
    "@Content": "The report is ready.",
    "@ToRecipients": "recipient@example.com"
  }
}
```
Optional: `@CcRecipients`, `@BccRecipients`, and a single inline attachment via `@AttachmentContent` (base64) + `@AttachmentName`.

### SendItem
Sends an existing item (e.g. a draft in `Drafts`) that already resides in the store — supply the item's `ItemId`. Use this to send a message you built with an INSERT into `Drafts`. Confirm before sending.

### MoveItem
Moves an item (mail or calendar) to another folder — supply the item `ItemId` and destination folder id.

### GetAttachment
Retrieves attachment content for one or more attachments. **Cloud-compatible** — returns base64 content without any disk/stream parameter:

- Required: `@AttachmentIds` — a semicolon-separated list of attachment ids. Get these from the `Attachments` XML column on the mail item (fetch the item by `ItemId` first; each `<AttachmentId Id="…">` is an id).
- Optional: `@IncludeMimeContent`, `@BodyType` (`Best` / `HTML` / `Text`).
- **Do not pass `@FileStream`** — it is an output-stream object the Connect AI interface cannot supply.
- Returns columns including `AttachmentId`, `Name`, `ContentType`, `Size`, and `Content` (base64).

```json
{
  "procedure": "GetAttachment",
  "parameters": { "@AttachmentIds": "AAMkAD...BEgAQ...=" }
}
```

### CreateAttachments / DeleteAttachment
`CreateAttachments` attaches files to an existing message; `DeleteAttachment` removes attachments. Supply attachment content as a base64 string — never a local file path, since cloud environments have no disk access. Attachment *upload* may be rejected in cloud environments; if it fails, that is a current driver limitation. `DeleteAttachment` (by attachment ID) is unaffected.

### GetUserAvailability
Returns free/busy data for a set of users/rooms over a time range — the building block for scheduling. Supply the time window (`StartTime`, `EndTime`, `Timezone`) and the attendees via the required `Mailboxes` parameter.

`Mailboxes` is **not** a plain email address and **not** a raw EWS SOAP `MailboxDataArray`. It requires a CData XML aggregate: a bare sequence of `<Row>` elements with **no outer wrapper element**, where each row has `<Address>`, `<AttendeeType>` (`Required` / `Optional` / `Room`), and `<ExcludeConflicts>`. Multiple attendees are multiple sibling `<Row>` elements.

Common failures:
- Passing a plain email string fails with `STMT RSB The input for [null] was not recognized as a valid table name or aggregate.`
- Wrapping the rows in an element (e.g. `<Mailboxes>` or `<MailboxDataArray>`), or omitting `<AttendeeType>` / `<ExcludeConflicts>` from a row, fails with `[a:ErrorMailboxDataArrayEmpty] The MailboxData array is empty.`

Use a window of at least ~24 hours — very short windows can return no data.

```sql
EXEC [Exchange_EWS].[EWS].[GetUserAvailability]
  StartTime = '2026-07-07T00:00:00',
  EndTime = '2026-07-09T23:59:59',
  Timezone = 'Eastern Standard Time',
  Mailboxes = '<Row><Address>user@example.com</Address><AttendeeType>Required</AttendeeType><ExcludeConflicts>false</ExcludeConflicts></Row>'
```
JSON form (two attendees — sibling `<Row>` elements):
```json
{
  "procedure": "GetUserAvailability",
  "parameters": {
    "@StartTime": "2026-07-07T00:00:00",
    "@EndTime": "2026-07-09T23:59:59",
    "@Timezone": "Eastern Standard Time",
    "@Mailboxes": "<Row><Address>user@example.com</Address><AttendeeType>Required</AttendeeType><ExcludeConflicts>false</ExcludeConflicts></Row><Row><Address>room@example.com</Address><AttendeeType>Room</AttendeeType><ExcludeConflicts>false</ExcludeConflicts></Row>"
  }
}
```

### GetUserOofSettings
Retrieves a user's Out-of-Office (automatic-reply) settings by email address — whether OOF is enabled and the configured messages.

### GetRoomLists / GetRooms
`GetRoomLists` returns the organization's room lists. To list the rooms within a room list, **query the `Rooms` view — not the `GetRooms` procedure.**

```sql
-- Room lists (procedure or the RoomLists view both work)
EXEC [Exchange_EWS].[EWS].[GetRoomLists]

-- Rooms in a specific list — use the Rooms VIEW with a RoomListEmailAddress filter
SELECT [Name], [EmailAddress], [RoomListEmailAddress]
FROM [Exchange_EWS].[EWS].[Rooms]
WHERE [RoomListEmailAddress] = 'roomlist@example.com'
```

The **`GetRooms` procedure is currently non-functional over EXEC** — it fails with a null-reference error (`Cannot invoke ... because the return value of ... is null`) for every input, valid or not, because the proc reads its address parameter under a name the request never populates and then dereferences a null query statement. The `Rooms` view routes to the same underlying EWS operation and works correctly, so it is the supported path. (Driver bug — fix tracked separately.)

For room *usage/occupancy* data (not just the room list), impersonate the room mailbox: set `ImpersonationUser` (or `SharedMailboxEmail`) to the room's address and query its `Calendar` folder. `GetUserAvailability` also returns per-room free/busy when a row uses `<AttendeeType>Room</AttendeeType>` (see that procedure above).

## Write Operations

EWS supports writes through both stored procedures (send/move — above) and direct DML on writable folder/item tables:

- **Draft and send mail** — INSERT into `Drafts`, then `SendItem` with its `ItemId`; or `SendMail` to compose and send in one step.
- **Create / update / delete calendar events** — DML on `Calendar` (control invitations with the `SendMeetingInvitations` / `SendCancellationsMode` columns).
- **Create / update contacts and tasks** — DML on `Contacts` and `Tasks`.

**Recipient columns are singular on INSERT.** The plural, delimited recipient columns you read from `Inbox` / `SentItems` (`ToRecipients_Names`, `ToRecipients_EmailAddresses`) are read-only and **do not exist on `Drafts`**. To set recipients on an INSERT, use the singular columns: `ToRecipients_EmailAddress` and `ToRecipients_Name` (and `CcRecipients_EmailAddress`, `BccRecipients_EmailAddress`). Create a draft with:
```sql
INSERT INTO [Exchange_EWS].[EWS].[Drafts]
  ([Subject], [Body], [ToRecipients_EmailAddress])
VALUES
  ('Status update', 'The report is ready.', 'recipient@example.com')
```
Then send it with `SendItem` using the new row's `ItemId`.

Write access is governed by the Connect AI catalog permissions for the Exchange connection — check the `PERMISSIONS` column from `getCatalogs` (`Insert` / `Update` / `Delete` / `Execute`, not just `Select`). If a write is rejected, the connection is read-only for the current user and access must be granted in Connect AI.

## EWS-Specific Conventions

- **Mail is per-folder.** There is no single "all messages" table — pick `Inbox`, `SentItems`, `Drafts`, `DeletedItems`, `JunkEmail`, or `Outbox` to match the request.
- **`ItemId` is the primary key**, not `id`; every item table carries the same large shared item base plus type-specific columns.
- **Recipients are parallel delimited columns on read** (`ToRecipients_Names` / `ToRecipients_EmailAddresses`), not a JSON array; `SendMail` recipient parameters are comma-separated. **On INSERT (e.g. `Drafts`) the recipient columns are singular** (`ToRecipients_EmailAddress` / `ToRecipients_Name`) — the plural read columns don't exist on `Drafts`. See Write Operations.
- **`Calendar` filters take an open-ended lower bound only** — `Start >= '<date>'`. An upper bound or two-sided range returns zero rows (`Calendar` maps to EWS `FindItem`); order by `Start` and trim the end client-side.
- **Contacts hold three fixed email slots** (`EmailAddress1`–`3`), unlike MSGraph's `emailAddresses` JSON array.
- **Structured recipient columns are blank in bulk reads.** `ToRecipients_Names` / `ToRecipients_EmailAddresses` (and Cc/Bcc) populate only on a single-item fetch by `ItemId` (`GetItem`) — this is expected EWS behavior, not missing data. When listing, read `DisplayTo` / `DisplayCc` (populated in bulk), or re-fetch the row by `ItemId` for the parsed name + SMTP columns. Same single-fetch rule as the `Attachments` column.
- **Attendee and attachment access is two-step**: fetch the item's `ItemId` (and its `Attachments` XML for attachment ids), then query `Calendar_RequiredAttendees` / `Calendar_OptionalAttendees` or call `GetAttachment`.
- **Cross-mailbox access** is available via `SharedMailboxEmail` (shared mailboxes) or the `ImpersonationUser` / `ImpersonationType` columns (impersonation), subject to Exchange permissions.
- **Attachment retrieval returns base64** (`Content`) with no disk/stream parameter — never pass `@FileStream`.
- **Scheduling helpers**: `GetUserAvailability` (free/busy), `GetUserOofSettings` (out-of-office), and room discovery have no MSGraph equivalent here — they are an EWS strength. For rooms, use `GetRoomLists` plus the `Rooms` view; the `GetRooms` procedure is currently broken over EXEC (see its section).
- **Confirm before any mail or calendar action** — send, move, invitation, or item writes all change the live mailbox.
