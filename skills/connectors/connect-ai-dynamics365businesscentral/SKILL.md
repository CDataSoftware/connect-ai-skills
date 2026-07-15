---
name: connect-ai-dynamics365businesscentral
description: Use when querying Dynamics 365 Business Central data through CData Connect AI. Covers the BC Common Service API data model (/api/v2.0 endpoint), company schema routing, sales/purchase document families, journal entries, AL enum encoding, write operations, and BC-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Dynamics365BusinessCentral
  family: erp
---

# CData Connect AI — Dynamics 365 Business Central Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Dynamics 365 Business Central-specific guidance for querying BC data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

**Do NOT call `getInstructions` for the Dynamics 365 Business Central driver under any circumstances — this skill fully replaces it.** The guidance it would provide is already incorporated here. Go straight from `getCatalogs` (to identify the BC connection) to `getSchemas` (to identify the company), then schema discovery (`getTables` / `getColumns`).

## Schema

Dynamics 365 Business Central exposes each company as a separate schema. Run `getSchemas` to discover available companies — each row is a company name to use as the schema in queries.

```sql
-- Replace [YourConnection] with your actual Dynamics 365 Business Central connection name from getCatalogs
-- Replace [YourCompany] with your actual company name from getSchemas (e.g., [Contoso, Ltd.])
SELECT * FROM [YourConnection].[YourCompany].[customers] LIMIT 10
```

Three-part names are **required** — two-part names and empty-middle names both fail. Company names commonly contain spaces, commas, and periods (e.g., `[Contoso, Ltd.]`), so always bracket-quote them exactly as returned by `getSchemas`.

> **Which endpoint does this guide cover?** This skill targets the **Common Service API** (`/api/v2.0` endpoint), which is the BC default and exposes a stable, Microsoft-defined table set with lowercase camelCase names — `customers`, `salesOrders`, `generalLedgerEntries`, and similar. If your `getTables` results show mixed-case names, `Power_BI_*` prefixes, or custom tenant page names instead, your connection uses the Web Services (`/ODataV4`) endpoint, which is tenant-specific and not covered by this skill.

## Query Process

### Step 1: Discover Companies

Run `getSchemas` to list available companies. On a multi-company connection (the default), each company is a separate schema.

### Step 2: Explore Tables

Use `getTables` against the target company schema. The `TABLE_TYPE` column is the reliable writability signal:
- `TABLE` — writable (INSERT / UPDATE / DELETE supported)
- `VIEW` — read-only (SELECT only)

Key writable tables: `customers`, `vendors`, `items`, `salesOrders` + `salesOrderLines`, `salesInvoices` + `salesInvoiceLines`, `salesQuotes` + `salesQuoteLines`, `salesCreditMemos` + `salesCreditMemoLines`, `purchaseOrders` + `purchaseOrderLines`, `purchaseInvoices` + `purchaseInvoiceLines`, `purchaseCreditMemos` + `purchaseCreditMemoLines`

Key read-only views: `accounts`, `generalLedgerEntries`, `agedAccountsReceivables`, `agedAccountsPayables`, `companies`, `dimensions`, `pdfDocument`, `balanceSheets`, `incomeStatements`, all `posted*` and `*Archive*` tables. Note: `purchaseQuotes` is a VIEW while `salesQuotes` is a TABLE.

`journals` and `journalLines` report `TABLE_TYPE = TABLE`, but treat them as read sources — see the note in Write Operations on journal entry creation.

### Step 3: Inspect Columns

Run `getColumns` on the target table before querying or writing. The `Readonly` flag in column metadata is unreliable — many server-managed fields (`number`, `lastModifiedDateTime`, `status`, `totalAmount*`) report `Readonly: false` despite being unwritable. Use the patterns in this skill instead.

### Step 4: Query with Full Three-Part Names

Filter on key fields — `id` (GUID), `number`, `status`, `customerId`/`vendorId`, `documentId`, and date columns are the standard filterable fields. For line tables, filter by `documentId`.

```sql
SELECT [id], [number], [status], [customerName], [orderDate], [totalAmountIncludingTax]
FROM [YourConnection].[YourCompany].[salesOrders]
WHERE [status] = 'Open'
ORDER BY [orderDate] DESC
LIMIT 20
```

## Data Model

### Key Tables

#### Master Data
- **customers** — Customer master: name, type, balance due, address, payment terms, currency
- **vendors** — Vendor master: name, outstanding balance, address, payment terms, currency
- **items** — Product and service catalog: name, type, price, cost, inventory level, posting groups

#### Sales Documents
- **salesQuotes** / **salesQuoteLines** — Draft quotations (writable; can be promoted to orders in BC)
- **salesOrders** / **salesOrderLines** — Sales orders and their line items
- **salesInvoices** / **salesInvoiceLines** — Sales invoices and line items
- **salesCreditMemos** / **salesCreditMemoLines** — Sales credit memos

#### Purchase Documents
- **purchaseOrders** / **purchaseOrderLines** — Purchase orders and line items
- **purchaseInvoices** / **purchaseInvoiceLines** — Purchase invoices and line items
- **purchaseCreditMemos** / **purchaseCreditMemoLines** — Purchase credit memos
- **purchaseQuotes** (VIEW — read-only; note asymmetry: `salesQuotes` is writable)

#### General Ledger
- **accounts** (VIEW) — Chart of accounts with type, category, and net change
- **generalLedgerEntries** (VIEW) — Posted GL transactions with debit/credit amounts
- **journals** — Journal batch headers (named posting containers)
- **journalLines** — Journal entry lines within a batch

#### Financial Reports (all VIEWs)
- **agedAccountsReceivables** / **agedAccountsPayables** — Customer and vendor aging summaries
- **balanceSheets**, **incomeStatements**, **cashFlowStatements**, **trialBalances**

#### Reference Data
- **currencies**, **paymentTerms**, **paymentMethods**, **shipmentMethods** — Transaction reference data
- **itemCategories**, **unitsOfMeasure**, **taxGroups**, **taxAreas**, **countriesRegions** — Item and tax reference data
- **locations**, **dimensions**, **dimensionValues** — Inventory and dimension reference data

### Document Hierarchy

Each document type is a separate top-level header with its own line table. Lines reference their header via `documentId` (GUID):

```
salesOrders (header)      ── salesOrderLines   (lines, via documentId)
salesInvoices (header)    ── salesInvoiceLines (lines, via documentId)
purchaseOrders (header)   ── purchaseOrderLines
purchaseInvoices (header) ── purchaseInvoiceLines
```

A sales invoice created from an order links back to it via `salesInvoices.orderId`. Filter line tables by `documentId` to retrieve a specific document's lines.

### Key Relationships

- `salesOrderLines.documentId` → `salesOrders.id`
- `salesInvoiceLines.documentId` → `salesInvoices.id`
- `purchaseOrderLines.documentId` → `purchaseOrders.id`
- `purchaseInvoiceLines.documentId` → `purchaseInvoices.id`
- `journalLines.journalId` → `journals.id`
- `salesOrders.customerId` → `customers.id`
- `purchaseOrders.vendorId` → `vendors.id`
- `generalLedgerEntries.accountId` → `accounts.id`

## Important Columns

### customers

- `id` — GUID primary key
- `number` — Customer number (human key; e.g., `10000`)
- `displayName` — Customer display name
- `type` — `Company` or `Person` (AL enum)
- `balanceDue` — Outstanding balance (DECIMAL; note: `balanceDue` on customers vs `balance` on vendors)
- `currencyCode` — Currency code (e.g., `USD`)
- `paymentTermsId` — FK to `paymentTerms.id`
- `paymentMethodId` — FK to `paymentMethods.id`
- `shipmentMethodId` — FK to `shipmentMethods.id`
- `creditLimit` — Credit limit (DECIMAL)
- `blocked` — VARCHAR AL-enum; filter on the literal encoded string, not a real space: `'_x0020_'` = not blocked, observed blocked states `'Ship'`/`'Invoice'`/`'All'` (may not be exhaustive — see Conventions for the authoritative-list technique)
- `lastModifiedDateTime` — Last modified timestamp

### vendors

- `id` — GUID primary key
- `number` — Vendor number (human key)
- `displayName` — Vendor display name
- `balance` — Outstanding balance (DECIMAL; note: `balance` on vendors vs `balanceDue` on customers)
- `currencyCode` — Currency code
- `paymentTermsId` — FK to `paymentTerms.id`
- `blocked` — VARCHAR AL-enum (same encoding as customers); same not-blocked literal `'_x0020_'`, own blocked states (observed: `'Payment'`/`'All'`; may not be exhaustive)
- `irs1099Code` — US 1099 reporting code
- `lastModifiedDateTime` — Last modified timestamp

### items

- `id` — GUID primary key
- `number` — Item number (human key)
- `displayName` — Item display name
- `type` — `Inventory`, `Service`, or `Non_x002D_Inventory` (AL enum; hyphen encoded as `_x002D_`)
- `unitPrice` — Sales price (DECIMAL)
- `unitCost` — Cost price (DECIMAL)
- `inventory` — Current quantity on hand (DECIMAL)
- `baseUnitOfMeasureCode` — Base unit of measure (e.g., `PCS`)
- `itemCategoryCode` — Item category code
- `blocked` — BOOLEAN (unlike `blocked` on customers/vendors which is a VARCHAR enum)
- `lastModifiedDateTime` — Last modified timestamp

### salesOrders

- `id` — GUID primary key
- `number` — Order number (e.g., `S-ORD101007`)
- `orderDate` — Order date (DATE)
- `status` — `Draft` or `Open`
- `customerId` — FK to `customers.id`
- `customerNumber` / `customerName` — Customer identifiers (read columns)
- `totalAmountExcludingTax` / `totalAmountIncludingTax` — Order totals (DECIMAL)
- `currencyCode` — Currency code
- `paymentTermsId` — FK to `paymentTerms.id`
- `shipmentMethodId` — FK to `shipmentMethods.id`
- `requestedDeliveryDate` — Requested delivery date (DATE)
- `fullyShipped` — All lines fully shipped (BOOLEAN)
- `lastModifiedDateTime` — Last modified timestamp

### salesOrderLines / salesInvoiceLines

- `id` — GUID primary key
- `documentId` — FK to parent header (GUID); **use this to filter lines for a document**
- `sequence` — Line sequence number
- `lineType` — `Item`, `Account`, `Resource`, `Comment`, `Charge`, `Fixed_x0020_Asset`, or `Allocation_x0020_Account` (AL enums)
- `itemId` — FK to `items.id` (Item lines); auto-fills description, UoM, and price on insert
- `accountId` — FK to `accounts.id` (Account/G-L lines)
- `lineObjectNumber` — Item or account number (read column; use `itemId`/`accountId` on write)
- `description` — Line description
- `quantity` — Quantity (DECIMAL)
- `unitPrice` — Unit price (DECIMAL; sales lines only — purchase lines use different column names)
- `discountPercent` — Line discount percentage
- `amountExcludingTax` / `amountIncludingTax` — Line totals (DECIMAL)

### salesInvoices (key columns beyond salesOrders)

- `invoiceDate` — Invoice date (DATE)
- `dueDate` — Payment due date (DATE)
- `status` — `Draft`, `Open`, or `Paid`
- `remainingAmount` — Outstanding amount (DECIMAL); **only on salesInvoices, not purchaseInvoices**. Computed field — cannot be used in ORDER BY (see Conventions)
- `orderId` / `orderNumber` — Originating order reference

### purchaseOrders / purchaseInvoices (differences from sales)

- `vendorId` / `vendorNumber` / `vendorName` — Vendor identifiers
- `purchaser` — Purchasing agent (vs `salesperson` on sales documents)
- `requestedReceiptDate` — Expected receipt date (purchaseOrders; vs `requestedDeliveryDate` on sales)
- `fullyReceived` — All lines received (purchaseOrders)
- `vendorInvoiceNumber` — Vendor's own reference number (purchaseInvoices only)
- `purchaseInvoices` has **no** `paymentTermsId` or `remainingAmount`

### purchaseOrderLines (key difference from sales lines)

- `directUnitCost` — Purchase unit cost (not `unitPrice`; purchase order lines only)
- `expectedReceiptDate` — Expected receipt date (DATE)
- `receiveQuantity` / `receivedQuantity` — Receiving tracking

### purchaseInvoiceLines (key difference from purchase order lines)

- `unitCost` — Unit cost on invoices (not `directUnitCost` as on purchase order lines)
- `expectedReceiptDate` — Expected receipt date (DATE)

### accounts (VIEW)

- `id` — GUID primary key
- `number` — G/L account number
- `displayName` — Account name
- `accountType` — `Posting`, `Heading`, `Total`, `Begin_x002D_Total`, or `End_x002D_Total` (AL enum; hyphen encoded)
- `category` — `Assets`, `Liabilities`, `Equity`, `Income`, `Expense`, `Cost_x0020_of_x0020_Goods_x0020_Sold`, or `_x0020_` (unassigned) (AL enum)
- `subCategory` — Detailed sub-category
- `netChange` — Net change for the current period (DECIMAL)
- `directPosting` — Accepts direct postings (BOOLEAN)
- `blocked` — BOOLEAN (unlike `blocked` on customers/vendors which is a VARCHAR enum)

### generalLedgerEntries (VIEW)

- `id` — GUID primary key
- `entryNumber` — Sequential entry number (INTEGER)
- `accountId` / `accountNumber` — Account reference
- `postingDate` — Posting date (DATE); **always filter by this for date-range queries**
- `documentNumber` — Source document number
- `documentType` — observed values `_x0020_` (unspecified), `Invoice`, `Payment` (AL enum; other BC document types may appear)
- `description` — Transaction description
- `debitAmount` / `creditAmount` — Debit and credit amounts (DECIMAL)

### journals

- `id` — GUID primary key
- `code` — Journal batch code (human key; e.g., `DAILY`, `DEFAULT`)
- `displayName` — Journal batch display name
- `balancingAccountNumber` — Default balancing account for the batch
- `templateDisplayName` — Parent journal template

### journalLines

- `id` — GUID primary key
- `journalId` — FK to `journals.id`; **filter lines by this to retrieve a batch's entries**
- `lineNumber` — Line sequence number (INTEGER)
- `accountId` / `accountNumber` — Posting account reference
- `postingDate` — Posting date (DATE)
- `amount` — Amount (DECIMAL)
- `description` — Line description
- `documentNumber` — Document reference number
- `balancingAccountId` / `balancingAccountNumber` — Balancing account override (optional)

## Common Query Patterns

### Find a Customer by Number

```sql
SELECT [id], [number], [displayName], [type], [balanceDue], [currencyCode], [paymentTermsId]
FROM [YourConnection].[YourCompany].[customers]
WHERE [number] = '10000'
```

### Find a Customer by Name

```sql
SELECT [id], [number], [displayName], [type], [balanceDue], [email]
FROM [YourConnection].[YourCompany].[customers]
WHERE [displayName] LIKE '%Adatum%'
LIMIT 10
```

### Open Sales Orders

```sql
SELECT [id], [number], [status], [customerName], [orderDate], [totalAmountIncludingTax], [currencyCode]
FROM [YourConnection].[YourCompany].[salesOrders]
WHERE [status] = 'Open'
ORDER BY [orderDate] DESC
LIMIT 20
```

### Lines for a Specific Document

Filter by the header's `id` using the `documentId` column to retrieve a document's lines.

```sql
SELECT [id], [sequence], [lineType], [lineObjectNumber], [description], [quantity], [unitPrice], [amountExcludingTax]
FROM [YourConnection].[YourCompany].[salesOrderLines]
WHERE [documentId] = '<salesOrder-id>'
```

### Outstanding Sales Invoices

```sql
SELECT [id], [number], [status], [customerName], [invoiceDate], [dueDate], [totalAmountIncludingTax], [remainingAmount]
FROM [YourConnection].[YourCompany].[salesInvoices]
WHERE [status] = 'Open'
-- to rank by remainingAmount, sort client-side: ORDER BY [remainingAmount] is rejected (computed column)
-- this example orders by dueDate, a bound column
ORDER BY [dueDate]
LIMIT 20
```

### G/L Entries by Date Range

```sql
SELECT [entryNumber], [accountNumber], [postingDate], [documentNumber], [documentType], [description], [debitAmount], [creditAmount]
FROM [YourConnection].[YourCompany].[generalLedgerEntries]
WHERE [postingDate] >= '2024-01-01' AND [postingDate] <= '2024-03-31'
ORDER BY [postingDate], [entryNumber]
LIMIT 50
```

### Chart of Accounts — Posting Accounts Only

```sql
SELECT [number], [displayName], [accountType], [category], [subCategory], [netChange]
FROM [YourConnection].[YourCompany].[accounts]
WHERE [accountType] = 'Posting'
ORDER BY [number]
```

### Journal Lines for a Batch

```sql
SELECT [lineNumber], [accountNumber], [postingDate], [description], [amount], [documentNumber]
FROM [YourConnection].[YourCompany].[journalLines]
WHERE [journalId] = '<journal-id>'
ORDER BY [lineNumber]
```

## Stored Procedures

### RequestRawValue

Retrieves the raw value of a BC OData resource — a primitive property or a binary stream such as a document PDF. This is how to pull a document PDF through Connect AI, in two steps.

**Step 1 — get the media read link from the `pdfDocument` view.** The view is queryable only when **both** `parentType` (an AL enum, e.g. `Sales_x0020_Invoice`) and `parentId` (the document `id`) are supplied. Its `pdfDocumentContent` column returns the resource URL (not the bytes):

```sql
SELECT [pdfDocumentContent]
FROM [YourConnection].[YourCompany].[pdfDocument]
WHERE [parentType] = 'Sales_x0020_Invoice' AND [parentId] = '<salesInvoice-id>'
```

**Step 2 — pass that URL to `RequestRawValue` as `MediaReadLink`.** Omit the optional `FileStream` parameter (a local output-stream target that cloud environments cannot provide); the procedure then returns the content as base64 in the `FileData` column, alongside `Success`:

```json
{
  "procedure": "RequestRawValue",
  "parameters": {
    "MediaReadLink": "<pdfDocumentContent URL from step 1>"
  }
}
```

Decode the `FileData` base64 to recover the PDF. `parentType` is an AL enum — use the encoded value for the document type (e.g. `Sales_x0020_Invoice`, `Purchase_x0020_Invoice`). (The `GetAdminConsentURL` procedure also exists but is only used during OAuth setup, not for data work.)

## Write Operations

Dynamics 365 Business Central supports INSERT and UPDATE through Connect AI where the BC user's permissions allow. Document lines can only be inserted while the parent document's `status` is `Draft`.

### Create a Master Record

```sql
-- Customer — only displayName required
INSERT INTO [YourConnection].[YourCompany].[customers] ([displayName]) VALUES ('Contoso Ltd')

-- Vendor — only displayName required
INSERT INTO [YourConnection].[YourCompany].[vendors] ([displayName]) VALUES ('Alpine Supplies')

-- Item — only displayName required; type defaults to Inventory
INSERT INTO [YourConnection].[YourCompany].[items] ([displayName]) VALUES ('Widget Pro 3000')
```

### Create a Document Header

```sql
-- Sales order — customerId required
INSERT INTO [YourConnection].[YourCompany].[salesOrders] ([customerId]) VALUES ('<customer-id>')

-- Sales invoice — customerId required; supply number if the tenant number series is manual
INSERT INTO [YourConnection].[YourCompany].[salesInvoices] ([customerId], [number]) VALUES ('<customer-id>', 'INV-2025-001')

-- Purchase order — vendorId required
INSERT INTO [YourConnection].[YourCompany].[purchaseOrders] ([vendorId]) VALUES ('<vendor-id>')

-- Purchase invoice — vendorId required
INSERT INTO [YourConnection].[YourCompany].[purchaseInvoices] ([vendorId]) VALUES ('<vendor-id>')
```

### Add a Line to a Document

Lines require `documentId` + `lineType` + `quantity`. For Item lines, supply `itemId` (auto-fills description, UoM, and price). For Account/G-L lines, supply `accountId`. Comment lines need no object id.

```sql
-- Item line on a sales order
INSERT INTO [YourConnection].[YourCompany].[salesOrderLines]
  ([documentId], [lineType], [itemId], [quantity])
VALUES ('<order-id>', 'Item', '<item-id>', 5)

-- Account/G-L line on a purchase invoice (note: unitCost, not directUnitCost)
INSERT INTO [YourConnection].[YourCompany].[purchaseInvoiceLines]
  ([documentId], [lineType], [accountId], [quantity], [unitCost])
VALUES ('<invoice-id>', 'Account', '<account-id>', 1, 250.00)

-- Comment line — no object id needed
INSERT INTO [YourConnection].[YourCompany].[salesOrderLines]
  ([documentId], [lineType], [description])
VALUES ('<order-id>', 'Comment', 'Rush delivery requested')
```

**Unsupported line types:** `Resource`, `Charge`, `Fixed_x0020_Asset`, and `Allocation_x0020_Account` lines cannot be created via Connect AI — these line types have no id column, and BC's API requires an object reference that cannot be formed without one.

### Update an Existing Record

```sql
UPDATE [YourConnection].[YourCompany].[customers]
SET [email] = 'billing@contoso.com', [paymentTermsId] = '<terms-id>'
WHERE [id] = '<customer-id>'
```

### Journal Entries Are Read-Only in Practice

`journals` and `journalLines` are readable, but creating a `journalLine` through the generic connector is not supported on a standard connection: the insert is rejected because the general-journal batch association is not established (`Name must have a value in Gen. Journal Batch`). Document `journals` / `journalLines` for reading (filter lines by `journalId`); use the BC web client or a dedicated integration to post journal entries.

### No Posting, Shipping, or Sending

Document workflows (posting an invoice, shipping an order, emailing a PDF) are BC bound actions not exposed as stored procedures. Connect AI is limited to **draft-document CRUD** — create, read, update, and delete documents and their lines. Use the BC web client or Power Automate for posting and workflow actions.

### Write Access Control

If write operations are blocked, the Connect AI connection may be set to readonly. Guide the user to their Connect AI connection settings to ensure write access is enabled. Beyond that, the BC user whose credentials the connection uses must have the relevant BC permission sets for the operation.

## Dynamics 365 Business Central-Specific Conventions

- **Three-part names are required.** Two-part names and empty-middle names both fail. Always use `[YourConnection].[CompanyName].[TableName]` and bracket-quote the company name. `getSchemas` returns the exact string to use.
- **AL enum encoding.** Multi-word BC enum values are XML-symbol-encoded: space → `_x0020_`, hyphen → `_x002D_`. Pass the encoded form literally in WHERE filters and on INSERT/UPDATE:
  - `items.type`: `Inventory`, `Service`, `Non_x002D_Inventory`
  - `*.lineType`: `Item`, `Account`, `Comment`, `Charge`, `Fixed_x0020_Asset`, `Allocation_x0020_Account`
  - `customers/vendors.blocked`: filter on the literal string `'_x0020_'`, not a real space (a real space returns "not a valid enumeration type constant"). `'_x0020_'` = not blocked; observed blocked states `'Ship'`/`'Invoice'`/`'All'` (customers), `'Payment'`/`'All'` (vendors). May not be exhaustive — use the invalid-insert technique below for the authoritative list.
  - `generalLedgerEntries.documentType`: `_x0020_` = unspecified, `Invoice`, `Payment`
  - To discover valid values for an enum field on INSERT: attempt an insert with an invalid value — the error message lists the accepted options.
- **`blocked` is not uniform across tables.** On `customers` and `vendors`, `blocked` is a VARCHAR enum. On `items` and `accounts`, `blocked` is a BOOLEAN. Check `getColumns` to confirm the type before filtering.
- **`TABLE_TYPE` is the reliable writability signal.** From `getTables`: `TABLE` = writable, `VIEW` = read-only. The `Readonly` flag in `getColumns` output is not reliable for BC — do not rely on it.
- **Line cost and price column names differ by table.** Sales lines use `unitPrice`; purchase order lines use `directUnitCost`; purchase invoice lines use `unitCost`. Confirm with `getColumns` before writing.
- **`lineObjectNumber` is a read column, not a write column.** It appears in SELECT results but BC rejects it on INSERT/UPDATE. Use `itemId` (Item lines) or `accountId` (Account lines) for object references.
- **Invoice lines are draft-only on insert.** Lines can only be added to a `salesInvoice` or `purchaseInvoice` while its `status` is `Draft`. Order lines can be added when the order is `Draft` or `Open`.
- **Number series.** Creating a `salesInvoice` can fail with `You cannot assign new numbers from the number series S-INV` if the tenant's series requires manual assignment. Supply an explicit `number` value in that case. Sales orders and purchase invoices typically auto-assign.
- **`remainingAmount` is sales-invoice-only.** This column exists on `salesInvoices` but not on `purchaseInvoices`.
- **Do NOT select or filter `paymentTermsId` on `purchaseInvoices`.** The column does not exist there (unlike `purchaseOrders` and all sales documents); selecting it fails with "column not found." If payment terms are needed, read them from the originating `purchaseOrders` record or the `vendors` master instead.
- **Pseudo-columns appear on every table.** `Filter`, `DirectURL`, `HTTPMethod`, and `URLType` are driver-internal columns visible in `getColumns` output — ignore them.
- **Navigation columns appear on every table.** Columns like `salesOrderLines`, `currency`, `customer`, and `documentAttachments` are OData navigation properties surfaced as VARCHAR. They do not contain queryable data in SELECT and should not be used in WHERE clauses.
- **Dynamic schema.** BC's table and column set comes from the OData `$metadata` for the tenant. Custom fields added in BC appear as additional columns. Use `getColumns` to discover them.
- **Computed columns reject ORDER BY.** Some columns are computed/derived rather than bound to a table field (confirmed: `salesInvoices.remainingAmount`). Sorting on them fails server-side with "cannot be used for $orderby because it is not bound directly to a table field." When a request asks to rank or sort documents by a computed amount (e.g. sales invoices by outstanding amount), do NOT `ORDER BY` that column — retrieve the rows (filtered, unsorted or ordered by a bound column such as `dueDate`) and sort client-side. If a sort or filter on any column errors this way, treat that column as computed.
- **Date format.** Use `'YYYY-MM-DD'` for DATE literals in WHERE clauses.
