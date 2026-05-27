---
name: connect-ai-sageintacct
description: Use when querying Sage Intacct data through CData Connect AI. Covers the Sage Intacct data model, financial reporting workflows, stored procedures, and Sage Intacct-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: Sage Intacct
  family: accounting
---

# CData Connect AI — Sage Intacct Skill

## ⚠ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

## Precedence

This skill replaces `getInstructions` for the Sage Intacct driver. Do not call `getInstructions` for Sage Intacct — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Sage Intacct connection via `getCatalogs`.

## Schema

Sage Intacct is a single-schema driver. The schema name is `SageIntacct`.

```sql
SELECT * FROM [YourConnection].[SageIntacct].[Glaccount] LIMIT 5
```

## ⚠ Connection Setting: UseLegacy

`UseLegacy` controls whether the driver uses the Legacy XML API (`UseLegacy=true`, the default) or the REST API (`UseLegacy=false`). It cannot be detected at runtime. The setting affects performance and a few specific syntax behaviors, but most queries work on either setting.

| Setting | API mode | Behavior |
|---------|----------|----------|
| `UseLegacy=true` (default) | Legacy XML API | `ORDER BY`, `OFFSET`, and aggregates (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) execute client-side after fetching results. Performs well on filtered queries with reasonable date ranges; may be slow on unfiltered queries against very large transaction tables. |
| `UseLegacy=false` | REST API | Server-side filtering, `ORDER BY`, `OFFSET`, and aggregates. Faster for aggregation-heavy queries on large transaction tables. |

**Safe on either setting:** filtered `SELECT` with `LIMIT`, `WHERE` clauses, `JOIN` with `LIMIT`, all writes and stored procedures, queries on master tables (`Glaccount`, `Customer`, `Vendor`, `Department`, `Location`, `Project`), and aggregate queries with reasonable filters (date range, account, customer).

**Known syntax differences on `UseLegacy=true`:** `IN (...)` predicates silently return 0 rows — rewrite as `[col] = 'X' OR [col] = 'Y'`. This is the most common gotcha and applies to any column, not just `State`.

**Performance considerations on `UseLegacy=true`:** unfiltered or wide-date-range aggregations against `Gldetail`, `Arinvoice`, `Apbill`, `Appayment`, or `Timesheetentry` may be slow because the driver must fetch and aggregate client-side. If a query is taking unusually long or times out, two paths exist: (1) tighten filters (narrower date range, specific account/customer), or (2) use a server-side equivalent — `AccountBalance` for period summaries instead of aggregating `Gldetail`, or `Customer.Totaldue`/`Vendor.Totaldue` for balance totals instead of summing `Arinvoice`/`Apbill`. These pre-aggregated alternatives are also faster on `UseLegacy=false`.

Do not proactively ask the user about the `UseLegacy` setting before running a query. Run the query first; if performance is poor or it times out, then suggest a narrower filter or a pre-aggregated alternative.

Never probe for this setting with a test query.

## Query Process

1. **Identify the connection** — call `getCatalogs` and filter for `DRIVER = 'SageIntacct'` if unknown.
2. **Note UseLegacy considerations** — `IN (...)` predicates return 0 rows on `UseLegacy=true` (use `OR` instead). For aggregations on transaction tables, run the query; if performance is poor, suggest a tighter filter or a pre-aggregated alternative (`AccountBalance`, `Totaldue`).
3. **Locate the table** — use `getTables` with a wildcard (e.g., `%account%`) if unsure.
4. **Inspect columns when not documented here** — many Sage Intacct columns have non-obvious names; call `getColumns` if a column isn't in this skill's Important Columns section.
5. **Filter transaction tables by date** — `Gldetail`, `Arinvoice`, `Apbill`, `Appayment`, `Timesheetentry` will time out without date predicates.

**For financial reporting:** query `Glaccount` to identify accounts → use `AccountBalance` for period summaries → query `Gldetail` only for transaction-level detail with date filters.

**For AR/AP analysis:** use `Customer.Totaldue` / `Vendor.Totaldue` for balance totals (pre-aggregated, safe on any setting) → query `Arinvoice` / `Apbill` for individual outstanding items → join headers to line items (`Arinvoiceitem`, `Appaymentitem`) filtering headers first.

## Data Model

### Key tables

| Table | Description |
|-------|-------------|
| `Glaccount` | Chart of accounts master |
| `Gldetail` | GL transaction detail (no `Accounttype` column — JOIN to `Glaccount`) |
| `AccountBalance` | Period account balances (use instead of aggregating `Gldetail`) |
| `Customer` / `Vendor` | Master records with `Totaldue` for current balances |
| `Arinvoice` / `Arinvoiceitem` | AR invoice headers and line items |
| `Apbill` / `Appaymentitem` | AP bill headers and line items |
| `Arpayment` / `Appayment` | Payment records |
| `Project` / `Task` | Project master and tasks |
| `Timesheet` / `Timesheetentry` | Time tracking |
| `Department` / `Location` / `Employee` | Dimension and org tables |
| `Item` / `Warehouse` / `Podocument` / `Sodocument` | Inventory and orders |

### Key relationships

**Header → line items** (always join on `Recordno` → `Recordkey`):
- `Arinvoice.Recordno` → `Arinvoiceitem.Recordkey`
- `Apbill.Recordno` → `Appaymentitem.Recordkey`

**Master → transaction:** `Customer` → `Arinvoice`/`Arpayment` via `Customerid`; `Vendor` → `Apbill`/`Appayment` via `Vendorid`; `Glaccount` → transaction lines via `Accountno`.

## Important Columns

### Glaccount
| Column | Type | Notes |
|--------|------|-------|
| `Accountno` | VARCHAR | Business key |
| `Title` | VARCHAR | Account name |
| `Accounttype` | VARCHAR | `balancesheet`, `incomestatement`, `Bank`, `Income`, `Expense`, `Cost of Goods Sold`, etc. **Only on this table — not on Gldetail.** |
| `Normalbalance` | VARCHAR | `Debit` or `Credit` |
| `Status` | VARCHAR | `active`, `inactive`, `active-non-posting` |
| `Category` | VARCHAR | **Use `Category`, not `Categoryname`** |

### Gldetail
| Column | Type | Notes |
|--------|------|-------|
| `Recordno` | VARCHAR | Primary key |
| `Entry_date` | DATE | Transaction date — **always filter on this** |
| `Accountno` | VARCHAR | Links to `Glaccount` |
| `Debitamount` / `Creditamount` / `Amount` | DECIMAL | GL amounts |
| `Description` | VARCHAR | Transaction description (valid here, **not** on `Arinvoiceitem`) |
| `Document` / `Batch_title` | VARCHAR | Source references |
| `Departmentid` / `Locationid` / `Projectid` / `Customerid` / `Vendorid` | VARCHAR | All nullable dimensions |
| `Cleared` | VARCHAR | `F` (not cleared), `T` (cleared), `R` (reconciled) |

### Arinvoice
| Column | Type | Notes |
|--------|------|-------|
| `Recordno` | BIGINT | Internal key — use for joins to line items |
| `Recordid` | VARCHAR | Invoice number (business key) |
| `Customerid` / `Customername` | VARCHAR | Customer reference |
| `State` | VARCHAR | `Posted`, `Partially Paid`, `Paid`, `Draft`, `Void` |
| `Totalentered` / `Totaldue` / `Totalpaid` | DECIMAL | Pre-aggregated — **do not `SUM` these** |
| `Whendue` / `Whencreated` / `Whenposted` / `Whenpaid` | DATE | Date fields |

### Arinvoiceitem
| Column | Type | Notes |
|--------|------|-------|
| `Recordno` | BIGINT | Line primary key |
| `Recordkey` | BIGINT | **Foreign key → `Arinvoice.Recordno` — join on this, not `Recordid`** |
| `Accountno` / `Accounttitle` | VARCHAR | GL account on this line |
| `Entrydescription` | VARCHAR | **Use `Entrydescription`, not `Description` — that column does not exist on this table** |
| `Amount` / `Trx_amount` | DECIMAL | Line amount in base / transaction currency |
| `Departmentid` / `Locationid` / `Projectid` / `Itemid` | VARCHAR | Dimensions (nullable) |
| `Line_no` | VARCHAR | Line number |

### Apbill
| Column | Type | Notes |
|--------|------|-------|
| `Recordno` | BIGINT | Internal key |
| `Recordid` | VARCHAR | Bill number |
| `Vendorid` / `Vendorname` | VARCHAR | Vendor reference |
| `State` | VARCHAR | `Posted`, `Partially Paid`, `Paid`, `Draft`, `Void` |
| `Totalentered` / `Totaldue` / `Totalpaid` | DECIMAL | Pre-aggregated — **do not `SUM` these** |
| `Whendue` / `Whencreated` / `Whenposted` / `Whenpaid` | DATE | Date fields |

### Customer
| Column | Type | Notes |
|--------|------|-------|
| `Customerid` | VARCHAR | Business key |
| `Name` | VARCHAR | Customer name |
| `Status` | VARCHAR | `active`, `inactive`, `active-non-posting` |
| `Totaldue` | DECIMAL | Total outstanding (pre-aggregated, use directly) |
| `Last_invoicedate` | DATE | Last AR invoice date (**Customer only — not on Vendor**) |
| `Displaycontact_contactname` / `_email1` / `_phone1` | VARCHAR | Primary contact |

### Vendor
| Column | Type | Notes |
|--------|------|-------|
| `Vendorid` | VARCHAR | Business key |
| `Name` | VARCHAR | Vendor name |
| `Status` | VARCHAR | `active`, `inactive`, `active-non-posting` |
| `Totaldue` | DECIMAL | Total outstanding (pre-aggregated, use directly) |
| `Whenlastbilled` / `Whenlastpaid` | DATE | **Vendor uses these — Customer's `Last_invoicedate` does not exist here** |
| `Displaycontact_contactname` / `_email1` / `_phone1` | VARCHAR | Primary contact |

### AccountBalance
| Column | Type | Notes |
|--------|------|-------|
| `ReportingPeriodName` | VARCHAR | e.g., `"Month Ended January 2025"` |
| `glaccountno` | VARCHAR | GL account number (lowercase) |
| `startbalance` / `endbalance` | DOUBLE | Opening / closing balance |
| `debits` / `credits` | DOUBLE | Period activity |
| `adjdebits` / `adjcredits` | DOUBLE | Adjustments |
| `reportingbook` | VARCHAR | `ACCRUAL`, `CASH`, etc. |
| `locationid` / `locationname` / `departmentid` / `departmentname` | VARCHAR | Dimensions |

### Project
| Column | Type | Notes |
|--------|------|-------|
| `Projectid` | VARCHAR | Business key |
| `Name` | VARCHAR | Project name |
| `Status` | VARCHAR | `active`, `inactive` |
| `Customerid` / `Customername` | VARCHAR | Associated customer |
| `Budgetamount` / `Actualamount` / `Percentcomplete` | DECIMAL | Budget tracking |

### Field patterns (shortcuts)

- **Contact prefixes:** `Displaycontact_`, `Contactinfo_`, `Billto_`, `Shipto_`, `Payto_`, `Returnto_` — each with subfields like `_contactname`, `_email1`, `_phone1`, `_mailaddress_city`.
- **Currency:** base currency in `Totalentered` / `Totaldue` / `Totalpaid`; transaction currency in `Trx_*`.
- **Dates:** `When` prefix — `Whencreated`, `Whenposted`, `Whendue`, `Whenpaid`, `Whendiscount`, `Whenmodified`.

## Common Query Patterns

### Active GL accounts by type
```sql
SELECT [Accountno], [Title], [Accounttype], [Normalbalance]
FROM [YourConnection].[SageIntacct].[Glaccount]
WHERE [Status] = 'active' AND [Accounttype] = 'balancesheet'
```

### GL transactions for an account by date range
```sql
SELECT [Entry_date], [Description], [Debitamount], [Creditamount], [Amount],
       [Document], [Batch_title], [Departmentid], [Locationid]
FROM [YourConnection].[SageIntacct].[Gldetail]
WHERE [Accountno] = '1000'
  AND [Entry_date] >= '2025-01-01'
  AND [Entry_date] <= '2025-01-31'
```

### Income statement by GL account — requires JOIN for account type
```sql
-- Faster on UseLegacy=false; may run slower on UseLegacy=true with wide date ranges
SELECT d.[Accountno], a.[Title], a.[Accounttype],
       SUM(d.[Debitamount]) AS TotalDebits,
       SUM(d.[Creditamount]) AS TotalCredits,
       SUM(d.[Amount]) AS NetAmount
FROM [YourConnection].[SageIntacct].[Gldetail] d
JOIN [YourConnection].[SageIntacct].[Glaccount] a ON d.[Accountno] = a.[Accountno]
WHERE a.[Accounttype] = 'incomestatement'
  AND d.[Entry_date] >= '2025-01-01'
  AND d.[Entry_date] <= '2025-12-31'
GROUP BY d.[Accountno], a.[Title], a.[Accounttype]
```

### Account balance for a period
```sql
SELECT [glaccountno], [startbalance], [debits], [credits], [endbalance], [reportingbook]
FROM [YourConnection].[SageIntacct].[AccountBalance]
WHERE [ReportingPeriodName] = 'Calendar Year Ended December 2025'
```

### Outstanding AR invoices for a customer
```sql
-- Use OR rather than IN — IN silently returns 0 rows on UseLegacy=true
SELECT [Recordno], [Recordid], [Whendue], [Totaldue], [State]
FROM [YourConnection].[SageIntacct].[Arinvoice]
WHERE [Customerid] = 'CUST001'
  AND ([State] = 'Posted' OR [State] = 'Partially Paid')
  AND [Totaldue] > 0
```

### AR invoice with line items
```sql
-- Note: Arinvoiceitem uses Entrydescription (not Description) and joins on Recordkey (not Recordid)
SELECT i.[Recordid], i.[Customerid], i.[Customername], i.[Totalentered], i.[Whendue],
       li.[Line_no], li.[Accountno], li.[Entrydescription], li.[Amount]
FROM [YourConnection].[SageIntacct].[Arinvoice] i
LEFT JOIN [YourConnection].[SageIntacct].[Arinvoiceitem] li
  ON i.[Recordno] = li.[Recordkey]
WHERE i.[Recordid] = 'INV-12345'
```

### Customer AR balance

For a customer's overall AR balance — the net of invoices, payments, credit memos, and adjustments — use `Customer.Totaldue` directly. It is pre-aggregated and already nets offsetting credits against invoices, which is why `SUM(Arinvoice.Totaldue)` cannot reconstruct it: the invoices table doesn't know about the payments or memos that offset them, so the sum will overstate the true balance. Reach for `Arinvoice.Totaldue` only when the user asks specifically about the balance on an individual invoice.

```sql
SELECT [Customerid], [Name], [Totaldue], [Currency]
FROM [YourConnection].[SageIntacct].[Customer]
WHERE [Status] = 'active' AND [Totaldue] > 0
```

### Vendor balances
```sql
SELECT [Vendorid], [Name], [Totaldue], [Currency]
FROM [YourConnection].[SageIntacct].[Vendor]
WHERE [Status] = 'active' AND [Totaldue] > 0
```

### Overdue AP bills
```sql
SELECT [Recordid], [Vendorid], [Vendorname], [Totaldue], [Whendue], [State]
FROM [YourConnection].[SageIntacct].[Apbill]
WHERE ([State] = 'Posted' OR [State] = 'Partially Paid')
  AND [Totaldue] > 0
  AND [Whendue] < GETDATE()
```

## Stored Procedures

### AccountBalanceReport
Comprehensive account balance report for a period with optional budget comparison and dimension grouping.

Key parameters: `@startdate`, `@enddate`, `@startaccountno`, `@endaccountno`, `@contentselection` (`Actual`, `Actual and Budget`), `@budgetid`, `@groupby` (comma-separated dimensions like `departmentid,glaccountno`), plus optional dimension filters (`@departmentid`, `@locationid`, `@projectid`).

```json
{
  "procedureName": "AccountBalanceReport",
  "parameters": {
    "@startdate": "2025-01-01",
    "@enddate": "2025-03-31",
    "@startaccountno": "6000",
    "@endaccountno": "6999",
    "@contentselection": "Actual",
    "@groupby": "departmentid,glaccountno"
  }
}
```

### ReverseInvoice
Reverses an AR invoice. `@Key` is `Arinvoice.Recordno` (not `Recordid`).

```json
{ "procedureName": "ReverseInvoice", "parameters": { "@Key": "76", "@DateReversed": "2025-03-31" } }
```

### VoidAPPayment
Voids an AP payment. `@Key` is `Appayment.Recordno`.

### ApproveVendor / DeclineVendor / GetVendorApprovalHistory
Vendor approval workflow procedures for tenants using vendor approval policies.

### CreateAttachment / UpdateAttachment — not functional in cloud
Attachment upload through Connect AI is not currently supported in cloud environments, even though `@AttachmentData` accepts base64. Do not attempt to call these.

## Write Operations

```sql
-- Update GL account status
UPDATE [YourConnection].[SageIntacct].[Glaccount]
SET [Status] = 'inactive' WHERE [Accountno] = '9999'

-- Create a customer
INSERT INTO [YourConnection].[SageIntacct].[Customer]
  ([Customerid], [Name], [Displaycontact_contactname], [Displaycontact_email1], [Status])
VALUES ('CUST-001', 'Acme Corp', 'John Smith', 'john@acme.com', 'active')

-- Update vendor contact
UPDATE [YourConnection].[SageIntacct].[Vendor]
SET [Displaycontact_phone1] = '555-1234'
WHERE [Vendorid] = 'VEND-100'
```

Write access is controlled by the Connect AI connection settings. If write operations fail with permission errors, guide the user to enable write access in their Connect AI connection settings.

## Sage Intacct-Specific Conventions

- **`UseLegacy=true` is the default** — affects performance on wide aggregations and changes `IN (...)` behavior, but most queries work on either setting. Do not proactively ask the user about this setting; run the query first and suggest alternatives only if it underperforms. Never probe with a test query.
- **Always filter master tables by `Status = 'active'`** unless looking for inactive records — applies to `Customer`, `Vendor`, `Glaccount`, `Project`.
- **`Status` vs `State`** — `Status` (`active`/`inactive`) is on master tables; `State` (`Posted`/`Draft`/`Paid`/`Void`) is on transactions. Confusing them produces wrong results.
- **`Accounttype` is on `Glaccount` only, not `Gldetail`** — to filter Gldetail by account type, JOIN to `Glaccount` on `Accountno`.
- **`Glaccount.Category`, not `Categoryname`** — the category column is named `Category`.
- **Arinvoiceitem joins on `Recordkey` to `Arinvoice.Recordno`** — not on `Recordid`. `Recordid` does not exist on `Arinvoiceitem`.
- **Arinvoiceitem uses `Entrydescription`, not `Description`** — the `Description` column does not exist on this table. (`Description` IS valid on `Gldetail`.)
- **Date filters mandatory on transaction tables** — `Gldetail`, `Arinvoice`, `Apbill`, `Appayment`, `Timesheetentry` will time out without date predicates.
- **`Totaldue` / `Totalpaid` / `Totalentered` are pre-aggregated — never `SUM` them** — applying aggregate functions fails with "Cannot perform an aggregate function on an expression containing an aggregate" on both `UseLegacy` settings. Use `Customer.Totaldue` / `Vendor.Totaldue` directly for balance totals; use `AccountBalance` for period summaries.
- **`State IN (...)` silently returns 0 rows on `UseLegacy=true`** — the Legacy XML API's `readByQuery` does not support `IN`. Rewrite as `[State] = 'X' OR [State] = 'Y'`, or use `UseLegacy=false`. This applies to any column, not just `State`.
- **Customer and Vendor schemas are not symmetric** — do not infer columns by analogy across them. Example: `Last_invoicedate` exists on Customer but not Vendor; Vendor uses `Whenlastbilled` and `Whenlastpaid`. Same caution applies to `Arinvoice`/`Apbill` and `Arinvoiceitem`/`Appaymentitem` pairs.
- **Dimensions are nullable on `Gldetail`** — `Departmentid`, `Locationid`, `Projectid`, `Customerid`, `Vendorid` are all optional. Use `LEFT JOIN` to dimension tables to avoid dropping rows.
- **Contact prefixes** — use `Displaycontact_` for primary contacts. `Billto_`, `Shipto_`, `Payto_`, `Returnto_` for address-specific contacts.
- **`When` prefix for all dates** — `Whencreated`, `Whenposted`, `Whendue`, `Whenpaid`, `Whendiscount`, `Whenmodified`. Not `CreateDate` or `DueDate`.
- **`Recordno` vs business keys** — `Recordno` (BIGINT) is the internal ID used for joins and procedure `@Key` parameters. `Customerid`, `Vendorid`, `Accountno`, `Recordid` are business keys for queries.
- **`ReverseInvoice` and `VoidAPPayment` use `Recordno`** — query the header first to get `Recordno`, then pass it as `@Key`.
- **Write operations failing on missing required fields** — if INSERT/UPDATE/procedure returns "Required field 'X' is missing", call `GetCustomFields` with the object type (e.g., `ARINVOICE`) to discover tenant-specific required fields, then retry with the field included.
