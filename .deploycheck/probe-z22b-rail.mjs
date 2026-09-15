/** Z2 图标栏冒烟: 布局列 / 导轨宽度 / 项宽 / 主区左移 / 移动端不受影响 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path"; import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";
const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280), H = Number(process.env.RECON_H || 860);
const OUT = path.join(SHOTS, `z22b-${W}x${H}`); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME, ...(PROXY ? { proxy: { server: PROXY } } : {}) });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, locale: "zh-CN", ...(W <= 768 ? { isMobile: true, hasTouch: true } : {}) });
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);
const d = await page.evaluate(() => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const grid = document.querySelector("app-layout div.tw-grid:has(> app-side-nav)");
  const item = document.querySelector("bit-nav-item [data-testid=nav-item-container]");
  const a = document.querySelector("bit-nav-item a[data-testid=nav-item-interactive] > div");
  const span = document.querySelector("bit-nav-item a span.tw-truncate");
  const tabbar = document.getElementById("warden-tabbar");
  return {
    gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    sideNav: R(document.querySelector("app-side-nav")),
    main: R(document.querySelector("main#main-content")),
    itemRect: R(item), itemPadInlineStart: item ? getComputedStyle(item).paddingInlineStart : null,
    aFlexDir: a ? getComputedStyle(a).flexDirection : null,
    spanFont: span ? getComputedStyle(span).fontSize : null,
    tabbarDisp: tabbar ? getComputedStyle(tabbar).display : null,
    navItemCount: document.querySelectorAll("app-side-nav > bit-nav-item, app-side-nav > bit-nav-group").length,
  };
});
console.log(JSON.stringify(d, null, 1));
await page.screenshot({ path: path.join(OUT, "01-rail.png") });
console.log(`截图 → ${OUT}/01-rail.png`);
await browser.close();
