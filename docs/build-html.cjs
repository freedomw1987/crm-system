// build-html.js — one-shot build script
// Reads every .md file in this directory + ../README.md, embeds them as
// <script type="text/markdown" id="doc-XXX"> elements inside index.html.
// Run: node build-html.js
//
// This avoids the `file://` fetch() CORS issue by inlining the markdown
// content. Re-run after editing any .md file.

const fs = require('fs');
const path = require('path');

const here = __dirname;
const docFiles = [
  { id: 'root',        title: 'README',           file: path.join(here, '..', 'README.md') },
  { id: 'progress',    title: 'PROGRESS',         file: path.join(here, 'PROGRESS.md') },
  { id: 'architecture',title: 'Architecture',     file: path.join(here, 'architecture.md') },
  { id: 'database',    title: 'Database',         file: path.join(here, 'database.md') },
  { id: 'api',         title: 'API reference',    file: path.join(here, 'api.md') },
  { id: 'ai-agent',    title: 'AI Agent',         file: path.join(here, 'ai-agent.md') },
  { id: 'frontend',    title: 'Frontend',         file: path.join(here, 'frontend.md') },
  { id: 'rbac',        title: 'RBAC',             file: path.join(here, 'rbac.md') },
  { id: 'operations',  title: 'Operations',       file: path.join(here, 'operations.md') },
  { id: 'contributing',title: 'Contributing',     file: path.join(here, 'contributing.md') },
  { id: 'docs-index',  title: 'Doc index',        file: path.join(here, 'README.md'), aliasOf: 'docs/README.md' },
  { id: 'prd',         title: 'PRD (老闆版)',     file: path.join(here, 'PRD.md') },
  { id: 'design',      title: 'Design (老闆版)',   file: path.join(here, 'DESIGN.md') },
];

let indexTpl = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
let appTpl   = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
let cssTpl   = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');

// CRITICAL: app.js gets inlined inside <script>...</script>. Any literal
// `</script>` string in app.js (e.g. inside a regex, template literal, or
// comment) would terminate the script tag prematurely and break the page.
// We escape every occurrence by inserting a backslash. JS engines treat
// `<\/script>` inside a string as `<` + `/script>` (a 7-char string that
// happens to contain "</script>"), so this is safe.
appTpl = appTpl.replace(/<\/script>/gi, '<\\/script>');
cssTpl = cssTpl.replace(/<\/script>/gi, '<\\/script>');  // belt-and-suspenders

const embedded = docFiles.map(({ id, file, aliasOf, title }) => {
  if (!fs.existsSync(file)) {
    console.error(`⚠️  missing: ${file}`);
    return '';
  }
  const raw = fs.readFileSync(file, 'utf8');
  // Strip the H1 from each file (the sidebar already shows the title).
  // This keeps the rendered page focused on the content.
  // We do this for any file whose first non-blank line is `# Title`.
  // For README.md (the repo root) we keep the H1 since it's the entry point.
  let content = raw;
  if (id !== 'root') {
    content = raw.replace(/^# [^\n]*\n+/, '');
  }
  const displayFile = aliasOf || path.relative(here, file);
  // Same `</script>` escape — markdown content is inlined inside
  // <script type="text/markdown" id="doc-XXX">...</script>. The browser
  // does NOT treat text/markdown as executable, but a literal `</script>`
  // would still terminate the parent script element early.
  const safeContent = content.replace(/<\/script>/gi, '<\\/script>');
  return `  <script type="text/markdown" id="doc-${id}" data-title="${title}" data-file="${displayFile}">
${safeContent}
  </script>`;
}).join('\n');

// Inline the CSS and JS so the docs are a single self-contained file
// (you can email it, archive it, or open from file:// without issues).
const inlined = indexTpl
  .replace(/<link rel="stylesheet" href="styles.css" \/>/, `<style>\n${cssTpl}\n</style>`)
  .replace(/<script src="app.js"><\/script>/, `<script>\n${appTpl}\n</script>`)
  .replace(/<script type="text\/markdown" id="doc-XXX"><\/script>/, embedded);

const outPath = path.join(here, 'index.html.bundled.html');
fs.writeFileSync(outPath, inlined);

// Self-test: write the inlined JS to a temp file and run `node --check` on
// it. This catches `</script>` escape mistakes and other JS syntax errors
// that would only surface when the page is opened in a browser.
const inlinedScriptMatch = inlined.match(/<script>\s*\n([\s\S]*?)\n\s*<\/script>/);
if (inlinedScriptMatch) {
  const tmpScript = '/tmp/inlined-app-test.js';
  fs.writeFileSync(tmpScript, inlinedScriptMatch[1]);
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', ['--check', tmpScript], { stdio: 'pipe' });
    console.log('  ✓ inlined JS passed node --check');
  } catch (e) {
    console.error('  ✗ inlined JS failed syntax check:');
    console.error(e.stderr?.toString() || e.message);
    process.exit(1);
  } finally {
    fs.unlinkSync(tmpScript);
  }
}

console.log(`✓ Built ${outPath}`);
console.log(`  Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
console.log(`  Open with: open ${outPath}    (macOS)`);
console.log(`             xdg-open ${outPath}  (Linux)`);
console.log(`             start ${outPath}    (Windows)`);
