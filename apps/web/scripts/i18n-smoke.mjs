// Smoke test — visit several pages in zh-TW + zh-CN, ensure no literal keys.
import { chromium } from 'playwright';

const BASE = 'http://localhost';
const EMAIL = 'admin@crm.local';
const PASSWORD = 'admin123';

const PAGES = [
  { path: '/', name: 'dashboard' },
  { path: '/companies', name: 'companies' },
  { path: '/deals', name: 'deals' },
  { path: '/quotations', name: 'quotations' },
  { path: '/products', name: 'products' },
  { path: '/services', name: 'services' },
  { path: '/users', name: 'users' },
  { path: '/roles', name: 'roles' },
  { path: '/audit', name: 'audit' },
  { path: '/ai-chat', name: 'ai-chat' },
  { path: '/settings/account', name: 'settings-account' },
  { path: '/settings/pipelines', name: 'settings-pipelines' },
];

const results = [];

async function loginAndPatch(ctx, locale) {
  // Set localStorage hint.
  await ctx.addInitScript((loc) => {
    try { localStorage.setItem('crm:locale', loc); } catch {}
  }, locale);
  // Update DB locale.
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody = await loginRes.json();
  await fetch(`${BASE}/api/auth/me/preferences`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${loginBody.token}` },
    body: JSON.stringify({ locale }),
  });
}

function countLiteralKeys(text) {
  // i18n keys have the shape `namespace.path.maybe.more` and all
  // segments are camelCase / lowercase letters. We scan for any
  // word starting with a registered namespace that's NOT followed
  // by CJK / non-key text.
  const namespaces = ['common', 'nav', 'auth', 'role', 'status', 'errors', 'dashboard',
    'settings', 'company', 'deal', 'quotation', 'product', 'service', 'contact',
    'user', 'audit', 'ai', 'activity', 'attachment'];
  const re = new RegExp(`\\b(${namespaces.join('|')})\\.[a-zA-Z][a-zA-Z0-9.]*`, 'g');
  const matches = text.match(re) ?? [];
  return [...new Set(matches)];
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const locale of ['zh-TW', 'zh-CN']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAndPatch(ctx, locale);

    // Login through the UI to seed the page.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

    for (const p of PAGES) {
      try {
        await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(800);
        const body = await page.locator('body').innerText();
        const literals = countLiteralKeys(body);
        const ok = literals.length === 0;
        results.push({ locale, page: p.name, ok, literals });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${locale}  ${p.path.padEnd(22)}  ${literals.length === 0 ? '' : `literals: ${literals.slice(0, 5).join(', ')}`}`);
      } catch (e) {
        results.push({ locale, page: p.name, ok: false, error: String(e) });
        console.log(`ERR   ${locale}  ${p.path}  ${e.message}`);
      }
    }
    await ctx.close();
  }

  await browser.close();

  const total = results.length;
  const pass = results.filter((r) => r.ok).length;
  const fail = total - pass;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${pass}/${total} pass, ${fail} fail`);
  if (fail > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  ${r.locale} ${r.page}: ${r.literals ? r.literals.join(', ') : r.error}`);
    }
    process.exit(1);
  }
})();
