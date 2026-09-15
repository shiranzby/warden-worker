/** Z3 密码库页冒烟: 行高 / 表头 / 筛选列 + 截图 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path"; import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";
const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280), H = Number(process.env.RECON_H || 860);
const OUT = path.join(SHOTS, `z23-${W}x${H}`); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ headless: true, executablePath: CHROME, ...(PROXY ? { proxy: { server: PROXY } } : {}) });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, locale: "zh-CN", ...(W <= 768 ? { isMobile: true, hasTouch: true } : {}) });
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);
const d = await page.evaluate(() => {
  const td = document.querySelector("main#main-content app-vault-items table tbody td");
  const th = document.querySelector("main#main-content app-vault-items table thead th");
  const fh = document.querySelector("app-vault-filter [data-testid=filters-header]");
  const fb = document.querySelector('app-vault-filter > div[data-testid="filters"]');
  return {
    tdH: td ? getComputedStyle(td).height : null,
    tdPad: td ? getComputedStyle(td).paddingTop + "/" + getComputedStyle(td).paddingLeft : null,
    thFont: th ? getComputedStyle(th).fontSize : null,
    thTransform: th ? getComputedStyle(th).textTransform : null,
    thWidths: [...document.querySelectorAll("main#main-content app-vault-items table thead th")].map(t => (t.innerText||"").trim().slice(0,8)),
    filterHeaderBg: fh ? getComputedStyle(fh).backgroundColor : null,
    filterHeaderFont: fh ? getComputedStyle(fh).fontSize : null,
    filterBorder: fb ? getComputedStyle(fb).borderTopWidth : null,
  };
});
console.log("  " + JSON.stringify(d));
await page.screenshot({ path: path.join(OUT, "01-vault.png") });
// 行高判据**按视口分档**：
//  · 宽屏：目标就是设计稿的 --row-h(52px)。表格行高是"最小高度"，单元格里还有
//    32px 的行内按钮与文字行，实测落在 53.5 ⇒ 允许 +3px 的内容余量。
//  · 窄屏：**不按 52 收**。窄屏下名称格把「名称 / 用户名 / 文件夹」竖着堆了几行，
//    行高必然更高 —— 那是移动端该有的样子(设计稿只有桌面稿, 移动端由我们按同一套
//    token 推导)。这里只守住一个上限, 防止哪次改动把它顶回 78px 那种松垮值。
const tdH = parseFloat(d.tdH);
const rowOk = W <= 768 ? tdH >= 52 && tdH <= 64 : Math.abs(tdH - 52) <= 3;
check(W <= 768 ? "行高在合理区间(52~64px, 窄屏内容堆叠)" : "行高 ≈ --row-h(52px, 允许 +3px)",
  rowOk, d.tdH);
check("表头字号 = 12px 且大写", d.thFont === "12px" && d.thTransform === "uppercase", d.thFont + "/" + d.thTransform);
check("筛选列外框已去掉", d.filterBorder === "0px", d.filterBorder);
console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图目录: ${OUT}`);
await browser.close();
