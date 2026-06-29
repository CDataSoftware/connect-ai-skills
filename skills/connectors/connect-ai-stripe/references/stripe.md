# CData Connect AI — Stripe (Classic) API Reference

> Surface: `Schema = Stripe` (the default). Load this reference when the live connection's `getSchemas` returns **`Stripe`**. See the base [SKILL.md](../SKILL.md) for schema identification.
>
> This is Stripe's classic, comprehensive data model — roughly 80 tables/views with the full object set. The `StripeV2` surface ([references/stripev2.md](stripev2.md)) is a different, smaller object model; do not carry its table or column names over to this surface, or vice versa.

## Schema

The schema name is `Stripe`. The three-part name is `[Catalog].[Stripe].[Table]`:

```sql
SELECT [Id], [Email], [Name], [Created]
FROM [YourConnection].[Stripe].[Customers]
LIMIT 10
```

The `Stripe` namespace is broad — roughly 80 tables/views covering billing, payments, balance, payouts, issuing, tax, and more. The tables below are the common starting points; use `getTables` to discover the rest (e.g. `Refunds`, `Disputes`, `Payouts`, `BalanceTransactions`, `Coupons`, `PromotionCodes`, `CheckoutSession`, `PaymentMethods`, `Plans`, `CreditNotes`).

## Query Process

Stripe's model is customer-centric: `Customers` is the hub, with payments, invoices, and subscriptions hanging off it. Most requests follow:

1. **Find the customer** — query `Customers` by `Email`, `Name`, or `Phone` to get the `cus_…` id.
2. **Drill into the customer's activity** — query `Invoices`, `Subscriptions`, `Charges`, or `PaymentIntent` filtered by the customer id. **Mind the column name** — it is `Customer` on `PaymentIntent` but `CustomerId` on `Charges`/`Invoices`/`Subscriptions` (see Conventions).
3. **Inspect columns** — Stripe tables are wide and flatten nested API objects into prefixed columns (`Plan*`, `Price*`, `ShippingAddress*`, `BillingDetails*`). Run `getColumns` before writing targeted queries.
4. **Act** — lifecycle changes (cancel a subscription, capture/cancel a payment intent, finalize/void an invoice) go through stored procedures, not UPDATE.

## Data Model

### Key Tables

- **Customers** — customer profiles: contact info, balance, currency, delinquency, default payment source
- **Products** — product catalog: name, description, type, default price, active flag
- **Prices** — pricing configs for products: unit amount, currency, one-time vs. recurring, interval
- **Charges** — individual payment attempts/transactions (one-time and invoice-driven)
- **PaymentIntent** — the full payment lifecycle object (creation → authentication → capture)
- **Invoices** — billing documents: amounts, status, due date, links to customer/subscription
- **InvoiceLineItems** (view) — what each invoice actually bills: amounts, quantity, price/product, period
- **Subscriptions** — recurring billing relationships linking customers to plans/prices

### Other notable tables

The eight above are just the common entry points. The `Stripe` namespace also exposes (among ~80 objects):

- **Payments & money movement** — `PaymentMethods`, `Refunds`, `Disputes`, `Payouts`, `Transfers`, `BalanceTransactions`, `AvailableBalance`, `PendingBalance`
- **Billing & subscriptions** — `SubscriptionItems`, `SubscriptionSchedules`, `InvoiceItems`, `CreditNotes`, `Plans`, `UsageRecords`, `Coupons`, `PromotionCodes`
- **Catalog & checkout** — `CheckoutSession`, `PaymentLinks`, `Quotes`, `ShippingRates`
- **Tax** — `TaxRates`, `TaxIds`, `TaxCodes`
- **Accounts & Connect** — `Accounts`, `Persons`, `BankAccounts`, `Cards`
- **Issuing** — `IssuingCards`, `Cardholders`, `Authorizations`, `Transactions`
- **Platform** — `Events`, `Files`, `FileLinks`, `Reviews`, `Meters`

Use `getTables` for the complete list and `getColumns` before querying any of them.

### Key Relationships

| From | Column | To |
|---|---|---|
| Invoices | `CustomerId` | Customers.`Id` |
| Subscriptions | `CustomerId` | Customers.`Id` |
| Charges | `CustomerId` | Customers.`Id` |
| PaymentIntent | `Customer` | Customers.`Id` |
| InvoiceLineItems | `InvoiceId` | Invoices.`Id` |
| InvoiceLineItems | `PriceProduct` | Products.`Id` |
| Prices | `Product` | Products.`Id` |
| Invoices | `Subscription` | Subscriptions.`Id` |
| PaymentIntent | `Invoice` | Invoices.`Id` |
| Charges | `PaymentIntent` / `Invoice` | PaymentIntent.`Id` / Invoices.`Id` |

> The customer foreign key is **`Customer`** on `PaymentIntent` but **`CustomerId`** on `Charges`, `Invoices`, and `Subscriptions`. Verify with `getColumns` rather than assuming.

## Important Columns

> **Amounts are integers in the smallest currency unit (cents).** `Amount`, `AmountDue`, `AmountPaid`, `Balance`, `UnitAmount`, etc. are whole integers — divide by 100 for major-unit currencies (USD, EUR, …). **Timestamps** are exposed as SQL `TIMESTAMP` (the driver converts Stripe's Unix-epoch seconds). Columns ending in `Aggregate` hold nested JSON (addresses, metadata, line items, etc.).

### Customers
- `Id` — `cus_…` identifier (PK)
- `Email`, `Name`, `Phone`, `Description`
- `Balance` — current balance, in cents (INTEGER)
- `Currency` — default billing currency
- `Created` — creation timestamp
- `Delinquent` — BOOLEAN; latest invoice's latest charge failed
- `DefaultSource` — default payment source id
- `TaxExempt` — `none`, `exempt`, or `reverse`
- `AddressAggregate`, `ShippingAggregate`, `MetadataAggregate` — nested JSON

### Invoices
- `Id` — `in_…` identifier (PK)
- `CustomerId` — billed customer
- `Number` — human-facing invoice number
- `Status` — `draft`, `open`, `paid`, `uncollectible`, or `void`
- `AmountDue`, `AmountPaid`, `AmountRemaining`, `Subtotal`, `Total`, `Tax` — all in cents (INTEGER)
- `Currency`
- `Created`, `DueDate` (`DueDate` is null when `CollectionMethod = 'charge_automatically'`)
- `Subscription` — source subscription, if any
- `PaymentIntent`, `Charge` — linked payment objects
- `HostedInvoiceUrl`, `InvoicePdf` — customer-facing links
- `CollectionMethod` — `charge_automatically` or `send_invoice`

### Subscriptions
- `Id` — `sub_…` identifier (PK)
- `CustomerId` — owning customer
- `Status` — `active`, `past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, `trialing`, or `paused`
- `CreatedAt` — creation timestamp (**note the `At` suffix — unlike most tables**)
- `CurrentPeriodStart`, `CurrentPeriodEnd` — current billing window
- `CancelAtPeriodEnd` — BOOLEAN; scheduled to cancel at period end
- `CanceledAt`, `CancelAt`, `EndedAt`, `StartDate`, `TrialStart`, `TrialEnd` — lifecycle timestamps
- `PlanId`, `PlanProduct`, `PlanAmount`, `PlanInterval` — flattened plan fields
- `ItemsAggregate` — subscription items (each with a price)

### PaymentIntent
- `Id` — `pi_…` identifier (PK)
- `Customer` — owning customer (**note: `Customer`, not `CustomerId`**)
- `Amount`, `AmountReceived`, `AmountCapturable` — in cents (INTEGER)
- `Currency`
- `Status` — `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`, `requires_capture`, `canceled`, or `succeeded`
- `Created`
- `Invoice` — source invoice, if any
- `LatestCharge` — resulting charge
- `PaymentMethod`, `CaptureMethod`, `ConfirmationMethod`
- `Description`

### Charges
- `Id` — `ch_…` identifier (PK)
- `CustomerId`, `Invoice`, `PaymentIntent` — owning customer / links
- `Amount`, `AmountRefunded`, `AmountCaptured` — in cents (INTEGER)
- `Currency`
- `Status` — `succeeded`, `pending`, or `failed`
- `Paid`, `Captured`, `Refunded`, `Disputed` — BOOLEANs
- `Created`
- `ReceiptURL`, `ReceiptEmail`
- `FailureCode`, `FailureMessage` — populated on failed charges
- `BillingDetails*`, `ShippingAddress*` — flattened nested fields

### InvoiceLineItems (view)
- `Id` — line item identifier (PK)
- `InvoiceId` — parent invoice
- `Amount`, `AmountExcludingTax` — in cents (INTEGER)
- `Currency`, `Description`, `Quantity`
- `PriceId`, `PriceProduct`, `PriceUnitAmount`, `PriceType` (`one_time` / `recurring`)
- `PriceRecurring` — recurring components (interval, usage type) as nested JSON; `PlanInterval` exposes the interval directly. **There is no `PriceRecurringInterval` column** — use `PlanInterval` or parse `PriceRecurring`
- `PeriodStart`, `PeriodEnd`, `Proration`, `Discountable`
- `Subscription` — source subscription, if any
- `Type` — `invoiceitem` or `subscription`

### Products
- `Id` — `prod_…` identifier (PK)
- `Name`, `Description`, `Type`
- `Active` — BOOLEAN
- `DefaultPrice` — default price id
- `Created`, `Updated`, `Url`, `Images`, `Shippable`, `StatementDescriptor`

### Prices
- `Id` — `price_…` identifier (PK)
- `Product` — owning product
- `Active` — BOOLEAN
- `UnitAmount` — price in cents (INTEGER); `UnitAmountDecimal` for sub-cent precision
- `Currency`, `Nickname`
- `Type` — `one_time` or `recurring`
- `RecurringInterval` — `day`, `week`, `month`, or `year` (recurring prices); `RecurringIntervalCount`, `RecurringUsageType`

## Common Query Patterns

### Find a customer by email

```sql
SELECT [Id], [Email], [Name], [Phone], [Balance], [Currency], [Delinquent], [Created]
FROM [YourConnection].[Stripe].[Customers]
WHERE [Email] LIKE '%jane@example.com%'
```

### Unpaid (open) invoices

```sql
SELECT [Id], [Number], [CustomerId], [AmountDue], [Currency], [Status], [DueDate], [Created]
FROM [YourConnection].[Stripe].[Invoices]
WHERE [Status] = 'open'
ORDER BY [DueDate] ASC
```

### Active subscriptions for a customer

```sql
SELECT [Id], [Status], [CurrentPeriodStart], [CurrentPeriodEnd], [CancelAtPeriodEnd], [CreatedAt]
FROM [YourConnection].[Stripe].[Subscriptions]
WHERE [CustomerId] = 'cus_a1b2c3d4e5f6'
  AND [Status] = 'active'
ORDER BY [CreatedAt] DESC
```

### A customer's payments

```sql
SELECT [Id], [Amount], [Currency], [Status], [Created], [Description], [LatestCharge]
FROM [YourConnection].[Stripe].[PaymentIntent]
WHERE [Customer] = 'cus_a1b2c3d4e5f6'
ORDER BY [Created] DESC
```

### Active products with their prices

```sql
SELECT
    p.[Id]   AS ProductId,
    p.[Name] AS ProductName,
    pr.[Id]  AS PriceId,
    pr.[UnitAmount],
    pr.[Currency],
    pr.[Type] AS PriceType,
    pr.[RecurringInterval],
    pr.[Nickname]
FROM [YourConnection].[Stripe].[Products] p
INNER JOIN [YourConnection].[Stripe].[Prices] pr ON pr.[Product] = p.[Id]
WHERE p.[Active] = true
  AND pr.[Active] = true
ORDER BY p.[Name], pr.[UnitAmount]
```

### What a specific payment bought (join through the invoice)

```sql
SELECT DISTINCT
    pi.[Id]            AS PaymentIntentId,
    p.[Name]           AS ProductName,
    ili.[PriceId],
    ili.[Amount],
    ili.[Quantity]
FROM [YourConnection].[Stripe].[PaymentIntent] pi
INNER JOIN [YourConnection].[Stripe].[Invoices] i          ON pi.[Invoice] = i.[Id]
INNER JOIN [YourConnection].[Stripe].[InvoiceLineItems] ili ON i.[Id] = ili.[InvoiceId]
INNER JOIN [YourConnection].[Stripe].[Products] p          ON ili.[PriceProduct] = p.[Id]
WHERE pi.[Id] = 'pi_a1b2c3d4e5f6'
```

## Stored Procedures

The `Stripe` surface exposes ~20 procedures for lifecycle actions that aren't expressible as table writes. Discover them with `getProcedures`; inspect parameters with `getProcedureParameters`. Common ones:

- **Subscriptions** — `CancelSubscription`, `ResumeSubscription`, `DeleteSubscriptionDiscount`
- **Payment intents** — `CapturePaymentIntent`, `CancelPaymentIntent`, `ConfirmPaymentIntent`
- **Invoices & credit notes** — `FinalizeInvoice`, `VoidInvoice`, `VoidCreditNotes`
- **Quotes** — `FinalizeQuote`, `AcceptQuote`, `CancelQuote`, `DownloadQuote`
- **Payment methods** — `AttachPaymentMethodToCustomer`, `DetachPaymentMethodFromCustomer`
- **Customer** — `DeleteCustomerDiscount`
- **Reviews & metering** — `ApproveReview`, `CreateBillingMeterEvent`
- **Files** — `DownloadFile`, `UploadFile`

### CancelSubscription

```json
{
  "catalogName": "YourConnection",
  "schemaName": "Stripe",
  "procedureName": "CancelSubscription",
  "parameters": {
    "SubscriptionId": "sub_a1b2c3d4e5f6"
  }
}
```

Only `SubscriptionId` is required. Optional: `InvoiceNow`, `IsProrate`, `CancellationDetailsComment`, `CancellationDetailsFeedback`.

### CapturePaymentIntent

Captures funds on a PaymentIntent whose `Status = 'requires_capture'`. `PaymentIntentId` is required; `AmountToCapture` (cents) optionally captures less than the authorized amount.

```json
{
  "catalogName": "YourConnection",
  "schemaName": "Stripe",
  "procedureName": "CapturePaymentIntent",
  "parameters": {
    "PaymentIntentId": "pi_a1b2c3d4e5f6",
    "AmountToCapture": "5000"
  }
}
```

### FinalizeInvoice

Finalizes a draft invoice (`InvoiceId` required; optional `AutoAdvance`). Pair with `VoidInvoice` to void a finalized invoice.

### DownloadFile / DownloadQuote

Both download content. **In cloud Connect AI, omit `DownloadLocation` (server-side disk path) and `FileStream` (output stream), and set `Encoding = 'BASE64'`** — the procedure returns the file content base64-encoded in the response, which you then decode. `DownloadFile` takes a `FileId`; `DownloadQuote` takes a `QuoteId` (finalized quote).

```json
{
  "catalogName": "YourConnection",
  "schemaName": "Stripe",
  "procedureName": "DownloadFile",
  "parameters": {
    "FileId": "file_a1b2c3d4e5f6",
    "Encoding": "BASE64"
  }
}
```

### UploadFile — not currently usable in cloud

`UploadFile` accepts `FullPath` (server-side disk path, unavailable in cloud) or `Content` (Java `InputStream`, unable to pass through the MCP interface). There is no base64 string alternative for the upload path. Treat file uploads as a current limitation — do not invent parameter names the driver does not accept. Support for file uploads via stored procedures is planned — check for updates if this capability is needed.

## Write Operations

Most core tables support INSERT/UPDATE/DELETE where the connection allows it (e.g. `Customers`, `Products`, `Prices`, `Invoices`, `Subscriptions`, `Charges`, `InvoiceItems`). However, **lifecycle state transitions are procedure-driven, not column writes** — cancel a subscription with `CancelSubscription` (not `UPDATE … SET Status='canceled'`), capture a payment with `CapturePaymentIntent`, finalize/void invoices with `FinalizeInvoice`/`VoidInvoice`, etc. Reach for a procedure when the change is an action rather than a field edit.

If writes are blocked, the Connect AI connection may be in readonly mode — guide the user to enable write access in the connection settings.

## Stripe-Specific Conventions

- **Monetary amounts are integers in the smallest currency unit (cents).** `Amount`, `AmountDue`, `Balance`, `UnitAmount`, `Subtotal`, `Total`, etc. are whole integers — divide by 100 for USD/EUR-style currencies (zero-decimal currencies like JPY are already whole units). Never present a raw `Amount` as dollars.
- **Customer FK column name varies by table.** `PaymentIntent` uses `Customer`; `Charges`, `Invoices`, and `Subscriptions` use `CustomerId`. Confirm with `getColumns`.
- **Created-timestamp name varies too.** Most tables use `Created`; `Subscriptions` uses `CreatedAt`. Don't assume one across tables.
- **Status values are lowercase strings**, and the value set differs per table — Invoices (`draft`/`open`/`paid`/`uncollectible`/`void`), Subscriptions (`active`/`past_due`/`canceled`/`trialing`/…), PaymentIntent (`requires_capture`/`succeeded`/…), Charges (`succeeded`/`pending`/`failed`). Filter with the exact lowercase string.
- **Booleans are real BOOLEANs** — filter with `[Active] = true` / `= 1`; no need to `CAST(... AS INT)`.
- **Nested objects are flattened into prefixed columns** — `Plan*`, `Price*`, `BillingDetails*`, `ShippingAddress*`, `Discount*`. Columns ending in `Aggregate` (e.g. `MetadataAggregate`, `ItemsAggregate`, `AddressAggregate`) hold nested JSON. Run `getColumns` to see the real expanded names before querying.
- **The catalog is large** (~80 tables, ~20 procedures). Beyond the core billing tables, `getTables`/`getProcedures` surface payouts, refunds, disputes, balance transactions, coupons, checkout sessions, issuing, tax, and more.
- **Lifecycle changes go through procedures, not UPDATE** — cancel/resume subscriptions, capture/cancel/confirm payment intents, finalize/void invoices, accept/finalize/cancel quotes.
- **Use explicit date literals** (`'2025-01-01'`) over `DATEADD()` for performance on time-based filters.
