---
name: connect-ai-workday
description: Use when querying Workday data through CData Connect AI. Covers Workday's multi-schema model (REST/WQL/Reports/SOAP), the REST entity-type system, prompt-column GUID lookup chains, value tables, change-resource procedures, and Workday-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: Workday
  family: hcm
---

# CData Connect AI — Workday Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Workday-specific guidance for querying Workday data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the Workday driver. Do not call `getInstructions` for Workday — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getSchemas` / `getTables` / `getColumns`) after identifying the Workday connection via `getCatalogs`.

## Schema

Workday has four **connection types**, each set via the `ConnectionType` connection property in CData. The connection type changes the entire surface area the driver exposes:

- **REST** — Workday REST API. The most common configuration. Empirically does **not** expose a single `REST` schema; instead the driver partitions REST tables across multiple functional-area schemas (see below). Supports inserts, updates, and limited deletes.
- **WQL** — Workday Query Language. Single `WQL` schema with Prism data sources (`cds_` prefix) and Core data sources. Read-only.
- **Reports** — Reports as a Service (RaaS). Single `Reports` schema; requires the `CustomReportURL` connection property. Read-only.
- **SOAP** — Workday SOAP API (legacy). Single `SOAP` schema.

**Always start with `getSchemas`** — the connection type can't be inferred from the connection name, and the schema list a REST connection exposes varies by tenant.

### REST schema partitioning (empirical)

The CData docs don't formally describe how REST tables are organized into schemas. Observed driver behavior: REST connections expose tables across **multiple functional-area schemas** named after Workday modules — e.g., `Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`, `Payroll`. **The exact set varies by tenant** — a tenant without Workday Student won't see `Student*` schemas, one without Financials won't see `CoreAccounting` / `AccountsPayable` / `Revenue`, etc. Table-to-schema mappings are also driver-version-dependent. Always run `getSchemas` and `getTables` on the live connection before writing queries.

### Table locations observed during validation

The mappings below were verified against one tenant. Use them as starting hints, not guarantees — confirm with `getTables` on the live connection.

| Table | Schema (observed) | Type |
|---|---|---|
| `Organizations` | `Common` | VIEW |
| `Requisitions` | `Procurement` | TABLE |
| `Cases` | `HelpCase` | TABLE |
| `JobPostings` (+ `JobPostings*` children) | `Recruiting` | VIEW |
| `JobProfiles` (+ `JobProfiles*` children) | `Staffing` | VIEW |
| `JobFamilies`, `JobsWorkspace`, `JobChanges*` | `Staffing` | VIEW / TABLE |
| `Workers*` views (`WorkersHistory`, `WorkersDirectReports`, `WorkersPaySlips`, etc.) | `Common` and `Staffing` | mostly VIEW |
| `MessageTemplates`, `NotificationTypes` | `Connect` | TABLE / VIEW |

**Tenant-dependent / not universally present:** older Workday connector docs reference bare `Workers`, `Jobs`, `companies`, `journals`, `journalLines` tables that did **not** appear on the validation tenant. Their availability depends on enabled modules (Financials/Accounting for the journal chain). Always confirm with `getTables`.

### Three-part name examples

```sql
-- REST connection: tables live in functional schemas
SELECT * FROM [WorkdayProd].[Common].[Organizations]
SELECT * FROM [WorkdayProd].[Procurement].[Requisitions]
SELECT * FROM [WorkdayProd].[HelpCase].[Cases]
SELECT * FROM [WorkdayProd].[Recruiting].[JobPostings]
SELECT * FROM [WorkdayProd].[Staffing].[JobProfiles]

-- Other connection types: single schema named after the type
SELECT * FROM [WorkdayWQL].[WQL].[cds_Prism_Test_From_Report]
SELECT * FROM [WorkdayReports].[Reports].[Employee Directory]
```

## Query Process

The REST connection requires a Workday-specific workflow built around **prompt columns** and **value tables**. Most non-trivial REST queries cannot be issued directly — they require resolving one or more Workday-internal GUIDs first.

### REST workflow

1. **Locate the schema** for the target table on the live connection. Start with `getSchemas` to see which functional-area schemas the tenant exposes; then call `getTables` with a `tableName` LIKE filter to find the table. The Table Locations table above is a starting hint, not a guarantee — actual locations vary by tenant.
2. **Inspect with `getColumns`** on `[catalog].[schema].[table]` and find any `_Prompt` columns. Some are required, some optional. Required prompts typically scope to a date range or parent ID.
3. **For each required `_Prompt`, resolve the GUID via the matching value table** (ends in `Values`, lives in the same schema). See Value Tables below.
4. **Chains may be multi-level** — a value table may itself require a `_Prompt`. Resolve backward from the target.
5. **Execute the target query** with literal GUIDs or date strings in `yyyy-mm-dd` format.

### WQL workflow

- **Prism sources (`cds_` prefix)** typically expose no `_Prompt` columns — query directly.
- **Core data sources** (names often ending in `Parms`) do expose `_Prompt` columns. Inspect with `getColumns` first and supply each required prompt.

Prefer Prism over Core where available — Prism is served from dedicated infrastructure and doesn't compete for tenant resources. If a Core source has multiple filters and you need any beyond the first, the user must enable `UseSplitTables` on the connection.

### Reports workflow

Confirm `CustomReportURL` is configured. Column names often contain dots and spaces — always quote with `[]` (e.g., `[Worker.Descriptor]`).

## Data Model (REST Connection)

### Entity Type Categories

The REST API exposes entities in four categories. Category controls how the entity is queried, which prompts it inherits, what its primary key looks like, and whether it supports writes.

- **Base** — read directly; one row per primary object (e.g., Requisitions, Organizations).
- **Child** — belong to a parent; accessed via the parent. Example: `RequisitionsWorktags`.
- **Owned** — require an owner record reference. Example: `RequisitionsRequisitionLines` needs a specific Requisition.
- **Owned child** — require both parent and owner.

### Primary Key Structures

| Entity Type | Primary Key |
|---|---|
| Base | Single `Id` |
| Child | `Id` + Parent reference |
| Owned | `Id` + Owner reference |
| Owned Child | `Id` + Parent + Owner |

### Prompt Columns

Prompt columns (`_Prompt` suffix) mirror Workday UI export-form fields. They accept Workday-internal GUIDs or, for date prompts, literal date strings. Without the required prompts, queries fail or return empty.

Which prompts an entity exposes follows its category:
- **Base** — own prompts only
- **Child** — parent's prompts
- **Owned** — own + owner's prompts
- **Owned child** — parent's + owner's prompts

When `getColumns` reveals `_Prompt` columns, resolve every required GUID before issuing the main query. Date prompts don't need a value-table lookup.

### Value Tables

Value tables provide the GUID lookups for `_Prompt` columns. All share these columns:

- **Id** — Workday GUID (the prompt value)
- **Descriptor** — human-readable; filter by this to find a row
- **CollectionToken** — non-NULL when there's a deeper level in the hierarchy
- **Collection_Prompt** — input parameter for hierarchical navigation

**Hierarchical navigation:**

1. Initial query returns top-level categories:
   ```sql
   SELECT * FROM [YourConn].[Staffing].[JobChangesGroupWorkersValues]
   WHERE [EffectiveDate_Prompt] = '2020-01-01'
   ```
2. Drill down using a `CollectionToken` from the previous result:
   ```sql
   SELECT * FROM [YourConn].[Staffing].[JobChangesGroupWorkersValues]
   WHERE [Collection_Prompt] = 'abcxyz123'
   ```
3. A row with **NULL `CollectionToken`** is a leaf — use its `Id` as the prompt value.

### Filter Push-Down

Server-side filtering is more efficient. Push-down rules by category:

- **Base** — `Id` filters pushed down; Workday returns only the matching row.
- **Child** — only parent `Id` is pushed down. Filters on the child entity itself are evaluated client-side after the full result is fetched (inefficient).
- **Owned** — owner `Id` is pushed down; the owner reference must be valid.
- **Owned Child** — both parent `Id` and owner `Id` filters can be pushed down.

### Change Resources

Business-process modifications (job changes, org assignment changes, time off) use a paired `Begin`/`Submit` stored procedure pattern:

1. Call `Begin<ChangeName>` to initiate the change event; returns a change ID.
2. Apply changes via queries/updates against change-specific tables.
3. Call `Submit<ChangeName>` with the change ID to commit and run the Workday business process.

**Single value changes** modify one record directly. **Collection changes** modify multiple related records — use `CollectionToken` for iterative navigation.

## Important Columns (REST Connection)

Non-obvious columns for the headline entities. Self-explanatory columns (`Id`, `Title`, `StartDate`, etc.) and timestamps are omitted — discover them with `getColumns`. Treat the `Workers` and `Jobs` lists as **illustrative**: bare top-level `Workers`/`Jobs` tables were not present on the validation tenant.

### Workers *(tenant-dependent)*

- `WorkerId` — employee or contingent-worker ID (distinct from `Id`)
- `WorkerType_Descriptor` — employee, contingent worker, etc.
- `Person_Email`, `Person_Phone`
- `PrimaryJob_BusinessTitle`, `PrimaryJob_JobProfile_Descriptor`, `PrimaryJob_Location_Descriptor`, `PrimaryJob_SupervisoryOrganization_Descriptor`
- `IncludeTerminatedWorkers_Prompt` — set to `0` for active workers only

### Organizations (Common)

- `OrganizationType_Prompt` — **required** classification filter
- `Href` — direct URL to the org in Workday

### Requisitions (Procurement)

- `Status_Descriptor` — open, approved, canceled, etc.
- `Amount_Value`, `Amount_Currency`, `FormattedAmount`
- `Requester_Descriptor`, `RequisitionType_Descriptor`, `Submitter_Descriptor`, `SourcingBuyer_Descriptor`
- `HighPriority` — `1` if marked high priority
- `Memo`, `InternalMemo`
- **Prompts:** `FromDate_Prompt`, `ToDate_Prompt`, `Requester_Prompt`, `RequisitionType_Prompt`, `SubmittedBy_Prompt`, `SubmittedByPerson_Prompt`, `SubmittedBySupplier_Prompt`

### Jobs *(tenant-dependent)*

- `BusinessTitle` — may differ from job profile title
- `JobType_Descriptor` — full-time, part-time, contract
- `Worker_Descriptor`, `Worker_Id` — current incumbent
- `SupervisoryOrganization_Descriptor`
- `NextPayPeriodStartDate`

### Cases (HelpCase)

- `CaseID` — human-readable case ID
- `Status_Descriptor`, `Type_Name`
- `About_Descriptor` — subject (person/entity involved)
- `Assignee_Descriptor`, `By_Descriptor`, `ServiceTeam_Descriptor`
- `DetailedMessage`, `Confidential`, `CaseLink`
- **Prompts:** `MyCases_Prompt`, `OpenCases_Prompt`, `Status_Prompt`, `Substatus_Prompt`, `Team_Prompt`, `Flag_Prompt`, `Label_Prompt`, `Sort_Prompt` / `Desc_Prompt`

### JobProfiles (Staffing)

- `DefaultJobTitle`, `Summary`, `JobDescription`, `AdditionalJobDescription`
- `JobCategory_Descriptor`, `JobLevel_Descriptor`, `ManagementLevel_Descriptor`
- `CriticalJob`, `DifficultyToFill_Descriptor`
- `Public`, `Inactive`, `WorkShiftRequired`

### JobPostings (Recruiting)

- `JobDescription`
- `Company_Descriptor`
- `JobType_Descriptor`, `TimeType_Descriptor`, `RemoteType_Name`
- `PrimaryLocation_Descriptor` (+ `_Country_Descriptor`, `_Region_Descriptor`)
- `JobSite_Descriptor`, `SpotlightJob`
- `Url` — external career-site URL

## Common Query Patterns

### Recent job postings

```sql
SELECT [Id], [Title], [StartDate], [EndDate], [PrimaryLocation_Descriptor],
       [JobType_Descriptor], [TimeType_Descriptor], [Company_Descriptor]
FROM [YourConn].[Recruiting].[JobPostings]
WHERE [StartDate] >= '2024-01-01'
ORDER BY [StartDate] DESC
```

### Requisitions within a date range

```sql
SELECT [Id], [Descriptor], [RequisitionType_Descriptor],
       [Requester_Descriptor], [Amount_Value], [Amount_Currency],
       [RequisitionDate], [Status_Descriptor]
FROM [YourConn].[Procurement].[Requisitions]
WHERE [FromDate_Prompt] = '2020-01-01'
  AND [ToDate_Prompt] = '2021-12-31'
ORDER BY [RequisitionDate] DESC
```

`FromDate_Prompt` / `ToDate_Prompt` accept literal dates in `yyyy-mm-dd` format (verified on the live driver).

### Organizations of a specific type

```sql
SELECT [Id], [Descriptor], [Href]
FROM [YourConn].[Common].[Organizations]
WHERE [OrganizationType_Prompt] = '<organization_type_GUID>'
```

`OrganizationType_Prompt` is required — resolve via the matching `*OrganizationType*Values` table.

### Open cases assigned to me

```sql
SELECT [Id], [CaseID], [Title], [CreationDate], [Status_Descriptor],
       [Type_Name], [About_Descriptor], [Assignee_Descriptor]
FROM [YourConn].[HelpCase].[Cases]
WHERE [MyCases_Prompt] = 1
  AND [OpenCases_Prompt] = 1
ORDER BY [CreationDate] DESC
```

### Multi-step prompt-column lookup chain *(illustrative)*

> ⚠️ The `companies` / `journals` / `journalLines` tables below depend on the Workday Financials module and were **not present** on the validation tenant. Use this as a pattern for any REST table with multi-level `_Prompt` dependencies.

To query `journalLines` (where available), three GUIDs must be resolved first: `company_Prompt`, `year_Prompt`, `journalEntryStatus_Prompt`. The chain:

1. `[CoreAccounting].[companies]` filtered by `Descriptor` → returns the company `Id` for `company_Prompt`.
2. `[CoreAccounting].[journals]` filtered by `company_Prompt` + an accounting-date range → returns `fiscalYear_Id` (use for `year_Prompt`) and `journalStatus_Id` (use for `journalEntryStatus_Prompt`).
3. `[CoreAccounting].[journalLines]` filtered by all three resolved prompts plus `entryMomentFrom_Prompt` / `entryMomentTo_Prompt`:

```sql
SELECT [workdayId], [accountingDate], [lastFunctionallyUpdated]
FROM [YourConn].[CoreAccounting].[journalLines]
WHERE [company_Prompt] = '<from_step_1>'
  AND [year_Prompt] = '<from_step_2>'
  AND [journalEntryStatus_Prompt] = '<from_step_2>'
  AND [entryMomentFrom_Prompt] = '2017-01-01'
  AND [entryMomentTo_Prompt] = '2017-06-01'
LIMIT 10
```

### WQL — Prism data source (`UseSplitTables = False`)

```sql
SELECT [employee_ID], [full_Name], [job_Profile_Name],
       [location___Name], [manager_Name], [compa_Ratio], [rating_String]
FROM [YourConn].[WQL].[cds_Prism_Test_From_Report]
LIMIT 10
```

### WQL — Prism joined across split tables

```sql
SELECT t1.[employee_ID], t1.[full_Name], t2.[manager_Name], t2.[compa_Ratio]
FROM [YourConn].[WQL].[cds_Prism_Test_From_Report_1] t1
INNER JOIN [YourConn].[WQL].[cds_Prism_Test_From_Report_2] t2
  ON t1.[employee_ID] = t2.[employee_ID]
LIMIT 10
```

### WQL — Core data source with required prompts

Core data sources expose `_Prompt` columns just like REST tables do. `absenceCasesByWorkerForOrganizationAndDateRangeParms` requires `organizations_Prompt` (VARCHAR GUID), `startDate_Prompt` / `endDate_Prompt` (DATE), `includeSubordinateOrganizations_Prompt` (BOOLEAN):

```sql
SELECT *
FROM [YourConn].[WQL].[absenceCasesByWorkerForOrganizationAndDateRangeParms]
WHERE [organizations_Prompt] = 'abc123def4567890...'
  AND [startDate_Prompt] = '2024-01-01'
  AND [endDate_Prompt] = '2024-12-31'
  AND [includeSubordinateOrganizations_Prompt] = 1
LIMIT 20
```

Resolve `organizations_Prompt` via a value table on a REST connection (or via a Workday admin if no value table is exposed in WQL).

### Reports — custom report view

```sql
SELECT [Worker.Descriptor], [businessTitle], [Job_Profile.Descriptor], [Hire_Date]
FROM [YourConn].[Reports].[Employee Directory]
WHERE [Is_Active_Employee] = 1
LIMIT 5
```

## Stored Procedures

Business-process procedures — **all live under `Staffing`** on REST connections (verified):

- `BeginJobChange` / `SubmitJobChange`
- `BeginOrganizationAssignmentChange` / `SubmitOrganizationAssignmentChange`
- `WorkersRequestTimeOff`
- `Begin/SubmitHomeContactInformationChange`, `Begin/SubmitWorkContactInformationChange`
- `WorkersRequestOneTimePayment`, `WorkersOrganizationAssignmentChanges`
- `RequisitionsCancel`, `RequisitionsClose`

Run `getProcedures` against `Staffing` for the full list.

`Begin*` / `Submit*` are always called in pairs — `Begin` returns the change ID, `Submit` consumes it. Don't call `Submit*` without `Begin*`, and don't forget `Submit*` after applying changes (otherwise the change isn't committed to Workday).

### SendMessage (Common schema)

`SendMessage` lives under `Common` rather than `Staffing`:

```json
{
  "schema": "Common",
  "procedure": "SendMessage",
  "parameters": {
    "EmailDetail_Body": "This is a test message",
    "EmailDetail_Subject": "Test Subject",
    "NotificationType_Id": "<NotificationType_GUID>",
    "Recipients_Contacts_Aggregate": "[{\"id\": \"<recipient_GUID>\"}]"
  }
}
```

`NotificationType_Id` and recipient `id` values are Workday GUIDs — resolve via the appropriate value tables.

## Write Operations (REST only)

REST connections support writes where the underlying Workday API allows it; **WQL and Reports are read-only by design** and cannot be made writable.

- **Insert** — supported on base/owned entities where the Workday API permits creation. Supply all Workday-mandatory fields; respect parent/owner dependencies.
- **Update** — must include `Id`. Child/owned entities require their compound keys. Prompt columns may be required depending on entity type.
- **Delete** — many entities cannot be deleted directly; use the change-resource pattern (Begin/Submit) instead.

**Two layers control write access:** the Workday business object's own rules (Workday side), and the Connect AI connection's readonly setting (CData side). When a write fails with a permissions error, check both.

## Workday-Specific Conventions

- **Never guess `_Prompt` GUIDs.** They are tenant-specific and not human-readable. Always resolve via the matching value table.
- **Prompt lookup chains can be 3+ levels deep.** A value table for one prompt may itself require a prompt sourced elsewhere. Plan backward from the target.
- **Date and boolean prompts take literals**, not GUIDs (e.g., `FromDate_Prompt` = `'2024-01-01'`, `includeSubordinateOrganizations_Prompt` = `1`).
- **Value-table hierarchies terminate at NULL `CollectionToken`.** Drill via `Collection_Prompt` until the token is NULL, then use that row's `Id`.
- **For WQL: prefer Prism (`cds_`) over Core.** Prism uses dedicated infrastructure; Core shares tenant resources and can degrade Workday for other users on heavy queries.
- **WQL Core sources still use `_Prompt` columns** (often named `*Parms`). Only Prism is prompt-free.
- **WQL exposes only one filter per data source.** For additional filters, enable `UseSplitTables` to fan the source into joinable narrower views.
- **WQL reference fields surface as paired `<entity>.descriptor` and `<entity>.id`** dotted columns — quote with `[]` (e.g., `[employee.id]`).
- **WQL column names mix conventions:** camelCase (`checkDt`), snake_case-with-caps (`hire_Date`), and a triple-underscore (`___`) separator for hyphens/dashes in the original field (`cost_Center___ID`, `location___Name`). Always `getColumns` first.
- **Reports column names** often contain dots and spaces — always quote with `[]`.
- **`Id` push-down depends on entity category** (base = fast; child = client-side after full fetch). For child entities, filter on the parent `Id` instead.
- **Change resources use a strict Begin/Submit pair** — neither stands alone.
