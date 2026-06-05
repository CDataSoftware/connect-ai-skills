---
name: connect-ai-googlecalendar
description: Use when querying Google Calendar data through CData Connect AI. Covers the Google Calendar data model (events, calendars, ACLs, attachments), the per-calendar table pattern, event/availability query patterns, stored procedures for creating and moving events, and Google Calendar-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: GoogleCalendar
  family: collaboration
---

# CData Connect AI — Google Calendar Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Google Calendar-specific guidance for querying Google Calendar data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the GoogleCalendar driver. Do not call `getInstructions` for Google Calendar — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Google Calendar connection via `getCatalogs`.

## Schema

Google Calendar is a single-schema driver. The schema name is `GoogleCalendar`.

```sql
SELECT [Id], [Summary], [StartDateTime], [EndDateTime]
FROM [YourConnection].[GoogleCalendar].[AllCalendars]
WHERE [CalendarId] = 'primary'
LIMIT 10
```

## Per-calendar tables — important

`getTables` for this driver returns far more than the handful of static tables. **Each calendar the account can access is exposed as its own dynamically-generated table, named after the calendar's title** (e.g. `[Holidays in United States]`, `[A Private Calendar]`, `[Test Calendar]`). These names often contain spaces or special characters and must be bracket-quoted.

There are two ways to read events:

- **`AllCalendars`** — the union view across every calendar. This is the primary, stable table to query. Scope it with a `[CalendarId]` filter (use `'primary'` for the user's main calendar).
- **A specific per-calendar table** — query the named table directly when you already know the calendar and want only its events.

Prefer `AllCalendars` with a `CalendarId` filter in almost all cases — it is stable, documented, and avoids guessing at calendar-table names. Use the `Calendars` table to enumerate available calendars and their IDs rather than scanning `getTables` output (which is dominated by per-calendar and test tables).

## Query Process

Google Calendar data is organized around events that belong to calendars. Most requests start with "find the relevant events in a time window," then refine or act.

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'GoogleCalendar'`.
2. **Identify the calendar** — default to `CalendarId = 'primary'`. To list calendars the account can see, query `Calendars` (`[Id]`, `[Summary]`, `[AccessRole]`).
3. **Query events from `AllCalendars`** — always include a date filter on `[StartDateTime]` (large calendars time out otherwise) and a `[CalendarId]` filter for performance.
4. **Refine** — filter by `[Status]`, attendees, all-day vs. timed, recurrence, etc.
5. **Act** — create events with `ImportEvent` or `QuickAddEvent`, check free/busy with `GetAvailability`, move events with `MoveEvent`, or modify events with UPDATE on `AllCalendars`.

## Data Model

### Key Tables

- **AllCalendars** — Union of events across all calendars. The primary table for event queries; scope with `[CalendarId]`. Holds event details, attendees, recurrence, reminders, and conference data.
- **Calendars** — Calendar metadata: title, description, timezone, color, visibility, and the authenticated user's `AccessRole` per calendar.
- **AccessControlRules** — Sharing/permission (ACL) rules per calendar: who can read or write a calendar.
- **Colors** (view) — Available color IDs and their hex values for calendars and events.
- **EventsAttachments** — Attachment metadata for events (Drive file ID, URL, title, MIME type).
- **UserSettings** (view) — The authenticated user's calendar preferences.
- **Per-calendar tables** — One dynamically-generated table per accessible calendar (see "Per-calendar tables" above).

### Key Relationships

- Events → Calendar: `AllCalendars.[CalendarId]` corresponds to `Calendars.[Id]`.
- ACL rules → Calendar: `AccessControlRules.[CalendarId]` corresponds to `Calendars.[Id]`.
- Attachments → Event: `EventsAttachments.[EventId]` corresponds to `AllCalendars.[Id]` (and `[CalendarId]` matches).
- Recurring-event instances → parent: `AllCalendars.[RecurringEventId]` points to the parent recurring event's `[Id]`.

## Important Columns

### AllCalendars

- `Id` — Event identifier (primary key, read-only)
- `CalendarId` — Calendar the event belongs to (key, writable — used to scope/override which calendar you query; `'primary'` = the user's main calendar)
- `Summary` — Event title
- `Description` — Event description
- `Location` — Free-form location text
- `StartDateTime` / `EndDateTime` — Timed-event start/end (TIMESTAMP). `EndDateTime` is exclusive
- `StartDateTimeZone` / `EndDateTimeZone` — IANA time zone (e.g. `'America/New_York'`)
- `StartDate` / `EndDate` — DATE values used **instead of** the DateTime columns for all-day events
- `AllDayEvent` — BOOLEAN, read-only — true when the event is all-day
- `Status` — `confirmed`, `tentative`, or `cancelled`
- `SendNotification` — BOOLEAN, writable — set to true on INSERT/UPDATE to notify attendees
- `AttendeesEmails` — Comma-separated attendee emails
- `AttendeesDisplayNames` — Comma-separated attendee names
- `AttendeesResponseStatus` — Comma-separated responses (`accepted`, `declined`, `needsAction`, `tentative`)
- `AttendeesOptional` — Comma-separated booleans for optional attendees
- `OrganizerEmail` / `OrganizerDisplayName` — Organizer identity (read-only)
- `CreatorEmail` / `CreatorDisplayName` — Creator identity (read-only)
- `Recurrences` — Pipe-separated RRULE/EXRULE/RDATE/EXDATE lines (recurring events only)
- `RecurringEventId` — Parent event ID for instances of a recurring event (read-only)
- `OriginalStartTimeDateTime` — For a recurring instance, its scheduled start per the recurrence rule
- `Created` / `Updated` — Lifecycle timestamps (read-only)
- `HangoutLink` — Google Meet/Hangout link, if any (read-only)
- `ConferenceEntryPointsAggregate` — Conference entry points (URLs, phone numbers)
- `HTML_Link` — Absolute link to the event in the Google Calendar web UI (read-only)
- `Transparency` — `opaque` (blocks time, default) or `transparent` (does not block time)
- `Visibility` — Event visibility
- `ColorId` — Event color (INTEGER ID into the event section of `Colors`)
- `EventType` — `default`, `outOfOffice`, `focusTime`, or `workingLocation`

### Calendars

- `Id` — Calendar identifier (usually an email address; key)
- `Summary` — Calendar title
- `Description` — Calendar description
- `Timezone` — Default time zone
- `AccessRole` — The authenticated user's role: `owner`, `writer`, `reader`, or `freeBusyReader` (read-only)
- `Hidden` — Whether the calendar is hidden from the list
- `Selected` — Whether the calendar's content shows in the UI
- `ColorId` — Calendar color (INTEGER ID into the calendar section of `Colors`)
- `SummaryOverride` — User-set display title for the calendar
- `Location` — Free-form calendar location

### AccessControlRules

- `CalendarId` — Calendar the rule applies to (key)
- `Id` — ACL rule identifier (key, read-only)
- `Role` — `none`, `freeBusyReader`, `reader`, `writer`, or `owner`
- `ScopeType` — `default`, `user`, `group`, or `domain`
- `ScopeValue` — Email of a user/group or a domain name (not applicable when `ScopeType = 'default'`)

### EventsAttachments

- `EventId` — Event the attachment belongs to (key)
- `CalendarId` — Calendar identifier
- `FileURL` — URL link to the attachment (key)
- `FileId` — Google Drive file ID, when the attachment lives in Drive (read-only)
- `Title` — Attachment name
- `MimeType` — MIME type of the attachment

## Common Query Patterns

### Next week's events

```sql
SELECT [Id], [Summary], [StartDateTime], [EndDateTime], [Location], [AttendeesEmails]
FROM [YourConnection].[GoogleCalendar].[AllCalendars]
WHERE [CalendarId] = 'primary'
  AND [StartDateTime] >= DATEADD(week, 1, CAST(GETDATE() AS DATE))
  AND [StartDateTime] <  DATEADD(week, 2, CAST(GETDATE() AS DATE))
ORDER BY [StartDateTime]
```

### Upcoming confirmed events only

```sql
SELECT [Summary], [StartDateTime], [EndDateTime], [Location]
FROM [YourConnection].[GoogleCalendar].[AllCalendars]
WHERE [CalendarId] = 'primary'
  AND [StartDateTime] >= GETDATE()
  AND [Status] = 'confirmed'
ORDER BY [StartDateTime]
```

### Events involving a specific attendee

Attendee data is comma-separated, so match with `LIKE`:

```sql
SELECT [Summary], [StartDateTime], [AttendeesEmails]
FROM [YourConnection].[GoogleCalendar].[AllCalendars]
WHERE [CalendarId] = 'primary'
  AND [StartDateTime] >= GETDATE()
  AND [AttendeesEmails] LIKE '%person@example.com%'
ORDER BY [StartDateTime]
```

### Finding open slots on a given afternoon

Query existing events, then identify gaps for scheduling:

```sql
SELECT [StartDateTime], [EndDateTime], [Summary]
FROM [YourConnection].[GoogleCalendar].[AllCalendars]
WHERE [CalendarId] = 'primary'
  AND DATEPART(weekday, [StartDateTime]) = 6   -- Friday (Sun=1 ... Sat=7)
  AND [StartDateTime] >= DATEADD(week, 1, CAST(GETDATE() AS DATE))
  AND [StartDateTime] <  DATEADD(week, 2, CAST(GETDATE() AS DATE))
  AND DATEPART(hour, [StartDateTime]) >= 12
ORDER BY [StartDateTime]
```

For true free/busy across one or more calendars, prefer the `GetAvailability` stored procedure (below) over computing gaps manually.

### List calendars the account can access

```sql
SELECT [Id], [Summary], [AccessRole], [Timezone]
FROM [YourConnection].[GoogleCalendar].[Calendars]
ORDER BY [Summary]
```

### Who can access a calendar (sharing rules)

```sql
SELECT [Id], [Role], [ScopeType], [ScopeValue]
FROM [YourConnection].[GoogleCalendar].[AccessControlRules]
WHERE [CalendarId] = 'primary'
```

## Stored Procedures

### QuickAddEvent

Creates an event from a natural-language string — the fastest way to add a simple event.

```sql
EXEC [YourConnection].[GoogleCalendar].QuickAddEvent
  @CalendarId = 'primary',
  @Summary = 'Lunch with Sarah next Friday at noon',
  @SendUpdates = 'all'
```

`@CalendarId` and `@Summary` are required.

### ImportEvent

Adds a fully-specified event. `@CalendarId` and `@ICalUID` are **required** — always supply a unique `@ICalUID` (RFC5545 UID, e.g. `'unique-id-20251114@yourdomain.com'`).

```sql
EXEC [YourConnection].[GoogleCalendar].ImportEvent
  @CalendarId = 'primary',
  @ICalUID = 'unique-id-20251114@yourdomain.com',
  @Summary = 'Product Launch Planning',
  @Description = 'Discuss Q1 product launch strategy',
  @Location = 'Conference Room B',
  @StartDateTime = '2025-11-15T14:00:00',
  @EndDateTime = '2025-11-15T15:30:00',
  @StartDateTimeZone = 'America/New_York',
  @EndDateTimeZone = 'America/New_York',
  @Attendees = '[{"email": "alice@example.com"}, {"email": "bob@example.com"}]',
  @RemindersUseDefault = 0,
  @ReminderOverrides = '[{"method": "email", "minutes": 60}, {"method": "popup", "minutes": 15}]'
```

JSON format for `executeProcedure`:

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleCalendar",
  "procedureName": "ImportEvent",
  "parameters": {
    "@CalendarId": "primary",
    "@ICalUID": "unique-id-20251114@yourdomain.com",
    "@Summary": "Product Launch Planning",
    "@StartDateTime": "2025-11-15T14:00:00",
    "@EndDateTime": "2025-11-15T15:30:00",
    "@StartDateTimeZone": "America/New_York",
    "@EndDateTimeZone": "America/New_York",
    "@Attendees": "[{\"email\": \"alice@example.com\"}]"
  }
}
```

- `@Attendees`, `@ReminderOverrides`, and `@ConferenceDataEntryPoints` accept JSON arrays (or temporary-table input) only.
- `@Recurrences` is a pipe-separated list of RRULE/EXRULE/RDATE/EXDATE lines (DTSTART/DTEND are not allowed). For a simple repeat, a single `RRULE:...` string is sufficient — see Recurrence rules below.
- Attachments are added by reference via `@AttachmentsFileUrls` (pipe-separated URLs) with `@SupportsAttachments = true` — there is no file-upload parameter (see Conventions).

> **`ImportEvent` has no notification parameter.** `@SendNotification` is a column on `AllCalendars` (used with INSERT/UPDATE), and `@SendUpdates` is a parameter on `QuickAddEvent` and `MoveEvent` — neither applies to `ImportEvent`. Attendee notifications for imported events are controlled by the calendar's default notification settings.

### GetAvailability

Returns free/busy windows for one or more calendars. All three parameters are required.

```sql
EXEC [YourConnection].[GoogleCalendar].GetAvailability
  @TimeMin = '2025-11-22T09:00:00Z',
  @TimeMax = '2025-11-22T17:00:00Z',
  @EntityIds = 'primary'
```

`@EntityIds` is a comma-separated list of calendar (or group) identifiers — pass several to compare availability across calendars.

### MoveEvent

Moves an event from one calendar to another, preserving its details.

```sql
EXEC [YourConnection].[GoogleCalendar].MoveEvent
  @CalendarId = 'primary',
  @EventId = '<event-id>',
  @Destination = '<destination-calendar-id>',
  @SendUpdates = 'all'
```

`@CalendarId` (source), `@EventId`, and `@Destination` are required.

### DownloadAttachments

Downloads an event's attachment content.

**Cloud-compatible call shape** — omit `@LocalFile` (server-side disk path) and `@FileStream` (output stream, cannot pass through MCP), and set `@Encoding = 'BASE64'`; the response returns the file content as base64 in a `FileData` column.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "GoogleCalendar",
  "procedureName": "DownloadAttachments",
  "parameters": {
    "@CalendarId": "primary",
    "@EventId": "<event-id>",
    "@Encoding": "BASE64"
  }
}
```

Find attachment identifiers first via `EventsAttachments`:

```sql
SELECT [EventId], [FileId], [FileURL], [Title], [MimeType]
FROM [YourConnection].[GoogleCalendar].[EventsAttachments]
WHERE [CalendarId] = 'primary'
  AND [EventId] = '<event-id>'
```

### Subscribe* / StopWatchingResources — not usable through Connect AI MCP

`SubscribeToEventChanges`, `SubscribeToAclChanges`, `SubscribeToCalendarListChanges`, `SubscribeToSettingsChanges`, and `StopWatchingResources` register/cancel Google push-notification (webhook) channels. They require a publicly reachable callback address and return no queryable data, so they are not useful in an interactive Connect AI/MCP session. Ignore them for query and scheduling tasks.

## Write Operations

The Google Calendar driver supports INSERT and UPDATE on `AllCalendars` (and the per-calendar tables) where the connection and the authenticated Google user's `AccessRole` allow it.

### Update an event

Always scope by both `[Id]` and `[CalendarId]`:

```sql
UPDATE [YourConnection].[GoogleCalendar].[AllCalendars]
SET [Summary] = 'Updated Meeting Title',
    [Location] = 'Virtual - Zoom Link',
    [SendNotification] = 1
WHERE [Id] = '<event-id>'
  AND [CalendarId] = 'primary'
```

### Reschedule an event

```sql
UPDATE [YourConnection].[GoogleCalendar].[AllCalendars]
SET [StartDateTime] = '2025-11-20T15:00:00',
    [EndDateTime] = '2025-11-20T16:00:00',
    [SendNotification] = 1
WHERE [Id] = '<event-id>'
  AND [CalendarId] = 'primary'
```

Prefer in-place UPDATE so event history and attendee responses are preserved. To *create* events, prefer the `ImportEvent` / `QuickAddEvent` procedures over raw INSERT — they expose attendees, reminders, recurrence, and conference data cleanly.

If write operations are blocked, the Connect AI connection may be in readonly mode (CData side) **or** the authenticated Google user may lack `writer`/`owner` `AccessRole` on the target calendar (check `Calendars.[AccessRole]`). Guide the user to enable write access on the connection and confirm their calendar permissions.

## Recurrence rules (RRULE)

`@Recurrences` / `[Recurrences]` use RFC5545 rules. Common forms:

- Weekdays daily: `RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR`
- Weekly on specific days: `RRULE:FREQ=WEEKLY;BYDAY=MO,WE`
- First Monday monthly: `RRULE:FREQ=MONTHLY;BYDAY=1MO`
- Limit occurrences: append `;COUNT=10`
- End by date: append `;UNTIL=20251231T000000Z`

For multiple rules/exceptions, separate lines with `|` (pipe). Do not include `DTSTART`/`DTEND` lines.

## Google Calendar-Specific Conventions

- **Query `AllCalendars` with a `CalendarId` filter, not the per-calendar tables.** Each calendar is also exposed as its own dynamically-named table, but `AllCalendars` is the stable entry point. Use `'primary'` for the user's main calendar; enumerate others via the `Calendars` table.
- **Date filters are mandatory on event queries.** `AllCalendars` will time out on large calendars without a `[StartDateTime]` range. Add a `[CalendarId]` filter for performance too.
- **All-day events use `StartDate`/`EndDate` (DATE), not `StartDateTime`/`EndDateTime`.** Filter all-day events with `[AllDayEvent] = 1` and read the DATE columns. `AllDayEvent` is read-only — it is derived, not set directly.
- **`EndDateTime` is exclusive.** A 1:00–2:00 event has `StartDateTime = ...T13:00` and `EndDateTime = ...T14:00`.
- **Always specify time zones when creating events** (`@StartDateTimeZone` / `@EndDateTimeZone`) to avoid ambiguity.
- **`ImportEvent` requires a unique `@ICalUID`.** Reusing a UID causes the request to be treated as the same event. Generate a fresh UID per event.
- **Attendees and reminders are JSON on procedures but comma-separated on the table.** `ImportEvent` takes `@Attendees` / `@ReminderOverrides` as JSON arrays; the `AllCalendars` table exposes the same data as comma-separated `AttendeesEmails` / `ReminderOverrideMethods` columns. Search attendees with `LIKE` on the comma-separated column.
- **Attachments are added by URL reference, not uploaded.** `ImportEvent` accepts `@AttachmentsFileUrls` (pipe-separated URLs, typically Google Drive links) with `@SupportsAttachments = true`. There is no base64/file-upload parameter, so the usual cloud file-upload limitation does not apply here — attachments must already exist at a URL.
- **`SendNotification` controls attendee emails on write.** Set to 1 to notify attendees of an insert/update, 0 for a silent change.
- **`Transparency` controls busy/free.** `opaque` (default) blocks time and shows as busy; `transparent` does not.
- **Conference/Meet links are read-only.** Read `HangoutLink` for the Meet link or `ConferenceEntryPointsAggregate` for other platforms; create conference data via the `ImportEvent` `ConferenceData*` parameters.
- **`DATEPART(weekday, ...)` numbering is Sun=1 … Sat=7** (so Friday = 6).
- **Use `GetAvailability` for free/busy**, not manual gap math, when the question is "when is everyone free."
