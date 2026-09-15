# Connection recipes — top data sources

Distilled **live from `GET /api/ui/drivers/{driver}` on 2026-06-02** (driver versions 25.0.x). Each row gives the driver's API name, its default auth scheme, the other schemes it supports, and a **practical minimal property set** to get connected. Use these as a starting point, then create with `connection-create` (which builds the portal's exact body) and **verify by listing schemas** (see [examples.md](examples.md#create-connection)).

> **For any driver not listed here** (there are ~200), distill it on demand — nothing hardcoded:
> ```bash
> node scripts/connect-cli.mjs driver-form --driver <Name> [--auth-scheme <Scheme>]
> ```
> (PowerShell alternative: `scripts\get-connection-form.ps1 -Driver <Name>`.) Both read the live `GET /api/ui/drivers/{driver}` form — `properties[]` (`name`, `required`, `userCredential`, `values`) plus `hierarchy.hierarchyRules`.

> **Why not use the driver's standalone `.prp`/docs?** Connect AI exposes its **own** connection form per driver — property names, defaults, and which props are required differ from the standalone JDBC/ODBC driver. This endpoint is the *Connect-AI-specific, account-current* source of truth. Don't infer Connect AI props from standalone driver docs.

---

## Two universal patterns

**A. Browser OAuth (most SaaS apps).** When a source's default scheme is `OAuth`/`OAuthPKCE`, the simplest path is to let Connect AI run the OAuth handshake:
```jsonc
{ "AuthScheme": "OAuth", "InitiateOAuth": "GETANDREFRESH",
  "OAuthClientId": "<id>", "OAuthClientSecret": "<secret>",
  "CallbackURL": "https://oauth.cdata.com/oauth/" }
```
Many apps also offer a **token** scheme (PAT / API token / access token) that skips the browser entirely — preferred for automation. Those are listed per source below.

**B. Databases.** No `AuthScheme` browser flow — supply `Server`, `Port`, `Database`, `User`, `Password` (and sometimes `Schema`/`Warehouse`). Defaults for `Port` are well-known (shown below).

---

## Recipe table

| Driver (API name) | Source | Category | Default auth | Other schemes | Practical minimal properties |
|---|---|---|---|---|---|
| `Salesforce` | Salesforce | CRM | `OAuthPKCE` | Basic, OAuth, OAuthJWT, AzureAD, OKTA, ADFS… | **Basic:** `User`,`Password`,`SecurityToken` · **OAuth:** pattern A |
| `Jira` ⚠️ | Jira | Collab | (form 500s) | APIToken, Basic, OAuth, PAT | **APIToken (Cloud):** `Url`,`User` (email),`APIToken` — *form endpoint 500s; create then verify by listing schemas* |
| `QuickBooksOnline` | QuickBooks Online | Accounting | OAuth (no AuthScheme prop) | — | Pattern A + `CompanyId`; set `UseSandbox` if sandbox |
| `HubSpot` | HubSpot | Marketing | `OAuth` | PrivateAppToken | **PrivateAppToken:** `AuthScheme=PrivateAppToken`,`OAuthAccessToken`,`Schema` · **OAuth:** pattern A |
| `ServiceNow` | ServiceNow | CRM/ERP | `Basic` | OAuth, OAuthJWT, AzureAD, OKTA… | **Basic:** `URL`,`User`,`Password` |
| `NetSuite` | NetSuite | ERP | `Token` | Basic, OAuth, OAuthJWT | **Token (TBA):** `AccountId`,`OAuthClientId`,`OAuthClientSecret`,`OAuthAccessToken`,`OAuthAccessTokenSecret` |
| `Dynamics365` | Dynamics 365 | CRM/ERP | `AzureAD` | AzureServicePrincipal(+Cert) | `Edition`,`OrganizationURL` + pattern A (`OAuthClientId`/`Secret`) |
| `Snowflake` | Snowflake | Cloud DW | `OAuth` | Password, PrivateKey, OKTA, OAuthJWT… | **Password:** `URL`,`User`,`Password`,`Database`,`Schema`,`Warehouse` |
| `GoogleBigQuery` | Google BigQuery | Cloud DW | `OAuth` | OAuthJWT, *WorkloadIdentity | `ProjectId`,`DatasetId` + pattern A · **Service acct:** `AuthScheme=OAuthJWT`,`OAuthJWTCert`,`OAuthJWTSubject` |
| `Databricks` | Databricks | Lakehouse | `PersonalAccessToken` | OAuthU2M/M2M, AzureAD | **PAT:** `Server`,`HTTPPath`,`Token`,`Database` |
| `Redshift` | Amazon Redshift | Cloud DW | `Basic` | IAMCredentials, AzureAD, ADFS, PingFederate | `Server`,`Port`=5439,`Database`,`User`,`Password`,`AWSRegion` |
| `SQL` | SQL Server | RDBMS | `Password` | AzureAD, AzurePassword, AzureServicePrincipal | `Server`,`Port`=1433,`Database`,`User`,`Password` (`AzureTenant` only for Azure schemes) |
| `MySQL` | MySQL | RDBMS | `Password` | AzureAD, AzurePassword, LDAP | `Server`,`Port`=3306,`Database`,`User`,`Password` |
| `PostgreSQL` | PostgreSQL | RDBMS | `Password` | AzureAD, AzureServicePrincipal, AwsIAMRoles | `Server`,`Port`=5432,`Database`,`User`,`Password` |
| `SAPHANA` | SAP HANA | RDBMS | `Password` | OKTA | `Server`,`Port`,`Database`,`Schema`,`User`,`Password` |
| `MongoDB` | MongoDB | NoSQL | `SCRAM-SHA-1` | SCRAM-SHA-256, X509, MONGODB-CR | `Server`,`Port`=27017,`Database`,`User`,`Password`,`UseSSL` |
| `SharePoint` | SharePoint | Collab | `AzureAD` | AzureServicePrincipalCert, OAuthJWT, Negotiate… | `URL`,`Schema` (e.g. `SharePointOnline`) + pattern A |
| `GoogleSheets` | Google Sheets | Collab | `OAuth` | Token, OAuthJWT, *WorkloadIdentity | Pattern A (defaults cover the rest) |
| `GoogleDrive` | Google Drive | Collab | `OAuth` | OAuthJWT | Pattern A |
| `Slack` | Slack | Collab | `OAuth` | UserToken, Token | **Token:** `AuthScheme=Token`,`OAuthAccessToken` · **OAuth:** pattern A |
| `Zendesk` | Zendesk | Collab | `OAuth` | OAuthPKCE, APIToken | **APIToken:** `URL`,`User`,`APIToken` |
| `GitHub` | GitHub | Collab | `OAuth` | PersonalAccessToken | **PAT:** `AuthScheme=PersonalAccessToken`,`Token` (`ghp_…`) |
| `AzureDevOps` | Azure DevOps | Collab | `AzureAD` | Basic | **PAT:** `AuthScheme=Basic`,`Organization`,`PersonalAccessToken` |
| `Confluence` | Confluence | Collab | `Basic` | OAuth, APIToken, OKTA, PAT, Crowd | **APIToken (Cloud):** `URL`,`User`,`APIToken` |
| `Asana` | Asana | Collab | `OAuth` | OAuthPKCE | Pattern A + `WorkspaceId` |
| `Smartsheet` | Smartsheet | Collab | `PersonalAccessToken` | OAuth | **PAT:** `PersonalAccessToken` |
| `Shopify` | Shopify | E-commerce | `AccessToken` | OAuth, OAuthClient | **AccessToken:** `ShopURL`,`AccessToken` |
| `Stripe` | Stripe | E-commerce | `OAuth` | APIKey | **APIKey:** `AuthScheme=APIKey`,`APIKey` (`sk_…`) |
| `Xero` | Xero | Accounting | `PKCE` | OAuth, OAuthClient | Pattern A (PKCE) + `Schema` |
| `Marketo` | Marketo | Marketing | (none) | — | `URL`,`OAuthClientId`,`OAuthClientSecret` |
| `Square` | Square | E-commerce | (none) | — | OAuth via pattern A; `LocationId`, `UseSandbox` |
| `Workday` | Workday | ERP/HR | `OAuth` | OAuthISU, OAuthJWT, AzureAD, Basic | `BaseURL`,`Tenant`,`ConnectionType` + pattern A (or **Basic:** `User`,`Password`) |
| `REST` | Generic REST/API | API/File | `Basic` | OAuth, Bearer, APIKey, NTLM, AWS*, Azure*… | `URI` + chosen scheme (`Basic`→`User`/`Password`; `Bearer`→`AuthToken`; `APIKey`→`APIKey`) |
| `OData` | Generic OData | API/File | `None` | Basic, OAuth, OAuthClient, AzureAD, SharePointOnline | **Basic:** `URL`,`User`,`Password` · public feeds: `AuthScheme=None`,`URL` |

⚠️ = the live driver-form endpoint currently returns **HTTP 500** for this driver (verified for `Jira`). Skip the form; assemble a minimal property set, `connection-create`, and verify by listing schemas.

---

## Worked create — Salesforce (Basic) and SQL Server

The CLI builds the portal's exact body for you; you just pass the driver props:

```bash
# Salesforce via username/password/token (no browser) — create, then auto-verify by listing schemas
node scripts/connect-cli.mjs connection-create --name SF_Prod --driver Salesforce \
  --props '{"AuthScheme":"Basic","User":"me@org.com","Password":"***","SecurityToken":"***"}'

# SQL Server
node scripts/connect-cli.mjs connection-create --name SalesDB --driver SQL \
  --props '{"AuthScheme":"Password","Server":"db.corp.local","Port":"1433","Database":"Sales","User":"svc","Password":"***"}'
```

> Calling the REST endpoint directly? Use the portal's exact body shape — PascalCase keys with the driver settings under **`Props`**, plus `UserId` and a `Permissions` entry (see [examples.md](examples.md#create-connection)). A lowercase `{properties:…}` body returns **HTTP 500**.

---

## Notes on accuracy

- **Default auth scheme, available schemes, required props, and credential props in the table are verified** from the live form on 2026-06-02.
- The **"practical minimal properties"** column is a sensible starting point per the common scheme; the *authoritative, conditional* requiredness (which props become required for a given `AuthScheme`) lives in `hierarchy.hierarchyRules` of the live form. Listing schemas after create (`connection-test --name N`) is the final arbiter that the connection actually authenticates.
- Driver names are **case-sensitive** and are the `driver` field from `GET /api/ui/drivers` (e.g. SQL Server is `SQL`, BigQuery is `GoogleBigQuery`).
