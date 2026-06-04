# Workday SOAP Connection Reference

> Connection type: `ConnectionType = SOAP`. Workday SOAP API (legacy). **Multiple functional-area schemas** — not a single `SOAP` schema.
>
> Load this reference when the live connection's `getSchemas` returns multiple underscore-spaced schema names (e.g., `Human_Resources`, `Staffing`, `Payroll`) rather than a single `WQL` / `Reports` / `REST`-style schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema

> ⚠️ **The SKILL.md connection-type table documents SOAP as returning a single `SOAP` schema. This is incorrect.** Validated against the live connection: `WorkdaySOAP_NY` exposes **37 functional-area schemas** with underscore-spaced names. There is no literal `SOAP` schema. Always run `getSchemas` on the live connection first.

SOAP connections expose multiple functional-area schemas, named after Workday web-service domains. Schema names use **underscore-spaced** format — different from REST's PascalCase (e.g., `Human_Resources` not `HumanResources`, `Absence_Management` not `AbsenceManagement`).

```sql
-- Correct: underscore-spaced schema names
SELECT * FROM [WorkdaySOAP].[Human_Resources].[Workers]
SELECT * FROM [WorkdaySOAP].[Staffing].[Positions]
SELECT * FROM [WorkdaySOAP].[Payroll].[Workers]

-- Wrong: these schemas do not exist
SELECT * FROM [WorkdaySOAP].[SOAP].[Workers]         -- no literal 'SOAP' schema
SELECT * FROM [WorkdaySOAP].[HumanResources].[Workers] -- no PascalCase schema names
```

### Sample schema names (observed on validation tenant)

Always run `getSchemas` first — the exact set varies by tenant and enabled modules. The list below is a starting reference, not a guarantee.

| Schema | Domain |
|---|---|
| `Human_Resources` | Worker personal data, compensation, demographics |
| `Staffing` | Job changes, positions, org assignment |
| `Payroll` | Payroll results, pay periods, withholding |
| `Payroll_CAN` | Canadian payroll |
| `Payroll_GBR` | UK payroll |
| `Payroll_Interface` | Payroll integration outputs |
| `Recruiting` | Job requisitions, job applications, offers |
| `Compensation` | Compensation plans, grades |
| `Compensation_Review` | Compensation review cycles |
| `Benefits_Administration` | Benefits elections, plans |
| `Absence_Management` | Time-off requests, balances |
| `Performance_Management` | Reviews, goals |
| `Talent` | Talent profiles, succession plans |
| `Time_Tracking` | Time entries, time blocks |
| `Learning` | Courses, enrollments |
| `Financial_Management` | Financial data |
| `Integrations` | Integration system outputs |
| `Identity_Management` | User accounts, SSO |
| `Scheduling` | Worker schedules |
| `Workforce_Planning` | Headcount plans |
| `Resource_Management` | Procurement resource data |
| `Revenue_Management` | Revenue recognition |
| `Settlement_Services` | Settlement processing |
| `Cash_Management` | Cash and treasury |
| `Dynamic_Document_Generation` | Configurable doc outputs |
| `Workday_Connect` | Workday Connect integration |
| `Workday_Extensibility` | Custom objects, EIBs |
| `Student_Core` | Student records |
| `Student_Finance` | Student financials |
| `Student_Recruiting` | Student admissions |
| `Academic_Foundation` | Academic programs |
| `Academic_Advising` | Advising records |
| `Admissions` | Admissions processing |
| `Campus_Engagement` | Campus activity |
| `Financial_Aid` | Financial aid awards |
| `Adoption` | Workday adoption tooling |

## Column Naming Convention

SOAP column names use **multi-part underscore-joined** paths that reflect the SOAP XML response structure. This is different from REST's dot-separated naming.

```sql
-- SOAP underscore-joined column names
Worker_Reference_WID                  -- Workday Internal ID (WID)
Worker_Reference_Employee_ID          -- Human-readable employee ID (e.g., '21001')
Worker_Reference_Contingent_Worker_ID

-- REST equivalent (dot-separated, different connection)
-- Worker.Id, Worker.Descriptor
```

**`Worker_Reference_WID` is the Workday WID; `Worker_Reference_Employee_ID` is the human-readable employee number.** These are not interchangeable — stored procedures require the WID, not the employee ID.

Because column names are deeply nested and not predictable without inspection, **always call `getColumns` before referencing any specific column**. Do not guess column names from the pattern.

## Query Process

1. **Run `getSchemas`** to see which underscore-spaced schemas the tenant exposes.
2. **Run `getTables`** in the relevant schema to find the table. Common entry point: `Human_Resources.Workers`.
3. **Run `getColumns`** before referencing any column — multi-part underscore names are not guessable without inspection.
4. **Apply `LIMIT`** on exploratory queries; SOAP tables can be large.
5. **Filter by `Worker_Reference_Employee_ID`** to target a specific worker by their human-readable ID.

### Example: Look up a worker by employee ID

```sql
SELECT [Worker_Reference_WID], [Worker_Reference_Employee_ID], [Worker_Descriptor]
FROM [WorkdaySOAP].[Human_Resources].[Workers]
WHERE [Worker_Reference_Employee_ID] = '21001'
```

## SOAP-Specific Conventions

- **Legacy surface.** Prefer REST, WQL, or Reports where the same data is available.
- **Underscore-spaced schema names** — not PascalCase, not a single `SOAP` schema.
- **Underscore-joined column names** — multi-part paths; always inspect with `getColumns`.
- **`Worker_Reference_Employee_ID` ≠ WID** — employee IDs are human-readable numbers; the WID (`Worker_Reference_WID`) is the Workday internal GUID required for most write operations and cross-reference lookups.
- **Discover everything.** SOAP table and column inventory beyond `Human_Resources.Workers` has not been validated in depth. Rely on `getTables` / `getColumns` rather than assumptions.
- If you encounter SOAP-specific prompt columns or write behavior, treat them like their REST analogues (see [rest.md](rest.md)) until confirmed against the live connection.