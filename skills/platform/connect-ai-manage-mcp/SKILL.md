---
name: connect-ai-manage-mcp
description: >
  Administer the CData Connect AI platform through the governed **Management MCP** server
  (`https://mcp.cloud.cdata.com/mcp/mgmt`) — the MCP-native path for **connection** and **toolkit**
  administration. Use to create a data-source connection (OAuth sources), list available sources and
  their configuration fields, list/test saved connections, and to build and shape toolkits: create a
  toolkit, attach connections, enable/disable universal and source ops, set server- and per-op
  instructions, and activate/deactivate toolkits and custom tools. Trigger on "create a connection"
  (for an OAuth source), "test my connection", "what sources can I connect", "make a toolkit",
  "add a connection to my toolkit", "turn off the delete ops in this toolkit", "set instructions for
  this toolkit / tool", "deactivate this toolkit". This skill covers ONLY connections + toolkits over
  MCP. For workspaces, jobs, users/roles, PATs, or billing — or connection deletes and custom-tool
  SQL edits — use `connect-ai-manage` (direct REST). For reading/writing DATA in a source, use
  `connect-ai-base` (+ the connector skill).
license: MIT
metadata:
  author: CData Software
  version: '1.0.0'
  homepage: https://www.cdata.com/connect/
  auth: Management MCP (OAuth Bearer, or PAT + HTTP Basic)
---

# CData Connect AI — Manage the Platform over MCP

This skill administers **connections** and **toolkits** in CData Connect AI through the
**Management MCP** server (`https://mcp.cloud.cdata.com/mcp/mgmt`). It is the MCP-native counterpart
to `connect-ai-manage`: same job for the connection/toolkit slice, but driven by MCP tools instead of
the raw `/api/ui/*` REST API. It does **not** query data, and it covers only what the Management MCP
exposes — see the routing and scope tables below.

Because the Management MCP is **OAuth-only for connection creation**, real credentials never pass
through the chat: authentication happens in the browser OAuth flow, and any non-OAuth source is handed
off to the admin UI. Only non-secret configuration values (an instance URL, a domain, a subdomain) are
ever collected in the conversation.

## Where this skill sits (routing)

| The user wants to… | Use |
|---|---|
| Create an **OAuth** connection, test connections, or build/shape **toolkits** — over MCP | **this skill** |
| **Full platform admin**: workspaces, jobs, users/roles, PATs, billing — or **delete** a connection/toolkit, or edit a custom tool's SQL | `connect-ai-manage` (direct REST) |
| Create a **non-OAuth** connection (Basic / API token / etc.) | Admin UI — this skill relays the source's `newConnectionUrl` |
| Read/write **data** in a source, with an MCP connector present | `connect-ai-base` + the connector skill (`connect-ai-<source>`) |
| Read/write **data** with **no** MCP connector available | `connect-ai-direct` |
| Set Connect AI up in Claude Code for the first time | `connect-ai-onboarding-claude-code` |

> **connect-ai-manage vs. connect-ai-manage-mcp.** `connect-ai-manage` is the broader, standalone
> REST skill (Auth0/PAT) covering the whole admin surface — it is the only path for workspaces, jobs,
> users, PATs, billing, and for hard deletes. This skill is narrower and MCP-native: it does
> connections + toolkits through a supported, governed server, with OAuth-delegated auth. Prefer this
> skill when the Management MCP is connected and the task is connection/toolkit work; fall back to
> `connect-ai-manage` for anything outside that subset.

## Ground rules

1. **Never act on activation.** Loading this skill produces no banner, no menu, no tool call. Act only
   on a concrete connection/toolkit request, and confirm the server is reachable (Step 0) first.
2. **Everything goes through the Management MCP.** This skill never calls a vendor API directly and
   never scrapes tokens; it only invokes the `mcp/mgmt` tools.
3. **OAuth-only connections.** `create_connection` supports OAuth authentication only. Never pass an
   `AuthScheme` such as `Basic`, `APIToken`, `PAT`, or `UserToken`, and never ask the user to paste a
   password, API key, or client secret into the chat. For a non-OAuth source, relay the source's
   `newConnectionUrl` and stop.
4. **`list_available_sources` is the source of truth.** Never tell a user a source is unsupported from
   prior knowledge — call `list_available_sources` first.
5. **No hard deletes here.** The Management MCP has no delete tools. Deactivating
   (`set_toolkit_active false`, `set_custom_tool_active false`) is the closest — a deactivated toolkit
   returns `423` to MCP clients but still exists. For a permanent delete, or to edit a custom tool's
   SQL/parameters, send the user to the admin UI (`connect-ai-manage` covers connection/toolkit
   deletes over REST). Still confirm before deactivating.

## Step 0 — Confirm the Management MCP is connected

Call `tool_search` for a Management-MCP tool name — search `"list_toolkits"` or `"create_connection"`.
These tools are unique to the `mcp/mgmt` server, so a hit confirms it is registered and authenticated.

- **Found** → proceed to the operation.
- **Not found** → the server isn't connected. Do **not** work around it (no raw HTTP to `mcp/mgmt`, no
  DevTools token). Tell the user the Management MCP isn't connected and offer to register it (Setup
  below). Data-MCP tools (`getCatalogs`, `queryData`) do **not** count — this skill needs the `mgmt`
  server specifically.

## Setup — register the Management MCP (only if Step 0 found nothing)

The Management MCP uses the **same authentication as the data MCP** — a Personal Access Token over HTTP
Basic (default), or browser OAuth. The only difference from onboarding is the URL:
`https://mcp.cloud.cdata.com/mcp/mgmt`.

Reuse the registration flow from `connect-ai-onboarding-claude-code` verbatim, substituting the `mgmt`
URL and a distinct server name. PAT path (credential stays in the user's own terminal, never in chat):

```bash
# The user creates a PAT in the Connect AI console (Settings → Access Tokens / Integrations → Claude Code),
# then runs BOTH lines in THEIR terminal, so the PAT stays local and never enters the chat.
CRED=$(printf '%s' 'you@example.com:YOUR_PAT' | base64 | tr -d '\n')
claude mcp add --scope user --transport http connect-mgmt https://mcp.cloud.cdata.com/mcp/mgmt --header "Authorization: Basic $CRED"
```

OAuth alternative (short-lived, self-refreshing) — register without the header, then authenticate:

```bash
claude mcp add --scope user --transport http connect-mgmt https://mcp.cloud.cdata.com/mcp/mgmt
# then in Claude Code:  /mcp → connect-mgmt → Authenticate
```

Then have the user **restart Claude Code** so the tools load, and re-invoke the request. See the
onboarding skill for the full PAT-vs-OAuth walkthrough, callback-URL troubleshooting, and the
"can't reach the CLI" fallback.

## Connections

The connection tools, and the exact order to use them in:

| Goal | Tool | Notes |
|---|---|---|
| List saved connections | `list_connections` | returns `id`, `name`, source type |
| List connectable sources | `list_available_sources` | authoritative; returns each source's `newConnectionUrl` |
| Inspect a source's full config schema | `get_source_properties(source)` | `basic` + `advanced` fields; for "what can I configure" questions |
| Get just the required fields to ask for | `prepare_connection(source)` | returns `requiredFields` (internal name, display name, description) |
| Create the connection | `create_connection(name, source, properties)` | OAuth-only; `properties` keyed by exact field name |
| Verify a connection works | `test_connection(id)` | run after create + after the user finishes OAuth sign-in |

### Create-a-connection workflow (OAuth sources)

1. **Resolve the source.** Call `list_available_sources` and match the user's request to a real
   `source` internal name. If it isn't in the allow-list of OAuth sources, relay its `newConnectionUrl`
   verbatim and stop — non-OAuth setup happens in the admin UI.
2. **Gather the required fields.** Call `prepare_connection(source)`. For each `requiredFields` entry,
   ask the user in chat for the actual value. These are **non-secret** config fields (URL, domain,
   instance). Never invent values, and never accept or request a password/API key/secret here — if the
   source needs one, it isn't an OAuth source (step 1).
3. **Create.** Call `create_connection(name, source, properties)` with every required field set. Do not
   send an `AuthScheme`. The tool validates and returns an actionable error if a field is missing.
4. **Sign in.** The connection now needs its browser OAuth sign-in (done by the user, outside the
   chat). Point them to it.
5. **Test.** Once they've signed in, call `test_connection(id)` and report success or the specific
   error returned.

Allow-listed OAuth sources (as of 2026-09): GitHub, GoogleCalendar, HubSpot, JIRA, SharePoint, Slack,
Asana, ExactOnline, ExcelOnline, Facebook, FacebookAds, GoogleAds, GoogleAnalytics, GoogleDrive,
GoogleSheets, LinkedInAds, Office365, OneNote, QuickBooksOnline, Salesforce, Square, SurveyMonkey,
Xero, ZohoCRM. Always confirm against `list_available_sources` rather than this list.

## Toolkits

A **toolkit** is a bundle of connections exposed to Data Copilot / MCP clients — and every toolkit is
itself a remote MCP server (`mcp_remote_server_url`, returned by `create_toolkit`, `get_toolkit`,
`list_toolkits`). So this skill can assemble a scoped MCP server that `connect-ai-base` then queries.

| Goal | Tool |
|---|---|
| List toolkits (incl. `mcp_remote_server_url`, `isActive`, tool counts) | `list_toolkits` |
| Full state of one toolkit | `get_toolkit(toolkit_id)` |
| Create an empty toolkit | `create_toolkit(name)` |
| Rename | `rename_toolkit(toolkit_id, name)` |
| Set server-level instructions / guardrails (empty string clears) | `update_toolkit_server_instructions(toolkit_id, server_instructions)` |
| Activate / deactivate (deactivate = closest to delete) | `set_toolkit_active(toolkit_id, active)` |
| List the connections in a toolkit | `list_toolkit_tools(toolkit_id)` |
| Full op state for one connection in a toolkit | `get_toolkit_tool(toolkit_id, tool_id)` |
| Attach a connection to a toolkit | `add_tool_to_toolkit(toolkit_id, connection_id)` |
| Toggle one op | `set_tool_op_enabled(toolkit_id, tool_id, kind, op_name, enabled)` |
| Toggle every op of a kind | `set_all_tool_ops_enabled(toolkit_id, tool_id, kind, enabled)` |
| Set per-source-op AI instructions | `update_source_tool_instructions(toolkit_id, tool_id, source_op_name, instructions)` |
| List custom SQL tools | `list_custom_tools(toolkit_id)` |
| Activate / deactivate a custom tool | `set_custom_tool_active(toolkit_id, custom_tool_id, active)` |

Notes that change how you drive these:

- **`kind` is `universal` or `source`.** Universal ops are the built-in SQL-flavored tools
  (`execute_select`, `get_tables`, …); source ops are driver-specific (JIRA's `get_issue`, …).
  Auto-included universal ops are unaffected by the bulk toggle.
- **`tool_id` is the connection's id inside the toolkit.** `add_tool_to_toolkit` takes a
  `connection_id` (from `list_connections`), which becomes the `tool_id` used by the toggle tools.
  `add_tool_to_toolkit` is idempotent — safe to call if already attached.
- **Custom SQL tools can only be toggled here, not authored.** Creating or editing a custom tool's SQL,
  parameters, or name is admin-UI only — `list_toolkit_tools` returns `admin_ui_create_custom_tool_url`
  and `list_custom_tools` returns `admin_ui_edit_url`; relay those.
- **Never pick inputs for the user.** Which toolkit, which connection, which ops to expose are the
  user's choices — when unspecified, list the options (via the `list_*` tools) and ask.

### Wiring a toolkit into Claude Code

`create_toolkit` / `list_toolkits` return `mcp_remote_server_url`. To use the toolkit's tools, register
that URL as an MCP server the same way as Setup above (PAT + Basic, or OAuth), then query it through
`connect-ai-base`. (The `connect-ai-manage` skill's `mcp-command` helper can assemble the
`claude mcp add` line, base64-encoding `username:PAT`, if the user prefers.)

## What this skill does NOT do

Route these to `connect-ai-manage` (direct REST) — the Management MCP has no tools for them:

- **Workspaces** and data assets
- **Jobs** — cache jobs and scheduled queries
- **Users, roles, invites**
- **Personal Access Tokens** (mint / revoke)
- **Billing** — subscription and usage
- **Hard deletes** of connections/toolkits, and **custom-tool SQL edits** (admin UI / REST)

For querying or writing data in any connected source, route to `connect-ai-base` (+ the connector
skill), or `connect-ai-direct` when no MCP connector is available.
