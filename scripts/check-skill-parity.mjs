#!/usr/bin/env node
/**
 * check-skill-parity.mjs — fail if files that must stay byte-identical have drifted.
 *
 * Some skills ship hand-copied duplicates of the same file (e.g. connect-cli.mjs in
 * both connect-ai-manage and connect-ai-direct). Once those copies share a runtime
 * contract — the connect-cli.mjs copies now share the token-cache crypto envelope and
 * the same on-disk cache file — a one-sided edit no longer surfaces as a merge conflict
 * or a failing import; it surfaces as a silent decrypt failure in the other skill. This
 * guard catches that drift at review time. Node built-ins only; no dependencies.
 *
 *   node scripts/check-skill-parity.mjs
 *
 * Exit 0 if every group is identical, 1 (with a diff summary) otherwise.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Groups of repo-relative paths that MUST remain byte-identical to each other.
const GROUPS = [
  {
    name: 'connect-cli.mjs (connect-ai-manage ↔ connect-ai-direct)',
    files: [
      'skills/platform/connect-ai-manage/scripts/connect-cli.mjs',
      'skills/platform/connect-ai-direct/scripts/connect-cli.mjs',
    ],
  },
];

let failed = false;
for (const g of GROUPS) {
  const hashes = g.files.map((f) => {
    try { return { f, h: createHash('sha256').update(readFileSync(f)).digest('hex') }; }
    catch (e) { return { f, h: `MISSING (${e.code || e.message})` }; }
  });
  if (new Set(hashes.map((x) => x.h)).size === 1) {
    console.log(`✓ ${g.name} — identical`);
  } else {
    failed = true;
    console.error(`✗ ${g.name} — files differ; re-sync them:`);
    for (const { f, h } of hashes) console.error(`    ${h.slice(0, 16)}  ${f}`);
  }
}
process.exit(failed ? 1 : 0);
