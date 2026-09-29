/**
 * MVP 上线后的现场诊断 —— 只回答两个问题:
 *   ① `app-side-nav` 图标栏里到底渲染了什么?（截图上看是"空的深色条"）
 *   ② 设置·外观页那个主题下拉为什么点不开?（工具页两个下拉是好的，说明不是全局问题）
 *
 * 用法:
 *   WARDEN_TEST_BASE=https://test.shytest.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/diag-mvp-live.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const OUT = path.join(SHOTS, "diag-mvp");
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
});
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });

async function closeAllDialogs() {
  for (let i = 0; i < 8; i++) {
    if ((await page.evaluate(() => document.querySelectorAll("bit-dialog").length)) === 0) return true;
    const ok = await page.evaluate(() => {
      const ds = [...document.querySelectorAll("bit-dialog")];
      const d = ds[ds.length - 1];
      const b =
        d.querySelector("footer button[bitdialogclose]") ||
        d.querySelector("footer button:last-child") ||
        d.querySelector("button[biticonbutton='bwi-close']");
      if (b) { b.click(); return true; }
      return false;
    });
    if (!ok) return false;
    await sleep(1200);
  }
  return false;
}

console.log(`BASE = ${BASE}`);

/* ============ ① 图标栏 ============ */
console.log("\n########## ① app-side-nav 图标栏 ##########");
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await closeAllDialogs();
await sleep(2500);
await page.screenshot({ path: path.join(OUT, "10-vault-clean.png") });

const nav = await page.evaluate(() => {
  const rail = document.querySelector("app-side-nav");
  if (!rail) return { err: "没有 app-side-nav" };
  const r = rail.getBoundingClientRect();
  const items = [...rail.querySelectorAll('bit-nav-item, [data-testid="nav-item-container"]')];
  const dump = items.map((el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const icon = el.querySelector("bit-icon, i[class*=bwi]");
    const label = el.querySelector("span.tw-truncate, span");
    const ic = icon ? getComputedStyle(icon) : null;
    const lb = label ? getComputedStyle(label) : null;
    return {
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid"),
      text: (el.textContent || "").trim().slice(0, 14),
      disp: cs.display,
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      iconCls: icon ? (icon.getAttribute("class") || icon.tagName) : null,
      iconDisp: ic ? ic.display + "/" + ic.visibility + "/" + ic.color + "/" + ic.fontSize : null,
      labelDisp: lb ? lb.display + "/" + lb.visibility + "/" + lb.color + "/" + lb.fontSize : null,
    };
  });
  return {
    railRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    railBg: getComputedStyle(rail).backgroundColor,
    railPadding: getComputedStyle(rail).padding,
    railCls: (rail.getAttribute("class") || "").slice(0, 120),
    itemCount: items.length,
    items: dump,
    // 顺带看外层 grid 的第一列
    gridCols: (() => {
      const g = document.querySelector("app-layout div.tw-grid");
      return g ? getComputedStyle(g).gridTemplateColumns : null;
    })(),
  };
});
console.log(JSON.stringify(nav, null, 1));
await page.screenshot({ path: path.join(OUT, "11-rail-crop.png"), clip: { x: 0, y: 0, width: 130, height: 860 } });

/* ============ ② 设置·外观 主题下拉 ============ */
console.log("\n########## ② 设置·外观 主题下拉 ##########");
await goRoute(page, "/settings/appearance", undefined, 25000).catch(() => {});
await closeAllDialogs();
await sleep(3000);
await page.screenshot({ path: path.join(OUT, "20-appearance.png") });

const info = await page.evaluate(() => {
  const sels = [...document.querySelectorAll("bit-select")];
  return sels.slice(0, 3).map((s, i) => {
    const b = s.getBoundingClientRect();
    const ng = s.querySelector("ng-select");
    const ctl = s.querySelector(".ng-select-container, .ng-control");
    return {
      i,
      text: (s.innerText || s.textContent || "").trim().slice(0, 20),
      hostRect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      hasNgSelect: !!ng,
      ngCls: ng ? ng.className : null,
      ctlRect: ctl ? (() => { const q = ctl.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; })() : null,
      disabled: ng ? (ng.classList.contains("ng-select-disabled") || ctl && getComputedStyle(ctl).pointerEvents) : null,
      style: s.getAttribute("style"),
    };
  });
});
console.log("  bit-select 列表: " + JSON.stringify(info, null, 1));

// 用真实鼠标点第一个，并记录按下/抬起前后
const t = info.find((x) => x.hasNgSelect) || info[0];
if (t && t.ctlRect) {
  const cx = t.ctlRect[0] + t.ctlRect[2] / 2;
  const cy = t.ctlRect[1] + t.ctlRect[3] / 2;
  console.log(`  点击点 = (${cx}, ${cy})  该点上是: ` +
    JSON.stringify(await page.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.tagName + "." + (e.getAttribute("class") || "").slice(0, 80) : null;
    }, [cx, cy])));

  const snap = () => page.evaluate(() => ({
    opened: document.querySelectorAll("ng-select.ng-select-opened").length,
    panels: [...document.querySelectorAll("ng-dropdown-panel")].filter((p) => p.getBoundingClientRect().height > 0).length,
    focused: document.activeElement ? document.activeElement.tagName + "." + (document.activeElement.getAttribute("class") || "").slice(0, 40) : null,
  }));
  console.log("  点前: " + JSON.stringify(await snap()));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(300);
  console.log("  按下后: " + JSON.stringify(await snap()));
  await page.mouse.up();
  await sleep(900);
  console.log("  抬起后: " + JSON.stringify(await snap()));
  await page.screenshot({ path: path.join(OUT, "21-appearance-after-click.png") });
  await page.keyboard.press("Escape");
}

/* ============ ③ 顺带：设置页各段是否成卡片 ============ */
console.log("\n########## ③ 设置页结构（判断设计系统覆盖到哪一层）##########");
const sec = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  const secs = [...main.querySelectorAll("bit-section")];
  return {
    bitSectionCount: secs.length,
    firstSectionHtml: secs[0] ? secs[0].outerHTML.slice(0, 400) : null,
    firstSectionChildClasses: secs[0]
      ? [...secs[0].children].map((c) => c.tagName.toLowerCase() + "." + (c.getAttribute("class") || "").split(/\s+/).slice(0, 3).join("."))
      : [],
  };
});
console.log(JSON.stringify(sec, null, 1));

await browser.close();
