# Sage Intacct REST API Reference

> Surface: `Schema = SageIntacctRest`. The newer REST API. Load this reference when the live connection's `getSchemas` returns **`SageIntacctRest`**. See the base [SKILL.md](../SKILL.md) for surface identification.
>
> The REST surface is an entirely different object model from the XML surface — different table names, different column-naming conventions, and no stored procedures. Do not carry XML table or column names (`Glaccount`, `Gldetail`, `Recordno`, `Totaldue`) over to REST.

## Schema

The schema name is `SageIntacctRest`. The three-part name is `[Catalog].[SageIntacctRest].[Table]`:

```sql
SELECT [id], [name], [accountType], [status] FROM [YourConnection].[SageIntacctRest].[Account] LIMIT 10
```

## Column conventions (read this first)

REST columns follow conventions that are consistent across every table — learn them once and they apply everywhere:

- **`key`** is the system primary key (every entity has it; marked as the key, read-only). Use `key` for joins and as the target of updates.
- **`id`** is the business/human-facing identifier (account number, customer ID, etc.). Some entities also have a more specific document-number column — `invoiceNumber` on `Invoice`, `billNumber` on `Bill`, `documentId` on `JournalEntryLine`.
- **Reference fields are flattened quads**: `<entity>_Id`, `<entity>_Key`, `<entity>_Name`, `<entity>_Href`. For example `customer_Id` / `customer_Key` / `customer_Name`, `glAccount_Id` / `glAccount_Key` / `glAccount_Name`, `vendor_Id` / `vendor_Key`. Filter or join on `_Key` (system key) or `_Id` (business ID); `_Name` is the display value; `_Href` is the REST API link.
- **camelCase column names** throughout (`accountType`, `invoiceDate`, `totalTxnAmount`, `dueDate`).
- **Nested objects are flattened with a prefix**, e.g. `paymentInformationTotalTxnAmountPaid`, `billSummary_IsSummaryPosted`, `invoiceSummary_GlPostingDate`.
- **`ListAggregate_*` columns** carry child collections (line items, contacts, etc.) — e.g. `ListAggregate_Lines`, `ListAggregate_TaxEntries`, `ListAggregate_ContactList`. They are used on `INSERT` to supply line items (see [Write Operations](#write-operations)).
- **Amounts**: `totalBaseAmount` (home currency) vs. `totalTxnAmount` (transaction currency), with `...Due` variants; line tables use `baseAmount` / `txnAmount`. Currency codes are `currencyBaseCurrency` / `currencyTxnCurrency`.
- **`status`** is on master records (`active` / `inactive`); **`state`** is on transactions.
- **Dates**: `auditCreatedDateTime` / `auditModifiedDateTime` (audit), plus entity dates like `invoiceDate`, `dueDate`, `postingDate`, `entryDate`, `createdDate`.

There are **no stored procedures** on the REST surface — everything is SQL plus `INSERT` / `UPDATE`.

## Query Process

1. **Locate the master record or entity** (`Account`, `Customer`, `Vendor`, `Item`) by `id` or `name`.
2. **Inspect with `getColumns`.** REST tables are wide, with flattened compound names and many custom fields — confirm column names before writing the query.
3. **Query the transaction entity** (`Invoice`, `Bill`, `JournalEntryLine`, `Payment`), filtering by a date column and `state`, and joining back to masters on `_Key` / `_Id`.
4. **For GL detail, use `JournalEntryLine`** — there is no `Gldetail` view on REST.

## Data Model

### Key Tables

#### General Ledger
- **`Account`** — Chart of accounts (the REST equivalent of XML `Glaccount`)
- **`JournalEntry`** / **`JournalEntryLine`** — Journal entries and their lines (the REST GL detail — replaces XML `Gldetail`/`Glentry`)
- **`Journal`**, **`Book`**, **`Budget`** / **`BudgetDetail`** — Journals, books, budgets
- **`StatisticalJournalEntry`** / **`StatisticalJournalEntryLine`** — Statistical journals

#### Accounts Payable (AP)
- **`Vendor`** — Vendor master
- **`Bill`** / **`BillLine`** — AP bills and lines
- **`Payment`** / **`PaymentLine`** — AP payments
- **`Adjustment`** / **`AdjustmentLine`** — AP/AR adjustments

#### Accounts Receivable (AR)
- **`Customer`** — Customer master
- **`Invoice`** / **`InvoiceLine`** — AR invoices and lines
- **`ReceivedPayment`** / **`ReceivedPaymentLine`** — Customer payments received
- **`CustomerRefund`** — Customer refunds

#### Inventory, Purchasing & Order Entry
- **`Item`** — Item master
- **`Document*`** family — The unified document model for purchasing and order entry. Type-specific tables include `DocumentPurchaseOrder`, `DocumentSalesOrder`, `DocumentSalesInvoice`, `DocumentPOReceiver`, each with a matching `DocumentLine*` line table.
- **`Warehouse`**, **`Bin`** — Inventory locations

#### Projects, Dimensions & Org
- **`Project`**, **`Task`**, **`Timesheet`** / **`TimesheetLine`** — Project accounting
- **`Department`**, **`Location`**, **`Class`**, **`Entity`** — Reporting dimensions
- **`Employee`**, **`Contact`** — People

### Key Relationships

- `Customer` → `Invoice`, `ReceivedPayment` (via `customer_Key` / `customer_Id`)
- `Vendor` → `Bill`, `Payment` (via `vendor_Key` / `vendor_Id`)
- `Account` → `JournalEntryLine` (via `glAccount_Key` / `glAccount_Id`)
- `JournalEntry` → `JournalEntryLine` (via `journalEntry_Key`)
- Header → line: a transaction's `key` maps to its line table's parent reference (e.g., `Invoice` → `InvoiceLine`, `Bill` → `BillLine`). Confirm the line table's parent column with `getColumns`.

## Important Columns

### Account
- `key` — System primary key
- `id` — Account number (business key)
- `name` — Account title
- `accountType` — Account classification
- `status` — `active` / `inactive`
- `category` — Account category
- `closingType`, `closeToGLAccount_Id` — Period-close configuration
- `entity_Id` / `entity_Name` — Owning entity (multi-entity tenants)

### Invoice (AR)
- `key` — System primary key
- `id` / `invoiceNumber` — Document identifiers
- `customer_Id` / `customer_Key` / `customer_Name` — Customer
- `state` — Invoice state
- `invoiceDate`, `dueDate` — Dates
- `totalBaseAmount` / `totalTxnAmount` — Totals (base vs. transaction currency)
- `totalBaseAmountDue` / `totalTxnAmountDue` — Outstanding amounts
- `currencyBaseCurrency` / `currencyTxnCurrency` — Currency codes
- `term_Id` / `term_Name` — Payment term
- `paymentInformationTotalTxnAmountPaid` — Amount paid (flattened nested field)
- `ListAggregate_Lines` — Line items (for INSERT)

### Bill (AP)
- `key` — System primary key
- `id` / `billNumber` — Document identifiers
- `vendor_Id` / `vendor_Key` / `vendor_Name` — Vendor
- `state` — Bill state
- `createdDate`, `dueDate`, `postingDate` — Dates
- `totalBaseAmount` / `totalTxnAmount` / `totalTxnAmountDue` — Amounts
- `term_Id` — Payment term
- `paymentPriority`, `isOnHold` — Payment handling
- `ListAggregate_Lines` — Line items (for INSERT)

### JournalEntryLine (GL detail)
- `key` — System primary key
- `journalEntry_Id` / `journalEntry_Key` — Parent journal entry
- `glAccount_Id` / `glAccount_Key` / `glAccount_Name` — GL account
- `txnType` — Debit/credit indicator
- `txnAmount` / `baseAmount` — Transaction- and base-currency amount
- `entryDate` — Entry date (use for date filters)
- `documentId`, `description` — Document reference and memo
- `state` — Line state
- `currencyTxnCurrency` / `currencyBaseCurrency`, `currencyExchangeRate` — Currency
- `ListAggregate_TaxEntries` — Tax entries

### Customer
- `key` — System primary key
- `id` — Customer ID (business key)
- `name` — Customer name
- `status` — `active` / `inactive`
- `totalDue` — Outstanding balance
- `creditLimit` — Credit limit
- `currency` — Default currency
- `term_Id` — Default payment term
- `parent_Id` / `parent_Name` — Parent customer
- `salesRepresentative_Id`, `customerType_Id` — References
- `ListAggregate_ContactList` — Associated contacts

### Vendor
- `key` — System primary key
- `id` — Vendor ID (business key)
- `name` — Vendor name
- `status` — `active` / `inactive`
- `totalDue` — Outstanding balance
- `creditLimit` — Credit limit
- `currency` — Default currency
- `term_Id` — Default payment term
- `parent_Id` / `parent_Name` — Parent vendor
- `accountGroup_Id`, `defaultExpenseGLAccount_Id` — GL grouping and default expense account
- `taxId`, `vendorAccountNumber`, `paymentPriority`, `isOnHold` — Tax ID, account number, payment handling
- `ListAggregate_ContactList` — Associated contacts

## Common Query Patterns

### Active accounts by type

```sql
SELECT [id], [name], [accountType], [status]
FROM [YourConnection].[SageIntacctRest].[Account]
WHERE [status] = 'active' AND [accountType] = 'balancesheet'
ORDER BY [id]
```

### Outstanding AR invoices

```sql
SELECT [id], [invoiceNumber], [customer_Name], [totalTxnAmount], [totalTxnAmountDue], [dueDate]
FROM [YourConnection].[SageIntacctRest].[Invoice]
WHERE [totalTxnAmountDue] > 0
ORDER BY [dueDate]
```

### Overdue AP bills

```sql
SELECT [id], [billNumber], [vendor_Name], [totalTxnAmount], [totalTxnAmountDue], [dueDate], [state]
FROM [YourConnection].[SageIntacctRest].[Bill]
WHERE [totalTxnAmountDue] > 0
  AND [dueDate] < GETDATE()
ORDER BY [dueDate]
```

### GL lines for an account over a date range

```sql
SELECT [entryDate], [glAccount_Id], [glAccount_Name], [txnType], [txnAmount], [description], [documentId]
FROM [YourConnection].[SageIntacctRest].[JournalEntryLine]
WHERE [glAccount_Id] = '6230'
  AND [entryDate] >= '2025-01-01'
  AND [entryDate] <= '2025-01-31'
ORDER BY [entryDate]
```

### Invoices with their lines (join header to line on `key`)

```sql
SELECT i.[invoiceNumber], i.[customer_Name], li.[txnAmount], li.[glAccount_Name]
FROM [YourConnection].[SageIntacctRest].[Invoice] i
LEFT JOIN [YourConnection].[SageIntacctRest].[InvoiceLine] li ON li.[invoice_Key] = i.[key]
WHERE i.[invoiceNumber] = 'INV-12345'
```

> Confirm the line table's parent reference column (e.g. `invoice_Key`) with `getColumns` — REST line tables name the parent reference after the header entity.

### Customer balances

```sql
SELECT [id], [name], [totalDue], [creditLimit], [status]
FROM [YourConnection].[SageIntacctRest].[Customer]
WHERE [status] = 'active' AND [totalDue] > 0
ORDER BY [totalDue] DESC
```

## Write Operations

The REST surface supports `INSERT` and `UPDATE` where the connection and the Sage Intacct user's permissions allow it. There are no stored procedures.

### Insert with line items via `ListAggregate_Lines`

Transaction entities with line items (`Invoice`, `Bill`, `JournalEntry`, …) accept their lines through the `ListAggregate_Lines` column on `INSERT`. Before writing one for the first time, sample the column from existing rows to see the exact aggregate shape the entity produces, then mirror that structure:

```sql
SELECT TOP 3 [key], [ListAggregate_Lines]
FROM [YourConnection].[SageIntacctRest].[Bill]
```

### Update by `key`

```sql
UPDATE [YourConnection].[SageIntacctRest].[Customer]
SET [creditLimit] = 50000
WHERE [key] = '1234'
```

Target updates by `key` (the system primary key), not by `id`.

### Write access control

If a write is blocked, the Connect AI connection may be read-only — guide the user to their Connect AI connection settings to enable write access. Beyond that, the Sage Intacct user authorized for the connection must have permission for the specific object and operation in Sage Intacct.

## REST-Specific Conventions

- **`key` vs. `id`.** `key` is the system primary key — use it for joins and updates. `id` is the business identifier; document entities add a specific number column (`invoiceNumber`, `billNumber`). Don't confuse the two.
- **Reference fields are `_Id` / `_Key` / `_Name` / `_Href` quads.** Join and filter on `_Key` or `_Id`; `_Name` is display-only.
- **Everything is camelCase**, and nested objects are flattened with a prefix (`paymentInformationTotalTxnAmountPaid`, `billSummary_IsSummaryPosted`). Run `getColumns` — these names are not guessable.
- **`status` (masters) vs. `state` (transactions).** Filter masters by `status = 'active'`; filter transactions by `state` plus a date.
- **Base vs. transaction currency.** `totalBaseAmount` / `baseAmount` are home currency; `totalTxnAmount` / `txnAmount` are transaction currency.
- **GL detail is `JournalEntryLine`**, not `Gldetail`. There is no `Gldetail` view on REST.
- **`ListAggregate_*` columns** hold child collections and are how you supply line items on `INSERT` — sample an existing row's aggregate before writing one.
- **No stored procedures.** Tasks that use a procedure on the XML surface (`ReverseInvoice`, `AccountBalanceReport`, attachments) are not available as procedures here — use SQL, writes, or the relevant report/entity tables.
- **Date filters are essential** on `JournalEntryLine`, `Invoice`, `Bill`, and the `Document*` tables to avoid timeouts.
