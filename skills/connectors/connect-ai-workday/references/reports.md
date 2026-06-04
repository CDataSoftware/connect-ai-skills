# Workday Reports Connection Reference

> Connection type: `ConnectionType = Reports`. Reports as a Service (RaaS). **Read-only.**
>
> Load this reference when the live connection's `getSchemas` returns a single `Reports` schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema

A single `Reports` schema. Each custom report exposed via RaaS appears as a table whose name matches the report name (which may contain spaces — quote with `[]`).

Requires the `CustomReportURL` connection property to be configured. If `getTables` returns nothing, confirm `CustomReportURL` is set on the connection.

```sql
SELECT * FROM [WorkdayReports].[Reports].[Employee Directory]
```

## Query Process

1. Confirm `CustomReportURL` is configured.
2. Run `getTables` to list the reports exposed by the configured RaaS endpoint.
3. Run `getColumns` — column names often contain dots and spaces, so discover them before querying.
4. Query the report. Always quote columns with `[]` (e.g., `[Worker.Descriptor]`).

## Common Query Patterns

### Custom report view

```sql
SELECT [Worker.Descriptor], [businessTitle], [Job_Profile.Descriptor], [Hire_Date]
FROM [YourConnection].[Reports].[Employee Directory]
WHERE [Is_Active_Employee] = 1
LIMIT 5
```

## Reports-Specific Conventions

- **`CustomReportURL` is mandatory.** Without it the Reports schema exposes nothing.
- **Reports column names** often contain dots and spaces — always quote with `[]`.
- **Read-only by design** — Reports cannot be made writable. For writes, use a REST connection.
