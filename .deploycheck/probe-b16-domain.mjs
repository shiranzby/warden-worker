/**
 * 第十六批 自定义域名页几何测量 —— 问题3: "右侧减号按钮没居中, 高度没对齐左侧输入框的一行".
 *
 * 用法: node .deploycheck/probe-b16-domain.mjs
 * 产物: .deploycheck/shots/e1-domain.png + 控制台几何表
 */
import { mkdirSync } from "node:fs";
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const DIR = "F:/WorkSpace/Workbuddy/Github项目分析部署/warden-worker/.deploycheck/shots";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror: " + e.message.slice(0, 140)));
console.log("BASE = " + BASE);
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "#/settings/domain-rules", "main#main-content", 20000);
await sleep(1500);

let rows = await page.locator("bit-form-field textarea[bitInput]").count();
console.log("初始 textarea 行数 = " + rows);
if (rows === 0) {
  const added = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (e) => /自定义域名/.test(e.textContent || "") && e.getBoundingClientRect().width > 0,
    );
    if (!b) return null;
    b.click();
    return (b.textContent || "").trim().slice(0, 20);
  });
  console.log("点新增按钮: " + added);
  await sleep(900);
  rows = await page.locator("bit-form-field textarea[bitInput]").count();
  console.log("新增后行数 = " + rows);
}

const geo = await page.evaluate(() => {
  const ta = document.querySelector("bit-form-field textarea[bitInput]");
  if (!ta) return null;
  const ff = ta.closest("bit-form-field");
  const row = ff.parentElement;
  const btn = row.querySelector("button");
  const label = ff.querySelector("label, bit-label, [class*='label']");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      cy: Math.round(r.y + r.height / 2),
      h: Math.round(r.height),
      display: cs.display,
      alignItems: cs.alignItems,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
      margin: cs.margin,
      alignSelf: cs.alignSelf,
      pos: cs.position,
    };
  };
  return {
    row: box(row),
    field: box(ff),
    label: box(label),
    bitLabel: box(ff.querySelector("bit-label")),
    fieldContainer: box(ff.querySelector("[bitfieldcontainer]")),
    textarea: box(ta),
    button: box(btn),
    fieldInner: ff.innerHTML.replace(/\s+/g, " ").slice(0, 700),
  };
});

console.log("\n===== 几何(视口坐标, 移动端 390x844) =====");
for (const [k, v] of Object.entries(geo || {})) {
  if (k === "fieldInner") continue;
  console.log(`${k.padEnd(14)} ${v ? JSON.stringify(v) : "(未找到)"}`);
}
if (geo) {
  const dy = geo.button && geo.textarea ? geo.button.cy - geo.textarea.cy : null;
  const dyField = geo.button && geo.field ? geo.button.cy - geo.field.cy : null;
  console.log(`\n按钮中心 - textarea中心 = ${dy}px   (0 = 已对齐)`);
  console.log(`按钮中心 - 整块field中心 = ${dyField}px`);
  console.log("\nfield 内部结构:\n" + geo.fieldInner);
}
await page.screenshot({ path: `${DIR}/e1-domain.png` });
await browser.close();
