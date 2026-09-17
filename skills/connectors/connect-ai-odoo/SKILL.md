---
name: connect-ai-odoo
description: Use when querying Odoo data through CData Connect AI. Covers the Odoo data model, relationship columns and their label companions, the FieldReferences map, query patterns, the CallProcedure RPC escape hatch, and Odoo-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Odoo
  family: crm_erp
---

# CData Connect AI — Odoo Skill

## ⚠ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Odoo-specific guidance for querying Odoo data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Odoo driver. Do not call `getInstructions` for Odoo, the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Odoo connection via `getCatalogs`.

## Schema

Odoo is a single-schema driver. The schema name is `Odoo`.

```sql
SELECT * FROM [YourConnection].[Odoo].[res_partner] LIMIT 10
```

Replace `[YourConnection]` with your actual Odoo connection name from `getCatalogs`.

## The table list is app-dependent

Odoo's object model is read live from the instance at connect time and reflects the apps installed there. Two Odoo connections can expose very different table sets: an instance without the Accounting app has no `account_move` at all, and one without Sales has no `sale_order`.

Treat every table named in this skill as an example to confirm with `getTables`, never as a guarantee. Querying a model whose app is not installed returns an error naming the table:

```
Could not convert table account_move to model: A table could not be found that matches account_move
```

That means the app is not installed on this instance, not that the query is malformed. Confirm with `getTables` rather than retrying, and use `ir_module_module` to see what is installed:

```sql
SELECT [name], [latest_version]
FROM [YourConnection].[Odoo].[ir_module_module]
WHERE [state] = 'installed'
ORDER BY [name]
```

## Query Process

### Step 1: Find the model

Odoo model names map from the dot-name to an underscore name: `res.partner` is queried as `res_partner`, `sale.order` as `sale_order`. The full list is large, so filter with `getTables` rather than listing everything:

```json
{
  "tableName": "%partner%"
}
```

### Step 2: Inspect the columns

Call `getColumns` on the table. Field names are app-specific and customizable, so do not assume them. `getColumns` also reports a `Readonly` flag per column, which tells you what you can write before attempting an INSERT or UPDATE.

### Step 3: Map the relationships

This is the Odoo-specific step. Query the `FieldReferences` view to learn which columns are single-valued foreign keys and which hold lists of IDs, before writing any query that touches a relationship:

```sql
SELECT [ReferenceColumn], [TargetTable], [IsMultiValued]
FROM [YourConnection].[Odoo].[FieldReferences]
WHERE [ReferenceTable] = 'res_partner'
```

- `IsMultiValued = 0` is a many2one: a single ID you can JOIN directly to `TargetTable`.
- `IsMultiValued = 1` is a many2many or one2many: a comma-separated list of IDs to parse client-side.

`IsMultiValued` is a boolean column, so it displays as `true` / `false` while `= 1` and `= 0` work as filters.

### Step 4: Sample before filtering

Preview real values before building filters, especially for relationship columns and selection fields such as `state` or `move_type`:

```sql
SELECT * FROM [YourConnection].[Odoo].[res_partner] LIMIT 5
```

### Step 5: Build up incrementally

Start flat, read the `<column>_label` companion for a many2one's display name, and add a JOIN only when you need other fields from the target.

## Data Model

### Models, Tables, and Views

Modifiable models are exposed as **tables** supporting SELECT, INSERT, UPDATE, and DELETE. Read-only objects are exposed as **views** supporting SELECT only, as `FieldReferences` is.

### Relationship Columns

Odoo's relational fields all live as columns on the same table. There are no separate junction tables:

- **many2one**: a single integer ID referencing one row in another model, the equivalent of a foreign key. Resolve it with a JOIN, or read its `_label` companion for the display name.
- **many2many**: text holding a comma-separated list of IDs, for example `category_id = "1,2,3"`. Filter with `LIKE` and parse the IDs client-side. Writable.
- **one2many**: the reverse of a many2one. Read it the same way as a many2many, but it is read-only. To change it, update the child rows' many2one column.

Every many2one column has a `<column>_label` companion holding the target's display name, so `partner_id` is the ID and `partner_id_label` is the name. The `_label` companion is read-only: write to the ID column, read the label for display.

### Key Tables

Common across standard Odoo apps. Confirm each exists with `getTables` before relying on it.

- **res_partner**: contacts and companies, the central party record used by sales, invoicing, and CRM
- **res_users**: Odoo user accounts
- **res_country** / **res_country_state**: geography lookups referenced by contacts
- **res_partner_category**: partner tags
- **crm_lead**: CRM leads and opportunities, separated by the `type` column
- **sale_order** / **sale_order_line**: sales orders and their line items
- **product_template** / **product_product**: product catalog
- **account_move** / **account_move_line**: accounting entries including customer invoices and vendor bills, separated by `move_type`
- **ir_module_module**: installed modules, for confirming which apps are present
- **FieldReferences** (view): the relationship map described above

### Key Relationships

- res_partner → res_country: join on `res_partner.[country_id] = res_country.[id]`
- sale_order → res_partner: join on `sale_order.[partner_id] = res_partner.[id]`
- account_move → res_partner: join on `account_move.[partner_id] = res_partner.[id]`
- crm_lead → res_partner: join on `crm_lead.[partner_id] = res_partner.[id]`
- Any relationship: look it up in `FieldReferences` rather than guessing the target

Nearly every Odoo model has both an `id` and a `name` column, so selecting `name` from two joined tables returns two columns headed `name` with no way to tell them apart. An alias does not fix this: an alias on a plain column is not carried into the result header, though one on an aggregate such as `COUNT(*) AS contact_count` is. Select the `_label` companion instead of joining, or select only one table's `name` per query.

## Important Columns

### Conventions shared by most models

- `id`: primary key, an integer, and the most reliable column to sort or paginate on
- `name`: the record's main label on most models, writable
- `display_name`: the computed display label, read-only
- `create_date` / `write_date`: creation and last-modification timestamps
- `active`: whether the record is active. Odoo archives by setting this false rather than deleting, so an unfiltered query can include archived rows
- `<column>_id`: a many2one foreign key, writable
- `<column>_id_label`: the companion display name for that foreign key, read-only
- `<column>_ids`: a multi-valued relationship holding a comma-separated ID list, empty as `''` rather than NULL

### res_partner

- `id`, `name`, `display_name`, `email`, `phone`
- `is_company`: true for an organization, false for an individual
- `parent_id` / `parent_id_label`: the company this contact belongs to
- `child_ids`: contacts belonging to this company (multi-valued)
- `country_id` / `country_id_label`, `state_id` / `state_id_label`: geography
- `user_id` / `user_id_label`: the salesperson assigned to the contact
- `category_id`: partner tags (multi-valued)
- `commercial_partner_id`: the top-level company for the contact

### sale_order

- `id`, `name`: the order reference, for example `S00001`
- `partner_id` / `partner_id_label`: the customer
- `partner_invoice_id`, `partner_shipping_id`: invoice and delivery addresses, each with a `_label` companion
- `user_id` / `user_id_label`: the salesperson
- `amount_total`, `amount_untaxed`: order totals
- `state`: order status, for example `draft` or `sale`
- `date_order`: when the order was placed

### crm_lead

- `id`, `name`
- `type`: `lead` or `opportunity`
- `stage_id` / `stage_id_label`: pipeline stage
- `partner_id` / `partner_id_label`: the related customer
- `user_id` / `user_id_label`: the salesperson
- `expected_revenue`, `probability`
- `active`: false once archived

### product_template

- `id`, `name`
- `categ_id` / `categ_id_label`: product category
- `type`: product type, for example `consu` or `service`
- `list_price`, `standard_price`: sales price and cost
- `sale_ok`, `purchase_ok`: whether the product can be sold or purchased

### account_move

- `id`, `name`: the entry reference, for example `INV/2025/0001`
- `move_type`: `out_invoice`, `out_refund`, `in_invoice`, `in_refund`, or `entry`
- `partner_id` / `partner_id_label`: the customer or vendor
- `invoice_date`, `date`
- `amount_total`, `amount_residual`: total and outstanding balance
- `state`: `draft`, `posted`, or `cancel`
- `payment_state`: settlement status

### FieldReferences (view)

- `ReferenceTable`, `ReferenceColumn`, `TargetTable`, `IsMultiValued`

## Common Query Patterns

### Contacts with resolved country and salesperson

Read the `_label` companions instead of joining, which avoids a JOIN per relationship.

```sql
SELECT [id], [name], [email],
       [country_id_label] AS country,
       [user_id_label] AS salesperson
FROM [YourConnection].[Odoo].[res_partner]
ORDER BY [name]
LIMIT 50
```

### Contacts counted by country

Aggregate directly on the `_label` companion.

```sql
SELECT [country_id_label] AS country, COUNT(*) AS contact_count
FROM [YourConnection].[Odoo].[res_partner]
WHERE [country_id] IS NOT NULL
GROUP BY [country_id_label]
ORDER BY contact_count DESC, country
```

### Companies only

```sql
SELECT [id], [name], [email], [country_id_label] AS country
FROM [YourConnection].[Odoo].[res_partner]
WHERE [is_company] = true
ORDER BY [name]
```

### Contacts carrying at least one tag

`category_id` is multi-valued, so compare against an empty string rather than testing for NULL.

```sql
SELECT [id], [name], [category_id]
FROM [YourConnection].[Odoo].[res_partner]
WHERE [category_id] <> ''
LIMIT 50
```

### Sales orders with customer and total

```sql
SELECT [id] AS order_id, [name],
       [partner_id_label] AS customer,
       [user_id_label] AS salesperson,
       [amount_total], [state], [date_order]
FROM [YourConnection].[Odoo].[sale_order]
ORDER BY [date_order] DESC
LIMIT 50
```

### Product catalog with category and price

```sql
SELECT [id], [name], [categ_id_label] AS category, [type], [list_price]
FROM [YourConnection].[Odoo].[product_template]
WHERE [sale_ok] = true
ORDER BY [list_price] DESC
LIMIT 50
```

### Customer invoices

`account_move` holds every accounting entry, so always filter by `move_type`. It is frequently
the largest model in an Odoo instance, often hundreds of thousands of rows, and the sort column
decides whether a query returns at all.

#### Most recent invoices

Sorting on `id` or on a stored date column is pushed down and stays responsive:

```sql
SELECT [id], [name], [partner_id_label] AS customer,
       [create_date], [amount_total], [state], [payment_state]
FROM [YourConnection].[Odoo].[account_move]
WHERE [move_type] = 'out_invoice'
ORDER BY [create_date] DESC
LIMIT 10
```

Prefer `create_date` over `invoice_date` for recency. `invoice_date` is unset on draft invoices,
which on some instances is nearly all of them, so ordering by it silently returns nothing useful.

#### Largest invoices by amount

Bound the scan with an id window and sort inside it. Copy this shape:

```sql
SELECT [id], [name], [partner_id_label] AS customer, [amount_total], [state]
FROM [YourConnection].[Odoo].[account_move]
WHERE [move_type] = 'out_invoice'
  AND [id] >= 400000          -- an id window; shift or widen it, or repeat across windows
ORDER BY [amount_total] DESC
LIMIT 10
```

`amount_total` is computed and its sort is not pushed down, so every scanned row is retrieved
before ordering, and `LIMIT` is applied after the sort rather than before it. That is why the
same query without the id window times out while this one returns promptly: the cost tracks
rows scanned, not rows returned. To cover the whole table, walk it in id windows and merge the
top rows from each.

### Open opportunities

`crm_lead` holds both leads and opportunities, separated by `type`.

```sql
SELECT [id], [name],
       [stage_id_label] AS stage,
       [user_id_label] AS salesperson,
       [partner_id_label] AS customer,
       [expected_revenue], [probability]
FROM [YourConnection].[Odoo].[crm_lead]
WHERE [type] = 'opportunity' AND [active] = true
ORDER BY [expected_revenue] DESC
LIMIT 50
```

## Stored Procedures

Odoo exposes a single stored procedure, `CallProcedure`. It runs a raw Odoo RPC against any model method and returns JSON, and it is the escape hatch for operations plain SQL CRUD cannot express: native domain searches, workflow methods, posting records, and deletes.

Parameters:

- `Model` (required): the Odoo dot-name, for example `res.partner`. Not the underscore table name.
- `Operation` (required): the method to call, for example `search_read`, `search_count`, `create`, or `unlink`.
- `Arguments` (optional): positional arguments as a JSON list. Not supported on Odoo 19 and above, where it must be left empty.
- `KeywordArgs` (optional): named arguments as a JSON object.

### Passing arguments depends on the Odoo version and the method

- **Methods that do not target existing records** (`search_read`, `search_count`, `create`) take everything through `KeywordArgs` on every version. Prefer that form.
- **Methods that act on existing records** (`unlink`, `write`) also need the record IDs, and those are version-specific. Below Odoo 19 the IDs go in `Arguments` as the first positional value, for example `[[42]]`. On Odoo 19 and above, where `Arguments` must be empty, they go in `KeywordArgs` as `{"ids": [42]}`.

Using the wrong form produces a clear error. On Odoo 19 and above, supplying `Arguments` fails with `Arguments parameter not supported in JSON API, It must be empty.` Below 19, passing record IDs through `KeywordArgs` instead of `Arguments` fails inside Odoo with `IndexError: tuple index out of range`, because the method receives no positional recordset.

### Native domain search

```json
{
  "procedure": "CallProcedure",
  "parameters": {
    "Model": "res.partner",
    "Operation": "search_read",
    "KeywordArgs": "{\"domain\": [[\"is_company\", \"=\", true]], \"fields\": [\"name\", \"email\"], \"limit\": 3}"
  }
}
```

Returns JSON, for example:

```
[{"id": 1, "name": "Acme Corporation", "email": "billing@acme.example"}]
```

### Counting records

```json
{
  "procedure": "CallProcedure",
  "parameters": {
    "Model": "res.partner",
    "Operation": "search_count",
    "KeywordArgs": "{\"domain\": []}"
  }
}
```

## Write Operations

Odoo supports INSERT and UPDATE through Connect AI where the connection has write access and the Odoo user's permissions allow it. Supply only the columns `getColumns` reports as writable.

### Create a record

```sql
INSERT INTO [YourConnection].[Odoo].[res_partner]
([name], [email], [is_company])
VALUES
('Acme Corporation', 'billing@acme.example', true)
```

### Update a record

```sql
UPDATE [YourConnection].[Odoo].[res_partner]
SET [email] = 'new.address@acme.example',
    [phone] = '+1-555-0100'
WHERE [id] = 42
```

### Change a relationship

Set a many2one by writing its ID column. The `_label` companion resolves itself from that write and cannot be set directly.

```sql
UPDATE [YourConnection].[Odoo].[res_partner]
SET [country_id] = 233
WHERE [id] = 42
```

Writing the label instead fails with `Column [country_id_label] could not be updated. This column is read-only.` Look the target ID up in the table `FieldReferences` names for that column, here `res_country`.

### Delete a record

There is no generic delete tool. Deletion goes through `CallProcedure` with Odoo's `unlink` operation, with the record IDs in the version-appropriate parameter described above.

Below Odoo 19:

```json
{
  "procedure": "CallProcedure",
  "parameters": {
    "Model": "res.partner",
    "Operation": "unlink",
    "Arguments": "[[42]]"
  }
}
```

On Odoo 19 and above:

```json
{
  "procedure": "CallProcedure",
  "parameters": {
    "Model": "res.partner",
    "Operation": "unlink",
    "KeywordArgs": "{\"ids\": [42]}"
  }
}
```

`unlink` returns `true` on success. Confirm any write with a follow-up SELECT rather than relying on a return value or an affected-row count alone.

If write operations are blocked, the Connect AI connection may not have write access enabled. Guide the user to their Connect AI connection settings to ensure write access is enabled.

## Odoo-Specific Conventions

- **Dot-name vs underscore name**: tables use the underscore form (`res_partner`), while `CallProcedure` takes the Odoo dot-name (`res.partner`). Mixing them up is the most common `CallProcedure` mistake
- **Check `FieldReferences` before joining**: it is the only reliable way to know whether a relationship column is a single ID you can JOIN or a comma-separated list you cannot
- **Read the `_label`, write the `_id`**: `<column>_id_label` gives you the display name with no JOIN, but it is read-only. Set the relationship by writing the integer `<column>_id`
- **Joins produce ambiguous `name` columns**: almost every model has a bare `name`, and an alias on a plain column is dropped from the result header, so a two-table join can return two columns both headed `name`. Prefer the `_label` companion, or select only one table's `name`
- **Multi-valued columns are not NULL when empty**: they come back as an empty string, so `IS NOT NULL` does not filter them. Use `<> ''`. This silently returns every row when you expected a filtered set
- **A missing table usually means a missing app**: the error names the table it could not match. Confirm with `getTables` and check `ir_module_module`, rather than retrying
- **Never sort a large model by a monetary or computed column before narrowing it**: ordering `account_move` by `amount_total` times out, because the sort is not pushed down and `LIMIT` is applied after it. Sort by `id` or a stored date column such as `create_date`, or filter the rows down first. This is the single most common way an Odoo query hangs
- **`COUNT(DISTINCT ...)` does not scale**: it is accepted, but it is not pushed down, so it works on small or filtered sets and times out on large ones. If you reached for it to avoid double counting, you are usually joining two one-to-many relationships at once, so aggregate each in its own subquery instead
- **Archived records**: Odoo archives with `active = false` rather than deleting. Add `WHERE [active] = true` when you want only live records
- **Booleans are flexible**: `true` / `false`, `1` / `0`, and `'true'` / `'false'` all work in filters
- **Computed columns are read-only**: `display_name` and every `_label` companion cannot be written. `getColumns` reports the `Readonly` flag, so check it before composing a write
- **Selection columns hold codes, not labels**: `move_type`, `state`, and `type` store values like `out_invoice`, `draft`, and `opportunity`. Sample the column before filtering on a guessed value
- **`create_date` is the stable time filter**: `write_date` is updated by many automated Odoo processes
