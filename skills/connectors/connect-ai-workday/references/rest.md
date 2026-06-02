# Workday REST Connection Reference

> Connection type: `ConnectionType = REST`. The Workday REST API — the most common configuration. Supports inserts, updates, and limited deletes.
>
> Load this reference when the live connection's `getSchemas` returns **functional-area schemas** (e.g., `Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`) rather than a single `WQL` / `Reports` / `SOAP` schema. See the base [SKILL.md](../SKILL.md) for connection-type identification.

## Schema partitioning (empirical)

REST connections do **not** expose a single `REST` schema. Instead the driver partitions REST tables across **multiple functional-area schemas** named after Workday modules — e.g., `Common`, `Procurement`, `Recruiting`, `Staffing`, `HelpCase`, `Payroll`, `Connect`.

The CData docs don't formally describe how REST tables are organized into schemas. **The exact set varies by tenant** — a tenant without Workday Student won't see `Student*` schemas, one without Financials won't see `CoreAccounting` / `AccountsPayable` / `Revenue`, etc. Table-to-schema mappings are also driver-version-dependent. **Always run `getSchemas` and `getTables` on the live connection before writing queries.**

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
```

## Query Process

The REST connection requires a Workday-specific workflow built around **prompt columns** and **value tables**. Most non-trivial REST queries cannot be issued directly — they require resolving one or more Workday-internal GUIDs first.

1. **Locate the schema** for the target table on the live connection. Start with `getSchemas` to see which functional-area schemas the tenant exposes; then call `getTables` with a `tableName` LIKE filter to find the table. The table-locations table above is a starting hint, not a guarantee — actual locations vary by tenant.
2. **Inspect with `getColumns`** on `[catalog].[schema].[table]` and find any `_Prompt` columns. Some are required, some optional. Required prompts typically scope to a date range or parent ID.
3. **For each required `_Prompt`, resolve the GUID via the matching value table** (ends in `Values`, lives in the same schema). See [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables).
4. **Chains may be multi-level** — a value table may itself require a `_Prompt`. Resolve backward from the target.
5. **Execute the target query** with literal GUIDs or date strings in `yyyy-mm-dd` format.

## Data Model

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

### Prompt Columns (REST entity categories)

> The generic prompt-column and value-table mechanics — `_Prompt` semantics, literal date/boolean prompts, never-guess-GUIDs, value-table structure, and hierarchical navigation — are documented once in the base [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables), since they also apply to WQL Core sources. This section covers only what REST adds on top.

On REST, **which prompts an entity exposes follows its entity category** (see [Entity Type Categories](#entity-type-categories) above):

- **Base** — own prompts only
- **Child** — parent's prompts
- **Owned** — own + owner's prompts
- **Owned child** — parent's + owner's prompts

Value tables for REST prompts live in the **same functional-area schema** as the target table and end in `Values`.

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

**Single value changes** modify one record directly. **Collection changes** modify multiple related records — use `CollectionToken` for iterative navigation. See [Stored Procedures](#stored-procedures) for the Begin/Submit pairing details.

## Important Columns by Schema

Non-obvious columns for the headline entities. Self-explanatory columns (`Id`, `Title`, `StartDate`, etc.) and timestamps are omitted — discover them with `getColumns`. Treat the `Workers` and `Jobs` lists as **illustrative**: bare top-level `Workers`/`Jobs` tables were not present on the validation tenant.

### Common

#### Organizations

- `OrganizationType_Prompt` — **required** classification filter
- `Href` — direct URL to the org in Workday

#### Workers *(tenant-dependent)*

Bare top-level `Workers` was not present on the validation tenant; `Workers*` views appeared in `Common` and `Staffing`. Columns below are illustrative.

- `WorkerId` — employee or contingent-worker ID (distinct from `Id`)
- `WorkerType_Descriptor` — employee, contingent worker, etc.
- `Person_Email`, `Person_Phone`
- `PrimaryJob_BusinessTitle`, `PrimaryJob_JobProfile_Descriptor`, `PrimaryJob_Location_Descriptor`, `PrimaryJob_SupervisoryOrganization_Descriptor`
- `IncludeTerminatedWorkers_Prompt` — set to `0` for active workers only

### Procurement

#### Requisitions

- `Status_Descriptor` — open, approved, canceled, etc.
- `Amount_Value`, `Amount_Currency`, `FormattedAmount`
- `Requester_Descriptor`, `RequisitionType_Descriptor`, `Submitter_Descriptor`, `SourcingBuyer_Descriptor`
- `HighPriority` — `1` if marked high priority
- `Memo`, `InternalMemo`
- **Prompts:** `FromDate_Prompt`, `ToDate_Prompt`, `Requester_Prompt`, `RequisitionType_Prompt`, `SubmittedBy_Prompt`, `SubmittedByPerson_Prompt`, `SubmittedBySupplier_Prompt`

### Recruiting

#### JobPostings

- `JobDescription`
- `Company_Descriptor`
- `JobType_Descriptor`, `TimeType_Descriptor`, `RemoteType_Name`
- `PrimaryLocation_Descriptor` (+ `_Country_Descriptor`, `_Region_Descriptor`)
- `JobSite_Descriptor`, `SpotlightJob`
- `Url` — external career-site URL

### Staffing

#### JobProfiles

- `DefaultJobTitle`, `Summary`, `JobDescription`, `AdditionalJobDescription`
- `JobCategory_Descriptor`, `JobLevel_Descriptor`, `ManagementLevel_Descriptor`
- `CriticalJob`, `DifficultyToFill_Descriptor`
- `Public`, `Inactive`, `WorkShiftRequired`

#### Jobs *(tenant-dependent)*

Bare top-level `Jobs` was not present on the validation tenant. Columns below are illustrative.

- `BusinessTitle` — may differ from job profile title
- `JobType_Descriptor` — full-time, part-time, contract
- `Worker_Descriptor`, `Worker_Id` — current incumbent
- `SupervisoryOrganization_Descriptor`
- `NextPayPeriodStartDate`

### HelpCase

#### Cases

- `CaseID` — human-readable case ID
- `Status_Descriptor`, `Type_Name`
- `About_Descriptor` — subject (person/entity involved)
- `Assignee_Descriptor`, `By_Descriptor`, `ServiceTeam_Descriptor`
- `DetailedMessage`, `Confidential`, `CaseLink`
- **Prompts:** `MyCases_Prompt`, `OpenCases_Prompt`, `Status_Prompt`, `Substatus_Prompt`, `Team_Prompt`, `Flag_Prompt`, `Label_Prompt`, `Sort_Prompt` / `Desc_Prompt`

## Common Query Patterns

### Recent job postings (Recruiting)

```sql
SELECT [Id], [Title], [StartDate], [EndDate], [PrimaryLocation_Descriptor],
       [JobType_Descriptor], [TimeType_Descriptor], [Company_Descriptor]
FROM [YourConnection].[Recruiting].[JobPostings]
WHERE [StartDate] >= '2024-01-01'
ORDER BY [StartDate] DESC
```

### Requisitions within a date range (Procurement)

```sql
SELECT [Id], [Descriptor], [RequisitionType_Descriptor],
       [Requester_Descriptor], [Amount_Value], [Amount_Currency],
       [RequisitionDate], [Status_Descriptor]
FROM [YourConnection].[Procurement].[Requisitions]
WHERE [FromDate_Prompt] = '2020-01-01'
  AND [ToDate_Prompt] = '2021-12-31'
ORDER BY [RequisitionDate] DESC
```

`FromDate_Prompt` / `ToDate_Prompt` accept literal dates in `yyyy-mm-dd` format (verified on the live driver).

### Organizations of a specific type (Common)

```sql
SELECT [Id], [Descriptor], [Href]
FROM [YourConnection].[Common].[Organizations]
WHERE [OrganizationType_Prompt] = '<organization_type_GUID>'
```

`OrganizationType_Prompt` is required — resolve via the matching `*OrganizationType*Values` table.

### Open cases assigned to me (HelpCase)

```sql
SELECT [Id], [CaseID], [Title], [CreationDate], [Status_Descriptor],
       [Type_Name], [About_Descriptor], [Assignee_Descriptor]
FROM [YourConnection].[HelpCase].[Cases]
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
FROM [YourConnection].[CoreAccounting].[journalLines]
WHERE [company_Prompt] = '<from_step_1>'
  AND [year_Prompt] = '<from_step_2>'
  AND [journalEntryStatus_Prompt] = '<from_step_2>'
  AND [entryMomentFrom_Prompt] = '2017-01-01'
  AND [entryMomentTo_Prompt] = '2017-06-01'
LIMIT 10
```

## Stored Procedures

Procedures on the Workday REST connection share a flat global namespace. On the validation tenant, `getProcedures` returns the same complete procedure list regardless of which functional-area schema is passed, and `executeProcedure` routes calls to Workday based on procedure name alone — the schema parameter is required by the driver but does not partition the procedure namespace. This was verified across multiple schemas including ones with no logical relationship to the procedure being called.

Practical implications:
- You can call any business-process procedure under any valid schema (`Staffing`, `Procurement`, `Common`, etc.) and the lookup will succeed. The schema is required by the tool signature but functionally decorative.
- Tables do not share this behavior — table schema membership is real and must be discovered with `getTables`. Only procedures are schema-promiscuous.
- For readability, prefer the schema closest to the procedure's domain: `Staffing` for worker-lifecycle procedures (Begin/SubmitJobChange, WorkersRequestTimeOff, organization-assignment changes), `Procurement` for requisition procedures (RequisitionsCancel, RequisitionsClose), `Common` for cross-cutting procedures (SendMessage). This is convention, not enforcement.

Caveat: this flat-namespace behavior is empirically observed on one validation tenant. Whether it holds across all Workday tenants and driver versions has not been confirmed.

Representative business-process procedures (call under any schema):

- `BeginJobChange` / `SubmitJobChange`
- `BeginOrganizationAssignmentChange` / `SubmitOrganizationAssignmentChange`
- `WorkersRequestTimeOff`
- `Begin/SubmitHomeContactInformationChange`, `Begin/SubmitWorkContactInformationChange`
- `WorkersRequestOneTimePayment`, `WorkersOrganizationAssignmentChanges`
- `RequisitionsCancel`, `RequisitionsClose`

Run `getProcedures` for the full list (any valid schema works).

`Begin*` / `Submit*` are always called in pairs — `Begin*` returns the change ID via the generic `Id` output column; `Submit*` then consumes it as `<ChangeName>_Id` (e.g., `SubmitJobChange` takes `JobChange_Id`, **not** `Id`). The naming convention likely generalizes to other `Submit*` procedures (`SubmitHire`, `SubmitTermination`, etc.), though only `SubmitJobChange` is empirically confirmed. Don't call `Submit*` without `Begin*`, and don't forget `Submit*` after applying changes (otherwise the change isn't committed to Workday).

### SendMessage (Common schema)

`SendMessage` follows the flat-namespace behavior described above — it is reachable from every valid schema. Use `Common` as the conventional call site (it matches existing skill posture and is the most domain-appropriate location for a cross-cutting messaging procedure):

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

### Error code legend (observed on validation tenant)

`executeProcedure` failures surface error codes from four distinct layers. Stable prefixes (observed on one tenant; not confirmed as universal):

| Code prefix | Layer | Trigger | Example message |
|---|---|---|---|
| `STMT RSB <name> is not a valid stored procedure` | CData driver (procedure resolution) | Procedure name doesn't exist | `STMT RSB <ThisIsNotARealProcedure> is not a valid stored procedure.` |
| `STMT SQL [60003]` | CData driver (input validation) | Required input parameter missing or empty | `STMT SQL [60003] The input [Requisitions_Id] must have a value to execute the [RequisitionsCancel] procedure.` |
| `STMT HTTP [40002] [S22] permission denied` | Workday API (authorization) | OAuth client lacks scope for the operation on this entity | `STMT HTTP [40002] [S22] permission denied.` |
| `STMT HTTP [40006] [S21] not found: <X>` | Workday API (entity resolution) | GUID malformed, nonexistent, or resolves to wrong entity type for the endpoint | `STMT HTTP [40006] [S21] not found: 00000000000000000000000000000000.` |

Distinguish driver-layer errors from Workday-layer errors when debugging:
- `STMT RSB` and `STMT SQL [60003]` mean the call never reached Workday — fix the procedure name or parameter set and retry.
- `STMT HTTP [40002]` and `STMT HTTP [40006]` mean Workday received the call and rejected it — fix the GUID, entity-type match, or OAuth client scope, not the call shape.

## Write Operations

REST connections support writes where the underlying Workday API allows it; **WQL and Reports are read-only by design** and cannot be made writable.

- **Insert** — supported on base/owned entities where the Workday API permits creation. Supply all Workday-mandatory fields; respect parent/owner dependencies.
- **Update** — must include `Id`. Child/owned entities require their compound keys. Prompt columns may be required depending on entity type.
- **Delete** — many entities cannot be deleted directly; use the change-resource pattern (Begin/Submit) instead.

**Two layers control write access:** the Workday business object's own rules (Workday side), and the Connect AI connection's read-only setting (CData side). When a write fails with a permissions error, check both.

## REST-Specific Conventions

> Prompt-column and value-table conventions (never guess GUIDs, literal date/boolean prompts, multi-level lookup chains, NULL `CollectionToken` = leaf) are shared across connection types and live in [SKILL.md → Prompt columns & value tables](../SKILL.md#prompt-columns--value-tables). The conventions below are REST-only.

- **Prompt inheritance follows entity category** (Base / Child / Owned / Owned child) — see [Prompt Columns (REST entity categories)](#prompt-columns-rest-entity-categories). Value tables for REST prompts live in the same functional-area schema as the target.
- **`Id` push-down depends on entity category** (base = fast; child = client-side after full fetch). For child entities, filter on the parent `Id` instead.
- **Change resources use a strict Begin/Submit pair** — neither stands alone.
- **Procedures share a flat namespace; tables don't.** On the Workday REST driver (observed on the validation tenant), `getProcedures`, `getProcedureParameters`, and `executeProcedure` all ignore the schema parameter for procedure resolution — any valid schema name works. Tables behave normally and require correct schema membership. Don't trust `getProcedures` schema-filtered output to indicate where a procedure "lives"; use it for procedure discovery (by name pattern) rather than schema-membership inference.
- **Driver `Required=false` on procedure parameters is often misleading.** Both the CData driver and Workday business-process rules may reject calls that omit parameters reported as `Required=false`. The CData driver surfaces these as `STMT SQL [60003] The input [X] must have a value...` errors before the call leaves the driver; Workday business-process rules surface as `STMT HTTP [40006] [S21] not found: ...` or `STMT HTTP [40002] [S22] permission denied`. In either case the operative rule is the same: treat any parameter named in a procedure's primary semantics — the ID of the entity being acted on, reason codes for state changes, comments for business-process steps — as functionally required regardless of metadata. Observed cases: `RequisitionsCancel` (`Comments`, `ReasonCode_Id`), `BeginJobChange` (`Worker_Id`, `Date`, `Reason_Id`), `SubmitJobChange`.
