/**
 * 第十六批(T 段) 线上截图取证 —— 只拍**设置页**(不含保险库条目内容, 无凭据泄露风险)。
 *  ① /settings/appearance 窄屏下拉展开
 *  ② /settings/domain-rules 行几何(输入框 + 减号按钮)
 * 用法:
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/shot-b16-live.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const OUT = path.join(SHOTS, "b16");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: CHROME, proxy: { server: PROXY } });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
console.log(`BASE = ${BASE}   proxy = ${PROXY}`);
await ensureLoggedIn(page, ctx, { verbose: false });

// ① 外观页：下拉展开
await goRoute(page, "/settings/appearance");
await sleep(700);
const sel = page.locator("bit-select").first().locator(".ng-select-container").first();
const b = await sel.boundingBox();
await page.touchscreen.tap(b.x + 40, b.y + b.height / 2);
await sleep(500);
const p1 = path.join(OUT, "01-dropdown-open.png");
await page.screenshot({ path: p1 });
console.log(`✅ ① ${p1}`);

// ② 域名页：行几何
await goRoute(page, "/settings/domain-rules", "main#main-content", 20000);
await sleep(500);
const addBtn = page.locator('button:has-text("新增自定义域名")').first();
if (await addBtn.count()) {
  await addBtn.tap().catch(() => addBtn.click());
  await sleep(900);
}
const row = page.locator(".warden-domain-row").first();
if (await row.count()) {
  await row.scrollIntoViewIfNeeded();
  await sleep(300);
  const bb = await row.boundingBox();
  const p2 = path.join(OUT, "02-domain-row.png");
  await page.screenshot({ path: p2, clip: { x: 0, y: Math.max(0, bb.y - 20), width: 390, height: Math.min(300, bb.height + 60) } });
  console.log(`✅ ② ${p2}`);
} else {
  console.log("⚠️ 没找到 .warden-domain-row（测试账号可能没有域名行）");
}

await browser.close();
