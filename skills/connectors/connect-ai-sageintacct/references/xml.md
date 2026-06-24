# Sage Intacct XML API Reference

> Surface: `Schema = SageIntacct`. The XML-based API — the default Sage Intacct configuration. Load this reference when the live connection's `getSchemas` returns **`SageIntacct`**. See the base [SKILL.md](../SKILL.md) for surface identification.
>
> This reference covers both XML implementations (`UseLegacy=True` and `UseLegacy=False`). They are identical for query construction; the only difference is server-side vs. client-side processing — see [UseLegacy & performance](#uselegacy--performance).

## Schema

The schema name is `SageIntacct`. The three-part name is `[Catalog].[SageIntacct].[Table]`:

```sql
SELECT [Accountno], [Title], [Accounttype] FROM [YourConnection].[SageIntacct].[Glaccount] LIMIT 10
```

## UseLegacy & performance

Both `UseLegacy` modes report schema `SageIntacct` and expose the same tables, columns, and procedures, so you cannot tell them apart at query time and you write the same SQL for both. The difference is execution:

- **`UseLegacy=False`** (newer, default) pushes `WHERE`, `ORDER BY`, `OFFSET`, and aggregate functions (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) to the Sage Intacct server. It also exposes a few extra audit/UUID columns (e.g., `Si_uuid`, `Createdbyloginid`, `Modifiedbyloginid`).
- **`UseLegacy=True`** (legacy) emulates those operations client-side — the driver fetches rows and processes them locally — which is slower and more timeout-prone on large tables.

If queries on large transaction tables (`Gldetail`, document tables) are slow or time out and you've already applied tight date filters, the connection may be on `UseLegacy=True`; recommend the user set `UseLegacy=False` for server-side filtering, sorting, and aggregation.

## Query Process

Sage Intacct XML data is organized around GL accounts, AR/AP master records, and the transactions and balances tied to them. Most questions follow one of two flows.

### General ledger / financial reporting

1. **Find the GL account.** Filter `Glaccount` by `Title` (LIKE) or `Accountno`. Capture the `Accountno` — it is the business key used on transactions.
2. **Pull transaction detail** from `Gldetail` filtered by `Accountno` and a date range on `Entry_date`. `Gldetail` is the posted GL line view.
3. **Pull period balances** from the `AccountBalance` view (by `ReportingPeriodName` or a date/account range) or run the `AccountBalanceReport` stored procedure for actual-vs-budget figures.

### AR / AP analysis

1. **Identify the master record** (`Customer` or `Vendor`) by `Name`/`Customerid`/`Vendorid`.
2. **Query the document table** (`Arinvoice` or `Apbill`), filtering by `State` and a date field (`Whendue`, `Whencreated`).
3. **Join to line items** (`Arinvoiceitem`, `Apbillitem`) on the header `Recordno` when you need line detail, and to payment tables for payment history.

Run `getColumns` on a table before writing targeted queries — Sage Intacct tables are wide and tenants add many custom fields.

## Data Model

### Key Tables

#### Core General Ledger
- **`Glaccount`** — Chart of accounts: account number, type, normal balance, status
- **`Gldetail`** — Posted GL transaction lines (view) — the GL detail for reporting
- **`Glentry`** — Individual GL journal entry lines
- **`Glbatch`** — GL batch headers for journal entries
- **`Gljournal`** / **`Journal`** — Journal definitions
- **`Glbudgetheader`** / **`Glbudgetitem`** — Budget data
- **`AccountBalance`** — Account balance summaries by period (parameterized view — see [Important Columns](#accountbalance))

#### Accounts Payable (AP)
- **`Vendor`** — Vendor master
- **`Apbill`** / **`Apbillitem`** — AP bills and their line items
- **`Appayment`** / **`Appaymentitem`** — Vendor payments and lines
- **`Apterm`** — Vendor payment terms
- **`Apadjustment`** — AP adjustments

#### Accounts Receivable (AR)
- **`Customer`** — Customer master
- **`Arinvoice`** / **`Arinvoiceitem`** — AR invoices and their line items
- **`Arpayment`** / **`Arpaymentitem`** — Customer payments and lines
- **`Arterm`** — Customer payment terms
- **`Aradjustment`** — AR adjustments

#### Inventory & Purchasing
- **`Item`** — Inventory/item master
- **`Podocument`** / **`Podocumententry`** — Purchase orders, requisitions, receivers (a single header table with document-type-specific views, e.g., `PodocumentPurchaseOrder`)
- **`Sodocument`** / **`Sodocumententry`** — Sales orders, quotes, invoices (document-type-specific views, e.g., `SodocumentSalesOrder`)
- **`Warehouse`** — Warehouse locations

#### Project Accounting
- **`Project`** — Project master with budgets and actuals
- **`Task`** — Project tasks
- **`Timesheet`** / **`Timesheetentry`** — Time tracking

#### Organization & Dimensions
- **`Department`**, **`Location`**, **`Class`** — Reporting dimensions
- **`Employee`** — Employee records
- **`Company`** — Company/entity configuration

### Key Relationships

**Master → transaction**
- `Customer` → `Arinvoice`, `Arpayment` (via `Customerid`)
- `Vendor` → `Apbill`, `Appayment` (via `Vendorid`)
- `Glaccount` → `Gldetail` (via `Accountno`)
- `Item` → document line items (via `Itemid`)
- Department / Location / Project / Class → transaction lines (via the respective `*id` column)

**Header → line:** transaction headers join to their line-item tables on `Recordno` → `Recordkey` (e.g., `Arinvoice.Recordno = Arinvoiceitem.Recordkey`). Confirm the line table's foreign-key column with `getColumns` before joining.

### Field Patterns

- **Keys.** Every table carries `Recordno` (the system record number). On **master** tables the *business key* is what the driver marks as the primary key — `Glaccount.Accountno`, `Customer.Customerid`, `Vendor.Vendorid`, `Project.Projectid`. On **transaction** tables (`Arinvoice`, `Apbill`, `Gldetail`) the primary key is `Recordno`, and `Recordid` holds the human-facing document/invoice/bill number.
- **Foreign keys & display names.** References appear as `<entity>id` plus a paired `<entity>name` (e.g., `Customerid` / `Customername`, `Vendorid` / `Vendorname`). Newer-implementation tables may also expose `<object>_recordno` foreign-key columns.
- **Contact field prefixes.** Contact blocks are flattened with prefixes: `Displaycontact_` (master display contact), `Contactinfo_` (primary contact), and `Shipto_` / `Billto_` / `Payto_` / `Returnto_` / `Contact_` (role-specific). Common subfields: `_contactname`, `_email1`, `_phone1`, `_mailaddress_city`, `_mailaddress_state`.
- **Status vs. State.** `Status` is on master tables (`active`, `inactive`, `active-non-posting`). `State` is on transactions (`Posted`, `Draft`, `Partially Paid`, `Paid`, `Void`). `Cleared` (on `Gldetail`) is `F` (not cleared), `T` (cleared), or `R` (reconciled).
- **Amount fields.** Base/home currency: `Totalentered`, `Totaldue`, `Totalpaid`, `Amount`. Transaction currency: the `Trx_`-prefixed equivalents (`Trx_totalentered`, `Trx_totaldue`, …). Retainage: `Totalretained`, `Trx_totalretained`.
- **Date fields.** Sage Intacct uses a `When`-prefix on documents (`Whencreated`, `Whenposted`, `Whendue`, `Whenpaid`, `Whenmodified`). `Gldetail` uses `Entry_date` for the posting date.

## Important Columns

### Glaccount
- `Accountno` — GL account number (**primary/business key**)
- `Title` — Account name
- `Accounttype` — High-level classification (e.g., `balancesheet`, `incomestatement`). The exact set varies by tenant — sample it before relying on specific values.
- `Normalbalance` — `debit` or `credit`
- `Status` — `active`, `inactive`, or `active-non-posting`
- `Category` / `Categorykey` — Account category grouping (the category column is `Category`, not `Categoryname`)
- `Recordno` — System record number

### Gldetail
- `Recordno` — Primary key of the GL line
- `Accountno` / `Accounttitle` — GL account number and title
- `Entry_date` — Posting/entry date (use for date filters)
- `Tr_type` — Debit (`1`) or credit (`-1`) indicator
- `Debitamount` / `Creditamount` / `Amount` — Base-currency amounts; `Trx_debitamount` / `Trx_creditamount` / `Trx_amount` for transaction currency
- `Description`, `Document`, `Recordid`, `Docnumber` — Description and document references
- `State` — GL line state
- `Cleared` / `Clrdate` — Bank reconciliation status and date
- `Departmentid`, `Locationid`, `Projectid`, `Customerid`, `Vendorid`, `Itemid`, `Classid` — Dimension references (any may be NULL)

> Important: `Gldetail` has **no `Accounttype` column**. To filter GL detail by account classification, join to `Glaccount` on `Accountno` (see [Common Query Patterns](#common-query-patterns)). Filtering `Gldetail` directly by `[Accounttype]` fails.

### Arinvoice
- `Recordno` — Primary key
- `Recordid` — Invoice number
- `Customerid` / `Customername` — Customer
- `State` — `Posted`, `Partially Paid`, `Paid`, `Draft`, `Void`
- `Totalentered` / `Totaldue` / `Totalpaid` — Base-currency totals (`Trx_`-prefixed for transaction currency)
- `Whencreated`, `Whenposted`, `Whendue`, `Whenpaid` — Dates
- `Currency` / `Basecurr` — Transaction and base currency codes
- `Termname` — Payment term
- `Docnumber` — Reference number

### Apbill
- `Recordno` — Primary key
- `Recordid` — Bill number
- `Vendorid` / `Vendorname` — Vendor
- `State` — `Posted`, `Partially Paid`, `Paid`, `Draft`, `Void`
- `Totalentered` / `Totaldue` / `Totalpaid` — Base-currency totals (`Trx_`-prefixed for transaction currency)
- `Whencreated`, `Whenposted`, `Whendue`, `Whenpaid` — Dates
- `Currency` — Transaction currency
- `Termname` — Payment term

### Customer
- `Customerid` — **Primary/business key**
- `Name` — Customer name
- `Status` — `active`, `inactive`, or `active-non-posting`
- `Totaldue` — Outstanding balance
- `Creditlimit` — Credit limit
- `Currency` — Default currency
- `Termname` — Default payment term
- `Parentid` / `Parentname` — Parent customer (hierarchies)
- `Displaycontact_contactname` / `Displaycontact_email1` / `Displaycontact_phone1` — Primary contact

### Vendor
- `Vendorid` — **Primary/business key**
- `Name` — Vendor name
- `Status` — `active`, `inactive`, or `active-non-posting`
- `Totaldue` — Outstanding balance
- `Currency` — Default currency
- `Termname` — Default payment term
- `Vendtype` — Vendor type
- `Form1099type` / `Form1099box` — 1099 reporting
- `Displaycontact_contactname` / `Displaycontact_email1` / `Displaycontact_phone1` — Primary contact

### Project
- `Projectid` — **Primary/business key**
- `Name` — Project name
- `Status` — `active` or `inactive`
- `Projectstatus` — Workflow status (distinct from `Status`)
- `Customerid` / `Customername` — Associated customer
- `Begindate` / `Enddate` — Project dates
- `Budgetamount` / `Contractamount` / `Actualamount` — Financials
- `Percentcomplete` — Calculated completion percentage (read-only)
- `Managerid` / `Managercontactname` — Project manager

### AccountBalance
A **parameterized view**: it returns period balances and accepts filter columns in the `WHERE` clause. Supply **either** `ReportingPeriodName` **or** a date + account range.

- `ReportingPeriodName` — Reporting period (e.g., `Month Ended January 2025`); alternative to `StartDate`/`EndDate`
- `glaccountno` — GL account number
- `startbalance`, `debits`, `credits`, `adjdebits`, `adjcredits`, `endbalance` — Balance figures
- `reportingbook` — Reporting book (`ACCRUAL` / `CASH`)
- `currency`, `locationid` / `locationname`, `departmentid` / `departmentname`
- Filter-only inputs: `StartDate`, `EndDate`, `StartAccountNo`, `EndAccountNo`, `ShowZeroBalances` (required if not using `ReportingPeriodName`)

## Common Query Patterns

### Active GL accounts by type

```sql
SELECT [Accountno], [Title], [Accounttype], [Normalbalance]
FROM [YourConnection].[SageIntacct].[Glaccount]
WHERE [Status] = 'active' AND [Accounttype] = 'balancesheet'
ORDER BY [Accountno]
```

### GL transactions for an account over a date range

```sql
SELECT [Entry_date], [Description], [Debitamount], [Creditamount], [Amount], [Document], [Batch_title]
FROM [YourConnection].[SageIntacct].[Gldetail]
WHERE [Accountno] = '6230'
  AND [Entry_date] >= '2025-01-01'
  AND [Entry_date] <= '2025-01-31'
ORDER BY [Entry_date]
```

### Income-statement activity by account (join `Gldetail` to `Glaccount`)

`Gldetail` has no `Accounttype`, so join to `Glaccount` to filter by classification:

```sql
SELECT a.[Accountno], a.[Title], a.[Accounttype],
       SUM(g.[Debitamount]) AS TotalDebits,
       SUM(g.[Creditamount]) AS TotalCredits,
       SUM(g.[Amount]) AS NetAmount
FROM [YourConnection].[SageIntacct].[Gldetail] g
JOIN [YourConnection].[SageIntacct].[Glaccount] a ON g.[Accountno] = a.[Accountno]
WHERE a.[Accounttype] = 'incomestatement'
  AND g.[Entry_date] >= '2025-01-01'
  AND g.[Entry_date] <= '2025-12-31'
GROUP BY a.[Accountno], a.[Title], a.[Accounttype]
ORDER BY a.[Accountno]
```

### Outstanding AR invoices

```sql
SELECT [Recordid], [Customerid], [Customername], [Totalentered], [Totaldue], [Whendue]
FROM [YourConnection].[SageIntacct].[Arinvoice]
WHERE [State] IN ('Posted', 'Partially Paid') AND [Totaldue] > 0
ORDER BY [Whendue]
```

### Overdue AP bills

```sql
SELECT [Recordid], [Vendorid], [Vendorname], [Totalentered], [Totaldue], [Whendue], [State]
FROM [YourConnection].[SageIntacct].[Apbill]
WHERE [State] IN ('Posted', 'Partially Paid')
  AND [Totaldue] > 0
  AND [Whendue] < GETDATE()
ORDER BY [Whendue]
```

### Customer aging summary

```sql
SELECT [Customerid], [Customername],
       SUM([Totaldue]) AS TotalOutstanding,
       COUNT(*) AS InvoiceCount
FROM [YourConnection].[SageIntacct].[Arinvoice]
WHERE [State] IN ('Posted', 'Partially Paid') AND [Totaldue] > 0
GROUP BY [Customerid], [Customername]
ORDER BY TotalOutstanding DESC
```

### Period balances from the AccountBalance view

```sql
SELECT [ReportingPeriodName], [glaccountno], [startbalance], [debits], [credits], [endbalance]
FROM [YourConnection].[SageIntacct].[AccountBalance]
WHERE [glaccountno] = '6230'
  AND [ReportingPeriodName] = 'Month Ended January 2025'
```

### AR invoice with line items

```sql
SELECT i.[Recordid], i.[Customername], i.[Totalentered], li.[Description], li.[Amount]
FROM [YourConnection].[SageIntacct].[Arinvoice] i
LEFT JOIN [YourConnection].[SageIntacct].[Arinvoiceitem] li ON i.[Recordno] = li.[Recordkey]
WHERE i.[Recordid] = 'INV-12345'
ORDER BY li.[Recordno]
```

### Bank transactions not yet reconciled

`Gldetail` carries the reconciliation status. To restrict to bank accounts, join to `Glaccount`:

```sql
SELECT g.[Entry_date], g.[Document], g.[Description], g.[Debitamount], g.[Creditamount], g.[Cleared], g.[Clrdate]
FROM [YourConnection].[SageIntacct].[Gldetail] g
JOIN [YourConnection].[SageIntacct].[Glaccount] a ON g.[Accountno] = a.[Accountno]
WHERE a.[Accounttype] = 'balancesheet'
  AND g.[Cleared] = 'F'
  AND g.[Entry_date] >= DATEADD(month, -2, GETDATE())
ORDER BY g.[Entry_date]
```

## Stored Procedures

Discover the full list with `getProcedures`, and always call `getProcedureParameters` before invoking one. The XML surface exposes roughly 14 procedures. The most useful:

### AccountBalanceReport

Generates an actual-vs-budget account balance report. Supply **either** `reportingperiodname` **or** `startdate`/`enddate`, and **one** account scope (`glaccountno`, `accountgroupname`, or `startaccountno`/`endaccountno`). Rich optional dimension filters exist (`departmentid`, `locationid`, `projectid`, `customerid`, `vendorid`, `classid`, …) plus `contentselection` (`Actual`, `Budget`, or `Actual and Budget`).

```json
{
  "procedure": "AccountBalanceReport",
  "parameters": {
    "reportingperiodname": "Month Ended January 2025",
    "startaccountno": "4000",
    "endaccountno": "4999",
    "contentselection": "Actual"
  }
}
```

### ReverseInvoice

Reverses an existing invoice and records the reversal in the GL. Both parameters are required.

```json
{
  "procedure": "ReverseInvoice",
  "parameters": {
    "Key": "1234",
    "DateReversed": "2025-01-31"
  }
}
```

`Key` is the invoice's `Recordno`. Read it from `Arinvoice` first.

### VoidAPPayment

Voids an AP payment and reverses it in the GL.

```json
{
  "procedure": "VoidAPPayment",
  "parameters": { "Key": "5678" }
}
```

`Key` is the AP payment's `Recordno` (from `Appayment`).

### ApproveVendor / DeclineVendor / GetVendorApprovalHistory

Drive the vendor approval workflow and report on its history. Inspect parameters with `getProcedureParameters` before calling.

### Utility procedures

`GetCustomFields`, `GetKeys`, `GetDimensionRestrictedData`, `GetRelationshipColumns`, `SetRelationship`, and `GetUserDateTimePreferences` are integration helpers for discovering keys, custom fields, and dimension relationships. Use them when a metadata lookup is needed rather than for routine querying.

### CreateAttachment / UpdateAttachment — cloud-compatible

`CreateAttachment` is **cloud-compatible**: it accepts the file content as a base64 string via `AttachmentData`, so it does not need disk access. Required parameters are `SupDocId`, `SupDocName`, and `SupDocFolderName` (the target attachment folder must already exist — see the `AttachmentFolders` table); `AttachmentData`, `AttachmentName`, and `AttachmentType` are optional but supply `AttachmentData` to upload content.

```json
{
  "procedure": "CreateAttachment",
  "parameters": {
    "SupDocId": "DOC-001",
    "SupDocName": "Signed contract",
    "SupDocFolderName": "Contracts",
    "AttachmentName": "contract.pdf",
    "AttachmentType": "pdf",
    "AttachmentData": "<base64-encoded file content>"
  }
}
```

## Write Operations

Sage Intacct supports `INSERT` and `UPDATE` through the XML surface where the connection and the Sage Intacct user's permissions allow it.

### Create a customer

```sql
INSERT INTO [YourConnection].[SageIntacct].[Customer]
  ([Customerid], [Name], [Displaycontact_contactname], [Displaycontact_email1], [Status])
VALUES
  ('CUST-001', 'Acme Corporation', 'John Smith', 'john@acme.com', 'active')
```

### Update a GL account's status

```sql
UPDATE [YourConnection].[SageIntacct].[Glaccount]
SET [Status] = 'inactive'
WHERE [Accountno] = '9999'
```

### Update vendor contact information

```sql
UPDATE [YourConnection].[SageIntacct].[Vendor]
SET [Displaycontact_phone1] = '555-1234',
    [Displaycontact_email1] = 'accounts@vendor.com'
WHERE [Vendorid] = 'VEND-100'
```

### Write access control

If a write or stored procedure is blocked, the Connect AI connection may be set to read-only — guide the user to their Connect AI connection settings to enable write access. Beyond that, the Sage Intacct user authorized for the connection must have permission for the specific object and operation in Sage Intacct.

## XML-Specific Conventions

- **`Gldetail` has no `Accounttype`.** Join to `Glaccount` on `Accountno` to filter GL detail by account classification.
- **Business key vs. `Recordno`.** Masters are keyed by their business ID (`Accountno`, `Customerid`, `Vendorid`, `Projectid`); transaction documents are keyed by `Recordno`, with `Recordid` holding the human-facing document number. `Recordno` exists on every table as the system record number, but it is not always the primary key.
- **Filter masters by `Status = 'active'`** unless the question asks about inactive records; note the third value `active-non-posting`.
- **Filter transactions by `State`** (`Posted`, `Partially Paid`, etc.) and always by a date column to avoid scanning whole tables.
- **Base vs. transaction currency.** Use `Totalentered`/`Totaldue`/`Amount` for base/home currency and the `Trx_`-prefixed columns for transaction currency in multi-currency tenants.
- **Contact fields use prefixes** — `Displaycontact_`, `Contactinfo_`, `Shipto_`, `Billto_`, `Payto_`, `Returnto_`, `Contact_`. Pick the prefix that matches the contact role you need.
- **Period reporting.** Prefer the `AccountBalance` view or `AccountBalanceReport` procedure for period balances rather than aggregating `Gldetail`.
- **Custom fields are everywhere.** Tenants add many custom columns. Run `getColumns` to discover the real column set before writing queries.
- **Performance depends on `UseLegacy`.** See [UseLegacy & performance](#uselegacy--performance) — tight date filters matter most on the legacy implementation, which processes filters and aggregates client-side.
