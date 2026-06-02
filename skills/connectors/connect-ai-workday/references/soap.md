# Workday SOAP Connection Reference

> Connection type: `ConnectionType = SOAP`. Workday SOAP API (legacy). Single `SOAP` schema.
>
> Load this reference when the live connection's `getSchemas` returns a single `SOAP` schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema

A single `SOAP` schema, backed by Workday's legacy SOAP web services.

```sql
SELECT * FROM [WorkdaySOAP].[SOAP].[<Table>]
```

## Query Process

The SOAP connection was not exercised in depth during validation, so this reference is discovery-first:

1. Run `getTables` on the live `SOAP` schema to see which web-service-backed tables the tenant exposes.
2. Run `getColumns` before referencing any column — do not assume names.
3. Apply `LIMIT` on exploratory queries.

If you encounter SOAP-specific prompt columns, value tables, or write behavior, treat them like their REST analogues (see [rest.md](rest.md)) until tenant-specific behavior is confirmed — but verify against the live connection rather than assuming parity.

## SOAP-Specific Conventions

- **Legacy surface.** Prefer REST, WQL, or Reports where the same data is available; SOAP is the oldest connection type.
- **Discover everything.** Table and column inventory was not validated here — rely on `getTables` / `getColumns` rather than documented assumptions.
