---
name: connect-ai-stripe
description: Use when querying Stripe data through CData Connect AI. A Stripe connection exposes one of two API surfaces — the classic Stripe API or the newer StripeV2 API — selected by the connection's Schema property and presenting different data models. This skill identifies which surface a connection uses and routes to the matching reference for the data model, query patterns, stored procedures, and Stripe conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Stripe
  family: accounting
---

# CData Connect AI — Stripe Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Stripe-specific guidance for querying Stripe data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and three-part query naming convention.

## Precedence

This skill replaces `getInstructions` for the Stripe driver. Do not call `getInstructions` for Stripe — the guidance it provides is already incorporated here and in the per-surface references. Proceed directly to `getSchemas` (to identify the surface — see below) and then schema discovery (`getTables` / `getColumns`) after identifying the Stripe connection via `getCatalogs`.

## Stripe exposes two API surfaces

A Stripe connection presents one of **two surfaces**, determined by the CData `Schema` connection property. A connection exposes only the surface it is configured for, so `getSchemas` returns a single schema. **The surface cannot be inferred from the connection name**, so the first move on any Stripe connection is to identify it with `getSchemas`.

> **Always run `getSchemas` as the FIRST tool call against any Stripe connection** — before any `queryData`, `getTables`, or `getColumns` call. **Do not infer the surface from the connection name.** The schema returned by `getSchemas` is the only authoritative signal: `Stripe` → classic surface, `StripeV2` → V2 surface.

| Surface | `Schema` property | Schema returned by `getSchemas` | Object model |
|---|---|---|---|
| **Classic** | `Stripe` (default) | `Stripe` | The comprehensive classic data model — ~80 tables/views (`Customers`, `Invoices`, `Subscriptions`, `Charges`, `PaymentIntent`, …) plus ~20 stored procedures. The configuration most connections use. |
| **V2** | `StripeV2` | `StripeV2` | Stripe's V2 Core/Events and billing-meter APIs — a narrow surface: `EventDestinations`, `ThinEvents`, and meter-event procedures. **Not** a billing/payments data model. |

## Step 1 — Identify the surface with `getSchemas`

Run `getSchemas` on the Stripe connection before anything else:

- Returns **`Stripe`** → classic surface → load [references/stripe.md](references/stripe.md).
- Returns **`StripeV2`** → V2 surface → load [references/stripev2.md](references/stripev2.md).

## Step 2 — Load the matching surface reference

Each surface has its own reference with the full data model, query workflow, important columns, query patterns, stored procedures, write operations, and conventions. Read the one that matches the surface identified in Step 1 before writing queries:

- **Classic** → [references/stripe.md](references/stripe.md) — the customer-centric `Customers` / `Invoices` / `Subscriptions` / `Charges` / `PaymentIntent` model, the broad ~80-object catalog, monetary/unit and column-naming conventions, lifecycle stored procedures, cloud-compatible download patterns, and write operations.
- **V2** → [references/stripev2.md](references/stripev2.md) — the narrow V2 surface: `EventDestinations` and `ThinEvents` (which requires a filter), meter-event and event-destination procedures, and write operations. For customers/invoices/charges, the connection must use the classic `Stripe` schema instead.

The three-part name is always `[Catalog].[Schema].[Table]`:

```sql
-- Classic surface
SELECT [Id], [Email], [Name] FROM [YourConnection].[Stripe].[Customers] LIMIT 10
```

The middle segment is the **schema** (`Stripe` or `StripeV2`), not the connection name and not a "driver name."

## Cross-cutting Stripe conventions

These hold on both surfaces, though the exact table and column names differ — see each reference for specifics.

- **Identify the surface first.** It dictates the object model and column conventions. Never assume — run `getSchemas`.
- **Monetary amounts are integers in the smallest currency unit (cents).** Divide by 100 for major-unit currencies (USD, EUR, …); zero-decimal currencies like JPY are already whole units. Never present a raw amount as dollars.
- **Timestamps** are exposed as SQL `TIMESTAMP` (the driver converts Stripe's Unix-epoch seconds).
- **Discover columns with `getColumns` before querying.** Stripe tables are wide and flatten nested API objects into prefixed columns. Confirm names on the live connection rather than assuming.
- **Use explicit date literals** (`'2025-01-01'`) over `DATEADD()` for performance on time-based filters.
