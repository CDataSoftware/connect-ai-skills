---
name: connect-ai-salesforce
description: Use when querying Salesforce data through CData Connect AI. Covers the Salesforce data model, query patterns, stored procedures, and Salesforce-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.1"
  connector: Salesforce
  family: crm
---

# CData Connect AI — Salesforce Skill

## ⚠ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Salesforce-specific guidance for querying Salesforce data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Salesforce driver. Do not call `getInstructions` for Salesforce — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Salesforce connection via `getCatalogs`.

## Schema

Salesforce is a single-schema driver. The schema name is `Salesforce`.

```sql
SELECT * FROM [MySalesforceConnection].[Salesforce].[Account] LIMIT 5
```

## Query Process

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'Salesforce'`.
2. **Locate the object** — use `getTables` to find the right Salesforce object. For custom objects, use `tableName: "%__c"`.
3. **Inspect columns** — call `getColumns` before writing any query. For picklist fields, query `PickListValues` to get valid values (see Conventions).
4. **Sample first** — run a `SELECT * … LIMIT 5` to validate structure and values before building complex queries.
5. **Filter on date columns** — Salesforce queries over large objects will time out without date filters; always add a `CreatedDate` or `LastModifiedDate` predicate when the result set could be large.
6. **Add JOINs and aggregations incrementally** — validate each join step before adding the next.

### Fallback when getTables or getProcedures are unavailable

If `getTables` or `getProcedures` are not available (disabled at the connection level or not exposed by the current tool surface), query the system catalog tables directly via `queryData`:

```sql
-- List all tables
SELECT [TableName], [TableType] FROM [MySalesforceConnection].[Salesforce].[sys_tables] ORDER BY [TableName]

-- List all stored procedures
SELECT [ProcedureName] FROM [MySalesforceConnection].[Salesforce].[sys_procedures] ORDER BY [ProcedureName]

-- List custom objects only
SELECT [TableName] FROM [MySalesforceConnection].[Salesforce].[sys_tables] WHERE [TableName] LIKE '%__c' ORDER BY [TableName]
```

These system tables are always available via `queryData` regardless of which discovery tools are enabled.

## Data Model

### Key Tables

- **Account** — Organizations and companies; the central entity most other objects relate to.
- **Contact** — Individual people, linked to Accounts via `AccountId`.
- **Lead** — Unqualified prospects; separate from Contacts until converted via `ConvertLead`.
- **Opportunity** — Sales deals and pipeline; linked to Accounts and optionally Contacts.
- **Case** — Customer service and support tickets; linked to Accounts and Contacts.
- **Campaign** — Marketing campaigns; tracks members, responses, and revenue attribution.
- **PickListValues** — Virtual table exposing all picklist field values for any Salesforce object. Filter by `TableName` and optionally `ColumnName`.

### Custom Objects and Fields

Salesforce orgs frequently contain custom objects and fields using the `__c` suffix:
- **Find custom objects**: call `getTables` with `tableName: "%__c"`
- **Find custom fields on a table**: call `getColumns` on any table and look for column names ending in `__c`

### Key Relationships

| Child table | Join column | Parent table |
|-------------|-------------|--------------|
| Contact | `AccountId` | Account |
| Opportunity | `AccountId` | Account |
| Case | `AccountId` | Account |
| Case | `ContactId` | Contact |
| Campaign | `ParentId` | Campaign (hierarchy) |

## Important Columns

### Account
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `Name` | VARCHAR | Account/company name |
| `Type` | VARCHAR | Picklist: Customer, Partner, Prospect, etc. |
| `Industry` | VARCHAR | Picklist field |
| `OwnerId` | VARCHAR | ID of the owning user |
| `ParentId` | VARCHAR | Parent account for hierarchies |
| `CreatedDate` | TIMESTAMP | Use for date-range filters |
| `LastModifiedDate` | TIMESTAMP | Use for incremental queries |
| `LastActivityDate` | DATE | Most recent logged activity |
| `BillingCity` / `BillingState` / `BillingCountry` | VARCHAR | Billing address parts |

### Contact
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `Name` | VARCHAR | Full name (readonly — write `FirstName` / `LastName` separately) |
| `FirstName`, `LastName` | VARCHAR | Writable name parts |
| `AccountId` | VARCHAR | Links Contact to Account |
| `Email` | VARCHAR | Primary email |
| `Title` | VARCHAR | Job title |
| `LastActivityDate` | DATE | Most recent logged activity |
| `ReportsToId` | VARCHAR | Contact hierarchy (manager) |
| `IsEmailBounced` | BOOLEAN | Email deliverability flag (readonly) |

### Opportunity
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `Name` | VARCHAR | Opportunity name |
| `AccountId` | VARCHAR | Links to Account |
| `StageName` | VARCHAR | Picklist: pipeline stage |
| `Amount` | DECIMAL | Deal value |
| `CloseDate` | DATE | Expected close date |
| `Probability` | DOUBLE | Likelihood to close (%) |
| `IsClosed` | BOOLEAN | Controlled by StageName (readonly) |
| `IsWon` | BOOLEAN | True for Closed Won (readonly) |
| `ForecastCategoryName` | VARCHAR | Forecast roll-up category |
| `LeadSource` | VARCHAR | Originating lead source |
| `ContactId` | VARCHAR | Primary contact on the deal |

### Lead
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `Name` | VARCHAR | Full name (readonly — write `FirstName` / `LastName` separately) |
| `Company` | VARCHAR | Required for Lead creation |
| `Status` | VARCHAR | Picklist: lead status |
| `LeadSource` | VARCHAR | Origin channel |
| `IsConverted` | BOOLEAN | True after ConvertLead |
| `ConvertedDate` | DATE | Date of conversion (readonly) |
| `ConvertedAccountId` | VARCHAR | Resulting Account (readonly) |
| `ConvertedContactId` | VARCHAR | Resulting Contact (readonly) |
| `ConvertedOpportunityId` | VARCHAR | Resulting Opportunity (readonly) |

### Case
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `CaseNumber` | VARCHAR | Auto-generated case number (readonly) |
| `AccountId` | VARCHAR | Links to Account |
| `ContactId` | VARCHAR | Links to Contact |
| `Status` | VARCHAR | Picklist |
| `Priority` | VARCHAR | Picklist |
| `Subject` | VARCHAR | Case title |
| `IsClosed` | BOOLEAN | True for closed cases (readonly) |
| `Origin` | VARCHAR | Channel: Email, Web, Phone |

### Campaign
| Column | Type | Notes |
|--------|------|-------|
| `Id` | VARCHAR | Primary key (readonly) |
| `Name` | VARCHAR | Campaign name |
| `Type` | VARCHAR | Picklist: campaign type |
| `Status` | VARCHAR | Picklist |
| `StartDate`, `EndDate` | DATE | Campaign date range |
| `NumberOfLeads` | INTEGER | Auto-maintained count (readonly) |
| `NumberOfOpportunities` | INTEGER | Auto-maintained count (readonly) |
| `AmountWonOpportunities` | DECIMAL | Revenue attributed (readonly) |

### PickListValues
| Column | Type | Notes |
|--------|------|-------|
| `TableName` | VARCHAR | Required filter: the Salesforce object name |
| `ColumnName` | VARCHAR | Optional filter: the field name |
| `PickList_Value` | VARCHAR | Internal API value (use this in WHERE clauses) |
| `PickList_Label` | VARCHAR | UI display label |
| `PickList_IsActive` | BOOLEAN | Whether value is currently selectable |
| `PickList_IsDefault` | BOOLEAN | Whether value is the default |

## Common Query Patterns

### Open opportunities for a specific account
```sql
SELECT [Name], [StageName], [Amount], [CloseDate], [Probability]
FROM [MySalesforceConnection].[Salesforce].[Opportunity]
WHERE [AccountId] IN (
  SELECT [Id]
  FROM [MySalesforceConnection].[Salesforce].[Account]
  WHERE [Name] LIKE '%Acme%'
)
AND [IsClosed] = 0
ORDER BY [CloseDate] ASC
```

### Contacts with recent activity
```sql
SELECT c.[Name], c.[Email], c.[Title], a.[Name] AS AccountName, c.[LastActivityDate]
FROM [MySalesforceConnection].[Salesforce].[Contact] c
LEFT JOIN [MySalesforceConnection].[Salesforce].[Account] a ON c.[AccountId] = a.[Id]
WHERE c.[LastActivityDate] >= '2024-01-01'
ORDER BY c.[LastActivityDate] DESC
LIMIT 20
```

### Pipeline summary by stage
```sql
SELECT [StageName], COUNT(*) AS OpportunityCount, SUM([Amount]) AS TotalAmount
FROM [MySalesforceConnection].[Salesforce].[Opportunity]
WHERE [IsClosed] = 0
AND [CloseDate] >= '2025-01-01'
GROUP BY [StageName]
ORDER BY TotalAmount DESC
```

### Unconverted leads by source
```sql
SELECT [FirstName], [LastName], [Company], [Email], [Status], [CreatedDate]
FROM [MySalesforceConnection].[Salesforce].[Lead]
WHERE [IsConverted] = 0
AND [LeadSource] = 'Web'
AND [CreatedDate] >= '2025-01-01'
ORDER BY [CreatedDate] DESC
```

### Accounts without any open opportunities (NOT EXISTS pattern)
```sql
SELECT [Id], [Name], [Industry], [LastActivityDate]
FROM [MySalesforceConnection].[Salesforce].[Account]
WHERE NOT EXISTS (
  SELECT 1 FROM [MySalesforceConnection].[Salesforce].[Opportunity] o
  WHERE o.[AccountId] = [Account].[Id] AND o.[IsClosed] = 0
)
AND [LastModifiedDate] >= '2025-01-01'
```

### Look up valid picklist values for a field
```sql
SELECT [PickList_Value], [PickList_Label], [PickList_IsDefault]
FROM [MySalesforceConnection].[Salesforce].[PickListValues]
WHERE [TableName] = 'Opportunity'
AND [ColumnName] = 'StageName'
AND [PickList_IsActive] = true
```

### Discover custom objects
Use `getTables` with a wildcard to list all custom objects in the org:
```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "tableName": "%__c"
}
```

## Stored Procedures

### ConvertLead
Converts a Lead into an Account, Contact, and optionally an Opportunity.

Required parameters: `@LeadId`, `@ConvertedStatus`. Before calling, retrieve valid converted status values:
```sql
SELECT [Id], [MasterLabel]
FROM [MySalesforceConnection].[Salesforce].[LeadStatus]
WHERE [IsConverted] = true
```

```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "ConvertLead",
  "parameters": {
    "@LeadId": "00Q000000000001",
    "@ConvertedStatus": "Qualified",
    "@DoNotCreateOpportunity": "false",
    "@OpportunityName": "Acme — New Deal"
  }
}
```

To merge into an existing Account and Contact instead of creating new ones, add `@AccountId` and `@ContactId`. Set `@DoNotCreateOpportunity` to `"true"` and omit `@OpportunityName` when no Opportunity is needed.

### GetUpdated
Returns IDs of records updated within a UTC time window for a given object type. Seconds in timestamps are ignored by the Salesforce API.

```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "GetUpdated",
  "parameters": {
    "@ObjectType": "Account",
    "@StartDate": "2025-09-09T13:00:00.000Z",
    "@EndDate": "2025-09-12T13:00:00.000Z"
  }
}
```

### GetDeleted
Returns IDs of records deleted within a UTC time window for a given object type. Same parameters as `GetUpdated`: `@ObjectType`, `@StartDate`, `@EndDate`.

### Search
Executes a full-text search across Salesforce objects. Accepts either a plain search term or a SOSL query (not both).

```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "Search",
  "parameters": {
    "@SearchTerm": "Acme Corporation"
  }
}
```

For a targeted SOSL query:
```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "Search",
  "parameters": {
    "@SOSL": "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)"
  }
}
```

### Merge
Combines up to three records of the same object type into a single master record. The non-master records are deleted after the merge.

```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "Merge",
  "parameters": {
    "@ObjectType": "Contact",
    "@MasterRecordId": "003000000000001",
    "@RecordToMergeIds": "003000000000002,003000000000003"
  }
}
```

### Undelete
Restores records from the Salesforce Recycle Bin. Use `GetDeleted` first to obtain the IDs of the records to restore.

### GetRecordCount
Returns a **cached** record count for a Salesforce object. Results may lag real-time data — use `COUNT(*)` queries for accurate counts.

### GetUserInformation
Returns personal details about the authenticated Salesforce user. Useful for confirming which user and org the active connection is running under. No parameters required.

### GetLimitInfo
Returns API usage and limit details for the Salesforce org. Use before running large or bulk operations to verify sufficient API capacity remains.

### DownloadAttachment

Downloads an attachment and returns its content as base64 in the `FileData` column when `FileLocation` is omitted. Confirmed working in cloud Connect AI environments.

**Key parameters** — use exactly these names:

| Parameter | Required | Notes |
|-----------|----------|-------|
| `@Id` | Conditional | ID of the specific attachment. Required if `@Name` is not provided. **Do not use `@AttachmentId`** — this parameter does not exist and will cause a runtime error. |
| `@ObjectId` | No | ID of the parent Salesforce object. Use to download all attachments on a record when `@Id` is unknown. |
| `@Name` | No | Filename as alternative to `@Id` |
| `@LocalPath` | No | Omit to receive file content as base64 in `FileData` |
| `@LightningMode` | No | Set to `'true'` for Lightning Files (ContentDocument); omit for Classic Attachments |

```json
{
  "catalogName": "MySalesforceConnection",
  "schemaName": "Salesforce",
  "procedureName": "DownloadAttachment",
  "parameters": {
    "@Id": "00P000000000001"
  }
}
```

Response includes `FileData` (base64-encoded content), `FileName`, `Success`, and `FailureMessage`.

### File procedures — cloud compatibility

| Procedure | Cloud status |
|-----------|-------------|
| `DownloadAttachment` | **Confirmed working** — returns base64 content in `FileData` when `FileLocation` is omitted |
| `DownloadContentDocument` | Requires validation — may return base64 content without `FileLocation` |
| `DownloadDocument` | Requires validation — may return base64 content without `FileLocation` |
| `UploadAttachment` | Likely non-functional — requires InputStream not available via MCP |
| `UploadContentDocument` | Likely non-functional — requires InputStream not available via MCP |
| `UploadDocument` | Likely non-functional — requires InputStream not available via MCP |

## Toolkit Procedure Calls

When executing stored procedures via a **toolkit** surface (e.g. `salesforce_basic_lw_execute_procedure`) rather than the generic MCP `executeProcedure` tool, parameter names in the parameters object **must include the `@` prefix**. The toolkit exposes raw SQL parameter binding and does not add the prefix automatically.

**Correct — toolkit:**
```json
{
  "sql": "EXECUTE [MySalesforceConnection].[Salesforce].GetUpdated @ObjectType = @ObjectType, @StartDate = @StartDate, @EndDate = @EndDate",
  "parameters": {
    "@ObjectType": { "value": "Account", "type": "string" },
    "@StartDate":  { "value": "2026-05-01T00:00:00.000Z", "type": "string" },
    "@EndDate":    { "value": "2026-05-15T23:59:59.000Z", "type": "string" }
  }
}
```

**Incorrect — toolkit (missing @ prefix):**
```json
{
  "parameters": {
    "ObjectType": "Account"
  }
}
```

Omitting the `@` prefix causes a null pointer error: `Cannot invoke "String.startsWith(String)" because "<local12>" is null`.

The generic MCP `executeProcedure` tool handles the `@` prefix internally — this guidance applies only to toolkit `execute_procedure` calls.

## Write Operations

### INSERT example
```sql
INSERT INTO [MySalesforceConnection].[Salesforce].[Lead]
  ([FirstName], [LastName], [Company], [Email], [LeadSource])
VALUES
  ('Jane', 'Smith', 'Acme Corp', 'jane@acme.com', 'Web')
```

### UPDATE example
```sql
UPDATE [MySalesforceConnection].[Salesforce].[Opportunity]
SET [StageName] = 'Closed Won', [Probability] = 100
WHERE [Id] = '006000000000001'
```

Write access is controlled by the CData Connect AI connection settings. If INSERT, UPDATE, or stored procedure calls return permission errors, guide the user to their Connect AI connection settings and confirm that write access is enabled — connections may be set to readonly mode by default.

## Salesforce-Specific Conventions

- **Leads are separate from Contacts** — a Lead only becomes a Contact after conversion via `ConvertLead`. Do not join Lead and Contact as if they are the same entity; they live in separate tables with different schemas.
- **Date filters prevent timeouts** — always include a `CreatedDate` or `LastModifiedDate` predicate when querying large objects (Account, Contact, Lead, Opportunity). Use explicit date literals (`'2025-01-01'`) instead of `DATEADD()` for best performance in Connect AI.
- **NULL foreign keys are common** — Salesforce allows many FK columns (e.g., `AccountId` on Contact) to be NULL. Use `IS NOT NULL` guards in WHERE clauses and prefer `LEFT JOIN` over `INNER JOIN` when joining related objects.
- **Use NOT EXISTS over complex LEFT JOINs** — for "find records without related records" queries, `NOT EXISTS` is more reliable than `LEFT JOIN … WHERE key IS NULL`.
- **Verify picklist values before filtering** — always query `PickListValues` to confirm valid values before filtering on picklist columns like `StageName`, `Status`, `Priority`, or `LeadSource`. The internal `PickList_Value` (used in WHERE clauses) may differ from the UI label in `PickList_Label`.
- **Custom fields and objects use `__c` suffix** — any column or table name ending in `__c` is a custom extension specific to that org. Use `getTables` with `tableName: "%__c"` to discover custom objects; use `getColumns` and look for `__c` columns to find custom fields on standard objects.
- **`Name` is readonly on Contact and Lead** — write `FirstName` and `LastName` separately; `Name` is a derived computed field and cannot be set directly.
- **`IsClosed` and `IsWon` are readonly on Opportunity** — they are controlled by Salesforce based on the `StageName` picklist value. Update `StageName` directly; do not attempt to set `IsClosed` or `IsWon`.
- **`CaseNumber` is auto-generated and readonly** — do not include it in INSERT statements.
- **Verify COUNT before aggregating** — run a `COUNT(*)` with your intended filters before running expensive aggregations to validate data volume and filter correctness.
