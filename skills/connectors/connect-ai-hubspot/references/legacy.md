# HubSpot Legacy Schema Reference

> Surface: `Schema = HubSpot`. The original HubSpot model, predating both CRM schemas. Load this reference when the live connection's `getSchemas` returns **`HubSpot`**. See the base [SKILL.md](../SKILL.md) for surface identification.
>
> This is a **different data model, not an older naming of the same one** (~60 tables). Primary keys, association handling, and enum casing all differ from V3 and V4. Do not carry table names, column names, or filter values over from those surfaces.
>
> Its distinctive strength is marketing and analytics — email campaigns, form submissions, web traffic analytics, social media, and CMS content — much of which has no equivalent on the newer schemas. Its CRM surface is smaller. For CRM-centric work, a `HubSpotV3` connection is generally the better fit.

## Schema

The schema name is `HubSpot`. The three-part name is `[Catalog].[HubSpot].[Table]`:

```sql
SELECT [DealId], [Deal Name], [Amount] FROM [YourConnection].[HubSpot].[Deals] LIMIT 10
```

Replace `[YourConnection]` with your actual HubSpot connection name from `getCatalogs`.

## What differs from V3 and V4 (read this first)

These five differences cause most failures when an agent arrives here carrying V3 or V4 assumptions:

| Concept | V3 / V4 | Legacy |
|---|---|---|
| Contact primary key | `Id` | **`VID`** |
| Deal primary key | `Id` | **`DealId`** |
| Enum casing | `opportunity`, `lead` | **`Opportunity`, `Lead`** (TitleCase) |
| Engagements | Five typed tables (`EngagementsCalls`, …) | **One combined `Engagements` table** with a `[Type]` discriminator |
| Associations | `*Associations` tables with `[Id]` / `[AssociationId]` / `[Type]` | **`CrmAssociations`**, requiring `[FromObjectId]` **and** `[DefinitionId]` |
| Stage label column | `DealPipelineStages.[Label]`, keyed by `[Id]` | **`DealPipelineStages.[StageName]`, keyed by `[StageId]`** |

Also note **`DealStages` is not a stage-definition table** on this surface — it is a per-deal stage *change history*. Numeric properties are typed `DOUBLE` rather than `DECIMAL`, so aggregate results may format differently.

## Query Process

1. **Discover the table.** This surface's table set differs substantially from the CRM schemas and is not fully enumerated here. Use a filtered `getTables` call.
2. **Confirm the columns.** Column names are frequently not what the newer schemas use for the same concept. Always run `getColumns` before writing a query against a table not documented here.
3. **Identify the primary key.** It is not `Id`. The `Key` flag in `getColumns` output marks it.
4. **Sample enum values before filtering.** Casing differs from the newer surfaces.

## Data Model

### Key Tables

**CRM objects** — a smaller set than the newer schemas: `Contacts`, `Companies`, `Deals`, `Tickets`, `LineItems`, `Products`. There are **no** `Leads`, `Quotes`, `Invoices`, `Orders`, `Subscriptions`, `Courses`, `Services`, `Listings`, `Appointments`, or `Feedbacksubmissions` tables here.

**Property metadata** — `ContactProperties`, `CompanyProperties`, `DealProperties`, `TicketProperties`, `LineItemProperties`, `ProductProperties`, plus the matching `*PropertyGroups` and `*PropertiesHistory` tables.

**Pipelines and stages**
- **DealPipelines** / **DealPipelineStages** — pipeline and stage definitions. The stage key is `[StageId]` and the label is `[StageName]`, alongside `[PipelineId]`, `[PipelineName]`, `[StageDisplayOrder]`, `[StageProbability]`, `[StageClosedWon]`, and active flags.
- **DealStages** — a per-deal stage *change history*, with `[DealId]`, `[StageCreated]`, `[StageValue]`, `[StageSource]`, `[StageSourceId]`. Use it for transition analysis, not for resolving a label.

**Engagements** — a single combined `Engagements` table. Discriminate with `[Type]` (values include `CALL`, `EMAIL`, `TASK`) and `[ActivityType]`. It carries denormalized association columns — `[AssociatedContacts]`, `[AssociatedCompanies]`, `[AssociatedDeals]`, `[AssociatedTickets]`, `[AssociatedOwners]`, `[AssociatedWorkflows]` — plus type-specific columns such as `[DurationMilliseconds]`, `[RecordingUrl]`, `[Disposition]`, `[MeetingOutcome]`, `[TaskType]`. Also **EngagementScheduledTasks**.

**Associations**
- **CrmAssociations** — the generic association table. **Requires both `[FromObjectId]` and `[DefinitionId]`** in the WHERE clause; without them the query errors. Columns are `[FromObjectId]`, `[ToObjectId]`, `[Category]`, `[DefinitionId]`.
- **DealAssociations** — deal associations, which can also be inserted and deleted.
- Many relationships are additionally available denormalized on `Engagements` and on contact/company columns, which is often simpler than going through `CrmAssociations`.

**Email marketing** — **EmailCampaigns** (campaign records with delivery statistics), **EmailCampaignEvents** (per-recipient events), **EmailSubscriptions** / **EmailSubscriptionTypes** (subscription state; `EmailSubscriptions` requires an email to be specified).

**Forms** — **Forms**, **FormFields**, **FormSubmissions**, **ContactFormSubmissions**. `FormSubmissions` requires a form to be specified.

**Web analytics** — **AnalyticsSessions**, **AnalyticsViews**, **AnalyticsContents**, **AnalyticsForms**, **AnalyticsBreakdowns**, **AnalyticsEventCompletions**, **AnalyticsSocialAssists**, and **Events** (event definitions). Also **ContactStatistics** for portal-level contact counts.

**Social media** — **SocialMediaChannels**, **SocialMediaMessages**.

**CMS content** — **Pages**, **Templates**, **UrlMappings**, **Domains**, **Blogs**, **BlogPosts**, **BlogAuthors**, **BlogTopics**, **Comments**.

**Files** — **Files**, **Folders**.

**Automation** — **Workflows**, **Enrollments** (workflows a contact is currently enrolled in).

**Contact identity** — **ContactIdentityProfiles**, plus identity columns on `Contacts` such as `[CanonicalVid]`, `[MergedVidsAggregate]`, and `[All vids for a contact]`.

### Key Relationships

- `Deals.[Deal Stage]` → `DealPipelineStages.[StageId]`, which carries `[StageName]`.
- `DealStages.[DealId]` → `Deals.[DealId]` — stage change history per deal.
- `CrmAssociations.[FromObjectId]` → the source record's key, with `[DefinitionId]` selecting the relationship type.
- `Engagements.[AssociatedDeals]` / `[AssociatedContacts]` — denormalized relationships on the engagement itself.
- `Contacts.[CanonicalVid]` → the surviving `VID` after a merge.

## Important Columns

### Contacts
- `VID` — the primary key (**not** `Id`)
- `CanonicalVid` — the canonical contact id after merges
- `Email`, `First Name`, `Last Name` — identity columns
- `Lifecycle Stage` — TitleCase on this surface (`Lead`, `Opportunity`)
- `ListId` — a list association available directly on the contact
- `MergedVidsAggregate`, `All vids for a contact` — merge history
- `Primary Associated Company ID` — the contact's primary company

### Deals
- `DealId` — the primary key (**not** `Id`)
- `Deal Name`, `Amount`, `Deal Stage`, `Deal Type`, `Deal owner`
- `AssociatedDealIds` — related deal ids
- `Is Deal Closed?` — true when the deal was won or lost

### DealPipelineStages
- `StageId` — the stage key that `Deals.[Deal Stage]` points at
- `StageName` — the readable stage label
- `PipelineId`, `PipelineName` — the containing pipeline
- `StageDisplayOrder`, `StageProbability`, `StageClosedWon` — stage attributes
- `StageIsActive`, `PipelineIsActive` — active flags

### DealStages
- `DealId` — the deal whose history this is
- `StageValue` — the stage the deal moved to
- `StageCreated` — when the transition happened
- `StageSource`, `StageSourceId` — what caused the transition (e.g. `CRM_UI`, `INTEGRATION`)

### Engagements
- `Id` — the engagement's id
- `Type`, `ActivityType` — the engagement kind (`CALL`, `EMAIL`, `TASK`, …)
- `Subject`, `Body`, `Title` — content columns
- `DateTime`, `StartTime`, `EndTime`, `CreatedAt`, `UpdatedAt` — timing
- `OwnerId`, `CreatedBy`, `ModifiedBy` — people
- `AssociatedContacts`, `AssociatedCompanies`, `AssociatedDeals`, `AssociatedTickets` — denormalized associations
- `DurationMilliseconds`, `RecordingUrl`, `Disposition` — call attributes
- `MeetingOutcome` — meeting attribute
- `TaskType`, `Status` — task attributes

### CrmAssociations
- `FromObjectId` — the source record's id; **required as a filter**
- `DefinitionId` — the relationship type; **required as a filter**
- `ToObjectId` — the related record's id
- `Category` — the association category

## Common Query Patterns

### Contacts by lifecycle stage
Note the TitleCase filter value — a value copied from a V3 query returns zero rows here.
```sql
SELECT [VID], [Email], [First Name], [Last Name], [Lifecycle Stage]
FROM [YourConnection].[HubSpot].[Contacts]
WHERE [Lifecycle Stage] = 'Opportunity'
LIMIT 50
```

### Pipeline snapshot — deals per stage label
Join on `[StageId]`, read the label from `[StageName]`.
```sql
SELECT s.[StageName], s.[PipelineName], COUNT(*) AS [Deals], SUM(d.[Amount]) AS [Value]
FROM [YourConnection].[HubSpot].[Deals] d
LEFT JOIN [YourConnection].[HubSpot].[DealPipelineStages] s ON s.[StageId] = d.[Deal Stage]
GROUP BY s.[StageName], s.[PipelineName]
ORDER BY [Value] DESC
```

### Deal stage transition history
```sql
SELECT [DealId], [StageValue], [StageCreated], [StageSource]
FROM [YourConnection].[HubSpot].[DealStages]
WHERE [DealId] = <deal-id>
ORDER BY [StageCreated] DESC
```

### Engagement activity by type
```sql
SELECT [Id], [Type], [Subject], [DateTime], [OwnerId], [AssociatedDeals]
FROM [YourConnection].[HubSpot].[Engagements]
WHERE [Type] = 'CALL'
ORDER BY [DateTime] DESC
LIMIT 25
```

### A record's associations
Both filters are required. `[DefinitionId]` selects which relationship type to return — enumerate the definition ids relevant to the portal before relying on a specific value.
```sql
SELECT [FromObjectId], [ToObjectId], [Category], [DefinitionId]
FROM [YourConnection].[HubSpot].[CrmAssociations]
WHERE [FromObjectId] = <deal-id> AND [DefinitionId] = 5
```

### Discovering custom property labels
```sql
SELECT [Name], [Label], [Type], [GroupName]
FROM [YourConnection].[HubSpot].[DealProperties]
WHERE [Label] LIKE '%score%'
```

## Stored Procedures

- **InsertEngagement** — creates an engagement record such as a call, email, or task. Creation is better supported than retrieval on this surface.
- **UpdateWorkflowContacts** — enrolls or unenrolls contacts from a workflow
- **UploadFile** — adds a file to the HubSpot file manager
- **DeleteFile** — permanently removes a file and its metadata and thumbnails

This surface has **no file download procedure**, and no custom object or custom property procedures — those live on `HubSpotV3`.

### File operations

`UploadFile` accepts base64 content, so it is usable through the ordinary procedure surface. Confirm the parameter names with `getProcedureParameters`, then pass the base64 bytes and a file name. Stream-typed parameters cannot be supplied through a procedure call, and any `FileLocation` / `FilePath` / `LocalPath` parameter refers to the CData cloud server's filesystem, not the user's machine.

To retrieve file content, use a `HubSpotV3` connection — this surface exposes file metadata through the `Files` table but no download path.

**When the session provides a dedicated file-upload tool, prefer it.** It moves the bytes out of band rather than through the conversation, so it handles content that base64 in a procedure call cannot. Follow the tool's own description for parameters and sequence. A completed upload must not be repeated.

## Write Operations

**`UPDATE` is the supported write path on the object tables**, subject to the connection's permissions. Target the surface's own key columns — `[DealId]`, `[VID]` — not `[Id]`:

```sql
UPDATE [YourConnection].[HubSpot].[Deals]
SET [Amount] = 12000
WHERE [DealId] = <deal-id>
```

### Creating records

A raw `INSERT` against the object tables does **not** work. HubSpot assigns each record's primary key server-side and exposes the key column — `[VID]` on contacts, `[CompanyId]` on companies, `[DealId]` on deals, `[Id]` on tickets and most others — as read-only, while the insert path requires a value for every non-nullable column that has no default and does not skip the read-only key — so the statement is rejected before the driver sees it.

**Creation is still supported**, through the connection's dedicated create tool for the object, which reaches the driver by a path that lets HubSpot generate the key. Use it in preference to any `INSERT`.

- **Never supply the key column — `[VID]` on contacts, `[CompanyId]` on companies, `[DealId]` on deals, `[Id]` on tickets and most others —** on a create.
- An error naming the key column as *"neither nullable nor has a default value"* is a property of the insert path, not a missing column. Switch to the create tool rather than retrying variants or inventing a key value.
- **Confirm the create by reading the record back** by the id the tool returns.
- If no create tool is listed in this session, say plainly that creation is unavailable here, and offer to update an existing record or point the user to the HubSpot UI.

Two writes on this surface sidestep the insert path entirely: `InsertEngagement` creates engagement records through `executeProcedure`, and `DealAssociations` accepts inserts for managing deal relationships.

### Write access control
A Connect AI connection may also be set to read-only. If an update or stored procedure is refused on permission grounds, direct the user to enable write access in their Connect AI connection settings. That is a different cause from the insert-path behavior above — do not send a user to connection settings over an insert error.

## Legacy-Specific Conventions

- **Do not assume `Id`.** Primary keys are `VID` on contacts and `DealId` on deals. Confirm with `getColumns` before writing a join.
- **Do not carry filter values from a V3 or V4 query.** Enum casing differs — `[Lifecycle Stage]` is `Opportunity` here and `opportunity` there. A mismatched value returns empty rather than erroring.
- **Do not assume column names match the newer schemas.** The same concept is often named differently: stage labels are `[StageName]`, not `[Label]`.
- **`DealStages` is history, not definitions.** For a readable stage label use `DealPipelineStages`; for how a deal moved through stages use `DealStages`.
- **Several tables require filters.** `CrmAssociations` needs `[FromObjectId]` and `[DefinitionId]`; `EmailSubscriptions` needs an email; `FormSubmissions` needs a form.
- **Prefer denormalized association columns when they answer the question.** `Engagements` carries `[AssociatedDeals]` and friends directly, which is simpler than a `CrmAssociations` lookup.
- **Column naming mixes two styles.** CRM property columns use spaced display labels (`[Deal Name]`, `[Lifecycle Stage]`) while system and metadata columns are unspaced (`DealId`, `VID`, `StageName`) — both appear in the same table.
- **Consider whether this is the right surface.** For CRM-centric questions, a `HubSpotV3` connection offers a richer object set, owner and team lookups, and list membership. Say so rather than working around a gap here.
