/**
 * 现场诊断 第二轮 —— 把第一轮留下的两个问号钉死。
 *
 *   ① 图标栏：DOM 说 6 项都在(白色图标 18px / 白色标签 10.5px / 高 52px)，
 *      但截图上看是一个**空的黑条**。到底是谁没画出来？
 *   ② 外观页主题下拉：点击点落在了 section 外壳 div 上，说明 ng-select 那一层
 *      不可点击 —— 用 elementsFromPoint(复数) 把整摞元素摊开，再让 Playwright
 *      自己按可操作性规则点一次，看是"探针点歪了"还是"真的点不开"。
 *   ③ 顺带：设置页的段外壳是 Tailwind 类 div，看设计系统到底覆盖到哪一层。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const OUT = path.join(SHOTS, "diag-mvp2");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 860 },
  locale: "zh-CN",
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);

/* ================= ① 图标栏 ================= */
console.log("\n########## ① 图标栏为什么是空的 ##########");
const rail = await page.evaluate(() => {
  const r = document.querySelector("app-side-nav");
  const list = r && r.querySelector("ul, nav, [role=navigation]");
  const item = r && r.querySelector("bit-nav-item");
  const icon = item && item.querySelector("i[class*=bwi], bit-icon");
  const label = item && item.querySelector("span.tw-truncate, span");
  const anc = (el, n = 6) => {
    const out = [];
    let e = el;
    while (e && out.length < n) {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      out.push({
        t: e.tagName.toLowerCase() + "." + (e.getAttribute("class") || "").split(/\s+/).slice(0, 3).join("."),
        op: cs.opacity, ov: cs.overflow, disp: cs.display, vis: cs.visibility,
        rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      });
      e = e.parentElement;
    }
    return out;
  };
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  return {
    railBg: r ? getComputedStyle(r).backgroundColor : null,
    railColor: r ? getComputedStyle(r).color : null,
    railRect: R(r),
    listRect: R(list),
    itemRect: R(item),
    itemOpacity: item ? getComputedStyle(item).opacity : null,
    itemBg: item ? getComputedStyle(item).backgroundColor : null,
    iconRect: R(icon),
    iconFont: icon ? getComputedStyle(icon).fontFamily : null,
    iconContent: icon ? getComputedStyle(icon, "::before").content : null,
    iconOpacity: icon ? getComputedStyle(icon).opacity : null,
    iconColor: icon ? getComputedStyle(icon).color : null,
    labelText: label ? label.textContent : null,
    labelRect: R(label),
    labelOpacity: label ? getComputedStyle(label).opacity : null,
    labelColor: label ? getComputedStyle(label).color : null,
    labelFont: label ? getComputedStyle(label).fontFamily + " / " + getComputedStyle(label).fontSize : null,
    labelOverflowHidden: label ? getComputedStyle(label).overflow : null,
    labelBoxes: label ? label.getClientRects().length : null,
    itemAncestors: anc(item, 5),
    iconAncestors: anc(icon, 4),
    fonts: {
      bwiLoaded: document.fonts.check('18px "bwi"'),
      bwiFaces: [...document.fonts].filter((f) => /bwi/i.test(f.family)).map((f) => f.family + "/" + f.status),
    },
    bwiSheetOk: [...document.styleSheets].some((s) => (s.href || "").includes("bwi")),
  };
});
console.log(JSON.stringify(rail, null, 1));
await page.screenshot({ path: path.join(OUT, "rail-3x.png"), clip: { x: 0, y: 60, width: 120, height: 380 } });

/* ================= ② 外观页下拉 ================= */
console.log("\n########## ② 外观页主题下拉 ##########");
await goRoute(page, "/settings/appearance", undefined, 25000).catch(() => {});
await sleep(3000);

const stack = await page.evaluate(() => {
  const s = document.querySelector("bit-select");
  const ng = s && s.querySelector("ng-select");
  const ctl = s && s.querySelector(".ng-select-container");
  const b = ctl ? ctl.getBoundingClientRect() : null;
  const cx = b ? Math.round(b.x + b.width / 2) : 0;
  const cy = b ? Math.round(b.y + b.height / 2) : 0;
  const R = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; };
  const chain = (el, n = 6) => {
    const out = [];
    let e = el;
    while (e && out.length < n) { const cs = getComputedStyle(e); out.push(e.tagName.toLowerCase() + " pe=" + cs.pointerEvents + " pos=" + cs.position + " z=" + cs.zIndex + " rect=" + JSON.stringify(R(e))); e = e.parentElement; }
    return out;
  };
  return {
    point: [cx, cy],
    top3: document.elementsFromPoint(cx, cy).slice(0, 5).map((e) => e.tagName.toLowerCase() + "." + (e.getAttribute("class") || "").split(/\s+/).slice(0, 4).join(".")),
    ctlRect: R(ctl),
    ngRect: R(ng),
    ngPe: ng ? getComputedStyle(ng).pointerEvents : null,
    ngChain: chain(ng, 4),
    // 虚拟滚动的外层
    mainCls: (document.querySelector("main") || {}).className,
    mainScrollTop: (document.querySelector("main") || {}).scrollTop,
  };
});
console.log(JSON.stringify(stack, null, 1));

// 让 Playwright 自己点（它会先滚动到可见、算元素中心、检查可操作性）
const sel = page.locator("bit-select").first();
console.log("  Playwright 直接点 bit-select ...");
const before = await page.evaluate(() => document.querySelectorAll("ng-select.ng-select-opened").length);
await sel.click({ timeout: 8000 }).catch((e) => console.log("   click 抛错: " + String(e.message).slice(0, 120)));
await sleep(1200);
const after = await page.evaluate(() => ({
  opened: document.querySelectorAll("ng-select.ng-select-opened").length,
  panels: [...document.querySelectorAll("ng-dropdown-panel")].filter((p) => p.getBoundingClientRect().height > 0).length,
  panelRect: (() => {
    const p = [...document.querySelectorAll("ng-dropdown-panel")].find((q) => q.getBoundingClientRect().height > 0);
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  })(),
}));
console.log(`  点前 opened=${before}  点后 ${JSON.stringify(after)}`);
await page.screenshot({ path: path.join(OUT, "appearance-after-pw-click.png") });
// 再试键盘
if (after.opened === 0) {
  await page.keyboard.press("ArrowDown");
  await sleep(800);
  console.log("  ArrowDown 后: " + JSON.stringify(await page.evaluate(() => ({
    opened: document.querySelectorAll("ng-select.ng-select-opened").length,
    panels: [...document.querySelectorAll("ng-dropdown-panel")].filter((p) => p.getBoundingClientRect().height > 0).length,
  }))));
}

/* ================= ③ 设置页段外壳 ================= */
console.log("\n########## ③ 设置段外壳（设计系统覆盖到哪一层）##########");
const card = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  const divs = [...main.querySelectorAll("div")].filter((d) =>
    /tw-border\b|tw-border-solid|tw-rounded/.test(d.className) && d.getBoundingClientRect().width > 300);
  return divs.slice(0, 4).map((d) => {
    const cs = getComputedStyle(d);
    const b = d.getBoundingClientRect();
    return {
      cls: d.className.slice(0, 150),
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      bg: cs.backgroundColor, border: cs.borderTopWidth + " " + cs.borderTopColor,
      radius: cs.borderTopLeftRadius, pad: cs.padding, shadow: cs.boxShadow.slice(0, 60),
    };
  });
});
console.log(JSON.stringify(card, null, 1));
await page.screenshot({ path: path.join(OUT, "settings-appearance-full.png") });

await browser.close();
