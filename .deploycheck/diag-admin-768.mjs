/**
 * 一次性诊断：768px 档下表格各列的 max-content / 实际宽度分别是多少？
 * 目的：回答"到底哪一列把 720px 吃完了"，而不是靠猜。
 * 用法：ADMIN_TOKEN_TEST=... node .deploycheck/diag-admin-768.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";

const BASE = (process.env.ADMIN_TEST_BASE || "https://test.shytest.cc.cd").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN_TEST || "";
const CHROME = "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const W = Number(process.env.DIAG_W || 768);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: { server: "http://127.0.0.1:7890", bypass: "localhost,127.0.0.1" },
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: W, height: 1024 },
  locale: "zh-CN",
});
const page = await ctx.newPage();
await page.goto(`${BASE}/admin/?d=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#gateBtn");
await page.fill("#tokenInput", TOKEN);
await page.click("#gateBtn");
await page.waitForFunction(() => !document.getElementById("dash").hidden);
await page.waitForTimeout(1000);

const out = await page.evaluate(() => {
  const panel = document.querySelector(".panel");
  const table = panel.querySelector("table");
  const pr = panel.getBoundingClientRect();
  const ths = [...table.querySelectorAll("thead th")];
  const rows = [...table.querySelectorAll("tbody tr")];

  // 量 max-content：把该列所有单元格包成一个 inline-block 探针，量它的自然宽度
  const maxContentOf = (i) => {
    let best = 0;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px";
    document.body.appendChild(probe);
    for (const tr of rows) {
      const td = tr.children[i];
      probe.style.font = getComputedStyle(td).font;
      probe.textContent = (td.textContent || "").trim();
      best = Math.max(best, probe.getBoundingClientRect().width);
    }
    probe.remove();
    return Math.round(best);
  };

  return {
    panelW: Math.round(pr.width),
    tableW: Math.round(table.getBoundingClientRect().width),
    tableSw: table.scrollWidth,
    cols: ths.map((th, i) => {
      const td = rows[0].children[i];
      const b = td.getBoundingClientRect();
      const cs = getComputedStyle(td);
      return {
        head: th.textContent.trim(),
        w: Math.round(b.width),
        padL: cs.paddingLeft,
        padR: cs.paddingRight,
        maxContent: maxContentOf(i),
        firstText: (td.textContent || "").trim().slice(0, 22),
        nowrap: cs.whiteSpace,
        cellScrollW: td.scrollWidth,
        cellClientW: td.clientWidth,
      };
    }),
  };
});

console.log(`视口 ${W}px  面板 ${out.panelW}  表格 ${out.tableW}  (scroll ${out.tableSw})`);
console.log("列".padEnd(10) + "实际宽".padStart(8) + "内容max".padStart(9) + "内边距".padStart(9) + "  换行  内容");
let sum = 0;
for (const c of out.cols) {
  sum += c.w;
  console.log(
    c.head.padEnd(10) +
      String(c.w).padStart(8) +
      String(c.maxContent).padStart(9) +
      `${c.padL}/${c.padR}`.padStart(9) +
      "  " +
      (c.nowrap === "normal" ? "可换" : "不换").padEnd(4) +
      "  " +
      c.firstText,
  );
}
console.log(`列宽合计 ${sum}（面板 ${out.panelW}）`);
const over = out.cols.filter((c) => c.cellScrollW > c.cellClientW + 1);
console.log(over.length ? "❗溢出单元格: " + over.map((c) => c.head).join(",") : "✅ 无单元格内部溢出");
await browser.close();
