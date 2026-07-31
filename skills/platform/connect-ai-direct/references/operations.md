# Operations — exact request/response shapes & SQL rules

Everything here is verified against the CData driver source (`ProviderCDataConnect`) and confirmed with live calls on 2026-06-02. Base URL: `https://cloud.cdata.com`. Header on every call: `Authorization: Bearer <token>`, `Content-Type: application/json` for POST/PUT.

---

## Data operations

### `POST /api/query` — one SELECT / INSERT / UPDATE

```jsonc
{
  "query": "SELECT [Id],[Name] FROM [Catalog].[Schema].[Table] WHERE [Status] = @status",
  "defaultCatalog": "Catalog",     // optional — lets you use unqualified names
  "defaultSchema":  "Schema",      // optional
  "schemaOnly":     false,         // true → return column metadata, zero rows
  "parameters": {
    "@status": { "dataType": 5, "value": "Open" }   // @-prefixed name → { dataType, value }
  }
}
```

### `POST /api/batch` — many rows, one statement

`parameters` becomes an **array** — one object per row:

```jsonc
{
  "query": "INSERT INTO [Catalog].[Schema].[Table] ([A],[B]) VALUES (@a,@b)",
  "defaultCatalog": "Catalog",
  "defaultSchema":  "Schema",
  "parameters": [
    { "@a": { "dataType": 5, "value": "x" }, "@b": { "dataType": 8, "value": 1 } },
    { "@a": { "dataType": 5, "value": "y" }, "@b": { "dataType": 8, "value": 2 } }
  ]
}
```

### `POST /api/exec` — stored procedure

```jsonc
{
  "procedure": "Catalog.Schema.ProcedureName",
  "defaultSchema": "Schema",
  "parameters": {
    "@InParam":  { "direction": 1, "dataType": 5, "value": "..." },
    "@OutParam": { "direction": 4, "dataType": 5, "value": null }
  }
}
```

Every parameter `procedureParameters` lists must be supplied — including OUT params (`value: null`).

### Response shape (all three)

```jsonc
{
  "results": [{
    "schema": [
      { "columnName": "Id", "dataType": 5, "tableName": "...", "schemaName": "...",
        "catalogName": "...", "length": 255, "precision": 0, "scale": 0, "nullable": false }
    ],
    "rows": [ ["..."] ],          // array of arrays, column order = schema order
    "affectedRows": -1            // -1 for SELECT; >=0 for write
  }],
  "parameters": { "@OutParam": { "dataType": 5, "value": "..." } },  // OUT/return values
  "error": { "code": "INVALID_REQUEST", "message": "..." }           // PRESENT ONLY ON FAILURE
}
```

> **The critical rule (verified live):** failures come back as **HTTP 200** with a populated `error` object. Success omits `error` (or it's null). `error.code` is a **string** (`INVALID_REQUEST`, `INVALID_AUTHORIZATION`, …) — *not* the integer `0`. Check `if (response.error) { handle failure }` before reading `rows`.

---

## Schema-discovery endpoints (GET)

| Endpoint | Query params (all optional unless noted) | Returns |
|---|---|---|
| `/api/catalogs` | — | `rows`: TABLE_CATALOG, DATA_SOURCE, DRIVER, VERSION, CONNECTION_ID |
| `/api/schemas` | `catalogName` | `rows`: TABLE_CATALOG, TABLE_SCHEMA |
| `/api/tables` | `catalogName`, `schemaName`, `tableName`, `tableType` | catalog, schema, **table name (row[2])**, type |
| `/api/columns` | `catalogName`, `schemaName`, `tableName` | column metadata |
| `/api/procedures` | `catalogName`, `schemaName`, `procedureName` | procedure list |
| `/api/procedureParameters` | `catalogName`, `schemaName`, `procedureName` | param name, direction, type |
| `/api/primaryKeys` | `catalogName`, `schemaName`, `tableName` | PK columns |
| `/api/importedKeys` | `catalogName`, `schemaName`, `tableName` | FK → parent |
| `/api/exportedKeys` | `catalogName`, `schemaName`, `tableName` | who references this table |
| `/api/indexes` | `catalogName`, `schemaName`, `tableName` | index metadata |

All return the same `{ results: [ { schema, rows } ] }` envelope. URL-encode catalog/schema/table values that contain spaces.

---

## Data-type codes (`dataType`)

Verified from `CDataConnectMetadataUtil.getRestDataType()`. Default to **5 (VARCHAR)** when unsure — the server coerces.

| Code | Type | Code | Type | Code | Type |
|---|---|---|---|---|---|
| 1 | BINARY | 7 | SMALLINT | 13 | NUMERIC |
| 2 | VARBINARY | 8 | INTEGER | 14 | BOOLEAN |
| 3 | LONGVARBINARY | 9 | BIGINT | 15 | DATE |
| 4 | BLOB | 10 | FLOAT | 16 | TIME |
| 5 | **VARCHAR (default)** | 11 | DOUBLE | 17 | TIMESTAMP |
| 6 | TINYINT | 12 | DECIMAL | 18 | UUID |

Numeric/boolean types (6–14) are sent **unquoted** in the JSON `value` (`"value": 123`); everything else is a JSON string.

## Parameter direction codes (`direction`, for `/api/exec`)

Verified from `CDataConnectMetadataUtil` (`SPPARAM_DIRECT_*`). **Note the order — INOUT is 2 and OUT is 4, not the reverse.**

| Code | Direction |
|---|---|
| 1 | IN |
| 2 | INOUT |
| 4 | OUT |
| 5 | RETURN value |

---

## SQL identifier & parameter rules

| Rule | Detail |
|---|---|
| Identifier quoting | `[Connection].[Schema].[Table]` — square brackets preferred (backticks also accepted). |
| Fully qualified names | Use `[Catalog].[Schema].[Table]` across catalogs. Unqualified names resolve via `defaultCatalog`/`defaultSchema`. |
| Parameters | Named `@name` (recommended) **or** positional `?`. Pick one style per query. Bind every user value. |
| Booleans | Use `1` / `0`. `TRUE`/`FALSE` are not portable across drivers. |
| Strings | Single quotes; escape by doubling: `'O''Brien'`. Prefer parameters over literals. |
| Dates | ISO-8601: `'2026-06-02'`, `'2026-06-02T14:30:00Z'`. |
| NULL | `IS NULL` / `IS NOT NULL` (never `= NULL`). |
| Row limiting | `SELECT TOP 10 …` or `… LIMIT 10 OFFSET 20` — both accepted. |
| DELETE | **Blocked by this skill** (safety). Use a soft delete or the portal. |

---

## Choosing & validating a target

1. `GET /api/catalogs` → see all data sources. With hundreds present, narrow by name.
2. To confirm a catalog is *live* (its vendor login hasn't expired), check `GET /api/ui/account/connections` and prefer ones with a recent `lastQueried`. A dead catalog returns **400** on `/api/schemas` — see [edge-cases.md](edge-cases.md#stale-catalog).
3. `schemaOnly: true` on `/api/query` is the most reliable way to get a table's columns when `/api/columns` is being stubborn — see [edge-cases.md](edge-cases.md#columns-empty).

---

## Translating plain English to SQL

This skill does NL→SQL **client-side**: discover the schema (3a), then write the SQL yourself and run it via `/api/query`. This is more reliable than the portal's `/api/ui/openai/query` endpoint, whose request contract is not publicly stable (see [edge-cases.md](edge-cases.md#nl-sql)). Always show the user the SQL you generated before running a write.
