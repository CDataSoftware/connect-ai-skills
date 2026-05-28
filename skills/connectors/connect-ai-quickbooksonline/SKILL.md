---
name: connect-ai-quickbooksonline
description: Use when querying QuickBooks Online data through CData Connect AI. Covers the QuickBooks Online data model (GL, AP, AR, items, banking), line-item patterns, LineAggregate XML for inserts, report objects, and QuickBooks-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: QuickBooksOnline
  family: accounting
---

# CData Connect AI — QuickBooks Online Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides QuickBooks Online-specific guidance for querying QuickBooks Online data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the QuickBooksOnline driver. Do not call `getInstructions` for QuickBooksOnline — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the QuickBooks Online connection via `getCatalogs`.

## Schema

QuickBooks Online is a single-schema driver. The schema name is `QuickBooksOnline`.

```sql
SELECT * FROM [YourConnection].[QuickBooksOnline].[Accounts] LIMIT 10
```

## Query Process

QuickBooks Online data is structured around master records (Accounts, Customers, Vendors, Items) that anchor transactions (Invoices, Bills, JournalEntries, Purchases) and their line items. Most user questions follow this pattern: find the master record, traverse to its transactions, then aggregate or compute balances.

### Step 1: Identify the Master Record

Locate the master record relevant to the question — usually an Account, Customer, or Vendor. Use a LIKE filter on `Name`/`DisplayName` plus a type filter where applicable. Master tables are non-transactional, so `SELECT DISTINCT` is acceptable when no dedicated lookup table exists.

```sql
SELECT [Id], [Name], [AccountType], [AccountSubType], [FullyQualifiedName], [Active], [CurrentBalance]
FROM [YourConnection].[QuickBooksOnline].[Accounts]
WHERE [Name] LIKE '%Promotional%' AND [AccountType] = 'Expense'
```

### Step 2: Traverse to Transactions or Line Items

Use the master record's `Id` to filter transaction line-item tables via the appropriate `*Ref` foreign key. Always include a `TxnDate` filter — large QuickBooks instances will time out without one.

```sql
SELECT [PurchaseId], [TxnDate], [EntityRef_Name], [Line_Description], [Line_Amount], [TotalAmt]
FROM [YourConnection].[QuickBooksOnline].[PurchaseLineItems]
WHERE [Line_AccountBasedExpenseLineDetail_AccountRef] = '17'
  AND [TxnDate] >= '2024-09-10'
ORDER BY [Line_Amount] DESC
LIMIT 10
```

### Step 3: Compute or Verify Balances

Pull balance fields off the master record, or aggregate from line items when you need a period balance rather than the live balance.

```sql
SELECT [Id], [Name], [AccountType], [CurrentBalance], [CurrentBalanceWithSubAccounts]
FROM [YourConnection].[QuickBooksOnline].[Accounts]
WHERE [Id] = '17'
```

### Step 4: Inspect Columns When Needed

When a query refers to fields you haven't validated, run `getColumns` on the table before issuing the query. QuickBooks Online has many compound column names following the `Line_<DetailType>_<Field>` pattern that are easy to misspell.

## Data Model

### Key Tables

#### Core General Ledger
- **Accounts** — Chart of accounts with account types, subtypes, and balances
- **JournalEntries** / **JournalEntryLineItems** — Manual journal entries with debit/credit details
- **CompanyInfo** / **Preferences** — Company settings and accounting configuration

#### Accounts Payable (AP)
- **Vendors** — Vendor master data
- **Bills** / **BillLineItems** — Vendor invoices with line details
- **BillPayments** — Payments to vendors
- **VendorCredits** — Credits from vendors

#### Accounts Receivable (AR)
- **Customers** — Customer master data
- **Invoices** / **InvoiceLineItems** — Sales invoices with line details
- **Payments** — Customer payments received
- **CreditMemos** — Credits issued to customers

#### Products & Banking
- **Items** — Product/service catalog with pricing
- **Deposits** / **Transfers** — Bank transactions
- **Purchases** / **PurchaseLineItems** — Direct purchases (cash/credit card)

#### Organization & Tax
- **Class** / **Departments** — Tracking dimensions for reporting
- **TaxCodes** / **TaxRates** — Sales tax configuration
- **Terms** — Payment terms for AR/AP

#### Pre-built Report Objects
- **BalanceSheetSummaryReport** — Complete balance sheet with hierarchy
- **CustomerBalanceDetail** — Customer aging details
- **GetReport** stored procedure — May not work in all environments; prefer the report tables above

### Key Relationships

**Master → Transaction Flow**
- Customers → Invoices, Payments, CreditMemos, Estimates, SalesReceipts (via `CustomerRef`)
- Vendors → Bills, BillPayments, PurchaseOrders, VendorCredits, Purchases (via `VendorRef`)
- Accounts → Various line items and deposits (via `AccountRef` fields)
- Items → Various line items (via `ItemRef` fields)

Each transaction links to its line items: Transaction `Id` → LineItems `ParentId` + `LineId`.

**Payment Application**
- Invoices ← PaymentLineItems (via `Line_LinkedTxn_TxnId`)
- Bills ← BillPaymentLineItems (via `Line_LinkedTxn_TxnId`)

### Field Patterns

#### Keys
- **Primary**: All tables use `Id`
- **Composite**: LineItems use `ParentId` + `LineId` (e.g., `InvoiceId` + `LineId`)
- **Foreign**: `<Entity>Ref` (e.g., `CustomerRef`, `VendorRef`)
- **Display Names**: `<Entity>Ref_Name`

#### Line Item Fields
Pattern: `Line_<DetailType>_<Field>`

- **Universal**: `Line_Amount`, `Line_Description`
- **Sales Items**: `Line_SalesItemLineDetail_ItemRef`, `Line_SalesItemLineDetail_UnitPrice`
- **Linked Transactions**: `Line_LinkedTxn_TxnId`, `Line_LinkedTxn_TxnType`

#### Status Fields
- **Balance**: `>0` (Open), `=0` (Paid)
- **Active**: `1` (Active), `0` (Inactive)
- **EmailStatus**: `NotSet`, `NeedToSend`, `EmailSent`
- **PrintStatus**: `NotSet`, `NeedToPrint`, `PrintComplete`
- **GlobalTaxCalculation**: `TaxExcluded`, `TaxInclusive`, `NotApplicable`

#### Account Types
`Bank`, `Accounts Receivable`, `Accounts Payable`, `Other Current Asset`, `Fixed Asset`, `Credit Card`, `Other Current Liability`, `Equity`, `Income`, `Expense`, `Cost of Goods Sold`

#### Common Fields
- **Amounts**: `TotalAmt`, `Balance`, `Line_Amount`, `CurrentBalance`, `UnappliedAmt`, `HomeTotalAmt`
- **Dates**: `TxnDate`, `DueDate`, `MetaData_CreateTime`, `MetaData_LastUpdatedTime`
- **Tax**: `TxnTaxDetail_TotalTax`, `TxnTaxDetail_TxnTaxCodeRef`, `Line_SalesItemLineDetail_TaxCodeRef`

## Important Columns

### Accounts

- `Id` — Internal identifier
- `Name` — Account display name
- `FullyQualifiedName` — Full path including parent accounts
- `AccountType` — High-level type (Bank, Income, Expense, etc.)
- `AccountSubType` — Detailed type
- `Active` — `1` for active, `0` for inactive
- `CurrentBalance` — Live balance (`0` for P&L / Income/Expense accounts)
- `CurrentBalanceWithSubAccounts` — Balance including sub-accounts
- `AcctNum` — Account number
- `ParentRef` / `ParentRef_Name` — Parent account reference

### Customers

- `Id` — Internal identifier
- `DisplayName` — Display name (use this for human-readable lookups)
- `CompanyName` — Company name
- `Balance` — Outstanding balance (DECIMAL)
- `BalanceWithJobs` — Cumulative balance including subcustomers
- `Active` — `1` for active, `0` for inactive
- `SalesTermRef` / `SalesTermRef_Name` — Payment terms (Customers use `SalesTermRef`, not `TermRef`)
- `PaymentMethodRef` / `PaymentMethodRef_Name` — Preferred payment method
- `PrimaryEmailAddr_Address` — Primary email
- `PrimaryPhone_FreeFormNumber` — Primary phone
- `Taxable` — Whether the customer is taxable
- `ParentRef` / `ParentRef_Name` — Parent customer (for subcustomers and projects)
- `Job` — Whether this record is a job/subcustomer
- `IsProject` — Whether this record is a project

### Vendors

- `Id` — Internal identifier
- `DisplayName` — Display name (use this for human-readable lookups)
- `CompanyName` — Company name
- `Balance` — Outstanding balance (VARCHAR — see Conventions)
- `Active` — `1` for active, `0` for inactive
- `TermRef` / `TermRef_Name` — Payment terms (Vendors use `TermRef`, not `SalesTermRef`)
- `APAccountRef` / `APAccountRef_Name` — Accounts-payable account used for this vendor
- `PrimaryEmailAddr_Address` — Primary email
- `PrimaryPhone_FreeFormNumber` — Primary phone
- `AcctNum` — The vendor's account number with your organization
- `Vendor1099` — Whether this vendor receives a 1099-MISC at year end
- `TaxIdentifier` — Vendor tax ID (TIN)
- `CostRate` / `BillRate` — Cost and billing rates for the vendor's services

### Invoices / Bills

- `Id` — Internal identifier
- `DocNumber` — Document number
- `SyncToken` — Optimistic-concurrency token; required for `VoidInvoice` / `VoidPayment` / `VoidSalesReceipt` and incremented after any update
- `TxnDate` — Transaction date
- `DueDate` — Payment due date
- `CustomerRef` / `CustomerRef_Name` — Customer (Invoices)
- `VendorRef` / `VendorRef_Name` — Vendor (Bills)
- `TotalAmt` — Total amount
- `Balance` — Outstanding balance (`0` when paid)
- `HomeTotalAmt` — Total in home currency
- `LineAggregate` — XML aggregate of all line items (used for INSERT — see Write Operations)
- `BillEmail_Address` / `BillEmailCc_Address` / `BillEmailBcc_Address` — Email addresses on Invoices. Note that the column name is `BillEmail_Address`, but the corresponding `VoidInvoice` procedure parameter is the bare name `BillEmail`. (`SendInvoice` uses a different parameter name, `EmailAddress`, defaulting to `BillEmail_Address` if omitted — see Stored Procedures.)
- `EmailStatus` — `NotSet`, `NeedToSend`, or `EmailSent` (Invoices). `BillEmail` is only required as a procedure parameter when `EmailStatus = NeedToSend`
- `PrivateNote` — Internal note; stamped with "Voided" after `VoidInvoice` / `VoidPayment` / `VoidSalesReceipt`

### Line-Item Tables (InvoiceLineItems, BillLineItems, JournalEntryLineItems, PurchaseLineItems, etc.)

- `<Parent>Id` + `LineId` — Composite key (e.g., `InvoiceId` + `LineId`)
- `Line_Amount` — Line amount
- `Line_Description` — Line description
- `Line_SalesItemLineDetail_ItemRef` — Item reference (sales lines)
- `Line_SalesItemLineDetail_UnitPrice` — Unit price
- `Line_AccountBasedExpenseLineDetail_AccountRef` — GL account (expense lines)
- `Line_JournalEntryLineDetail_AccountRef` — GL account (journal entry lines)
- `Line_JournalEntryLineDetail_AccountRef_Name` — GL account display name (journal entry lines)
- `Line_JournalEntryLineDetail_PostingType` — `Debit` or `Credit` (journal entry lines)
- `Line_LinkedTxn_TxnId` / `Line_LinkedTxn_TxnType` — Linked transaction (payment application)

The `Line_<DetailType>_<Field>` prefix follows the line's detail type: `SalesItemLineDetail` on Invoices/SalesReceipts/CreditMemos, `AccountBasedExpenseLineDetail` on Bills/Purchases, `JournalEntryLineDetail` on JournalEntries. Use the detail type that matches the parent transaction table.

### BalanceSheetSummaryReport

- `Account` — Account or grouping label
- `Total` — Period total
- `RowType` — Detail row vs. header/summary row
- `RowGroup` — Section grouping (Assets, Liabilities, Equity)

## Common Query Patterns

### Active Accounts by Type

```sql
SELECT [AccountType], COUNT(*) AS ActiveAccountCount
FROM [YourConnection].[QuickBooksOnline].[Accounts]
WHERE [Active] = 1
GROUP BY [AccountType]
ORDER BY [AccountType]
```

### Outstanding AR Invoices

```sql
SELECT
    [Id],
    [DocNumber],
    [TxnDate],
    [DueDate],
    [CustomerRef_Name],
    [TotalAmt],
    [Balance],
    CASE WHEN [DueDate] < GETDATE() THEN 'Overdue' ELSE 'Current' END AS Status
FROM [YourConnection].[QuickBooksOnline].[Invoices]
WHERE [Balance] > 0
ORDER BY [DueDate], [CustomerRef_Name]
LIMIT 20
```

### Vendor Balances

```sql
SELECT
    [Id],
    [DisplayName],
    [CompanyName],
    [Balance],
    [Active],
    [TermRef_Name],
    [AcctNum],
    [PrimaryPhone_FreeFormNumber],
    [PrimaryEmailAddr_Address]
FROM [YourConnection].[QuickBooksOnline].[Vendors]
WHERE [Balance] != '0' AND [Balance] != ''
```

### Balance Sheet Summary

```sql
SELECT [Account], [Total], [RowType], [RowGroup]
FROM [YourConnection].[QuickBooksOnline].[BalanceSheetSummaryReport]
ORDER BY [RowGroup]
```

### GL Detail for a Specific Account

```sql
SELECT [PurchaseId], [TxnDate], [EntityRef_Name], [Line_Description], [Line_Amount], [TotalAmt]
FROM [YourConnection].[QuickBooksOnline].[PurchaseLineItems]
WHERE [Line_AccountBasedExpenseLineDetail_AccountRef] = '<AccountId>'
  AND [TxnDate] >= '2025-01-01'
ORDER BY [TxnDate], [Line_Amount] DESC
LIMIT 50
```

### Sales by Item

```sql
SELECT
    [Line_SalesItemLineDetail_ItemRef_Name] AS Item,
    SUM([Line_Amount]) AS Revenue
FROM [YourConnection].[QuickBooksOnline].[InvoiceLineItems]
WHERE [TxnDate] >= '2025-01-01'
GROUP BY [Line_SalesItemLineDetail_ItemRef_Name]
ORDER BY Revenue DESC
LIMIT 20
```

### Payments Applied to an Invoice

```sql
SELECT p.[Id], p.[TxnDate], p.[TotalAmt], pli.[Line_LinkedTxn_TxnId] AS InvoiceId
FROM [YourConnection].[QuickBooksOnline].[Payments] p
INNER JOIN [YourConnection].[QuickBooksOnline].[PaymentLineItems] pli ON p.[Id] = pli.[PaymentId]
WHERE pli.[Line_LinkedTxn_TxnId] = '<InvoiceId>'
  AND pli.[Line_LinkedTxn_TxnType] = 'Invoice'
```

## Stored Procedures

### VoidInvoice / VoidPayment / VoidSalesReceipt

Void an existing transaction — the record is retained but its financial impact is reversed. Each procedure requires the target transaction's `Id` and current `SyncToken` (fetch from the transaction table first).

```sql
SELECT [Id], [SyncToken] FROM [YourConnection].[QuickBooksOnline].[Invoices] WHERE [Id] = '130'
```

```json
{
  "procedure": "VoidInvoice",
  "parameters": {
    "InvoiceId": "130",
    "SyncToken": "0"
  }
}
```

### SendInvoice

Emails an existing invoice to the customer. Defaults to the invoice's `BillEmail_Address` if `EmailAddress` is omitted.

```json
{
  "procedure": "SendInvoice",
  "parameters": {
    "InvoiceId": "130",
    "EmailAddress": "customer@example.com"
  }
}
```

### GetReport

Runs one of QuickBooks Online's report endpoints with QuickBooks-defined parameters (e.g., `ReportType=ProfitAndLoss`, date macros, filters by department/class/customer). The procedure takes a large number of optional parameters that vary by report type — call `getProcedureParameters` to inspect them before use. The source's caveat (`May not work in all environments`) is real: not every QuickBooks tenant has every report enabled.

Prefer the pre-built report tables (`BalanceSheetSummaryReport`, `CustomerBalanceDetail`) when they cover the question — they are simpler and more reliable than `GetReport`.

### DownloadPDF

Downloads an Invoice, Sales Receipt, or Estimate as a PDF. In cloud-based Connect AI environments, omit `DownloadFolder` and `FileStream` — the procedure returns the file as base64 in the `Base64EncodedData` column. Empirically verified against the QuickBooks Online driver: a `DownloadPDF` call with only `TxnType` and `TxnID` returned a base64-encoded PDF.

```json
{
  "procedure": "DownloadPDF",
  "parameters": {
    "TxnType": "Invoice",
    "TxnID": "130"
  }
}
```

Response columns: `Base64EncodedData` (the encoded file), `Result` (`Success`), `PDFFile` (empty when no `DownloadFolder` was provided). Decode the base64 to retrieve the original PDF for download or display.

### DownloadAttachment / DownloadNote

Same cloud-friendly calling pattern as `DownloadPDF` — omit `DownloadFolder` and `FileStream`, supply only `AttachmentId`, and decode the returned base64 content.

```json
{
  "procedure": "DownloadAttachment",
  "parameters": {
    "AttachmentId": "<id from Attachables>"
  }
}
```

To find attachment IDs, use the `AttachableRefs` companion table — it joins attachments to their parent entities and exposes flat columns directly (no XML parsing needed). `AttachableRefs` already includes `FileName`, `Size`, and `ContentType`, so a join back to `Attachables` is unnecessary for discovery:

```sql
SELECT [AttachableId], [FileName], [Size], [ContentType]
FROM [YourConnection].[QuickBooksOnline].[AttachableRefs]
WHERE [AttachableRef_EntityRef] = '<transaction-id>'
  AND [AttachableRef_EntityRef_type] = 'Invoice'
```

`AttachableRefs` and `Attachables` are companion tables: `AttachableRefs` exposes the entity-to-attachment relationships with flat columns, while `Attachables` holds attachment-level metadata. The `Attachables` table itself exposes the entity reference only as an XML aggregate column (`AttachableRefAggregate`), so query `AttachableRefs` instead for any "what's attached to transaction X" question. Use the returned `AttachableId` value as the input to `DownloadAttachment`.

### UploadAttachment — Not currently supported in cloud

`UploadAttachment` accepts either `FilePath` (server-side disk path, unavailable in cloud) or `Content` as a Java `InputStream` (cannot be passed through the MCP interface). There is no base64 string alternative yet. Treat file uploads as a current limitation — do not invent parameter names that the driver does not accept. Support for base64 string uploads is planned across CData drivers; check for updates if this capability is needed.

## Write Operations

QuickBooks Online supports INSERT and UPDATE through Connect AI where the QuickBooks user's permissions allow it.

### LineAggregate for Transactions with Line Items

Several transaction tables — `Invoices`, `Bills`, `BillPayments`, `Payments`, `PurchaseOrders`, `SalesReceipts`, `RefundReceipts` — accept a `LineAggregate` column on INSERT instead of separate line-item rows. `LineAggregate` is an XML payload describing all line items for the transaction.

Before writing an INSERT against one of these tables for the first time, run a small SELECT (around 5 rows) to inspect the actual XML shape `LineAggregate` produces for that table, then mirror that structure in your INSERT.

```sql
SELECT TOP 5 [Id], [LineAggregate]
FROM [YourConnection].[QuickBooksOnline].[Invoices]
```

Sample Invoice INSERT:

```sql
INSERT INTO [YourConnection].[QuickBooksOnline].[Invoices]
    ([CustomerRef], [TxnDate], [LineAggregate])
VALUES
    ('6342',
     '2025-09-23',
     '<Line><DetailType>SalesItemLineDetail</DetailType><Amount>125.00</Amount><SalesItemLineDetail><ItemRef>15</ItemRef><UnitPrice>125.00</UnitPrice><Qty>1</Qty></SalesItemLineDetail><Description>Manchester United Away Jersey</Description></Line><Line><DetailType>SalesItemLineDetail</DetailType><Amount>0.00</Amount><SalesItemLineDetail><ItemRef>2</ItemRef><UnitPrice>0.00</UnitPrice><Qty>1</Qty></SalesItemLineDetail><Description>Hours</Description></Line><Line><DetailType>SalesItemLineDetail</DetailType><Amount>75.60</Amount><SalesItemLineDetail><ItemRef>1</ItemRef><UnitPrice>75.60</UnitPrice><Qty>1</Qty></SalesItemLineDetail><Description>Sales</Description></Line>')
```

### Update an Existing Record

```sql
UPDATE [YourConnection].[QuickBooksOnline].[Customers]
SET [PrimaryEmailAddr_Address] = 'new@example.com'
WHERE [Id] = '6342'
```

### Write Access Control

If write operations are blocked, the Connect AI connection may be set to readonly. Guide the user to their Connect AI connection settings to ensure write access is enabled. Beyond that, the QuickBooks user authorized for the connection must have permission for the specific operation in QuickBooks.

## QuickBooks Online-Specific Conventions

- **VARCHAR numeric fields**: A handful of numeric fields are stored as VARCHAR — confirmed cases: `Vendors.Balance` and the `TxnTaxDetail_TotalTax` column on transaction tables (Invoices, Bills, line-item tables). Most other numeric fields (`TotalAmt`, `Line_Amount`, `Customers.Balance`, `Invoices.Balance`, `Bills.Balance`, `Accounts.CurrentBalance`) are DECIMAL and do not need casting. When you encounter a VARCHAR numeric field, use `CAST(field AS DECIMAL)` for comparisons, sorting, and aggregation — plain `>` or `SUM()` can return wrong results.
- **NULL vs empty string**: Some optional fields contain `''` (empty string) instead of `NULL`. Filter both when checking for missing values: `WHERE [Field] IS NOT NULL AND [Field] != ''`.
- **`CurrentBalance` is 0 for P&L accounts**: Income and Expense accounts always report `CurrentBalance = 0`. For P&L figures, aggregate line items from the relevant transaction tables or use the report tables.
- **Filter master data by `[Active] = 1`**: Vendors, Customers, Accounts, Items, etc. retain inactive records. Always filter for active records unless the question specifically asks about inactive ones.
- **Date format**: Use `'YYYY-MM-DD'` for date literals in WHERE clauses.
- **Date filters are essential**: Transaction tables grow large fast — always filter by `TxnDate` (or `MetaData_LastUpdatedTime` for change tracking) on Invoices, Bills, Purchases, Payments, JournalEntries, and their line-item tables to avoid timeouts.
- **`LineAggregate` for inserts**: Transaction tables with line items expect an XML `LineAggregate` column on INSERT — sample the column from existing rows before writing one.
- **Composite line-item keys**: Line-item tables use `<Parent>Id` + `LineId` as the composite key — `Id` alone does not uniquely identify a line.
- **`*Ref` vs `*Ref_Name`**: `*Ref` holds the ID used for joins and inserts; `*Ref_Name` holds the human-readable display name. Always join on `*Ref`.
- **Report objects vs `GetReport` procedure**: The pre-built report tables (`BalanceSheetSummaryReport`, `CustomerBalanceDetail`) are more reliable than the generic `GetReport` stored procedure, which is not available in all environments.
