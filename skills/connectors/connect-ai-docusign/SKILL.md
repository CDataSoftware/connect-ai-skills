---
name: connect-ai-docusign
description: Use when querying DocuSign data through CData Connect AI. Covers the DocuSign data model (Envelopes, Templates, Documents, Recipients), envelope lifecycle queries, stored procedures for creating and downloading documents (with base64 vs FileLocation cloud-compat patterns), and DocuSign-specific conventions. Composes on top of the connect-ai-base skill.
license: Apache-2.0
metadata:
  author: CData Software
  version: "1.0"
  connector: DocuSign
  family: collaboration
---

# CData Connect AI — DocuSign Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides DocuSign-specific guidance for querying DocuSign data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the DocuSign driver. Do not call `getInstructions` for DocuSign — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the DocuSign connection via `getCatalogs`.

## Schema

DocuSign is a single-schema driver. The schema name is `DocuSign`.

```sql
SELECT [EnvelopeId], [EmailSubject], [Status], [CompletedDateTime]
FROM [YourDocuSignConnection].[DocuSign].[Envelopes]
LIMIT 10
```

## Query Process

DocuSign's data is organized around the envelope lifecycle: an envelope contains documents, has recipients who sign, and progresses through states (created → sent → delivered → completed). Most analyses start with envelopes and join outward.

1. **Identify the connection** — if unknown, call `getCatalogs` and filter for `DRIVER = 'DocuSign'`.
2. **Tables vs. procedures** — query operations use tables (`Envelopes`, `Documents`, etc.); creation, modification, and download operations use stored procedures. **All tables are read-only views by design** — INSERT/UPDATE/DELETE on tables is not supported.
3. **Find the envelope first** — most workflows begin by locating one or more envelopes by status, date, or recipient. Filter with `Status` and `CompletedDateTime` / `SentDateTime`.
4. **Drill into documents or recipients** — both `Documents` and `Recipients` tables are keyed by parent: queries **must** include both `Type` (`'envelopes'` or `'templates'`) and `Id` (envelope or template ID) in the WHERE clause, otherwise the query fails or returns the entire table.
5. **Download via procedure** — use `DownloadDocument` (with cloud-compatible parameters; see Stored Procedures below) to retrieve signed content as base64.

## Data Model

### Key Tables (read-only views)

All DocuSign tables are read-only views. To create or modify data, use the stored procedures below.

- **Envelopes** — Envelope-level records: status, timestamps, sender, recipients summary
- **Templates** — Template definitions: name, description, sharing settings, ownership
- **Documents** — Documents within envelopes or templates. **Requires `Type` + `Id` filters** in WHERE clause
- **Recipients** — Signers, CC, and other recipient types. **Also requires `Type` + `Id` filters** when scoping to a specific envelope or template (same filter pattern as `Documents`)
- **DocumentTabs** — Tab (signature/field) definitions within documents
- **Folders** — Envelope folders for organization

### Envelope Status values

`Envelopes.Status` is a lowercase string. Driver-reported values:

- `created` — Draft, not yet sent
- `sent` — Recipients notified
- `delivered` — Recipients have opened
- `signed` — Recipients have signed (intermediate state on some envelopes; overlaps with `completed`)
- `completed` — All required tabs filled and the envelope is closed
- `declined` — A recipient refused to sign
- `voided` — Sender canceled the envelope (see `VoidedReason` for cause)

For "what got signed?" queries, filter on `Status IN ('completed', 'signed')` if both terminal states matter; for "what's in flight?", filter on `Status IN ('sent', 'delivered')`.

### Key Relationships

| Child table | Filter columns | Parent |
|---|---|---|
| Documents | `Type` + `Id` | Envelopes or Templates (`Type` tells you which) |
| Recipients | `Type` + `Id` | Envelopes or Templates (same pattern as Documents) |
| DocumentTabs | document ID | Documents |

## Important Columns

### Envelopes

- `EnvelopeId` — Unique identifier (primary key)
- `EmailSubject` — Email subject sent to recipients
- `Status` — `created`, `sent`, `delivered`, `signed`, `completed`, `declined`, `voided`
- `StatusChangedDateTime` — Timestamp of last status change
- `SentDateTime` — When the envelope was sent
- `CompletedDateTime` — When all signatures were captured (null until `Status = 'completed'`)
- `CreatedDateTime`, `LastModifiedDateTime`, `DeclinedDateTime`, `VoidedDateTime`, `DeletedDateTime` — Lifecycle timestamps
- `VoidedReason` — Why the envelope was voided (null unless `Status = 'voided'`)
- `SenderUserName`, `SenderEmail`, `SenderUserId`, `SenderAccountId` — Sender identity (note: column is `SenderUserName`, not `SenderName`)
- `EnvelopeUri`, `DocumentsUri`, `RecipientsUri`, `CertificateUri` — URI fields for API drill-down
- `PurgeState` — Document/metadata purge lifecycle (`unpurged`, `documents_queued`, `documents_purged`, etc.)

### Templates

- `TemplateId` — Unique identifier
- `Name`, `Description`
- `Shared` — Whether template is shared across the account (BOOLEAN)
- `Created`, `LastModified` — Timestamps
- `PageCount` — Number of pages in the template
- `FolderName`, `FolderId` — Folder placement
- `OwnerUserName`, `OwnerEmail`, `OwnerUserId` — Template owner

### Documents

- `Id` — Parent envelope or template ID (required filter)
- `Type` — `'envelopes'` or `'templates'` (required filter)
- `DocumentId` — Document identifier within the parent (e.g., `"1"`, `"2"`) — also part of the key
- `DocumentName` — Display name
- `DocumentType` — Type classification (`content`, `summary`, etc.)
- `Uri` — Document URI
- `IncludeInDownload` — Whether the document is included in combined-document downloads (BOOLEAN)

### Recipients

- `RecipientId` — Unique identifier within the envelope/template (primary key)
- `Type` — `'envelopes'` or `'templates'` (filter to scope to a parent)
- `Id` — Parent envelope or template ID (filter to scope to a parent)
- `RecipientType` — Role classification (signer, carbon copy, agent, intermediary, certified delivery, etc.)
- `Name`, `Email` — Recipient identity
- `RoleName` — Optional template role (e.g., `'Buyer'`, `'Seller'`)
- `Status` — Recipient-level status
- `DeliveredDateTime`, `SignedDateTime` — Timestamps for this recipient
- `SigningGroupId`, `SigningGroupName` — When the recipient is a signing group rather than an individual
- `RoutingOrder` (via `CurrentRoutingOrder`) — Position in the sequential signing flow

## Common Query Patterns

### Recently completed envelopes

```sql
SELECT [EnvelopeId], [EmailSubject], [Status], [SenderEmail], [CompletedDateTime]
FROM [YourConnection].[DocuSign].[Envelopes]
WHERE [Status] = 'completed'
  AND [CompletedDateTime] >= '2025-01-01'
ORDER BY [CompletedDateTime] DESC
LIMIT 20
```

### Envelopes pending action (sent or delivered, not yet completed)

```sql
SELECT [EnvelopeId], [EmailSubject], [Status], [StatusChangedDateTime]
FROM [YourConnection].[DocuSign].[Envelopes]
WHERE [Status] IN ('sent', 'delivered')
  AND [SentDateTime] >= '2025-01-01'
ORDER BY [SentDateTime] DESC
LIMIT 50
```

### Documents within a specific envelope

```sql
-- Required: both Type and Id filters
SELECT [DocumentId], [DocumentName], [DocumentType]
FROM [YourConnection].[DocuSign].[Documents]
WHERE [Type] = 'envelopes'
  AND [Id] = '<envelope-id>'
```

### Recipients for a specific envelope

```sql
-- Required: both Type and Id filters (same pattern as Documents)
SELECT [RecipientId], [RecipientType], [Name], [Email], [Status], [SignedDateTime]
FROM [YourConnection].[DocuSign].[Recipients]
WHERE [Type] = 'envelopes'
  AND [Id] = '<envelope-id>'
```

### Templates with sharing scope

```sql
SELECT [TemplateId], [Name], [Description], [Shared], [Created], [OwnerUserName]
FROM [YourConnection].[DocuSign].[Templates]
WHERE [Shared] = true
ORDER BY [Created] DESC
```

### Voided envelopes with reasons

```sql
SELECT [EnvelopeId], [EmailSubject], [SenderEmail], [VoidedDateTime], [VoidedReason]
FROM [YourConnection].[DocuSign].[Envelopes]
WHERE [Status] = 'voided'
  AND [VoidedDateTime] >= '2025-01-01'
ORDER BY [VoidedDateTime] DESC
```

## Stored Procedures

DocuSign uses stored procedures for all create/modify/download operations since tables are read-only. Several procedures accept file content; in cloud Connect AI environments, prefer the base64 `@DocumentsAggregate` parameter over disk-path (`@FileLocation`) or stream (`@Content`) parameters.

### DownloadDocument

Downloads a signed document or certificate from an envelope or template.

**Cloud-compatible call shape** — omit both `@DownloadLocation` (disk path) and `@FileStream` (output-stream, cannot pass through MCP); the response returns the document content as base64. `@Encoding` is an optional parameter to control the encoding of the returned content.

```json
{
  "catalogName": "YourDocuSignConnection",
  "schemaName": "DocuSign",
  "procedureName": "DownloadDocument",
  "parameters": {
    "@Type": "envelopes",
    "@Id": "<envelope-id>",
    "@DocumentId": "<document-id-from-documents-table>"
  }
}
```

### CreateAndSendEnvelope

Creates an envelope and either sends it or saves it as draft.

**Cloud-compatible call shape** — use `@DocumentsAggregate` with base64-encoded content. Do not use `@FileLocation` (disk path) or `@Content` (InputStream) — neither works in cloud environments.

```json
{
  "catalogName": "YourDocuSignConnection",
  "schemaName": "DocuSign",
  "procedureName": "CreateAndSendEnvelope",
  "parameters": {
    "@Status": "sent",
    "@EmailSubject": "Please sign the agreement",
    "@DocumentsAggregate": "[{\"documentId\": \"1\", \"name\": \"Agreement.pdf\", \"fileExtension\": \"pdf\", \"documentBase64\": \"JVBERi0xLjcKJeLjz9MK...\"}]",
    "@SignersEmail": "signer@example.com",
    "@SignersName": "John Smith",
    "@SignersRecipientId": "1",
    "@SignersRoutingOrder": "1"
  }
}
```

Set `@Status` to `"created"` to save as draft instead of sending immediately. `@EmailSubject` is required. For multiple signers or carbon-copies, use `@SignersAggregate` / `@CarbonCopiesAggregate` (note: different naming from `CreateTemplate` — see Conventions).

### CreateTemplate

Creates a new template. Two patterns: bare template (add documents later), or template + documents in one call via `@DocumentsAggregate`.

**Pattern A — bare template, add documents in a separate call:**

```json
{
  "catalogName": "YourDocuSignConnection",
  "schemaName": "DocuSign",
  "procedureName": "CreateTemplate",
  "parameters": {
    "@Name": "Sales Agreement Template",
    "@Description": "Standard sales agreement for new customers",
    "@Shared": "false",
    "@EmailSubject": "Please sign the Sales Agreement"
  }
}
```

Response returns a new `TemplateId`.

**Pattern B — template with documents in one call (recommended for cloud):**

```json
{
  "catalogName": "YourDocuSignConnection",
  "schemaName": "DocuSign",
  "procedureName": "CreateTemplate",
  "parameters": {
    "@Name": "Sales Agreement Template",
    "@Description": "Standard sales agreement",
    "@Shared": "false",
    "@DocumentsAggregate": "[{\"documentId\": \"1\", \"name\": \"Agreement.pdf\", \"fileExtension\": \"pdf\", \"documentBase64\": \"JVBERi0xLjcKJeLjz9MK...\"}]"
  }
}
```

`CreateTemplate` accepts only base64 document upload (`@DocumentsAggregate`) — it has no `@FileLocation` or `@Content` parameter. To base a new template on an existing envelope, pass `@EnvelopeId`. For recipients, use `@RecipientsSignersAggregate` and `@RecipientsCarbonCopiesAggregate` (different naming from `CreateAndSendEnvelope`).

### AddDocumentToTemplate — Not currently supported in cloud

`AddDocumentToTemplate` accepts `@FileLocation` (server-side disk path, unavailable in cloud) or `@Content` (Java `InputStream`, unable to pass through the MCP interface). There is no base64 string alternative for the upload path on this procedure. Treat add-document-to-existing-template as a current limitation in cloud — instead, create the template with documents together via `CreateTemplate` Pattern B (`@DocumentsAggregate`). Support for base64 upload on `AddDocumentToTemplate` is planned but not currently available.

### MoveEnvelope

Moves envelopes between folders or to the recycle bin. No file content involved. Pass the destination folder ID; setting the destination to `recyclebin` deletes or voids the envelope. Consult `getProcedureParameters` for the current parameter signature.

### GetConsentURL

Returns the URL an end user must visit to grant individual consent for the DocuSign integration (OAuth consent flow). Use when bootstrapping or re-authorizing a DocuSign connection. No file content involved.

### `@DocumentsAggregate` parameter reference

Used by `CreateTemplate` and `CreateAndSendEnvelope` for cloud-compatible document upload. Requires base64-encoded file content — file paths are not supported.

| Field | Required | Notes |
|---|---|---|
| `documentId` | Yes | Unique identifier within the call (e.g., `"1"`, `"2"`) — sequential numbering |
| `name` | Yes | Display name of the document |
| `fileExtension` | Yes | File type: `"pdf"`, `"docx"`, etc. |
| `documentBase64` | Yes* | Base64-encoded file content |
| `remoteUrl` | No | URL to fetch the document from (alternative to `documentBase64`) |

*One of `documentBase64` or `remoteUrl` must be provided.

## Write Operations

DocuSign tables are read-only views. **All create/modify/delete operations go through stored procedures** — INSERT, UPDATE, and DELETE against tables are not supported by the driver.

If a stored procedure call returns a permissions error, two things to check: (1) the Connect AI connection's readonly setting (CData side — the connection may have execute disabled), and (2) the authenticated DocuSign API user's role permissions in DocuSign.

## DocuSign-Specific Conventions

- **All tables are read-only views.** INSERT, UPDATE, and DELETE on tables are not supported. Use stored procedures (`CreateAndSendEnvelope`, `CreateTemplate`, `AddDocumentToTemplate`, `DownloadDocument`, `MoveEnvelope`, `GetConsentURL`) for all create/modify/download operations.
- **`Documents` and `Recipients` both require `Type` + `Id` filters.** Queries without both columns in WHERE clause will fail or return the full table. `Type` is `'envelopes'` or `'templates'`; `Id` is the parent envelope or template ID. This is a broader pattern than just Documents — any time you scope a child entity to a parent, both columns are required.
- **Status values are lowercase strings.** Filter with `'completed'`, `'sent'`, `'delivered'`, `'created'`, `'signed'`, `'declined'`, `'voided'` — never numeric codes. Note that `signed` and `completed` are both terminal states for signed envelopes and may overlap in practice; use `IN ('signed', 'completed')` when querying "what got signed".
- **For cloud Connect AI: use `@DocumentsAggregate` (base64), not `@FileLocation` or `@Content` (disk path / InputStream).** Cloud environments do not have disk access, and InputStream parameters cannot be passed through the MCP interface. `CreateAndSendEnvelope` and `CreateTemplate` support `@DocumentsAggregate`; `AddDocumentToTemplate` does not (use `CreateTemplate` Pattern B as the workaround when starting a template with documents).
- **`DownloadDocument` returns base64 when `@DownloadLocation` and `@FileStream` are both omitted.** Cloud environments cannot use either parameter; omit both and the response contains the document content as base64. `@Encoding` is available to control encoding of the returned content.
- **Recipient aggregate parameter names differ between procedures.** `CreateAndSendEnvelope` uses `@SignersAggregate` and `@CarbonCopiesAggregate`. `CreateTemplate` uses `@RecipientsSignersAggregate` and `@RecipientsCarbonCopiesAggregate`. Confirm the exact parameter name for the procedure you're calling via `getProcedureParameters`.
- **Sequential `documentId` values in `@DocumentsAggregate`.** When supplying multiple documents in one call, use `"1"`, `"2"`, `"3"`, etc. — these are the IDs within the call, not global document IDs.
- **Use explicit date literals for filtering, not `DATEADD()`.** Explicit dates (`'2025-01-01'`) perform better in Connect AI than computed expressions.
- **Use `CompletedDateTime` for "what got signed?" queries; `SentDateTime` for "what's in flight?" queries.** Both are present on `Envelopes`; pick the one that matches the question semantics. For voided envelopes, `VoidedDateTime` + `VoidedReason` is the relevant pair.