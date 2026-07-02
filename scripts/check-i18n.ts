#!/usr/bin/env bun
/**
 * check-i18n.ts — P3-i18n lint guard (2026-07-02).
 *
 * Fails (exit 1) if any user-facing JSX/TS file outside the
 * `locales/` and `i18n/` directories contains CJK characters. The
 * guard is intentionally narrow:
 *
 *   - Walks apps/web/src/{components,pages,lib,App.tsx,main.tsx}.
 *   - Skips files inside apps/web/src/locales/ (the catalog itself)
 *     and apps/web/src/i18n/ (LanguageSwitcher labels live there).
 *   - Strips comments and string literals that are clearly NOT
 *     user-facing (URL paths, Prisma field names, hex codes, etc).
 *   - For everything else, flags any CJK character (`一-鿿`,
 *     CJK symbols & punctuation).
 *
 * Run via:
 *   bun scripts/check-i18n.ts
 *
 * Exit codes:
 *   0 = no stray CJK strings found
 *   1 = at least one file contains user-facing CJK outside the catalogs
 *
 * Note: the script is intentionally read-only. It does not modify
 * any file — fixing drift is a manual refactor through Phase 2-4.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const WEB_SRC = join(ROOT, 'apps/web/src');

const CJK_PATTERN = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿＀-￯]/;

/** Files/directories we deliberately skip. */
const SKIP_DIRS = new Set(['locales', 'i18n', '__tests__', 'node_modules', 'dist']);
const SKIP_FILES = new Set(['vite-env.d.ts']);

/** File extensions we treat as user-facing source. */
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

type Hit = { path: string; line: number; text: string; cjk: string };

async function* walk(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      if (SOURCE_EXTS.some((ext) => e.name.endsWith(ext))) {
        yield full;
      }
    }
  }
}

/**
 * Strip line comments (`// ...`) and block comments (`/* ... *\/`)
 * from a source string. Naive but good enough — we only need to
 * avoid false positives, not be perfect.
 */
function stripComments(source: string): string {
  // Block comments: /* ... */
  let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments: // ...\n  (we keep the trailing newline so line
  // numbers stay stable)
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

/**
 * Strip backtick template literal INTERPOLATIONS that look like
 * user-facing strings. We DO want to flag `placeholder="搜尋"`,
 * but we DON'T want to flag `path: '/companies/${id}'`.
 *
 * Heuristic: remove any backtick-delimited segment, and any
 * single-quoted segment that contains only URL-ish characters
 * (slashes, alphanumerics, $ , { } ).
 */
function stripNonUserStrings(source: string): string {
  return source
    // Backtick template literals (any flavor)
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, '``')
    // Single/double-quoted strings that look URL-ish: only [a-zA-Z0-9_/$.:-]
    .replace(/"[a-zA-Z0-9_/$.:{}?&=#%+\-]*"/g, '""')
    .replace(/'[a-zA-Z0-9_/$.:{}?&=#%+\-]*'/g, "''");
}

function checkFile(path: string): Hit[] {
  const text = require('node:fs').readFileSync(path, 'utf8');
  const lines = stripNonUserStrings(stripComments(text)).split('\n');
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(CJK_PATTERN);
    if (m) {
      hits.push({
        path,
        line: i + 1,
        text: line.trim().slice(0, 120),
        cjk: m[0],
      });
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const allHits: Hit[] = [];
  for await (const file of walk(WEB_SRC)) {
    const hits = checkFile(file);
    allHits.push(...hits);
  }

  if (allHits.length === 0) {
    console.log('check-i18n: no stray CJK strings found.');
    process.exit(0);
  }

  console.error(`check-i18n: ${allHits.length} stray CJK string(s) found:`);
  for (const h of allHits) {
    console.error(`  ${relative(ROOT, h.path)}:${h.line}  [${h.cjk}]  ${h.text}`);
  }
  console.error('');
  console.error('These strings should be moved to apps/web/src/locales/<lng>/<ns>.json');
  console.error('and referenced via t("...") — see the i18n plan for the per-page phases.');
  process.exit(1);
}

main();