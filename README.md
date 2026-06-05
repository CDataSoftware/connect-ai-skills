# CData Connect AI Skills

> [!IMPORTANT]
> This repository is under development. Additional connector-family skills (`connect-ai-crm`, `connect-ai-erp`, `connect-ai-hcm`, `connect-ai-ticketing`, `connect-ai-analytics`, `connect-ai-files`) and connector-specific skills are in development.

## Installation

> [!NOTE]
> `connect-ai-base` must be enabled alongside any other skill in this repo — all connector-family and connector-specific skills build on top of it. Always include `--skill connect-ai-base` when installing other skills individually.

Install every skill in this repo:

```
npx skills add CDataSoftware/connect-ai-skills
```

Install a specific skill by name (the folder name under [`skills/`](skills/)). Pair it with `connect-ai-base`:

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base --skill connect-ai-salesforce
```

Pass `--skill` multiple times to install several skills in one command:

```
npx skills add CDataSoftware/connect-ai-skills --skill connect-ai-base --skill connect-ai-salesforce --skill connect-ai-jira
```

### Available skills

| Skill | Family | Description |
|---|---|---|
| [`connect-ai-base`](skills/connect-ai/connect-ai-base/SKILL.md) | — | **Base skill.** Required connection confirmation, discovery workflow for the generic MCP Server and Toolkits, query construction, and common error recovery. Load this first — all other skills compose on top of it. |
| [`connect-ai-salesforce`](skills/connectors/connect-ai-salesforce/SKILL.md) | CRM | Salesforce data model, query patterns, stored procedures, and Salesforce-specific conventions. |
| [`connect-ai-bullhorncrm`](skills/connectors/connect-ai-bullhorncrm/SKILL.md) | CRM | Bullhorn CRM recruiting data model (Candidates, ClientCorporations, JobOrders, JobSubmissions, Placements), file-attachment procedures, edit-history tables, and Bullhorn conventions. |
| [`connect-ai-workday`](skills/connectors/connect-ai-workday/SKILL.md) | HCM | Workday's multi-connection-type model (REST/WQL/Reports/SOAP), per-connection-type references, prompt-column lookups, value tables, and change-resource procedures. |
| [`connect-ai-quickbooksonline`](skills/connectors/connect-ai-quickbooksonline/SKILL.md) | Accounting | QuickBooks Online data model (GL, AP, AR, items, banking), line-item patterns, LineAggregate XML for inserts, and report objects. |
| [`connect-ai-jira`](skills/connectors/connect-ai-jira/SKILL.md) | Ticketing | Jira data model, issue hierarchy, query patterns, stored procedures, and Jira-specific conventions. |
| [`connect-ai-confluence`](skills/connectors/connect-ai-confluence/SKILL.md) | Collaboration | Confluence data model (spaces, pages, comments, attachments, users, and analytics/hierarchy views), the space → page → refine workflow, and base64 image/attachment retrieval. |
| [`connect-ai-airtable`](skills/connectors/connect-ai-airtable/SKILL.md) | Collaboration | Airtable's multi-schema model (Information metadata plus one schema per base), per-base table/view anatomy, attachment/collaborator fields, comments, and stored procedures. |
| [`connect-ai-docusign`](skills/connectors/connect-ai-docusign/SKILL.md) | Collaboration | DocuSign data model (Envelopes, Templates, Documents, Recipients), envelope lifecycle queries, and procedures for creating/downloading documents. |
| [`connect-ai-googlecalendar`](skills/connectors/connect-ai-googlecalendar/SKILL.md) | Collaboration | Google Calendar data model (events, calendars, ACLs, attachments), the per-calendar table pattern, availability queries, and event create/move procedures. |
| [`connect-ai-googledrive`](skills/connectors/connect-ai-googledrive/SKILL.md) | Files | Google Drive data model (files, folders, drives, permissions) and procedures for uploading and downloading file content. |

Additional skills will be listed here as they ship.

## Prerequisites

- **CData Connect AI** account with at least one connection configured
- The **Connect AI MCP server** added to your AI integration (see [Connect AI Integrations - AI Tools](https://docs.cloud.cdata.com/en/Integrations#ai-tools))

## License

[MIT](LICENSE)
