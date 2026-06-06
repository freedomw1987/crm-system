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
  const safeContent = content
    .replace(/<\/script>/gi, '<\\/script>')  // escape closing script tags inside content
    ;
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
console.log(`✓ Built ${outPath}`);
console.log(`  Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
console.log(`  Open with: open ${outPath}    (macOS)`);
console.log(`             xdg-open ${outPath}  (Linux)`);
console.log(`             start ${outPath}    (Windows)`);
