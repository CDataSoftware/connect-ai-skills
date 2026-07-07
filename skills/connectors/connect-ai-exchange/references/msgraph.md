# Exchange — MSGraph Surface Reference

This reference covers the **Microsoft Graph** surface of the Exchange driver (schema name `MSGraph`). Load it only after `getSchemas` has returned `MSGraph` for the connection. For the EWS surface, use [ews.md](ews.md) instead.

The three-part name is always `[Catalog].[MSGraph].[Table]` — the middle segment is the schema `MSGraph`, not the connection name:

```sql
SELECT [subject], [from_emailAddress_address], [receivedDateTime]
FROM [Exchange_MSGraph].[MSGraph].[Messages]
WHERE [receivedDateTime] >= '2025-01-01'
ORDER BY [receivedDateTime] DESC
LIMIT 10
```

## Column-naming convention

MSGraph flattens the Graph API's nested JSON into `camelCase` columns, joining nested paths with an underscore:

- `from_emailAddress_address`, `from_emailAddress_name` — the Graph `from.emailAddress.address` / `.name`.
- `start_dateTime`, `start_timeZone`, `end_dateTime`, `end_timeZone` — event start/end.
- `location_displayName`, `organizer_emailAddress_name`, `responseStatus_response`.
- `body_content`, `body_contentType`, `flag_flagStatus`.

Collection fields (`toRecipients`, `ccRecipients`, `bccRecipients`, `attendees`, `emailAddresses`) come back as JSON arrays in a single VARCHAR column. Boolean columns (`isRead`, `hasAttachments`, `isCancelled`, `isOnlineMeeting`, `isAllDay`) are real booleans — filter with `= 1` / `= 0`.

## Query Process

1. **Identify the object.** Most requests target `Messages` (email), `CalendarView` or `Events` (calendar), or `Contacts`. Tenant-wide reporting requests map to the M365 usage-report views.
2. **Inspect columns with `getColumns`** on the target table before querying — the tables are wide and use flattened `_` paths.
3. **Always add a date filter** on `receivedDateTime` (Messages) or `start_dateTime` (calendar) to avoid timeouts, using explicit date literals.
4. **Obey the ORDER BY / WHERE pairing rule** (below) whenever you sort.
5. **For calendar, choose `CalendarView` vs `Events`** deliberately (below). Use `CalendarView` for "what's on the calendar between these dates" (it expands recurring series); use `Events` to read or write a specific event.

## The ORDER BY / WHERE pairing rule

The Graph API requires that any property used in `ORDER BY` also be filtered in `WHERE`, and appear **first** in the `WHERE` clause, in the same order, before any other filters.

```sql
SELECT [subject], [from_emailAddress_name], [receivedDateTime]
FROM [Exchange_MSGraph].[MSGraph].[Messages]
WHERE [receivedDateTime] >= '2025-01-01'   -- ORDER BY field first
  AND [subject] LIKE '%invoice%'            -- non-ORDER BY filters after
ORDER BY [receivedDateTime] DESC
LIMIT 20
```

- ✅ ORDER BY fields → first in `WHERE`, in the same order.
- ✅ All other filters → after the ORDER BY fields.
- ❌ Never `ORDER BY` a field that has no corresponding `WHERE` filter — the query fails or returns nothing.

## Data Model

### Key Tables and Views

- **Messages** (table) — Every mail item across the mailbox in one table (not per-folder). Subject, sender, recipients, body, read/attachment status, `parentFolderId` for the containing folder. The central table for most email requests. Writable.
- **Events** (table) — Calendar events with organizer, attendees, recurrence, online-meeting details, response status. Writable — create/update/delete events here.
- **CalendarView** (view, read-only) — A date-windowed, recurrence-expanded view of events. Use for "what's scheduled between two dates." Requires a `start_dateTime` range in practice; read-only.
- **Calendars** / **CalendarGroups** (tables) — The user's calendars and calendar groups; `Events` rows carry a `calendarId`.
- **Contacts** (table) — Personal contacts. Writable.
- **MailFolders** (table) — Mailbox folders (`Inbox`, `SentItems`, custom folders); join `Messages.parentFolderId` to a folder `id`.
- **MessageAttachments** / **EventAttachments** (views) — Attachment metadata for messages / events.
- **EventInstances** (view) — Individual occurrences expanded from a recurring event's `seriesMasterId`.
- **Users** / **Groups** / **GroupMembers** (tables) — Directory objects available through the same Graph connection.
- **M365 usage-report views** — Tenant-wide activity reports: `EmailActivityUserDetail`, `EmailAppUsageUserDetail`, `MailboxUsageDetails`, `M365AppUserDetail`, `Office365ActiveUserDetail`, `Office365ActivationsUserDetail`, `Office365GroupsActivityDetail`, `OneDriveActivityUserDetail`, `OneDriveUsageAccountDetail`, `SharePointActivityUserDetail`, `SharePointSiteUsageDetail`, `TeamsUserActivityUserDetail`, `TeamsDeviceUsageUserDetail`, `SkypeForBusinessActivityUserDetail`, `SkypeForBusinessDeviceUsageUserDetail`, `YammerActivityUserDetail`, `YammerDeviceUsageUserDetail`, `YammerGroupsActivityDetail`. These require tenant admin consent and report on the whole tenant, not the signed-in mailbox. They use **PascalCase** columns and require a `Period` or `Date` filter (see the query pattern below).

### CalendarView vs Events

Both expose the same event columns. `Events` is the writable base table (one row per event / series master). `CalendarView` is a read-only projection that expands recurring series into individual dated occurrences within a requested window — better for calendar displays, but you cannot INSERT/UPDATE through it.

### Key Relationships

- `Messages.parentFolderId` → `MailFolders.id` — the folder a message lives in.
- `Messages.conversationId` groups a mail thread.
- `Events.calendarId` → `Calendars.id` — the calendar an event belongs to.
- `EventInstances.seriesMasterId` → `Events.id` — occurrences of a recurring event.
- `MessageAttachments` / `EventAttachments` join to their parent by the message/event `id`.

## Important Columns

### Messages
- `id` — Unique message ID (primary key).
- `subject` — Subject line.
- `from_emailAddress_address` / `from_emailAddress_name` — Sender address and display name.
- `sender_emailAddress_address` / `sender_emailAddress_name` — Actual sending mailbox (differs from `from_*` for send-on-behalf).
- `receivedDateTime` / `sentDateTime` — Received / sent timestamps (use for date filters and sorting).
- `isRead` — Boolean read flag (`0` = unread, `1` = read).
- `hasAttachments` — Boolean attachment flag. See the `has:attachment` caveat under Conventions.
- `importance` — `low` / `normal` / `high`.
- `bodyPreview` — Short body preview; `body_content` — full body; `body_contentType` — `html` / `text`.
- `toRecipients` / `ccRecipients` / `bccRecipients` — JSON arrays of recipients.
- `conversationId` — Thread identifier; `parentFolderId` — containing folder.
- `flag_flagStatus` — Follow-up flag state; `isDraft` — draft flag; `webLink` — open-in-OWA URL.

### Events / CalendarView
- `id` — Event ID (primary key). `CalendarView` rows are read-only.
- `subject` — Event title.
- `start_dateTime` / `end_dateTime` — Start / end (VARCHAR; pair with `start_timeZone` / `end_timeZone`). Filter and sort on `start_dateTime`.
- `isAllDay` — All-day flag.
- `location_displayName` — Location name (full address in `location_address_*`).
- `organizer_emailAddress_name` / `organizer_emailAddress_address` — Organizer.
- `attendees` — JSON array of attendees; `isOrganizer` — whether the mailbox owner organizes.
- `responseStatus_response` — Owner's response (`accepted` / `declined` / `tentativelyAccepted` / `none`).
- `isOnlineMeeting` / `onlineMeeting_joinUrl` — Online-meeting flag and join link.
- `isCancelled` — Cancelled flag; `showAs` — free/busy status; `sensitivity` — normal/private/etc.
- `recurrence_pattern_type`, `recurrence_range_*` — Recurrence definition; `seriesMasterId` — parent series (populated on occurrences).
- `reminderMinutesBeforeStart` / `isReminderOn` — Reminder settings.

### Contacts
- `id` — Contact ID (primary key).
- `displayName` — Full name. **Always include `[displayName]` in the SET clause of any Contact UPDATE**, even when you aren't changing it — otherwise the Graph API overwrites it with an auto-generated value.
- `givenName` / `surname` / `middleName` / `nickName` — Name parts.
- `emailAddresses` — JSON array of addresses; `primaryEmailAddress_address` — primary address.
- `mobilePhone` / `businessPhones` / `homePhones` — Phone numbers.
- `companyName` / `jobTitle` / `department` / `officeLocation` — Work details.
- `businessAddress_*` / `homeAddress_*` — Structured addresses; `birthday`; `manager`.

## Common Query Patterns

### Recent unread messages
```sql
SELECT [subject], [from_emailAddress_address], [from_emailAddress_name], [receivedDateTime], [bodyPreview]
FROM [Exchange_MSGraph].[MSGraph].[Messages]
WHERE [receivedDateTime] >= '2025-01-01'
  AND [isRead] = 0
ORDER BY [receivedDateTime] DESC
LIMIT 10
```

### Messages with attachments matching a subject
`receivedDateTime` leads the WHERE because it is the ORDER BY field.
```sql
SELECT [subject], [from_emailAddress_name], [receivedDateTime], [hasAttachments]
FROM [Exchange_MSGraph].[MSGraph].[Messages]
WHERE [receivedDateTime] >= '2025-01-01'
  AND [hasAttachments] = 1
  AND [subject] LIKE '%invoice%'
ORDER BY [receivedDateTime] DESC
LIMIT 20
```

### Upcoming meetings (CalendarView)
```sql
SELECT [subject], [start_dateTime], [end_dateTime], [location_displayName], [organizer_emailAddress_name]
FROM [Exchange_MSGraph].[MSGraph].[CalendarView]
WHERE [start_dateTime] >= '2025-01-01'
ORDER BY [start_dateTime] ASC
LIMIT 10
```

### Search contacts by name
```sql
SELECT [displayName], [emailAddresses], [mobilePhone], [companyName], [jobTitle]
FROM [Exchange_MSGraph].[MSGraph].[Contacts]
WHERE [displayName] LIKE '%Smith%'
ORDER BY [displayName]
```

### Email activity report (tenant admin)
The usage-report views use **PascalCase** columns (unlike the rest of MSGraph) and require a `Period` (`D7` / `D30` / `D90` / `D180`) or a `Date` (within the last 30 days) filter.
```sql
SELECT [UserPrincipalName], [DisplayName], [SendCount], [ReceiveCount], [ReadCount]
FROM [Exchange_MSGraph].[MSGraph].[EmailActivityUserDetail]
WHERE [Period] = 'D7'
```

## Stored Procedures

Recipient lists on MSGraph procedures are **semicolon-separated** (`a@x.com; b@y.com`).

### SendMail
Composes and sends a new message, or sends an existing draft when `@Id` is supplied. **Always confirm with the user before sending.**
```sql
EXEC [Exchange_MSGraph].[MSGraph].[SendMail]
  ToRecipients = 'recipient@example.com',
  Subject = 'Status update',
  Content = 'The report is ready.'
```
JSON form:
```json
{
  "procedure": "SendMail",
  "parameters": {
    "@ToRecipients": "recipient@example.com",
    "@Subject": "Status update",
    "@Content": "The report is ready."
  }
}
```
Optional parameters: `@CcRecipients`, `@BccRecipients`, `@ContentType` (`HTML`/`Text`), `@Id` (send an existing draft/message by ID), `@SenderEmail` / `@FromEmail` (send-on-behalf), `@UserId` (impersonated mailbox), and attachment parameters (`@Attachments` as `filename,base64content; …`, or `@FileName` + `@ContentBytes`). See the attachment note below.

### ForwardMail / ReplyToMessage
`ForwardMail` forwards an existing message to new recipients; `ReplyToMessage` replies while preserving the thread. Both are send actions — first query the `Messages` table to get the target message's `id` (locate-then-send), then **confirm with the user before sending**.

`ForwardMail` parameters:
- `MessageId` (required) — the `id` of the message to forward (from the `Messages` table).
- `ToRecipients` (required) — semicolon-separated recipient addresses (e.g. `user1@example.com; user2@example.com`).
- `Comment` — optional text added above the forwarded content.
- `UserId` — the acting / impersonated mailbox.

```sql
EXEC [Exchange_MSGraph].[MSGraph].[ForwardMail]
  MessageId = 'AAMkAD...=',
  ToRecipients = 'user1@example.com; user2@example.com',
  Comment = 'Forwarding for your review.'
```

`ReplyToMessage` parameters:
- `MessageId` (required) — the `id` of the message being replied to (obtain it from the `Messages` table).
- `Comment` — the reply body text.
- `ToAll` — reply-all flag: reply to all original recipients (`true`) or the sender only (`false`).
- `UserId` — the acting / impersonated mailbox.

```sql
EXEC [Exchange_MSGraph].[MSGraph].[ReplyToMessage]
  MessageId = 'AAMkAD...=',
  Comment = 'Thanks — confirming receipt.'
```
JSON form:
```json
{
  "procedure": "ReplyToMessage",
  "parameters": {
    "@MessageId": "AAMkAD...=",
    "@Comment": "Thanks — confirming receipt.",
    "@ToAll": "false"
  }
}
```

### RespondToEvent
Responds to a calendar invitation. Locate the event in `Events` / `CalendarView` first, then confirm before responding. Parameters:
- `EventId` (required) — the `id` of the event being responded to.
- `ResponseType` (required) — the response to send. Valid values: `Accept`, `Decline`.
- `SendResponse` — whether to send a response to the organizer (`true` / `false`; default `true`).
- `Comment` — optional note included in the response, visible to the organizer.
- `UserId` — the acting / impersonated mailbox.

```sql
EXEC [Exchange_MSGraph].[MSGraph].[RespondToEvent]
  EventId = 'AAMkAD...=',
  ResponseType = 'Accept'
```

### MoveMail
Moves a message to another folder. Parameters:
- `MessageId` (required) — the `id` of the message to move (from `Messages`).
- `DestinationId` (required) — the `id` of the destination folder (from `MailFolders`).
- `UserId` — the acting / impersonated mailbox.

### DismissEventReminder / SnoozeEventReminder
Dismiss or snooze a calendar event's reminder.
- `DismissEventReminder` — parameters: `EventId` (required), `UserId` (optional).
- `SnoozeEventReminder` — parameters: `EventId` (required), `DateTime` (required — the new reminder time), `TimeZone` (required — the time zone for `DateTime`), `UserId` (optional).

### DownloadAttachments
Downloads attachments for a message or event. **Cloud-compatible** — returns file content as base64 without any disk/stream parameter:

- Required: `@AttachmentSource` (`Message` or `Event`) and `@SourceId` (the message/event `id`).
- Recommended: `@AttachmentId` to target a **single** attachment. Omitting it downloads every attachment, and a multi-attachment result can exceed the response size limit.
- **Do not pass `@FileStream`** — it is an output-stream object the Connect AI interface cannot supply.
- Returns columns `Id`, `Name`, `ContentBytes` (base64), `LastmodifiedDatetime`, `ContentType`.

```json
{
  "procedure": "DownloadAttachments",
  "parameters": {
    "@AttachmentSource": "Message",
    "@SourceId": "AAMkAD...=",
    "@AttachmentId": "AAMkAD...BEgAQ...="
  }
}
```

The `MessageAttachments` / `EventAttachments` views are the query equivalent for listing attachment metadata; use `DownloadAttachments` (or select the content column on those views) to retrieve the bytes.

### AddAttachments / DeleteAttachment
`AddAttachments` attaches files to an existing message; `DeleteAttachment` removes one. Supply attachment content as a base64 string via `ContentBytes` — never a local file path, since cloud environments have no disk access. Attachment *upload* may be rejected in cloud environments; if it fails, that is a current driver limitation. `DeleteAttachment` (by attachment ID) is unaffected.

### GetAdminConsentURL / FetchAdditionalUserFields
`GetAdminConsentURL` generates the tenant admin-consent OAuth URL (setup helper). `FetchAdditionalUserFields` retrieves extended directory attributes (T1–T3) for a user.

## Write Operations

MSGraph supports writes through both stored procedures (send/forward/reply/move/respond — above) and direct DML on writable tables:

- **Send or draft mail** — `SendMail`, or INSERT into `Messages` to create a draft.
- **Create / update / delete events** — DML on `Events` (not `CalendarView`, which is read-only).
- **Create / update contacts** — DML on `Contacts`. Always include `[displayName]` in a Contact UPDATE (see Important Columns).

Write access is governed by the Connect AI catalog permissions for the Exchange connection — check the `PERMISSIONS` column from `getCatalogs` (`Insert` / `Update` / `Delete` / `Execute`, not just `Select`). If a write is rejected, the connection is read-only for the current user and access must be granted in Connect AI.

## MSGraph-Specific Conventions

- **One `Messages` table, not per-folder.** Unlike EWS, all mail lives in `Messages`; filter by `parentFolderId` (joined to `MailFolders`) to scope to a folder.
- **ORDER BY fields must lead the WHERE clause** and each must be filtered — see the pairing rule above.
- **Use `CalendarView` for date-ranged calendar reads** (it expands recurring series) and `Events` for reading/writing a specific event.
- **`start_dateTime` / `end_dateTime` are VARCHAR**, paired with a separate `*_timeZone` column — compare as date literals and read the time zone alongside.
- **Recipient collections are JSON arrays** in `toRecipients` / `ccRecipients` / `bccRecipients`; recipient *parameters* on procedures are semicolon-separated strings.
- **Contact UPDATE must set `displayName`** or Graph regenerates it — always include it in the SET clause.
- **Attachment download returns base64** (`ContentBytes`) with no disk/stream parameter; target a single `@AttachmentId` to stay under the response size limit.
- **M365 usage-report views are tenant-wide** and require admin consent — they report on the whole organization, not just the signed-in mailbox.
- **Confirm before any mail or calendar action** — send, forward, reply, move, respond, or event writes all change the live mailbox.
