# CData Connect AI — StripeV2 (V2 API) Reference

> Surface: `Schema = StripeV2`. Load this reference when the live connection's `getSchemas` returns **`StripeV2`**. See the base [SKILL.md](../SKILL.md) for schema identification.
>
> **StripeV2 is a narrow surface, not a billing data model.** It exposes Stripe's V2 Core/Events and billing-meter APIs only — event destinations, thin events, and meter events. There are no `Customers`, `Invoices`, `Subscriptions`, `Charges`, or `PaymentIntent` tables here. For that data, use the classic `Stripe` surface ([references/stripe.md](stripe.md)); do not carry classic table or column names over to this surface.

## Schema

The schema name is `StripeV2`. The three-part name is `[Catalog].[StripeV2].[Table]`:

```sql
SELECT [Id], [Name], [Type], [Status] FROM [YourConnection].[StripeV2].[EventDestinations] LIMIT 10
```

## What's on this surface

The entire surface is two objects and five procedures — confirm with `getTables` / `getProcedures`:

| Object | Type | Purpose |
|---|---|---|
| `EventDestinations` | table | Webhook / Amazon EventBridge destinations that receive Stripe events. Supports query and write. |
| `ThinEvents` | view | The lightweight ("thin") event stream for the last 30 days. **Read-only and requires a filter** (see below). |

Procedures: `CreateBillingMeterEvent`, `CreateBillingMeterEventAdjustment`, `EnableEventDestination`, `DisableEventDestination`, `PingEventDestination`.

## Data Model

### EventDestinations
- `Id` — event destination identifier (PK)
- `Name` — destination name
- `Description` — optional description of what the destination is used for
- `Type` — destination type (e.g. webhook endpoint, Amazon EventBridge)
- `Status` — `enabled` or `disabled` (readonly; change via the Enable/Disable procedures)
- `StatusDetailsDisabledReason` — why the destination was disabled
- `EnabledEvents` — list of event types this destination subscribes to
- `EventPayload` — payload type of the subscribed events
- `EventsFrom` — where events are routed from
- `SnapshotApiVersion` — API version snapshot-payload events are rendered as
- `WebhookEndpointUrl` — the webhook endpoint URL
- `WebhookEndpointSigningSecret` — signing secret, **only returned on creation** (readonly)
- `AmazonEventbridgeAWSAccountId`, `AmazonEventbridgeAwsRegion`, `AmazonEventbridgeAWSEventSourceArn`, `AmazonEventbridgeAWSEventSourceStatus` — Amazon EventBridge destination fields
- `Created`, `Updated` — timestamps
- `Livemode` — BOOLEAN; true in live mode, false in test mode
- `MetadataAggregate` — nested JSON metadata

### ThinEvents (view)
- `Id` — event identifier (PK)
- `Type` — event type
- `Created` — when the event occurred
- `RelatedObjectId`, `RelatedObjectType`, `RelatedObjectUrl` — the object the event is about and the URL to retrieve it
- `Context` — authentication context needed to fetch the event or related object
- `ReasonType` — why the event was produced
- `ReasonRequestId`, `ReasonRequestIdempotencyKey` — the API request that caused the event
- `DataDeveloperMessageSummary`, `DataReasonErrorCount`, `DataReasonErrorTypes`, `DataValidationStart`, `DataValidationEnd` — extra detail included when the event is fetched
- `Livemode` — BOOLEAN

> **`ThinEvents` requires a filter.** A query with no `WHERE` fails with *"At least ID, or RELATED_OBJECT/ID should be specified."* Filter by `Id` (a specific event) or by `RelatedObjectId` (all events for an object). It covers only the **last 30 days**.

## Common Query Patterns

### List event destinations

```sql
SELECT [Id], [Name], [Type], [Status], [WebhookEndpointUrl], [EnabledEvents], [Created]
FROM [YourConnection].[StripeV2].[EventDestinations]
```

### Events for a specific object (last 30 days)

```sql
SELECT [Id], [Type], [Created], [RelatedObjectType], [RelatedObjectId]
FROM [YourConnection].[StripeV2].[ThinEvents]
WHERE [RelatedObjectId] = 'in_a1b2c3d4e5f6'
ORDER BY [Created] DESC
```

### A single event by id

```sql
SELECT [Id], [Type], [Created], [Context], [RelatedObjectUrl]
FROM [YourConnection].[StripeV2].[ThinEvents]
WHERE [Id] = 'evt_a1b2c3d4e5f6'
```

## Stored Procedures

Inspect parameters with `getProcedureParameters`; execute with `executeProcedure`.

### CreateBillingMeterEvent

Records usage against a billing meter. Required: `EventName` (the meter's `event_name`), `PayloadCustomerMappingValue` (the customer the usage maps to), and `PayloadValueSettingsValue` (the usage value). Optional: `PayloadCustomerMappingKey` (defaults to `stripe_customer_id`), `PayloadValueSettingsKey` (defaults to `value`), `Identifier` (auto-generated if omitted), and `Timestamp` (defaults to now; must be within the past 35 days or up to 5 minutes in the future).

```json
{
  "catalogName": "YourConnection",
  "schemaName": "StripeV2",
  "procedureName": "CreateBillingMeterEvent",
  "parameters": {
    "EventName": "api_requests",
    "PayloadCustomerMappingValue": "cus_a1b2c3d4e5f6",
    "PayloadValueSettingsValue": "25"
  }
}
```

### CreateBillingMeterEventAdjustment

Cancels a previously sent meter event. Required: `EventName` and `CancelIdentifier` (the `Identifier` of the event to cancel). You can only cancel an event within **24 hours** of Stripe receiving it.

### EnableEventDestination / DisableEventDestination / PingEventDestination

Each takes a single required `EventDestinationId`. Use Enable/Disable to flip a destination's `Status`; use Ping to send a test event to the destination.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "StripeV2",
  "procedureName": "PingEventDestination",
  "parameters": {
    "EventDestinationId": "we_a1b2c3d4e5f6"
  }
}
```

## Write Operations

`EventDestinations` supports INSERT / UPDATE / DELETE where the connection allows it — create a destination by inserting `Name`, `Type`, `EnabledEvents`, and `WebhookEndpointUrl` (or the `AmazonEventbridge*` fields for an EventBridge destination). `WebhookEndpointSigningSecret` is returned only at creation, so capture it then. `Status` is not a writable column — use `EnableEventDestination` / `DisableEventDestination` instead. `ThinEvents` is read-only.

If writes are blocked, the Connect AI connection may be in readonly mode — guide the user to enable write access in the connection settings.

## StripeV2-Specific Conventions

- **Narrow surface.** Only `EventDestinations` and `ThinEvents` exist, plus the five procedures above. For billing/payments data (customers, invoices, charges, subscriptions), the connection must use the classic `Stripe` schema instead.
- **`ThinEvents` always needs a filter** (`Id` or `RelatedObjectId`) and only goes back 30 days.
- **Destination status is procedure-driven**, not a column write — flip it with `EnableEventDestination` / `DisableEventDestination`.
- **`WebhookEndpointSigningSecret` is only available at creation** — it is readonly and not returned on later queries.
- **Booleans are real BOOLEANs** (`Livemode`) — filter with `= true` / `= 1`.
- **Meter events feed Stripe billing usage** — `CreateBillingMeterEvent` values are usage quantities, not monetary amounts.
