---
name: connect-ai-onboarding-claude-code
description: Use this skill when an existing Claude Code user wants to connect Claude Code to CData Connect AI for the first time — signing up for a Connect AI account, authenticating Claude Code to the Connect AI MCP server (via a Personal Access Token by default, with browser OAuth as an alternative), connecting a data source, and running a first query. Trigger phrases include "set me up with Connect AI", "connect Claude Code to Connect AI", "onboard me to Connect AI", "how do I use Connect AI in Claude Code", "I don't have a Connect AI account yet". Skip the steps about installing Claude Code or creating a Claude Code account — this audience already uses Claude Code.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
---

# Claude Code Onboarding Skill — Connect Claude Code to CData Connect AI

This skill walks an existing Claude Code user through everything needed to start using **CData Connect AI** — a managed MCP server that gives Claude live, contextual, governed SQL access to hundreds of business data sources (Salesforce, HubSpot, Jira, NetSuite, SAP, Snowflake, Google Analytics, and more).

The user is assumed to already have Claude Code installed and signed in. **Do not** walk them through installing the CLI, creating a Claude account, or running `npm install -g @anthropic-ai/claude-code`. Start at Connect AI sign-up.

**Auth model:** Connect AI's MCP endpoint accepts two auth methods. The **default path is a Personal Access Token (PAT) + Basic auth**: the user generates a PAT in the Connect AI console and Claude Code sends it in an `Authorization: Basic` header. Crucially, **the PAT never enters the AI session** — Claude hands the user a registration command that they run in their *own* terminal, so the credential stays local and out of the conversation transcript. This works on every surface — interactive or headless — and does **not** depend on the OAuth authorization server whitelisting Claude Code's dynamically-chosen localhost callback (a `redirect_uri` / "Callback URL mismatch" there is a common cause of OAuth failures). **Browser-based OAuth** is offered as an *alternative* (further down in Step 2) for users who prefer short-lived, self-refreshing tokens and whose Connect AI OAuth app has the Claude Code callback URL whitelisted — Connect AI's MCP endpoint is a fully OAuth-compliant resource (advertises `WWW-Authenticate: Bearer` + protected-resource metadata, supports dynamic client registration, PKCE, and refresh tokens).

**Flow order:** Authentication identifies the *user*, not a specific dataset, so Claude Code can be wired up immediately after sign-up — before any data source exists. The order is: sign up → **connect Claude Code to Connect AI** → connect a data source → verify. (Authenticating with zero data sources is fine; `getCatalogs` simply returns empty until a source is added.)

## Delivery style

Walk the user through the steps **one at a time** — never dump them all at once. After each step, end with exactly one line:

> Reply **next** when done — or tell me what went wrong.

Keep it identical every step so the user only has to remember one word. Do not ask multi-part questions, do not list optional details to report, do not offer alternative reply phrasings — that defeats the purpose. The exceptions are Step 0 (state detection, a multi-choice question), Step 1 (where it can help to ask which sign-up method the user picked), and the **PAT step in Step 2** (where the user runs a command in their own terminal and reports the result, rather than simply replying `next`).

**Do not** give a time estimate up front (e.g. "this takes ~10–15 minutes"). Time guesses can put users off before they start, and the actual time varies wildly depending on which data source they connect.

## When this skill applies

Activate when the user:
- Asks to be onboarded to Connect AI, or to wire Connect AI into Claude Code
- Mentions they don't yet have a Connect AI account
- Asks how to query their business data (CRM, ERP, support, analytics, databases) from Claude Code
- References the docs page `docs.cloud.cdata.com/en/Clients/ClaudeCode-Client`

## What the user will accomplish

By the end of this skill, the user will have:
1. A Connect AI account
2. The Connect AI MCP server registered with Claude Code and authenticated (PAT by default; OAuth as an alternative)
3. At least one data source connected inside Connect AI
4. A verified first query against their data

---

## Step 0 — Detect what the user already has, then jump to the right step

Before walking through anything, ask one question to find out where the user already is. Use the `AskUserQuestion` tool (or the equivalent in your harness) so the answers are mutually exclusive. The four states and where each one starts:

| Answer | Start at |
|---|---|
| "I'm completely new to Connect AI" | Step 1 |
| "I have a Connect AI account but Claude Code isn't connected to it yet" | Step 2 |
| "Claude Code is already connected to Connect AI, but I have no data source" | Step 3 |
| "I already have a Personal Access Token I want to reuse" | Step 2 (reuse existing PAT) |

Phrase the question conversationally — e.g. *"Before we start, which of these matches you right now?"* — and route the user to the matching step. Do not walk anyone through steps they have already completed; skipping ahead is the whole point of asking. If the user gives an answer that doesn't cleanly map, default to the earlier of the two relevant steps so nothing important is skipped.

---

## Step 1 — Sign up for CData Connect AI

The user does not have an account yet. **Open the sign-up page for them automatically** rather than asking them to navigate there — they should not have to copy-paste a URL. Launch it with the platform-appropriate command before listing the rest of the steps:

- Windows (PowerShell): `Start-Process "https://cloud-login.cdata.com/u/signup"`
- macOS: `open "https://cloud-login.cdata.com/u/signup"`
- Linux: `xdg-open "https://cloud-login.cdata.com/u/signup"`

If the command fails (headless/sandboxed environment with no browser), fall back to telling the user to open the URL manually. Then direct them as follows:

1. The sign-up page (**https://cloud-login.cdata.com/u/signup**) should now be open in your browser — if it didn't pop up, open it manually.
2. Sign up using either:
   - **Email + name + password** — enter the user's email address and name, set a password, then submit, or
   - **SSO** — click the **LinkedIn**, **Microsoft**, or **Google** button and authorize (no password is set on the CData side; the SSO provider handles auth).
3. **Verify the email address** — this is a required prerequisite. CData sends a confirmation email; click the link inside before continuing. Sign-up is not complete until the address is verified.
4. Sign in to the Connect AI console at **https://cloud.cdata.com/**.

If the user already has a CData Cloud / Connect Cloud account, that same account works — they can sign in directly without re-registering.

## Step 2 — Connect Claude Code to Connect AI (register the MCP server and authenticate)

Wire Claude Code to Connect AI now, before any data source exists — auth identifies the user, so it works with an empty account. The **default path is a PAT + Basic auth**, and the **PAT is never pasted into this chat**: Claude hands the user a command to run in their *own* terminal, so the credential stays on their machine and out of the AI session transcript. It works on every surface (interactive or headless). The **OAuth alternative** (further down) is for users who'd rather sign in through the browser with short-lived, self-refreshing tokens.

### PAT path (default)

**The credential must never enter the AI session.** Do **not** ask the user to paste their PAT, their `username:PAT`, or the encoded header into the chat, and do not run the registration command yourself. Claude's only job here is to hand over a ready-to-run command; the **user runs it in their own terminal** and reports back. This keeps a long-lived secret out of the conversation transcript.

**1. Generate the PAT** (skip if reusing one). Two equivalent places to create one — prefer the first:
- **Integrations → Claude Code → Connect** — the purpose-built flow. Opens a modal showing the **MCP Endpoint** (`https://mcp.cloud.cdata.com/mcp`), your **Username** (your email), and a **[+ Create PAT]** button. Click **[+ Create PAT]**, name the token, **Create**.
- **Settings → Personal Access Tokens** — the documented fallback, if the Integrations modal isn't available. Click **Create PAT**, name the token, **Create**.

Either way, **copy the PAT immediately** from the dialog — the console will not show it again. Treat it like a password.

**2. Run the registration command in your own terminal** (PowerShell, Windows Terminal, Git Bash, macOS Terminal, iTerm2, bash, zsh — anywhere `claude` is on PATH). Hand the user the command for their platform; it Base64-encodes the credential inline, so they never hand-encode and the PAT only ever exists in their local shell:

- **Windows (PowerShell):**
  ```powershell
  $cred = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("you@example.com:YOUR_PAT"))
  claude mcp add --transport http connectmcp https://mcp.cloud.cdata.com/mcp --header "Authorization: Basic $cred"
  ```
- **macOS / Linux (bash/zsh):**
  ```bash
  CRED=$(printf '%s' 'you@example.com:YOUR_PAT' | base64 | tr -d '\n')
  claude mcp add --transport http connectmcp https://mcp.cloud.cdata.com/mcp --header "Authorization: Basic $CRED"
  ```

Tell the user to replace `you@example.com:YOUR_PAT` with their own email and the PAT they just copied — keep the colon between them and keep the quotes.

**3. Confirm and restart.** The command should print `Added http MCP server connectmcp`. Ask the user to confirm they saw that line. No `/mcp` authenticate step is needed on this path — the header carries the credential. Then tell them to **restart Claude Code** so the new tools load, and **re-invoke this skill** — Step 0 will route them to Step 3 (connect a data source).

Because the user runs the command outside this session, Claude can't read its output — rely on their confirmation. If they hit an error, ask them to paste the **error message only**, never the command or credential.

### OAuth alternative (browser sign-in)

Offer this when the user prefers short-lived, self-refreshing tokens over a PAT. It requires an interactive browser, so it does **not** work on headless/sandboxed/remote surfaces — use the PAT path there.

Unlike the PAT path, this registration carries **no secret**, so Claude can run it directly. First confirm Claude can reach the CLI:
```bash
claude --version
```
- **Succeeds** with a version string → Claude runs the `claude mcp add` registration below.
- **Fails** (`claude` not found, or the Bash tool is sandboxed) → hand the user the registration command to run themselves (see the **"Can't reach the CLI" note**), then route them through `/mcp` → Authenticate.

**Heads-up on the callback URL.** OAuth requires Claude Code's localhost callback (`http://localhost:<port>/callback`) to be in the authorization server's allowed-callback list. Claude Code picks a random port each run, which can fail with **"Callback URL mismatch" / `redirect_uri` not in the allowed list**. If that happens, the reliable fallback is the **PAT path** above; users whose Connect AI OAuth app lets them register a callback can pin a matching port with `--callback-port <port>` (see step 3).

1. Register the server (no credential header — Connect AI will drive OAuth):
   ```bash
   claude mcp add --transport http connectmcp https://mcp.cloud.cdata.com/mcp
   ```
   Confirm the CLI prints `Added http MCP server connectmcp` or similar.

2. Tell the user to **restart Claude Code** so the new server loads, then authenticate it:
   - Run **`/mcp`** in Claude Code, select **connectmcp**, and choose **Authenticate**.
   - A browser opens to **`cloud-login.cdata.com`**. Sign in / approve. The localhost callback completes automatically and Claude Code stores the token (it refreshes itself via `offline_access` — no re-auth every session).

   The OAuth click-through happens inside the user's interactive Claude Code session — Claude cannot perform it through the Bash tool. Claude's job is to run the `claude mcp add` registration and then route the user through `/mcp` → Authenticate.

3. If authentication fails with **"Callback URL mismatch"** / `redirect_uri` not in the allowed list, Claude Code's localhost callback port isn't in the OAuth app's allowed list. Easiest fix: use the **PAT path** above. To stay on OAuth, re-add the server with `--callback-port <port>` set to a port whose `http://localhost:<port>/callback` is registered in the Connect AI OAuth app's Allowed Callback URLs (a Connect AI admin can confirm or add allowed ports).

4. Because registering + authenticating requires a restart, the skill conversation ends here for this session. Tell the user that after they've restarted and signed in, they should **re-invoke this skill** — Step 0 will route them to Step 3 (connect a data source).

### "Can't reach the CLI" note

The **PAT path always runs in the user's own terminal**, so it needs nothing from Claude here — the platform commands in the PAT path above are already the ready-to-run blocks. This note only matters for the **OAuth alternative**, where Claude would normally run the registration itself. If `claude --version` failed, hand the user the command to paste into any terminal where `claude` is on PATH (PowerShell, cmd, Windows Terminal, Git Bash, bash, zsh, macOS Terminal, iTerm2, etc.):

```
claude mcp add --transport http connectmcp https://mcp.cloud.cdata.com/mcp
```
then restart Claude Code and run `/mcp` → connectmcp → Authenticate. If sign-in returns "Callback URL mismatch," add `--callback-port <port>` for a port registered in the OAuth app, or use the PAT path.

## Step 3 — Connect a data source

Now give Claude something to query. **Open the connection picker for them automatically** — the same way Step 1 opens the sign-up page. Deep-link directly to the "Select Connection" page so they don't have to hunt through the nav:

- Windows (PowerShell): `Start-Process "https://cloud.cdata.com/connections/SelectConnection"`
- macOS: `open "https://cloud.cdata.com/connections/SelectConnection"`
- Linux: `xdg-open "https://cloud.cdata.com/connections/SelectConnection"`

If the launch fails (headless/sandboxed), tell the user to open **https://cloud.cdata.com/connections/SelectConnection** manually (equivalent to **Connections → Add Connection** in the left nav). Then:

1. The connection picker (**https://cloud.cdata.com/connections/SelectConnection**) should now be open — if it didn't pop up, open it manually.
2. Pick the connector for the data source the user wants Claude to reach (Salesforce, HubSpot, Jira, Snowflake, Postgres, Google Analytics, etc. — hundreds available).
3. Complete the auth flow for that source (usually OAuth — click **Authorize** and sign in to the source system) and **Save & Test**.
4. Confirm the connection shows a green/"Connected" status.

Tip: encourage the user to start with one source they know well — it makes the first Claude query meaningful.

> Note: per-connector deep-linking (jump straight to a specific connector's config page) is not yet supported by the Connect AI UI — `SelectConnection` is the deepest stable link. Revisit if/when the UI exposes per-connector URLs.

## Step 4 — Verify the connection (Claude runs the check, not the user)

Do not ask the user to type a verification query. Run the check yourself by calling the Connect AI MCP `getCatalogs` tool directly, then show the result formatted as a small table.

By this point the user has registered + authenticated (Step 2) and restarted, so the **connectmcp** server should already be loaded in the session. Just call `getCatalogs` and show the result.

- If it's still not loaded (the user reached here without restarting after Step 2), tell them to **restart Claude Code**, finish auth if they haven't (on the OAuth alternative, complete `/mcp` → Authenticate), then re-invoke this skill at "Step 4 — verify."
- When the check succeeds, show the catalogs as a compact table (catalog name, source, permissions) and explicitly state the connection is verified end-to-end.
- If `getCatalogs` returns empty, auth works but no data sources are connected — route the user back to Step 3.
- If `getCatalogs` fails with a 401 / auth error, follow the Troubleshooting section.

## Step 5 — You're connected — start talking to your data

This is the closing step. Make three things unmistakable:

1. **The onboarding process is done.** No more configuration is required. Connect AI is wired into Claude Code and ready to use.
2. **The user can now talk to their business data in natural language** — no SQL, no exports, no copy-paste between dashboards. Connect AI handles the SQL translation, governance, and result shaping; Claude handles the conversation.
3. **More sources can be added anytime** by repeating Step 3 in the Connect AI console. Every additional source becomes immediately queryable from Claude Code, and Claude can **join and query across sources** in a single question (e.g. Salesforce opportunities + Jira tickets in one prompt).

Then suggest one or two starter queries that match the catalogs the user actually connected — pick from whichever of these apply:

- Salesforce → *"Top 10 open opportunities by amount."*
- Jira → *"Open bugs assigned to me, sorted by priority."*
- Google Analytics → *"Top 20 landing pages by sessions over the last 7 days."*
- Asana → *"Tasks due this week across all projects."*
- Confluence → *"Most recently updated pages."*
- HubSpot → *"How many MQLs did we generate last month, by source?"*
- Snowflake / Postgres → *"Describe the `orders` table and give me row counts by month."*

End the skill there. Do not add another `Reply **next**` prompt — there's nothing after this.

---

## Troubleshooting

- **401 / auth errors when listing catalogs (PAT path)** → re-check the Base64 string. Common mistakes: encoding `PAT:email` instead of `email:PAT`, including a trailing newline, or wrapping the PAT in quotes before encoding.
- **PAT lost** → it cannot be recovered; revoke it in **Settings → Personal Access Tokens** and generate a new one (or re-run the **Integrations → Claude Code → Connect** flow), then re-run the Step 2 PAT path to re-register.
- **Server registered but Claude doesn't call its tools** → restart the Claude Code session so the new MCP server is loaded.
- **`claude mcp add` not found** → the user's `claude` CLI may be outdated. Have them run `claude --version` and update if needed. (Do *not* walk them through reinstalling unless they ask.)
- **OAuth fails with "Callback URL mismatch" / `redirect_uri` not in allowed list (OAuth alternative)** → Claude Code's localhost callback port isn't in Connect AI's allowed-callback list (the port is chosen randomly each run). Easiest fix: use the default **PAT path**. To stay on OAuth, pin `--callback-port <port>` to a port registered in the Connect AI OAuth app, or have a Connect AI admin add `http://localhost:<port>/callback` for your chosen port.
- **OAuth browser flow doesn't open / no browser available (OAuth alternative)** → the surface is headless or sandboxed. Use the **PAT path**, which needs no browser.
- **OAuth completes but tools still don't appear** → restart Claude Code; newly-authenticated MCP servers load on session start. Re-check with `/mcp` that **connectmcp** shows as authenticated.
- **401 / auth errors (OAuth alternative)** → the token may have expired or been revoked; run `/mcp` → connectmcp → Authenticate again.
- **Empty catalog list** → auth works but no data sources are connected yet. Go back to Step 3.

## Reference

- Official docs: https://docs.cloud.cdata.com/en/Clients/ClaudeCode-Client
- Connect AI MCP endpoint: `https://mcp.cloud.cdata.com/mcp`
- Connect AI console: https://cloud.cdata.com/
- OAuth metadata (for reference): protected-resource at `https://mcp.cloud.cdata.com/.well-known/oauth-protected-resource`; authorization server `https://cloud-login.cdata.com/` (authorize `/authorize`, token `/oauth/token`, dynamic registration `https://mcp.cloud.cdata.com/register`).
