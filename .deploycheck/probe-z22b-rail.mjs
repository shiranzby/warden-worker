/**
 * Z2 图标栏冒烟 —— 布局列 / 导轨宽 / 每项内容**真的画出来了** / 移动端不受影响
 *
 * 🔴 为什么改成"断言 + 量内容"（2026-09-29 血案）：
 *    原版只打印 `itemRect` / `a` 的 flex-direction / span 的 font-size，
 *    这三个值在**整个内容层被 `display:none` 时依然全部正确** ——
 *    `[data-testid="nav-item-container"]` 高 56×52、`a>div` 仍是 column、
 *    span 仍是 10.5px，于是探针一路"绿"，而线上导轨其实是一条**空白黑条**。
 *    根因是我们自己那条 `> div:last-child{display:none}`（详情见 vaultwarden.css Z2 段注释）。
 *    ⇒ 判据一律落到 **icon / span 的 getClientRects().length 与渲染矩形**上，
 *      以及"导轨里至少能看到 6 组文字"。
 *
 * 用法:
 *   node .deploycheck/probe-z22b-rail.mjs                                   # 本地 8099
 *   RECON_W=390 RECON_H=844 node .deploycheck/probe-z22b-rail.mjs          # 窄屏回归
 *   WARDEN_TEST_BASE=https://test.shytest.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-z22b-rail.mjs                                 # 线上
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280);
const H = Number(process.env.RECON_H || 860);
const isNarrow = W <= 768;
const OUT = path.join(SHOTS, `z22b-${W}x${H}`);
fs.mkdirSync(OUT, { recursive: true });

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: W, height: H },
  locale: "zh-CN",
  ...(isNarrow ? { isMobile: true, hasTouch: true } : {}),
});
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);

console.log(`BASE = ${BASE}   viewport = ${W}x${H}`);

const d = await page.evaluate(() => {
  const R = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  };
  /** 真的画出来了吗：既有非零矩形，又有至少一个 client rect。 */
  const painted = (e) => {
    if (!e) return false;
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && e.getClientRects().length > 0;
  };
  const grid = document.querySelector("app-layout div.tw-grid:has(> app-side-nav)");
  const rail = document.querySelector("app-side-nav");
  const container = document.querySelector("bit-nav-item [data-testid=nav-item-container]");
  const inner = document.querySelector("bit-nav-item a[data-testid=nav-item-interactive] > div");
  const icon = document.querySelector("bit-nav-item a[data-testid=nav-item-interactive] bit-icon i, bit-nav-item a[data-testid=nav-item-interactive] bit-icon");
  const span = document.querySelector("bit-nav-item a span.tw-truncate");

  // 逐项：容器 / 图标 / 标签 三层都要真的画出来
  const items = [...document.querySelectorAll("app-side-nav [data-testid=nav-item-container]")].map((c) => {
    const ic = c.querySelector("bit-icon");
    const sp = c.querySelector("span.tw-truncate");
    return {
      text: (sp ? sp.textContent : (c.textContent || "")).trim().slice(0, 8),
      container: R(c),
      containerPainted: painted(c),
      // ⚠️ 关键：不是查"元素存不存在"，而是查"渲染矩形非零"
      iconPainted: painted(ic),
      iconRect: R(ic),
      labelPainted: painted(sp),
      labelRect: R(sp),
    };
  });
  const paintedItems = items.filter((i) => i.containerPainted && i.iconPainted);
  const labelledItems = items.filter((i) => i.labelPainted);

  return {
    gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    sideNav: R(rail),
    main: R(document.querySelector("main#main-content")),
    itemRect: R(container),
    itemPadInlineStart: container ? getComputedStyle(container).paddingInlineStart : null,
    innerFlexDir: inner ? getComputedStyle(inner).flexDirection : null,
    spanFont: span ? getComputedStyle(span).fontSize : null,
    // 内容可见性的硬证据
    innerDisplay: inner ? getComputedStyle(inner).display : null,
    iconPainted: painted(icon),
    spanPainted: painted(span),
    items,
    paintedCount: paintedItems.length,
    labelledCount: labelledItems.length,
    railVisibleText: (rail ? rail.innerText : "").replace(/\s+/g, "").slice(0, 40),
    tabbarDisp: (() => {
      const t = document.getElementById("warden-tabbar");
      return t ? getComputedStyle(t).display : null;
    })(),
    navItemCount: [...document.querySelectorAll("app-side-nav [data-testid=nav-item-container]")]
      .filter((c) => !c.closest("bit-nav-group")).length,
  };
});
console.log(JSON.stringify({ ...d, items: `(${d.items.length} 项)` }, null, 1));
d.items.forEach((i) => console.log(`     项 ${i.text}: container=${JSON.stringify(i.container)} icon=${JSON.stringify(i.iconRect)} label=${JSON.stringify(i.labelRect)}`));
await page.screenshot({ path: path.join(OUT, "01-rail.png") });

if (!isNarrow) {
  check("布局列第一列 = 68px 导轨", /^68px/.test(d.gridCols || ""), d.gridCols);
  check("导轨宽度 = 68px", d.sideNav && Math.abs(d.sideNav[2] - 68) <= 2, JSON.stringify(d.sideNav));
  check("每项容器已清掉行内 padding-inline-start", d.itemPadInlineStart === "0px", d.itemPadInlineStart);
  check("项内是竖排(图标在上/标签在下)", d.innerFlexDir === "column", String(d.innerFlexDir));
  check("标签字号 = 10.5px", d.spanFont === "10.5px", String(d.spanFont));

  /* 🔴 本批新增的核心判据 —— 内容层必须真的被画出来 */
  check("内容层没有被 display:none", d.innerDisplay === "block" || d.innerDisplay === "flex",
    String(d.innerDisplay));
  check("第一项的图标真的渲染出非零矩形", d.iconPainted,
    JSON.stringify(d.items[0] && d.items[0].iconRect));
  check("第一项的标签真的渲染出非零矩形", d.spanPainted,
    JSON.stringify(d.items[0] && d.items[0].labelRect));
  check("每一项的图标都画出来了", d.paintedCount === d.items.length,
    `${d.paintedCount}/${d.items.length}`);
  check("每一项的标签都画出来了", d.labelledCount === d.items.length,
    `${d.labelledCount}/${d.items.length}`);
  check("导轨里能读到导航文字（不是空白黑条）",
    d.railVisibleText.length >= 8, JSON.stringify(d.railVisibleText));
  check("一级导航 6 项", d.navItemCount === 6, String(d.navItemCount));
} else {
  check("窄屏不套用导轨（一级导航走底部标签栏）", d.sideNav === null || d.sideNav[2] <= 1 || d.tabbarDisp !== null,
    `sideNav=${JSON.stringify(d.sideNav)} tabbar=${d.tabbarDisp}`);
}

console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图 → ${OUT}/01-rail.png`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
