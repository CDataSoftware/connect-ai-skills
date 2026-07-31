#!/usr/bin/env node
/**
 * connect-cli.mjs — CData Connect AI command-line interface.
 *
 * Zero-dependency (Node 18+ built-ins only). The Connect AI analogue of the
 * Membrane CLI: it owns Auth0 sign-in (browser once, then silent refresh) and
 * wraps the Connect AI REST surface as clean subcommands. A skill/agent can
 * drive every operation by shelling out to this file — no hand-built HTTP.
 *
 *   node connect-cli.mjs login
 *   node connect-cli.mjs catalogs
 *   node connect-cli.mjs query "SELECT [Id],[Name] FROM [Cat].[Schema].[Table] LIMIT 10"
 *
 * Auth: Auth0 only (the embedded driver OAuth client + oauth.cdata.com bounce
 * server). No PAT. Tokens cache in the same file the PowerShell helper uses, so
 * one sign-in serves both. Output is JSON on stdout; errors are {"error":"..."}
 * on stdout with exit code 1. Diagnostics go to stderr.
 *
 * Publishable later as @cdata/connect-cli (add package.json + bin) with no code
 * change — then `npx @cdata/connect-cli <cmd>`.
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { URL, URLSearchParams } from 'node:url';

// ---------------------------------------------------------------------------
// Constants (PROD). Override the API host with --host for non-prod.
// ---------------------------------------------------------------------------
const AUTH_DOMAIN      = 'https://cloud-login.cdata.com';
const AUDIENCE         = 'https://cloud.cdata.com/api';
const SCOPE            = 'offline_access';
const REGISTERED_REDIR = 'https://oauth.cdata.com/oauth/';
const DEFAULT_API_BASE = 'https://cloud.cdata.com';
const DEFAULT_PORT     = 33333;
// Embedded driver OAuth client (AES-128-ECB/PKCS7, key "_rssbus_" padded to 16).
const ENC_CLIENT_ID     = 'sXU4nPhfXkEJOYXFG2fXu6B+jx1SxAql3vxq77zvc1NaIeCMmgRgQMcd2XGT537i';
const ENC_CLIENT_SECRET = 'WLdy5OMuJCpMnlc6cdX7PNQx9hX/+gCEc4Hh9LnsW3T7VL2bwh9SyFP9y5n8vxl7S8rTB98ETv4ucYumgl6R41oh4IyaBGBAxx3ZcZPnfuI=';

let API_BASE = DEFAULT_API_BASE;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cacheFile() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'CData', 'connect-auth.json');
  }
  return path.join(os.homedir(), '.config', 'CData', 'connect-auth.json');
}

function decryptCred(b64) {
  const key = Buffer.from('_rssbus_        ', 'ascii'); // 16 bytes
  const d = crypto.createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(true); // PKCS7
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8').replace(/\s+$/, '');
}
function creds() {
  return { clientId: decryptCred(ENC_CLIENT_ID), clientSecret: decryptCred(ENC_CLIENT_SECRET) };
}

function httpRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function readCache() {
  try {
    let s = fs.readFileSync(cacheFile(), 'utf8');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // strip BOM (PowerShell writes UTF-8 BOM)
    return JSON.parse(s);
  } catch { return null; }
}
function writeCache(obj) {
  const f = cacheFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 });
}
function clearCache() { try { fs.unlinkSync(cacheFile()); return true; } catch { return false; } }

async function tokenRequest(form) {
  const body = new URLSearchParams(form).toString();
  const r = await httpRequest(`${AUTH_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  if (r.status >= 400) throw new Error(`token endpoint HTTP ${r.status}: ${r.body.slice(0, 300)}`);
  return JSON.parse(r.body);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function browserLogin(c, port = DEFAULT_PORT, timeoutSec = 300) {
  return new Promise((resolve, reject) => {
    const localUrl = `http://localhost:${port}`;
    const state = Buffer.from(localUrl, 'utf8').toString('base64');
    const authUrl = `${AUTH_DOMAIN}/authorize?audience=${encodeURIComponent(AUDIENCE)}`
      + `&scope=${encodeURIComponent(SCOPE)}&state=${encodeURIComponent(state)}`
      + `&client_id=${encodeURIComponent(c.clientId)}&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REGISTERED_REDIR)}`;
    let timer;
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, localUrl);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (!code && !err) { res.writeHead(204); res.end(); return; } // ignore /favicon.ico etc.; keep waiting
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;padding:2em"><h2 style="color:#080">Sign-in complete. You can close this tab.</h2></body></html>');
        server.close(); clearTimeout(timer);
        if (err) return reject(new Error(`Auth0 error: ${err} ${u.searchParams.get('error_description') || ''}`));
        if (!code) return reject(new Error(`No code in callback: ${req.url}`));
        const realCode = Buffer.from(code, 'base64').toString('utf8'); // bounce server base64-encodes it
        const tok = await tokenRequest({
          grant_type: 'authorization_code', client_id: c.clientId, client_secret: c.clientSecret,
          code: realCode, redirect_uri: REGISTERED_REDIR,
        });
        resolve(tok);
      } catch (e) { try { server.close(); } catch {} reject(e); }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {   // loopback only — the OAuth callback comes from localhost; do not expose on the LAN
      process.stderr.write(`cdata-connect: opening browser for sign-in...\n`);
      process.stderr.write(`cdata-connect: if it doesn't open, visit:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
    timer = setTimeout(() => { try { server.close(); } catch {} reject(new Error(`Timed out after ${timeoutSec}s waiting for sign-in.`)); }, timeoutSec * 1000);
  });
}

// `silent: true` makes this a non-interactive check — it uses the cache or a
// silent refresh, but NEVER opens a browser; it returns null instead. The
// `status`/preflight command relies on this so "is there an active session?"
// can be answered without forcing a sign-in.
async function ensureToken({ fromScratch = false, port = DEFAULT_PORT, silent = false } = {}) {
  const c = creds();
  const now = Math.floor(Date.now() / 1000);
  if (fromScratch && !silent) clearCache();
  else {
    const cached = readCache();
    if (cached && cached.access_token) {
      if ((cached.expires_at || 0) - now > 300) return cached.access_token;
      if (cached.refresh_token) {
        try {
          const t = await tokenRequest({ grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: cached.refresh_token });
          writeCache({ access_token: t.access_token, refresh_token: t.refresh_token || cached.refresh_token, expires_at: now + (t.expires_in || 86400) });
          return t.access_token;
        } catch (e) {
          if (silent) return null;
          process.stderr.write(`cdata-connect: refresh failed (${e.message}); opening browser.\n`);
        }
      } else if (silent) return null; // expired, no refresh token, won't open a browser
    } else if (silent) return null;   // no cached session, won't open a browser
  }
  if (silent) return null;
  const t = await browserLogin(c, port);
  writeCache({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now + (t.expires_in || 86400) });
  return t.access_token;
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s; }

// Core API call. Centralizes auth header, SPA-trap detection, and the
// HTTP-200-error-envelope (error.code is a STRING like INVALID_REQUEST).
async function api(method, apiPath, { query = null, body = null } = {}) {
  const token = await ensureToken();
  let url = API_BASE + apiPath;
  if (query) { const qs = new URLSearchParams(query).toString(); if (qs) url += (url.includes('?') ? '&' : '?') + qs; }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let payload = null;
  if (body != null) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const r = await httpRequest(url, { method, headers, body: payload });
  if (typeof r.body === 'string' && /^\s*<(!doctype|html)/i.test(r.body)) {
    throw new Error(`SPA-routing trap: ${method} ${apiPath} returned HTML, not JSON. Use an /api/* JSON endpoint (not /odata, /api.rsc, /openapi).`);
  }
  let json = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch { /* leave null */ }
  if (r.status === 401) throw new Error(`HTTP 401 Unauthorized on ${apiPath}. Run "login --from-scratch" to re-authenticate.`);
  if (r.status >= 400) {
    const m = json && json.error ? `${json.error.code || r.status}: ${json.error.message || ''}` : `HTTP ${r.status}: ${truncate(r.body, 300)}`;
    const e = new Error(m); e.status = r.status; throw e;
  }
  if (json && json.error && (json.error.code || json.error.message)) {
    const e = new Error(`${json.error.code}: ${json.error.message}`); e.status = r.status; e.apiError = json.error; throw e;
  }
  return json;
}

// Shape a /api/query|batch|exec result into rows-of-objects for readability.
function shapeResult(resp) {
  if (!resp || !resp.results || !resp.results[0]) return resp;
  const out = resp.results.map((rs) => {
    const cols = (rs.schema || []).map((c) => c.columnName);
    const rows = (rs.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
    return { columns: cols, rowCount: rows.length, rows, affectedRows: rs.affectedRows };
  });
  const r = out.length === 1 ? out[0] : out;
  if (resp.parameters) return { result: r, parameters: resp.parameters };
  return r;
}

function out(obj, args) { process.stdout.write(JSON.stringify(obj, null, args.compact ? 0 : 2) + '\n'); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function need(args, name) {
  const v = args[name];
  if (v === undefined) throw new Error(`Missing required --${name}`);
  return v;
}
function parseJsonArg(v, name) {
  try { return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { throw new Error(`--${name} must be valid JSON. Got: ${truncate(String(v), 80)}`); }
}

// ---------------------------------------------------------------------------
// Jobs helpers (cache jobs + scheduled queries share the UI BFF; bodies and
// endpoints verified from a cloud.cdata.com HAR trace, June 2026)
// ---------------------------------------------------------------------------
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function fetchAllJobs() {
  const c = await api('GET', '/api/ui/cacheJobs/list');
  const s = await api('GET', '/api/ui/scheduledquery/list');
  const caching = (c && c.list) || [];
  const scheduled = (s && s.list) || [];
  for (const j of caching) j._kind = 'caching';
  for (const j of scheduled) j._kind = 'scheduledquery';
  return caching.concat(scheduled);
}

async function findJob(idOrName) {
  const jobs = await fetchAllJobs();
  const m = jobs.filter((j) => j.id === idOrName || j.name === idOrName);
  if (!m.length) throw new Error(`No job with id or name "${idOrName}". Run "jobs" to see options.`);
  if (m.length > 1) throw new Error(`Ambiguous: ${m.length} jobs match "${idOrName}". Use the id.`);
  return m[0];
}

function strToBool(v) { return ['1', 'true', 'yes', 'y', 't'].includes(String(v).trim().toLowerCase()); }

// ---------------------------------------------------------------------------
// Scripted OAuth (BFF handshake — same mechanism as the portal Sign In button,
// verified live on GoogleSheets, ExcelOnline, MSTeams, Salesforce, Instagram).
// Callback params are base64 — decode each exactly once; pass rssbus as "true".
// ---------------------------------------------------------------------------
function oauthPendingFile() { return path.join(path.dirname(cacheFile()), 'connect-oauth-pending.json'); }

function dec64(s) {
  if (!s) return s;
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}

// ---------------------------------------------------------------------------
// Driver-form distiller (auth schemes + required + credential props)
// ---------------------------------------------------------------------------
function distillDriver(d, wantScheme) {
  const props = d.properties || [];
  const authProp = props.find((p) => p.name === 'AuthScheme');
  const required = props.filter((p) => p.required === true && p.name !== 'AuthScheme').map((p) => ({ name: p.name, description: p.description }));
  const credentials = props.filter((p) => p.userCredential === true).map((p) => ({ name: p.name, description: p.description }));
  const scheme = wantScheme || (authProp && authProp.default) || '';
  const template = {};
  if (scheme) template.AuthScheme = scheme;
  for (const p of required) template[p.name] = `<${p.name}>`;
  for (const p of credentials) if (!(p.name in template)) template[p.name] = `<${p.name}>`;
  return {
    driver: d.name, niceName: d.niceName, category: d.category, version: d.version,
    defaultAuthScheme: authProp ? authProp.default : null,
    authSchemes: authProp ? authProp.values : null,
    required, credentials,
    template: { driver: d.name, properties: template },
  };
}

const HELP = `CData Connect AI CLI

Usage: node connect-cli.mjs <command> [options]

Auth:
  status | preflight                  Check for an ACTIVE Connect AI session + connections (silent; no browser). Run first.
  login [--from-scratch] [--port N]   Sign in via Auth0 (browser once; cached + refreshed)
  logout                              Clear the cached token (same as login --from-scratch next time)
  whoami                              Show the signed-in user (verifies data + admin access)

Discover & query:
  catalogs                            List data-source connections (catalogs)
  schemas   --catalog C               List schemas in a catalog
  tables    --catalog C --schema S    List tables/views
  columns   --catalog C --schema S --table T   List columns (auto-falls back to schemaOnly)
  query     "<SQL>" [--catalog C] [--schema S] [--params '<json>'] [--schema-only]
  exec      --procedure Cat.Schema.Proc --params '<json>'

Admin — connections & drivers:
  connections                         List all connections (rich detail)
  drivers   [--search term]           List installed drivers
  driver-form --driver D [--auth-scheme S]   Distill a driver's connection form
  connection-test   --name N                  Verify an existing connection (lists its schemas)
  connection-create --name N --driver D --props '<json>' [--no-verify]
  connection-delete --id ID --confirm

Scripted OAuth (no portal; see reference/oauth-without-portal.md):
  oauth-start  --driver D --name N [--props '<json>']   Get the provider consent URL
  oauth-finish --url "<callback URL>" [--props '<json>'] Exchange code + create the connection

Users, roles & PATs:
  users                               List all users
  roles                               List roles (integer id = system, UUID = custom)
  user-invite --email E --role N [--custom-role-ids '<json>'] [--permissions '<json>']
  user-update --id ID --set '<json>'  GET-merge-PUT (only pass changed fields)
  user-delete --id ID --confirm
  pats | pat-create --name N | pat-delete --id ID --confirm

Billing:
  subscription | usage

Workspaces & assets:
  workspaces | workspace-create --name N | workspace-get --id ID
  workspace-assets --id ID            List a workspace's assets (/children)
  workspace-delete --id ID --confirm
  assets-add --workspace-id ID --connection-id ID --schema S --tables T1,T2

Toolkits:
  toolkits | toolkit-create --name N | toolkit-tools --id ID
  toolkit-delete --id ID --confirm
  toolkit-url --id ID                 MCP URL (auth there = Basic base64(user:PAT), not JWT)

Jobs (cache jobs + scheduled queries):
  jobs                                Merged list of both kinds
  job-get --id ID_OR_NAME
  job-create --source-connection GUID --source-schema S --source-table T \
             --frequency N --frequency-unit U [--full-update bool] [--time-check-column C] [--body '<json>']
  scheduled-query-create --name N --query SQL --destination-connection GUID \
             --destination-schema S --destination-table T --frequency N --frequency-unit U [--body '<json>']
  job-update --id ID_OR_NAME [flags]  Fetches current job, overlays your flags
  job-run --id ID_OR_NAME | job-stop --id ID_OR_NAME
  job-delete --id ID_OR_NAME --confirm

Escape hatch:
  raw --method M --path /api/...  [--body '<json>'] [--query '<json>']

Global flags:
  --compact        single-line JSON output
  --host URL       override API base (default https://cloud.cdata.com)

Notes:
  * Output is JSON on stdout. Errors are {"error":"..."} on stdout, exit code 1.
  * DELETE SQL is blocked in the 'query' command only (advisory — exec / scheduled-query-create / raw can still issue it). Destructive admin ops (connection-delete, etc.) require --confirm.
  * On HTTP 200 the API can still carry {"error":{code,message}} — this CLI raises it as an error.`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (args.host && typeof args.host === 'string') API_BASE = args.host.replace(/\/$/, '');
  if (!cmd || cmd === 'help' || args.help) { process.stdout.write(HELP + '\n'); return; }

  switch (cmd) {
    case 'login': {
      await ensureToken({ fromScratch: !!args['from-scratch'], port: args.port ? Number(args.port) : DEFAULT_PORT });
      const me = await api('GET', '/api/ui/users/self');
      const cat = await api('GET', '/api/catalogs');
      const n = cat?.results?.[0]?.rows?.length ?? 0;
      out({ status: 'signed-in', user: me?.email || me?.userId || me?.name || me, catalogs: n }, args);
      return;
    }
    case 'logout': { out({ status: clearCache() ? 'logged-out' : 'no-cached-token' }, args); return; }
    case 'whoami': { out(await api('GET', '/api/ui/users/self'), args); return; }

    case 'status': case 'preflight': {
      // Preflight: is there an ACTIVE connection to Connect AI? Run this first,
      // before any task. It checks the session SILENTLY (never opens a browser)
      // and reports how many data-source connections exist.
      const token = await ensureToken({ silent: true });
      if (!token) {
        out({ status: 'no-session', signedIn: false, host: API_BASE,
          next: 'No active Connect AI session. Run: node connect-cli.mjs login (opens the browser once).' }, args);
        return;
      }
      let me;
      try { me = await api('GET', '/api/ui/users/self'); }
      catch (e) {
        out({ status: 'session-invalid', signedIn: false, host: API_BASE, detail: e.message,
          next: 'Session is no longer valid. Run: node connect-cli.mjs login --from-scratch.' }, args);
        return;
      }
      let connections = [];
      try {
        const r = await api('GET', '/api/ui/account/connections');
        connections = r.connections || r.results || r || [];
      } catch { /* session is still active even if listing connections hiccups */ }
      const recentlyUsed = connections
        .filter((c) => c.lastQueried)
        .sort((a, b) => String(b.lastQueried).localeCompare(String(a.lastQueried)))
        .slice(0, 5)
        .map((c) => ({ name: c.name, driver: c.driver, lastQueried: c.lastQueried }));
      out({
        status: 'active', signedIn: true, host: API_BASE,
        user: me.email || me.userId || me.name,
        connectionCount: connections.length,
        recentlyUsed,
        next: connections.length
          ? 'Active. Proceed with the requested task.'
          : 'Signed in, but no data-source connections exist yet. Create one (connection-create / oauth-start) before querying.',
      }, args);
      return;
    }

    case 'catalogs': { out(shapeResult(await api('GET', '/api/catalogs')), args); return; }
    case 'schemas': { out(shapeResult(await api('GET', '/api/schemas', { query: { catalogName: need(args, 'catalog') } })), args); return; }
    case 'tables': {
      const q = { catalogName: need(args, 'catalog'), schemaName: need(args, 'schema') };
      if (args.table) q.tableName = args.table;
      out(shapeResult(await api('GET', '/api/tables', { query: q })), args); return;
    }
    case 'columns': {
      const q = { catalogName: need(args, 'catalog'), schemaName: need(args, 'schema'), tableName: need(args, 'table') };
      const r = shapeResult(await api('GET', '/api/columns', { query: q }));
      if (r && r.rowCount === 0) {
        // Fallback: schemaOnly query (verified more reliable on some drivers)
        const sql = `SELECT * FROM [${q.catalogName}].[${q.schemaName}].[${q.tableName}] LIMIT 1`;
        const sr = await api('POST', '/api/query', { body: { query: sql, schemaOnly: true } });
        out({ via: 'schemaOnly-fallback', columns: (sr.results?.[0]?.schema || []).map((c) => ({ name: c.columnName, dataType: c.dataType, nullable: c.nullable })) }, args);
        return;
      }
      out(r, args); return;
    }
    case 'query': {
      const sql = args._[1];
      if (!sql) throw new Error('Usage: query "<SQL>"');
      if (/(^|;)\s*delete\s/i.test(sql)) throw new Error('DELETE is blocked by this CLI (safety). Use UPDATE ... SET Status=\'Archived\' or run it from the portal.');
      const body = { query: sql };
      if (args.catalog) body.defaultCatalog = args.catalog;
      if (args.schema) body.defaultSchema = args.schema;
      if (args['schema-only']) body.schemaOnly = true;
      if (args.params) body.parameters = parseJsonArg(args.params, 'params');
      out(shapeResult(await api('POST', '/api/query', { body })), args); return;
    }
    case 'exec': {
      const body = { procedure: need(args, 'procedure') };
      if (args.schema) body.defaultSchema = args.schema;
      if (args.params) body.parameters = parseJsonArg(args.params, 'params');
      out(shapeResult(await api('POST', '/api/exec', { body })), args); return;
    }

    case 'connections': {
      const r = await api('GET', '/api/ui/account/connections');
      const list = (r.connections || r.results || r || []).map((c) => ({ id: c.id, name: c.name, driver: c.driver, lastQueried: c.lastQueried, isTested: c.isTested, authScheme: c.authScheme }));
      out({ count: list.length, connections: list }, args); return;
    }
    case 'drivers': {
      const r = await api('GET', '/api/ui/drivers');
      let list = (r.drivers || r || []).map((d) => ({ driver: d.driver, niceName: d.niceName, category: d.category, version: d.version, beta: d.beta, premium: d.premium }));
      if (args.search && typeof args.search === 'string') {
        const s = args.search.toLowerCase();
        list = list.filter((d) => (d.driver || '').toLowerCase().includes(s) || (d.niceName || '').toLowerCase().includes(s));
      }
      out({ count: list.length, drivers: list }, args); return;
    }
    case 'driver-form': {
      const driver = need(args, 'driver');
      let d;
      try { d = await api('GET', `/api/ui/drivers/${encodeURIComponent(driver)}`); }
      catch (e) {
        if (e.status === 500) throw new Error(`The driver-form endpoint returned 500 for "${driver}" (known for some drivers, e.g. Jira). Assemble a minimal property set and validate with connection-test instead.`);
        throw e;
      }
      out(distillDriver(d, typeof args['auth-scheme'] === 'string' ? args['auth-scheme'] : null), args); return;
    }
    case 'connection-test': {
      // There is no standalone testConnection that works headlessly; the portal "tests" by
      // listing schemas. So verify an EXISTING connection by name via schema discovery.
      const name = need(args, 'name');
      try {
        const r = await api('GET', '/api/ui/schemas', { query: { catalogName: name } });
        const n = r && r.results && r.results[0] && r.results[0].rows ? r.results[0].rows.length : undefined;
        out({ name, ok: true, schemas: n }, args);
      } catch (e) {
        out({ name, ok: false, error: e.message }, args);
      }
      return;
    }
    case 'connection-create': {
      // Body shape mirrors the portal exactly (verified from a HAR capture): PascalCase top-level
      // keys, driver settings under `Props`, plus UserId + a Permissions entry. Create does NOT
      // require a passing test (the saved connection comes back isTested:false).
      const name = need(args, 'name');
      const driver = need(args, 'driver');
      const props = parseJsonArg(need(args, 'props'), 'props');
      if (props.credentials === undefined) props.credentials = 'shared';
      const me = await api('GET', '/api/ui/users/self');
      const drvResp = await api('GET', '/api/ui/drivers');
      const drvList = drvResp.drivers || drvResp || [];
      const drv = Array.isArray(drvList) ? drvList.find((d) => d.driver === driver) : null;
      const body = {
        ConnectionType: 0, Driver: driver, IsCacheConnection: false, Name: name,
        OAuthProps: {}, OnPremOptions: {}, WalletFileContent: '',
        // Creator always gets opsAllowed=15 (ALL) — matches the portal's own create flow.
        UserId: me.id, Permissions: [{ userId: me.id, opsAllowed: 15 }], Props: props,
      };
      if (drv && drv.version) body.DriverVersion = drv.version;
      const created = await api('POST', '/api/ui/account/connections', { body });
      const conn = (created && created.connection) || created;
      const result = { status: 'created', id: conn.id, name: conn.name, driver: conn.driver, authScheme: conn.authScheme };
      if (!args['no-verify']) {
        try { await api('GET', '/api/ui/schemas', { query: { catalogName: name } }); result.verified = true; }
        catch (e) { result.verified = false; result.verifyError = e.message; }
      }
      out(result, args); return;
    }
    case 'connection-delete': {
      if (!args.confirm) throw new Error('connection-delete is destructive. Re-run with --confirm to proceed.');
      const id = need(args, 'id');
      await api('DELETE', `/api/ui/account/connections/${encodeURIComponent(id)}`);
      out({ status: 'deleted', id }, args); return;
    }

    // ---- Users, roles & PATs ----
    case 'users': {
      const r = await api('GET', '/api/ui/users');
      out(r && r.users ? r.users : r, args); return;
    }
    case 'roles': { out(await api('GET', '/api/ui/roles'), args); return; }
    case 'user-invite': {
      const body = {
        email: need(args, 'email'),
        role: Number(need(args, 'role')),
        isInvite: true, canBeImpersonated: false, canImpersonateAsSupport: false,
        managedByScim: false, spreadsheetsUser: false,
        customRoleIds: args['custom-role-ids'] ? parseJsonArg(args['custom-role-ids'], 'custom-role-ids') : [],
        permissions: args.permissions ? parseJsonArg(args.permissions, 'permissions') : [],
        workspacePermissions: [],
      };
      const r = await api('POST', '/api/ui/user/inviteNewUserList', { body });
      out({ status: 'invited', email: body.email, response: r }, args); return;
    }
    case 'user-update': {
      const id = need(args, 'id');
      const changes = parseJsonArg(need(args, 'set'), 'set');
      const cur = await api('GET', `/api/ui/users/${encodeURIComponent(id)}`);
      const merged = Object.assign({}, (cur && cur.user) || cur, changes);
      const r = await api('PUT', `/api/ui/users/${encodeURIComponent(id)}`, { body: merged });
      out({ status: 'updated', id, changed: Object.keys(changes), response: r }, args); return;
    }
    case 'user-delete': {
      if (!args.confirm) throw new Error('user-delete is destructive. Re-run with --confirm to proceed.');
      const id = need(args, 'id');
      await api('DELETE', `/api/ui/users/${encodeURIComponent(id)}`);
      out({ status: 'deleted', id }, args); return;
    }
    case 'pats': { out(await api('GET', '/api/ui/users/self/pats'), args); return; }
    case 'pat-create': {
      // The full token is in `tokenString`, shown ONCE — relay the copy-now warning.
      const r = await api('POST', '/api/ui/users/self/pats', { body: { name: need(args, 'name') } });
      out(r, args); return;
    }
    case 'pat-delete': {
      if (!args.confirm) throw new Error('pat-delete revokes the token permanently. Re-run with --confirm.');
      const id = need(args, 'id');
      await api('DELETE', `/api/ui/users/self/pats/${encodeURIComponent(id)}`);
      out({ status: 'deleted', id }, args); return;
    }

    // ---- Billing ----
    case 'subscription': { out(await api('GET', '/api/ui/billing/subscription'), args); return; }
    case 'usage': { out(await api('GET', '/api/ui/billing/usage'), args); return; }

    // ---- Workspaces & assets ----
    case 'workspaces': {
      const r = await api('GET', '/api/ui/workspaces');
      out(r && r.workspaces ? r.workspaces : r, args); return;
    }
    case 'workspace-create': { out(await api('POST', '/api/ui/workspaces', { body: { name: need(args, 'name') } }), args); return; }
    case 'workspace-get': { out(await api('GET', `/api/ui/workspaces/${encodeURIComponent(need(args, 'id'))}`), args); return; }
    case 'workspace-assets': {
      const r = await api('GET', `/api/ui/workspaces/${encodeURIComponent(need(args, 'id'))}/children`);
      out(r && r.assets ? r.assets : r, args); return;
    }
    case 'workspace-delete': {
      if (!args.confirm) throw new Error('workspace-delete is destructive. Re-run with --confirm.');
      const id = need(args, 'id');
      await api('DELETE', `/api/ui/workspaces/${encodeURIComponent(id)}`);
      out({ status: 'deleted', id }, args); return;
    }
    case 'assets-add': {
      const tables = String(need(args, 'tables')).split(',').map((t) => t.trim()).filter(Boolean);
      if (!tables.length) throw new Error('No tables given in --tables.');
      const records = tables.map((t) => ({
        AssetType: args['asset-type'] ? Number(args['asset-type']) : 1,
        ConnectionId: need(args, 'connection-id'),
        DataAssetCategory: args['data-asset-category'] ? Number(args['data-asset-category']) : 1,
        ParentId: null,
        SchemaName: need(args, 'schema'),
        TableName: t,
      }));
      const r = await api('POST', `/api/ui/workspaces/${encodeURIComponent(need(args, 'workspace-id'))}/assets/fromConnection/batch`, { body: { Records: records } });
      out({ status: 'created', count: records.length, response: r }, args); return;
    }

    // ---- Toolkits ----
    case 'toolkits': {
      const r = await api('GET', '/api/ui/toolkits');
      out(r && r.toolkits ? r.toolkits : r, args); return;
    }
    case 'toolkit-create': { out(await api('POST', '/api/ui/toolkits', { body: { name: need(args, 'name') } }), args); return; }
    case 'toolkit-tools': {
      const r = await api('GET', `/api/ui/toolkits/${encodeURIComponent(need(args, 'id'))}/tools`);
      out(r && r.tools ? r.tools : r, args); return;
    }
    case 'toolkit-delete': {
      if (!args.confirm) throw new Error('toolkit-delete is destructive. Re-run with --confirm.');
      const id = need(args, 'id');
      await api('DELETE', `/api/ui/toolkits/${encodeURIComponent(id)}`);
      out({ status: 'deleted', id }, args); return;
    }
    case 'toolkit-url': {
      // Derived from the id — the BFF doesn't return it. MCP auth is Basic base64(username:PAT), NOT the Bearer JWT.
      out({ url: `https://mcp.cloud.cdata.com/mcp/toolkits/${need(args, 'id')}` }, args); return;
    }

    // ---- Jobs (cache jobs + scheduled queries) ----
    case 'jobs': { out(await fetchAllJobs(), args); return; }
    case 'job-get': {
      const job = await findJob(need(args, 'id'));
      const base = job._kind === 'scheduledquery' ? '/api/ui/scheduledquery/' : '/api/ui/cacheJobs/';
      out(await api('GET', base + job.id), args); return;
    }
    case 'job-create': {
      let body;
      if (args.body) body = parseJsonArg(args.body, 'body');
      else {
        for (const f of ['source-connection', 'source-schema', 'source-table', 'frequency', 'frequency-unit']) need(args, f);
        body = {
          jobFrequencyUnit: Number(args['frequency-unit']),
          jobFrequency: Number(args.frequency),
          cacheSchemas: [{
            sourceConnection: args['source-connection'],
            sourceSchema: args['source-schema'],
            sourceTable: args['source-table'],
            isFullUpdate: args['full-update'] === undefined ? true : strToBool(args['full-update']),
            timeCheckColumn: typeof args['time-check-column'] === 'string' ? args['time-check-column'] : '',
            isAutoTruncateStrings: args['auto-truncate-strings'] === undefined ? true : strToBool(args['auto-truncate-strings']),
          }],
        };
      }
      out(await api('POST', '/api/ui/cacheJobs', { body }), args); return;
    }
    case 'scheduled-query-create': {
      let body;
      if (args.body) body = parseJsonArg(args.body, 'body');
      else {
        for (const f of ['name', 'query', 'destination-connection', 'destination-schema', 'destination-table', 'frequency', 'frequency-unit']) need(args, f);
        body = {
          name: args.name,
          destinationWriteScheme: args['write-scheme'] ? Number(args['write-scheme']) : 1,
          destinationConnection: args['destination-connection'],
          destinationSchema: args['destination-schema'],
          destinationTable: args['destination-table'],
          jobFrequency: Number(args.frequency),
          jobFrequencyUnit: Number(args['frequency-unit']),
          query: args.query,
          enabled: args.enabled === undefined ? true : strToBool(args.enabled),
          logVerbosity: args.verbosity ? Number(args.verbosity) : 2,
          definedNextRun: typeof args['next-run'] === 'string' ? args['next-run'] : new Date().toISOString(),
        };
      }
      out(await api('POST', '/api/ui/scheduledquery/create', { body }), args); return;
    }
    case 'job-update': {
      let body;
      if (args.body) body = parseJsonArg(args.body, 'body');
      else {
        // Fetch the current cache job and overlay only the supplied flags.
        const job = await findJob(need(args, 'id'));
        if (job._kind === 'scheduledquery') throw new Error('job-update wraps cache jobs only; update a scheduled query with --body (PUT shape in reference/jobs.md).');
        const cur = await api('GET', '/api/ui/cacheJobs/' + job.id);
        const effTcc = typeof args['time-check-column'] === 'string' ? args['time-check-column'] : (cur.timeCheckColumn || '');
        body = {
          jobFrequencyUnit: args['frequency-unit'] !== undefined ? Number(args['frequency-unit']) : cur.jobFrequencyUnit,
          jobFrequency: args.frequency !== undefined ? Number(args.frequency) : cur.jobFrequency,
          verbosity: args.verbosity !== undefined ? Number(args.verbosity) : (cur.logVerbosity ?? 3),
          cacheSchemas: [{
            id: job.id,
            enabled: args.enabled === undefined ? (cur.enabled ?? true) : strToBool(args.enabled),
            isAutoTruncateStrings: args['auto-truncate-strings'] === undefined ? (cur.isAutoTruncateStrings ?? true) : strToBool(args['auto-truncate-strings']),
            sourceConnection: args['source-connection'] || cur.sourceConnection,
            sourceSchema: args['source-schema'] || cur.sourceSchema,
            sourceTable: args['source-table'] || cur.sourceTable,
            isFullUpdate: args['full-update'] === undefined ? !effTcc : strToBool(args['full-update']),
            timeCheckColumn: effTcc,
          }],
        };
      }
      out(await api('PUT', '/api/ui/cacheJobs/jobs/update', { body }), args); return;
    }
    case 'job-run': {
      const job = await findJob(need(args, 'id'));
      const r = await api('POST', '/api/ui/cacheJobs/run/' + job.id);
      out({ status: 'queued', id: job.id, name: job.name, response: r }, args); return;
    }
    case 'job-stop': {
      const job = await findJob(need(args, 'id'));
      const r = await api('PUT', '/api/ui/cacheJobs/stop/' + job.id);
      out({ status: 'stop-requested', id: job.id, name: job.name, response: r }, args); return;
    }
    case 'job-delete': {
      if (!args.confirm) throw new Error('job-delete is destructive. Re-run with --confirm.');
      const job = await findJob(need(args, 'id'));
      const endpoint = job._kind === 'scheduledquery' ? '/api/ui/scheduledquery/deleteBatch' : '/api/ui/cacheJobs/deleteBatch';
      const r = await api('DELETE', endpoint, { body: { ids: [job.id] } });
      out({ status: 'deleted', id: job.id, name: job.name, response: r }, args); return;
    }

    // ---- Scripted OAuth (no portal) ----
    case 'oauth-start': {
      const driver = need(args, 'driver');
      const name = need(args, 'name');
      const extra = args.props ? parseJsonArg(args.props, 'props') : {};
      const me = await api('GET', '/api/ui/users/self');
      const drv = await api('GET', `/api/ui/drivers/${encodeURIComponent(driver)}`);
      const props = Object.assign({ AuthScheme: 'oauth' }, extra);
      const base = {
        driver, props, connectionType: 0, driverVersion: drv.version, name,
        userId: me.id, userRole: 0, oAuthParams: {}, oAuthProps: {}, permissions: [],
        userDefinedProps: {}, walletFileContent: '', externalId: '',
        onPremOptions: { agentLocationId: null },
      };
      const r1 = await api('POST', '/api/ui/oauth/getAuthorizationUrl', { body: base });
      fs.writeFileSync(oauthPendingFile(), JSON.stringify({
        base, passthroughParameters: r1.passthroughParameters || null, callbackId: r1.callbackId,
      }, null, 2), { mode: 0o600 });
      out({
        status: 'awaiting-approval', oauthUrl: r1.oauthUrl, callbackId: r1.callbackId,
        next: 'Open oauthUrl, sign in & approve, then run: oauth-finish --url "<the callback URL you land on>". Microsoft drivers: copy the address-bar URL the INSTANT it appears (codes expire in ~60s).',
      }, args); return;
    }
    case 'oauth-finish': {
      const landing = need(args, 'url');
      const pf = oauthPendingFile();
      if (!fs.existsSync(pf)) throw new Error('No pending OAuth handshake. Run oauth-start first.');
      const pending = JSON.parse(fs.readFileSync(pf, 'utf8'));
      const base = pending.base;
      const q = new URL(landing).searchParams;
      // Decode each callback param exactly once (verified rule); rssbus passes as "true".
      const oAuthParams = {};
      for (const k of ['state', 'code', 'iss', 'scope', 'session_state']) {
        const v = q.get(k);
        if (v !== null && v !== '') oAuthParams[k] = dec64(v);
      }
      if (q.get('rssbus') !== null) oAuthParams.rssbus = 'true';
      if (pending.passthroughParameters) {
        for (const [k, v] of Object.entries(pending.passthroughParameters)) {
          if (v !== null && v !== undefined && !(k in oAuthParams)) oAuthParams[k] = v;
        }
      }
      base.oAuthParams = oAuthParams;
      const tok = await api('POST', '/api/ui/oauth/createOAuthAccessToken', { body: base });
      // Persist a NEW connection with the tokens (verified path: do NOT pre-create then PUT).
      const extra = args.props ? parseJsonArg(args.props, 'props') : {};
      const schemeRaw = (base.props.AuthScheme || 'oauth').toLowerCase();
      const scheme = schemeRaw === 'azuread' ? 'AzureAD' : (schemeRaw === 'oauth' ? 'OAuth' : base.props.AuthScheme);
      const props = Object.assign({}, base.props, extra, {
        AuthScheme: scheme, InitiateOAuth: 'OFF',
        OAuthAccessToken: tok.oauthaccesstoken, OAuthRefreshToken: tok.oauthrefreshtoken,
      });
      if (tok.oauthserverurl) props.OAuthServerURL = tok.oauthserverurl;
      const body = {
        ConnectionType: 0, Driver: base.driver, DriverVersion: base.driverVersion,
        IsCacheConnection: false, Name: base.name,
        OAuthProps: {}, OnPremOptions: {}, WalletFileContent: '',
        UserId: base.userId, Permissions: [{ userId: base.userId, opsAllowed: 15 }], Props: props,
      };
      await api('POST', '/api/ui/account/connections', { body });
      try { fs.unlinkSync(pf); } catch {}
      const result = { status: 'created', name: base.name, driver: base.driver };
      try {
        await api('GET', '/api/ui/schemas', { query: { catalogName: base.name } });
        result.verified = true;
      } catch (e) { result.verified = false; result.verifyError = e.message; }
      out(result, args); return; // tokens intentionally NOT echoed
    }

    case 'raw': {
      const method = (need(args, 'method') + '').toUpperCase();
      if (method === 'DELETE' && !args.confirm) throw new Error('raw DELETE is destructive. Re-run with --confirm.');
      const body = args.body ? parseJsonArg(args.body, 'body') : null;
      const query = args.query ? parseJsonArg(args.query, 'query') : null;
      out(await api(method, need(args, 'path'), { body, query }), args); return;
    }

    default:
      throw new Error(`Unknown command "${cmd}". Run "help" for usage.`);
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: e.message || String(e) }) + '\n');
  process.exit(1);
});
