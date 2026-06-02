---
name: connect-ai-bullhorncrm
description: Use when querying Bullhorn CRM data through CData Connect AI. Covers the Bullhorn data model (Candidates, ClientCorporations, JobOrders, JobSubmissions, Placements), recruiting query patterns, file-attachment stored procedures, edit-history tables, and Bullhorn-specific conventions (mixed FK casing, special-character column names, soft-delete and permission patterns). Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: BullhornCRM
  family: crm
---

# CData Connect AI — Bullhorn CRM Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Bullhorn CRM-specific guidance for querying Bullhorn data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the BullhornCRM driver. Do not call `getInstructions` for BullhornCRM — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Bullhorn connection via `getCatalogs`.

## Schema

BullhornCRM is a single-schema driver. The schema name is `BullhornCRM`.

```sql
SELECT [ID], [FirstName], [LastName], [Status]
FROM [YourBullhornConnection].[BullhornCRM].[Candidate]
LIMIT 100
```

## Query Process

Bullhorn is a recruitment-centric relational model built around three core entities: Candidates, JobOrders, and Placements. Most analyses start with one of these and join outward.

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'BullhornCRM'`.
2. **Pick the core entity** — Candidate for talent/pipeline questions, JobOrder for open-role/client-demand questions, Placement for hires/revenue questions.
3. **Inspect columns** — call `getColumns` on the chosen entity before writing queries. Bullhorn instances are heavily customized; do not assume the schema matches Bullhorn UI labels.
4. **Sample first** — run a `SELECT * … LIMIT 5` to validate structure and value formats (status fields are string picklists; valid values vary by tenant).
5. **Filter on date columns** — `DateAdded` and `DateLastModified` exist on most major entities; always include a date predicate when result sets could be large.
6. **Join outward incrementally** — JobSubmission links Candidate ↔ JobOrder; Placement represents successful hires. Validate each join with a small LIMIT before adding the next.

## Data Model

### Key Tables

Bullhorn's data model centers on the recruiting lifecycle:

- **Candidate** — Primary recruiting entity (people in the talent pool).
- **ClientCorporation** — Companies / clients. Supports parent-child hierarchies via `ParentCompanyid`.
- **ClientContact** — People who work at client companies; linked to `ClientCorporation` via `Companyid`.
- **JobOrder** — Open job requisitions (may also be referred to as job listings).
- **JobSubmission** — Many-to-many link between Candidate and JobOrder; tracks who was submitted for which role and the submission status.
- **Placement** — A successful hire; one Placement represents a candidate placed into a JobOrder. Carries direct FKs to both the JobOrder (`Jobid`) and the client company (`Companyid`).

### Activity Tables

- **Task**, **Appointment**, **Sendout**, **Tearsheet** — Activity tracking.
- **Note** — Email content is **not** exposed via the Bullhorn API by default. If the customer routes emails through Bullhorn Automation, those emails populate the `Note` table and can be queried there.

### Payroll & Financial Tables

- **PayCheck**, **EmployeePay**, **Deduction** — Payroll records.
- **PlacementCommission** — Commission attributable to a Placement.
- **JobOrderRateCard**, **PlacementRateCard** — Rate cards (billing/pay rates per job or placement).

### History (Edit) Tables

For auditing field-level changes:

- **CandidateEditHistory**
- **JobOrderEditHistory**
- **PlacementEditHistory**
- **ClientCorporationEditHistory**

These tables can be very large. Always include filters (entity ID + date range) before querying.

### Key Relationships

| Child table | Join column | Parent table |
|---|---|---|
| ClientContact | `Companyid` | ClientCorporation |
| ClientCorporation | `ParentCompanyid` | ClientCorporation (self — company hierarchy) |
| JobOrder | `ClientCompanyid` | ClientCorporation |
| JobOrder | `Contactid` | ClientContact |
| JobSubmission | `Candidateid` | Candidate |
| JobSubmission | `Jobid` | JobOrder |
| Placement | `Candidateid` | Candidate |
| Placement | `Jobid` | JobOrder |
| Placement | `Companyid` | ClientCorporation (direct, not only via JobOrder) |

## Important Columns

### Candidate

- `ID` — Primary key (numeric)
- `FirstName`, `LastName`, `Name` — `Name` is a derived/display field; write `FirstName` / `LastName` separately
- `Status` — String picklist (e.g., Active, Inactive, Placed)
- `DateAdded`, `DateLastModified` — Timestamps for incremental queries
- `Email1`, `Email2`, `Email3`, `MobilePhone`, `WorkPhone` — Contact fields
- `CurrentCompany` — Most recent employer (text)
- `YearsExperience`, `DesiredSalary`, `DesiredPayRate`
- `OwnerCorporationid` — FK to ClientCorporation (the owning agency)
- `BranchID` — FK to Branch (note: uppercase `ID`, not the typical lowercase `id`)
- `IsDeleted` — Soft-delete flag; filter to `false` for active records
- `IsAnonymized` — GDPR/privacy flag

### ClientCorporation

- `ID` — Primary key
- `CompanyName`
- `Status`, `Type`
- `DateAdded`, `DateLastModified`
- `MainPhone`, `BillingPhone`, `Fax`
- `ParentCompanyid` — Self-referential FK for company hierarchy
- `BranchID` — Uppercase `ID` (FK casing exception, see Conventions)
- `AnnualRevenue(Millions)`, `Sector`, `BusinessSectors`, `NetTerms`
- *No `IsDeleted` column* — ClientCorporation does not expose soft-delete

### ClientContact

- `ID`
- `FirstName`, `LastName`, `Name`
- `Companyid` — FK to `ClientCorporation.ID`
- `Email1`, `Email2`, `Email3`, `DirectPhone`, `MobilePhone`
- `Title`, `Department`, `Office`
- `Ownerid` — FK to the user who owns the contact
- `Reportstoid` — Self-referential FK (reporting hierarchy)
- `Status`
- `IsDeleted` — Soft-delete flag
- `IsDefaultContact` — Whether this contact is the default for the company
- `DateAdded`, `DateLastModified`

### JobOrder

- `ID`
- `JobTitle`
- `Status` — **String picklist** (e.g., Open, Closed, Accepting Candidates) — distinct from `Open/Closed` below
- `Open/Closed` — **BOOLEAN column** (literal name, slash included) — separate from `Status`. JobOrder has both, and they don't necessarily move together. Always quote with `[]` to escape the slash: `[Open/Closed]`
- `ClientCompanyid` — FK to `ClientCorporation.ID`
- `Contactid` — FK to `ClientContact.ID` (primary contact for the requisition)
- `DateAdded`, `DateClosed`, `DateLastPublished`, `LastUpdated`
- `Ownerid` — User who owns the requisition
- `Branch`, `BranchID` (uppercase `ID`)
- `EmploymentType`, `StartDate`, `EstimatedEndDate`, `ScheduledEnd`
- `Locationid` — FK to Location
- `#ofOpenings` — Literal column name (use `[#ofOpenings]`)
- `SalaryLow`, `SalaryHigh`, `PayRate`, `ClientBillRate`, `Mark-up%`
- `JobDescription`, `JobPostingURL`
- `IsDeleted`

### JobSubmission

- `ID` — Primary key
- `Candidateid` — FK to `Candidate.ID`
- `Jobid` — FK to `JobOrder.ID`
- `Status` — Submission stage (e.g., Submitted, Client Interview, Rejected)
- `DateAdded`, `DateLastModified`, `DateWebResponse`
- `StartDate`, `EndDate`
- `BillRate`, `PayRate`, `Salary`
- `AddedByid` — FK to user who created the submission
- `Source`, `Comments`
- `IsDeleted`, `IsHidden`
- Screening columns: `ScreeningStatus`, `ScreeningScore`, `ScreeningFeedbackRating`, `ScreeningCompletedDate`

### Placement

- `ID` — Primary key
- `Candidateid` — FK to `Candidate.ID`
- `Jobid` — FK to `JobOrder.ID`
- `Companyid` — FK to `ClientCorporation.ID` (direct, not only via JobOrder)
- `Contactid`, `BillingContactid`, `ApprovingClientContactid` — Various contact references
- `StartDate`, `ScheduledEnd`, `EstimatedEndDate`, `EmploymentStartDate`, `EffectiveDate`, `DocumentDeadline`
- `Status`
- `Salary`, `BillRate`, `PayRate`, `OvertimeBillRate`, `OvertimePayRate`, `DoubletimeBillRate`, `DoubletimePayRate`
- `PlacementFee(%)`, `PlacementFee(Flat)`, `Mark-up%`, `OTMark-up%`
- `EmploymentType`, `EmployeeType`, `TerminationReason`
- `DateAdded`, `DateLastModified`

## Common Query Patterns

### Recently added candidates

```sql
SELECT [ID], [FirstName], [LastName], [Status], [DateAdded]
FROM [YourConnection].[BullhornCRM].[Candidate]
WHERE [IsDeleted] = false
  AND [DateAdded] >= DATEADD(day, -30, GETDATE())
ORDER BY [DateAdded] DESC
LIMIT 50
```

### Candidates submitted to a specific job

```sql
SELECT c.[FirstName], c.[LastName], js.[Status], js.[DateAdded]
FROM [YourConnection].[BullhornCRM].[JobSubmission] js
JOIN [YourConnection].[BullhornCRM].[Candidate] c
  ON js.[Candidateid] = c.[ID]
WHERE js.[Jobid] = 12345
ORDER BY js.[DateAdded] DESC
```

### Active placements with candidate names

```sql
SELECT p.[ID], c.[FirstName], c.[LastName], p.[StartDate], p.[Status], p.[BillRate]
FROM [YourConnection].[BullhornCRM].[Placement] p
JOIN [YourConnection].[BullhornCRM].[Candidate] c
  ON p.[Candidateid] = c.[ID]
WHERE p.[Status] = 'Active'
ORDER BY p.[StartDate] DESC
```

### Open job orders (using either Status or Open/Closed)

```sql
-- By Status picklist
SELECT [ID], [JobTitle], [Status], [DateAdded]
FROM [YourConnection].[BullhornCRM].[JobOrder]
WHERE [Status] = 'Open'
  AND [IsDeleted] = false
ORDER BY [DateAdded] DESC

-- Or by the boolean Open/Closed column (slash in the name requires brackets)
SELECT [ID], [JobTitle], [Status], [Open/Closed]
FROM [YourConnection].[BullhornCRM].[JobOrder]
WHERE [Open/Closed] = true
  AND [IsDeleted] = false
```

### Recruiting funnel: JobOrder → JobSubmission → Candidate → Placement

```sql
SELECT jo.[JobTitle], jo.[Status] AS JobStatus,
       js.[Status] AS SubmissionStatus,
       c.[FirstName], c.[LastName],
       p.[ID] AS PlacementID, p.[StartDate]
FROM [YourConnection].[BullhornCRM].[JobOrder] jo
LEFT JOIN [YourConnection].[BullhornCRM].[JobSubmission] js ON js.[Jobid] = jo.[ID]
LEFT JOIN [YourConnection].[BullhornCRM].[Candidate] c ON js.[Candidateid] = c.[ID]
LEFT JOIN [YourConnection].[BullhornCRM].[Placement] p
       ON p.[Candidateid] = c.[ID] AND p.[Jobid] = jo.[ID]
WHERE jo.[DateAdded] >= '2025-01-01'
ORDER BY jo.[DateAdded] DESC
LIMIT 100
```

### Client revenue rollup (Placement × ClientCorporation)

```sql
SELECT cc.[CompanyName],
       COUNT(p.[ID]) AS Placements,
       SUM(p.[BillRate]) AS TotalBillRate
FROM [YourConnection].[BullhornCRM].[Placement] p
JOIN [YourConnection].[BullhornCRM].[ClientCorporation] cc ON p.[Companyid] = cc.[ID]
WHERE p.[StartDate] >= '2025-01-01'
GROUP BY cc.[CompanyName]
ORDER BY TotalBillRate DESC
```

### Candidate pipeline by submission status

```sql
SELECT js.[Status], COUNT(*) AS CandidateCount
FROM [YourConnection].[BullhornCRM].[JobSubmission] js
WHERE js.[DateAdded] >= '2025-01-01'
GROUP BY js.[Status]
ORDER BY CandidateCount DESC
```

## Stored Procedures

The BullhornCRM driver exposes file-attachment procedures: `DownloadFile` and `UploadFile`. Both involve disk-based or stream-based parameters and have specific cloud-compatibility caveats.

### DownloadFile

Downloads a file attached to a specified Bullhorn entity.

| Parameter | Required | Notes |
|---|---|---|
| `EntityType` | Yes | The Bullhorn entity type (e.g., `Candidate`, `JobOrder`) |
| `EntityId` | Yes | The ID of the entity that owns the file |
| `FileId` | Yes | The ID of the specific file to download |
| `OutputFolder` | No | Disk path to write the file. **Omit in cloud environments** — disk write fails. |
| `FileStream` | No | Stream-based delivery. **Omit in cloud environments** — InputStream/OutputStream parameters cannot be passed through MCP. |

**Cloud-compatible call shape** — omit both `OutputFolder` and `FileStream`; the response should contain file content as base64. Matches the established CData download pattern across drivers but has not been empirically verified for BullhornCRM specifically; validate before relying on it in production.

```json
{
  "catalogName": "YourBullhornConnection",
  "schemaName": "BullhornCRM",
  "procedureName": "DownloadFile",
  "parameters": {
    "EntityType": "Candidate",
    "EntityId": "12345",
    "FileId": "67890"
  }
}
```

### UploadFile

Uploads a file and attaches it to a Bullhorn entity.

| Parameter | Required | Notes |
|---|---|---|
| `EntityType` | Yes | The entity type to attach to |
| `EntityId` | Yes | The entity ID |
| `ExternalId` | Yes | External reference ID for the file |
| `FileLocation` | No | Disk path. **Fails in cloud environments** — no disk access. |
| `Content` | No | Described as input-stream content; typed `VARCHAR`. Cloud support via base64 string is **unconfirmed** for BullhornCRM. |
| `FileName` | No | Required when `Content` is provided. |
| `ContentType`, `Description`, `Type` | No | Metadata. |

**Cloud status: currently requires validation.** Across CData drivers historically, upload procedures have been non-functional in cloud environments because they expect a Java `InputStream` rather than a base64 string. The driver may have been updated to accept base64 in `Content`, but this hasn't been verified for BullhornCRM. Do not document a working call pattern until tested on a live tenant.

## Write Operations

The BullhornCRM driver supports a limited set of writes — the most common are `INSERT INTO Candidate` and `UPDATE JobOrder`. Other tables may or may not be writable; check the column-level `Readonly` flag via `getColumns` (`Readonly=false` means writable) and test in a sandbox before relying on it.

### INSERT example

```sql
INSERT INTO [YourConnection].[BullhornCRM].[Candidate]
  ([FirstName], [LastName], [Email1], [Status])
VALUES
  ('Jane', 'Smith', 'jane@example.com', 'Active')
```

### UPDATE example

```sql
UPDATE [YourConnection].[BullhornCRM].[JobOrder]
SET [Status] = 'Closed', [Open/Closed] = false
WHERE [ID] = 12345
```

Write access is controlled by **two layers**: the Connect AI connection's readonly setting (CData side) and the authenticated Bullhorn API user's permissions (Bullhorn side). If a write fails, check both.

## Bullhorn-Specific Conventions

- **FK column casing is mixed, not uniform.** Most FK columns use a lowercase `id` suffix (`Candidateid`, `Jobid`, `Companyid`, `ClientCompanyid`, `Ownerid`, `Contactid`, `Reportstoid`, `AddedByid`, `Categoryid`, `ParentCompanyid`), but several use uppercase `ID`: `BranchID`, `MasterUserID`, `ClientContactID`. `ExternalID` is an external/legacy reference, not a true FK. Always confirm casing with `getColumns` before joining — Bullhorn does not have a single consistent rule.
- **Primary keys are always uppercase `ID`.** Only FK columns vary; the table's own primary key is consistently `ID`.
- **Column names commonly contain special characters.** Slashes (`Open/Closed`, `Culture/Perks`), hashes (`#ofOpenings`), percent signs (`Mark-up%`, `Tax%`, `PlacementFee(%)`), parentheses (`Reportingto(contact)id`, `WillRelocate?`), question marks. `[]` quoting is **required**, not stylistic. Plain identifiers will fail to parse on many columns.
- **`JobOrder.Status` and `JobOrder.[Open/Closed]` are distinct fields.** `Status` is a `VARCHAR` picklist (Open / Closed / Accepting Candidates / etc.); `[Open/Closed]` is a separate `BOOLEAN`. They don't necessarily move together in legacy data — check both for "is this job open?" questions, and confirm which one the user means.
- **Status fields are string picklists, not numeric codes.** Filter with literal strings (`'Active'`, `'Open'`, `'Submitted'`). Picklist values differ by Bullhorn configuration; confirm with `SELECT DISTINCT [Status] FROM <table>`.
- **`IsDeleted` is present on most transactional tables but NOT on ClientCorporation.** Candidate, ClientContact, JobOrder, JobSubmission, and Placement all expose `IsDeleted` and should be filtered to `false` for active queries. ClientCorporation does not have this column.
- **History tables are append-only and very large.** `CandidateEditHistory`, `JobOrderEditHistory`, `PlacementEditHistory`, `ClientCorporationEditHistory` track every field change. Always filter on entity ID and a date range.
- **Custom fields are pervasive and use mixed casing.** Bullhorn tenants are heavily customized — every entity has many `customText`, `customInt`, `customFloat`, `customDate`, `customTextBlock` slots. Casing of the first letter varies within the same table (e.g., `customDate1` vs `CustomDate10`); always confirm exact names via `getColumns`. Encrypted custom fields (`CustomEncryptedText1` through `CustomEncryptedText10`) exist on Candidate and Placement for PII data.
- **`Note` table is sparse without Bullhorn Automation.** Email content is not in `Note` by default — only present when the tenant uses Bullhorn Automation to ingest emails.
- **Permission errors return HTTP 403 with "No read rights".** If a query against an entire entity returns 403 / "No read rights", the API user lacks read scope for that object; route the user to their Bullhorn administrator. If only specific fields return errors (e.g., "No read rights. Shift" on JobOrder), drop those fields from the SELECT and re-run.
- **Use `DateAdded` for incremental loads.** It's monotonically increasing and exists on every transactional entity. `DateLastModified` is also available where mutations are common.
- **Join on numeric `ID` / `id` columns, not names.** `CompanyName`, `JobTitle`, candidate names are not guaranteed unique.
- **File procedures need cloud-compat validation.** `DownloadFile` should work in cloud when `OutputFolder` and `FileStream` are both omitted (returns base64 in response per the established pattern); `UploadFile` is likely non-functional in cloud until base64 string input is confirmed working. Test before relying on either.
