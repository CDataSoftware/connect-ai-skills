# Security Policy

CData takes the security of our software and our community seriously. This
repository publishes [Agent Skills](README.md) for CData Connect AI — Markdown
instructions and reference material that guide AI assistants through querying
connected data sources. If you believe you have found a security issue in this
repository or in the way these skills interact with Connect AI, we appreciate
your help in disclosing it to us responsibly.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Instead, report them privately by email to **security@cdata.com**.

To help us triage and prioritize the report, please include as much of the
following as you can:

* The type of issue (for example, prompt injection, credential exposure, unsafe
  instruction, or a flaw in a query pattern)
* The skill or file affected, and the full path within this repository
* Step-by-step instructions to reproduce the issue
* Proof-of-concept or example prompts, queries, or MCP tool calls, if applicable
* The impact of the issue, including how an attacker might exploit it

If you would like to encrypt sensitive details, ask us in your initial email and
we will arrange a secure channel.

## What to Expect

* We will acknowledge your report within **3 business days**.
* We will provide an initial assessment and expected next steps within **10
  business days**.
* We will keep you informed as we work toward a resolution, and we will let you
  know when the issue is fixed.
* We ask that you give us a reasonable opportunity to address the issue before
  any public disclosure.

## Scope

This policy covers the contents of this repository (the `connect-ai-skills`
Agent Skills). Because these skills are instructional text rather than a running
service, security-relevant issues typically include:

* Instructions that could cause an AI assistant to expose credentials, tokens,
  or other sensitive data
* Query or tool-call patterns that could lead to unintended data modification or
  deletion
* Prompt-injection or instruction-tampering vectors introduced through skill
  content
* References to insecure endpoints, defaults, or authentication flows

Vulnerabilities in the **CData Connect AI platform** itself, the **MCP server**,
or any **CData driver or product** are outside the scope of this repository but
are equally welcome — please report those to the same address,
**security@cdata.com**, or through the channels listed on
[cdata.com/security](https://www.cdata.com/security/).

## Safe Harbor

We consider security research and vulnerability disclosure conducted in good
faith and in accordance with this policy to be authorized. We will not pursue or
support legal action against researchers who make a good-faith effort to comply
with it. Please act in good faith: avoid privacy violations, data destruction,
and any disruption to CData services or other users, and only interact with
accounts and data you own or are explicitly permitted to test.

Thank you for helping keep CData Connect AI and its community safe.
