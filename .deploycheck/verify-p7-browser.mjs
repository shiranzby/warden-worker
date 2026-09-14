/**
 * P7 上线后的浏览器冒烟测试(不登录): 验证页面真的能渲染、无 console 报错、
 * 桌面/窄屏两档视口下的登录页都正常。
 *
 * 用法: node .deploycheck/verify-p7-browser.mjs
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const PW_INDEX = "F:/WorkSpace/Workbuddy/Github项目分析部署/vw_web_builds/node_modules/playwright/index.js";
const EXE = "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const SITE = "https://shypwd.cc.cd";
const SHOTS = path.join(import.meta.dirname, "shots-p7");
fs.mkdirSync(SHOTS, { recursive: true });

const modNs = await import(pathToFileURL(PW_INDEX).href);
const pw = modNs.default ?? modNs;
const { chromium } = pw;

let pass = 0, fail = 0;
const chk = (label, ok, extra = "") => {
  if (ok) { console.log(`  [OK]   ${label} ${extra}`); pass++; }
  else { console.log(`  [FAIL] ${label} ${extra}`); fail++; }
};

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  proxy: { server: "http://127.0.0.1:7890" },
  args: ["--ignore-certificate-errors"],
});

const errors = [];
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

console.log("=== 1) 桌面 1280x800 ===");
const resp = await page.goto(`${SITE}/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
chk("HTTP 200", resp?.status() === 200, `(status=${resp?.status()})`);

await page.waitForSelector("app-root", { timeout: 30000 }).catch(() => {});
const hasRoot = await page.locator("app-root").count();
chk("app-root 已挂载", hasRoot > 0);

await page.waitForTimeout(6000);
const title = await page.title();
console.log(`  title = ${title}`);
const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
chk("页面有可见文本(非空白)", bodyText.trim().length > 20, `(${bodyText.trim().length} 字符)`);
await page.screenshot({ path: path.join(SHOTS, "live-desktop.png"), fullPage: false });
console.log(`  shot -> shots-p7/live-desktop.png`);

console.log("=== 2) 窄屏 375x812 ===");
await page.setViewportSize({ width: 375, height: 812 });
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
const vp = await page.evaluate(() => {
  const m = document.querySelector('meta[name="viewport"]');
  return m ? m.getAttribute("content") : null;
});
console.log(`  meta viewport = ${vp}`);
chk("viewport 是 device-width(源码定制)", !!vp && vp.includes("device-width"));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
chk("窄屏无横向溢出", overflow <= 2, `(溢出 ${overflow}px)`);
await page.screenshot({ path: path.join(SHOTS, "live-mobile.png"), fullPage: false });
console.log(`  shot -> shots-p7/live-mobile.png`);

console.log("=== 3) console / pageerror ===");
const real = errors.filter((e) => !/favicon|Manifest|Failed to load resource: the server responded with a status of 404/i.test(e));
if (real.length === 0) { chk("无 console/page 错误", true); }
else { chk("无 console/page 错误", false, `(${real.length} 条)`); real.slice(0, 10).forEach((e) => console.log(`     ${e}`)); }

await browser.close();
console.log(`\n=== 结果: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
