# Workspaces & Toolkits

Manage Connect AI **Workspaces** (curated sets of data assets) and **Toolkits** (Data Copilot tool bundles, exposable as MCP servers) through the Admin UI BFF at `https://cloud.cdata.com/api/ui/*`. All work goes through the bundled helper [`scripts/cdata_workspaces.py`](../scripts/cdata_workspaces.py), which handles auth, request shaping, and parsing so each operation is a single reliable command.

Run everything as: `python scripts/cdata_workspaces.py <command> [flags]` (Windows: use `py` if `python` isn't on PATH)

> The most common operations are also wrapped as CLI commands (`workspaces`, `workspace-create`, `toolkits`, … — see [cli.md](cli.md)). The Python helper is the full-featured surface (grouped tool views, asset batches, `claude mcp add` assembly).

## Token handling

The helper resolves a Bearer token in this order:
1. `--token VALUE`
2. `CDATA_TOKEN` environment variable
3. Token file `~/.cdata_token` (overridable with `--token-file` or `CDATA_TOKEN_FILE`)
4. **The skill's Auth0 CLI cache** (`%LOCALAPPDATA%\CData\connect-auth.json`) — so if you've run `node scripts/connect-cli.mjs login`, the helper just works with no extra setup.

In **Claude Code**, sign in once with the CLI and forget about tokens. The helper exits with **code 3** on any 401/403 — when that happens re-run `node scripts/connect-cli.mjs login` (it silently refreshes) and retry; only fall back to asking the user to paste a browser token if the CLI can't run (**Claude Chat**, token saved to `~/.cdata_token`). Never silently fail. Run `verify` first on the session's first workspace/toolkit request; if it prints `OK`, proceed.

The token is never printed back, pasted into chat, or committed anywhere.

## When the user asks generally ("work with workspaces")

Don't start any operation on your own. Ask which area, then list that area's operations and wait:

```
Workspaces — what would you like to do?
  1. List workspaces
  2. Create a workspace
  3. Open / get a workspace
  4. List the assets in a workspace
  5. Delete a workspace
  6. Add data assets to a workspace (from a connection)
```

```
Toolkits — what would you like to do?
  1. List toolkits
  2. Create a toolkit
  3. List the tools in a toolkit
  4. Delete a toolkit
  5. Get a toolkit's MCP URL
  6. Configure a toolkit as an MCP server in Claude Code (claude mcp add)
```

When the user's opening message already names a specific operation ("list my workspaces", "create a toolkit called X"), skip the menus and do exactly that one thing. Never chain operations the user didn't ask for, and never pick inputs on their behalf — which workspace, which connection, which schema, which tables are all the user's choices. When something is needed and unspecified, list the available options and ask; don't guess.

## Commands

### Workspaces

| Operation | Command |
|-----------|---------|
| Verify token | `verify` |
| List workspaces | `list-workspaces` (add `--json` for raw) |
| Create workspace | `create-workspace --name "NAME"` |
| Get workspace (metadata + asset count) | `get-workspace --id WORKSPACE_ID` |
| List assets in a workspace | `list-assets --id WORKSPACE_ID` (add `--json` for raw) |
| Delete workspace | `delete-workspace --id WORKSPACE_ID` |
| List connections (catalogs) | `list-connections [--filter TEXT]` |
| List schemas in a catalog | `list-schemas --catalog CONNECTION_NAME` |
| List tables in a schema | `list-tables --catalog CONNECTION_NAME --schema SCHEMA` |
| Add assets to a workspace | `create-assets --workspace-id ID --connection-id ID --schema SCHEMA --tables T1,T2` |

### Toolkits

| Operation | Command |
|-----------|---------|
| List toolkits | `list-toolkits` (add `--json` for raw) |
| Create toolkit | `create-toolkit --name "NAME"` |
| List tools in a toolkit | `list-tools --toolkit-id TOOLKIT_ID` (`--raw` for flat records, `--json` for raw) |
| Delete toolkit | `delete-toolkit --id TOOLKIT_ID` |
| Get a toolkit's MCP URL | `toolkit-url --toolkit-id TOOLKIT_ID` |
| Build/run `claude mcp add` for a toolkit | `mcp-command --toolkit-id ID --user USER --pat PAT [--name NAME] [--scope local\|user\|project] [--run]` |

> **Not implemented yet:** "Create tool" (`POST /toolkits/{id}/tools`) and "Activate
> toolkit" (`PATCH /toolkits/{id}/activate`). The endpoints exist but their exact
> behavior/payloads weren't pinned down — add them once confirmed. (New toolkits
> already come back with `isActive: true`.)

## How the pieces relate

A **connection** is the catalog: its `name` is what the schema/table endpoints take as `catalogName`, and its `id` (a GUID) is the `ConnectionId` used when creating assets. Schemas belong to a catalog; tables/views belong to a schema. To add an asset you need: target `workspace-id`, the connection's `connection-id`, the `schema`, and one or more table names.

## Workflows

Pick IDs by name for the user — never make them hunt for a GUID. When an operation needs a workspace, connection, schema, or table and the user hasn't named one unambiguously, list the options and ask which.

### List workspaces
Run `list-workspaces`. Present names (with asset counts) in a readable list.

### Create a workspace
Confirm the intended name, run `create-workspace --name "..."`, report the new workspace's id and name.

### Open / get a workspace
If the user named it, resolve the name to its id from `list-workspaces`, then `get-workspace --id ...`. If ambiguous or unspecified, show the list and ask which to open.

### List assets in a workspace
Resolve the workspace by name → id (ask if unclear), then `list-assets --id ...`. This calls the `/children` endpoint and shows each asset's alias, source schema.table, type, and driver. `get-workspace` only returns the count; use `list-assets` when the user wants to see the actual contents.

### Delete a workspace
Always `list-workspaces` first and confirm *which* one (by name) the user means — deletion is destructive and not reversible. Echo back the name + id and get a clear go-ahead before `delete-workspace --id ...`.

### Add assets from a connection
This is the multi-step one. Walk it:
1. `list-connections` (use `--filter` if the user mentioned a source like "Confluence" or "Salesforce") and let the user pick the connection. Capture its `name` (catalog) and `id` (ConnectionId).
2. `list-schemas --catalog <name>`. If one schema, use it; if several, ask.
3. `list-tables --catalog <name> --schema <schema>` and let the user choose which tables/views to add (they may say "all" or name specific ones).
4. Resolve the target workspace (by name → id; ask if unclear).
5. `create-assets --workspace-id <id> --connection-id <id> --schema <schema> --tables Comma,Separated,Names`.

The helper defaults `AssetType=1` and `DataAssetCategory=1` (standard table/view asset), matching what the UI sends; override with `--asset-type` / `--data-asset-category` only if the user has a specific reason.

### List toolkits
Run `list-toolkits`. Shows each toolkit's id, active flag, and name. The raw `--json` form also embeds each toolkit's `tools`, so you rarely need a second call just to see what's inside.

### Create a toolkit
Confirm the intended name, run `create-toolkit --name "..."`, report the new toolkit's id and name. (It comes back `isActive: true`.)

### List tools in a toolkit
Resolve the toolkit by name → id from `list-toolkits` (ask if unclear), then `list-tools --toolkit-id ...`.

Important: each **data source** added to a toolkit is stored as **two backend records** — a `universal` tool (SQL-style operations: Query Data, Get Tables, …) and a `source` tool (the data-source-specific operations: List Pages, Create Page, …). The UI collapses both into one card per source with "X/Y Universal" and "A/B Source" badges. So the raw `/tools` endpoint returns twice as many records as cards shown in the UI.

The default `list-tools` output mirrors the UI: one entry per data source, showing how many operations are enabled out of the total under each of Universal and Source, and listing the enabled operation names. Counts come from `config.operations[].enabled` (universal) and `config.configuration[].isActive` (source). Use `--raw` if the user actually wants the flat per-record list, or `--json` for the full payload.

### Delete a toolkit
Destructive — same care as deleting a workspace. `list-toolkits` first, confirm the name + id with the user, then `delete-toolkit --id ...`.

### Configure a toolkit as an MCP server in Claude Code
Every toolkit is exposed as a remote MCP server at `https://mcp.cloud.cdata.com/mcp/toolkits/{toolkitId}` (the BFF doesn't return this field — it's derived from the id; `toolkit-url` just prints it). To wire it into Claude Code:

```
claude mcp add --transport http <ToolkitName> https://mcp.cloud.cdata.com/mcp/toolkits/<id> \
  --header "Authorization: Basic <base64(username:PAT)>"
```

Authentication is **HTTP Basic** using `base64(username:PAT)` — a CData **Personal Access Token**, *not* the Bearer JWT this skill uses for the BFF. (The JWT is only for `cloud.cdata.com/api/ui/*`; the MCP endpoint wants Basic+PAT. The native Claude Desktop connector is the other supported path.) Need a PAT? The skill can mint one — see [user-management-billing.md](user-management-billing.md#pats).

`mcp-command` assembles this for you: it fills the server name (from the toolkit) and URL, and base64-encodes the `username:PAT`. Steps:
1. Resolve the toolkit (by name → id) the user wants to expose.
2. Ask the user for their **CData username** (login email) and a **PAT** — these aren't the Bearer token and the skill doesn't store them.
3. Run `mcp-command --toolkit-id ID --user USER --pat PAT` to print the command for the user to copy, or add `--run` to execute `claude mcp add` directly (preferred, so the base64-encoded secret isn't echoed into the chat).

Security: `base64(username:PAT)` is encoding, not encryption — treat the printed command as a secret. Prefer `--run`. Default scope is `local` (this project); use `--scope user` to make the server available across all the user's projects.

> **Note (ground-rule 2 interplay):** registering a toolkit as an MCP server is **for the user's other tools/sessions**. This skill itself still doesn't consume MCP connectors — it keeps using the Auth0 + `/api/ui/*` path.

## Notes
- The connections list is large (hundreds). Always narrow with `--filter` before showing it.
- `list-tables` may return duplicate rows from the API; the helper de-duplicates.
- Output is a compact table by default; pass `--json` to the list commands when you need exact field values to feed into a later step.
