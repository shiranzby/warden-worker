/**
 * 生产实例(`shypwd.cc.cd`)上账号管理台的**只读**截图 + 冒烟验收 —— 第二十三批（AB 段）。
 *
 * 与 `probe-admin-ui.mjs` 的分工：
 *   · 那个跑在**测试通道**(warden-worker-test / 灌了种子数据的测试库)，会真的点写操作按钮，
 *     而且**一旦发现 envTag 不是"测试"就立刻中止**；
 *   · 这个跑在**生产**(用户真实账号)，所以纪律是 **一个字节都不许改**。
 *
 * 「只读」不是靠自觉，是靠一条机器判据：拦截页面发出的所有请求，
 * **任何非 GET/HEAD 且打到 `/api/admin/` 的请求都算失败**。这样"我点没点到写按钮"
 * 就不再是人的记忆问题。
 *
 * ⚠️ 本脚本**故意不点击**任何按钮（除了"查看详情"，那只是读取已在内存里的数据）。
 *    「停用 / 踢下线 / 重置两步验证 / 删除」在生产实例上必须由**用户本人**决定。
 *
 * 用法：
 *   set -a && . .deploycheck/.env.local && set +a && node .deploycheck/probe-admin-prod-shots.mjs
 *   ADMIN_PROD_BASE=https://shypwd.cc.cd ADMIN_SHOTS_TAG=r23 node ... probe-admin-prod-shots.mjs
 * 退出码：有 FAIL 就是 1。
 * ⚠️ 别用 `| head -N` 跑（SIGPIPE 会让 node 中途死掉）。要留档就 `> 文件`。
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";

const BASE = (process.env.ADMIN_PROD_BASE || "https://shypwd.cc.cd").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN || "";
const CHROME =
  process.env.WARDEN_CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";
const SHOTS = path.resolve(import.meta.dirname, "shots", process.env.ADMIN_SHOTS_TAG || "admin-prod");

/** 本机直连 Cloudflare 边缘会被 TLS reset，一律挂代理（与 curl 侧同一套）。 */
const PROXY =
  process.env.ADMIN_PROD_PROXY ||
  (/localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890");

const VIEWPORTS = [
  { w: 1920, h: 1080, tag: "1920" },
  { w: 1440, h: 900, tag: "1440" },
  { w: 768, h: 1024, tag: "768" },
  { w: 390, h: 844, tag: "390" },
];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};
const group = (t) => console.log(`\n── ${t} ──`);

fs.mkdirSync(SHOTS, { recursive: true });
if (!TOKEN) {
  console.error("缺少 ADMIN_TOKEN 环境变量（见 .deploycheck/.env.local）。");
  process.exit(2);
}
console.log(`BASE   = ${BASE}`);
console.log(`代理   = ${PROXY || "(直连)"}`);
console.log(`截图   = ${SHOTS}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});

/** 非 GET 的管理接口请求 —— 出现任何一条就是"越界写了"。 */
const mutations = [];
const consoleErrors = [];
let pageErrors = 0;

const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent: UA,
  locale: "zh-CN",
  viewport: { width: VIEWPORTS[0].w, height: VIEWPORTS[0].h },
});
const page = await ctx.newPage();
page.on("request", (r) => {
  const m = r.method().toUpperCase();
  if (m !== "GET" && m !== "HEAD" && r.url().includes("/api/admin/")) {
    mutations.push(`${m} ${new URL(r.url()).pathname}`);
  }
});
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => {
  pageErrors++;
  consoleErrors.push("pageerror: " + String(e).slice(0, 200));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitStable(sel, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await page.locator(sel).count();
    if (n > 0) return true;
    await sleep(200);
  }
  return false;
}
/** 先滚进视口再拍 —— 否则截图里是"元素在视口外"的假象（本项目踩过）。 */
const shotAt = async (file, el) => {
  if (el) await el.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(260);
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
};

try {
  group("① 令牌门");
  await page.goto(`${BASE}/admin/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  const gate = await waitStable("#gate input, #gate button");
  check("令牌门渲染出来", gate, "");
  // ⚠️ 文件名必须与**实际视口**一致 —— 上一版在这里直接拍，
  // 拿到的是 context 初始的 1920x1080，却叫 "gate-390-default.png"（文件名撒谎）。
  for (const vp of [VIEWPORTS[3], VIEWPORTS[1]]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await sleep(320);
    await shotAt(`gate-${vp.tag}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(200);

  group("② 用生产令牌进入");
  await page.fill("#gate input", TOKEN).catch(async () => {
    await page.locator("#gate input").first().fill(TOKEN);
  });
  await page.locator("#gate button").first().click();
  const ready = await waitStable('#dash:not([hidden]) td[data-label="账号"]', 15000);
  check("进入管理台（表格出现且 #dash 已展开）", ready, "");

  const envTag = await page
    .locator('[class*="env"], .badge, .tag')
    .first()
    .innerText()
    .catch(() => "");
  const bodyText = await page.locator("body").innerText();
  check(
    "页面自报运行在生产实例（env 徽章含“生产”）",
    /生产/.test(bodyText),
    `envTag=${JSON.stringify(envTag.trim())}`,
  );
  const state = await page.evaluate(() => ({
    rows: document.querySelectorAll('td[data-label="账号"]').length,
    gateHidden: (() => {
      const g = document.getElementById("gate");
      return !g || getComputedStyle(g).display === "none";
    })(),
    cards: document.querySelectorAll(".stat, .card, [class*='stat']").length,
  }));
  check("令牌门已收起（不是叠在仪表盘上）", state.gateHidden, JSON.stringify(state));
  check("表格有数据行", state.rows > 0, `rows=${state.rows}`);

  group("③ 四视口 × 明暗双主题");
  for (const vp of VIEWPORTS) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await sleep(420);
      const g = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        theme: getComputedStyle(document.body).backgroundColor,
        rows: document.querySelectorAll('td[data-label="账号"]').length,
      }));
      check(
        `${vp.tag} ${scheme}: 无横向溢出`,
        g.overflowX <= 1,
        `overflowX=${g.overflowX} bg=${g.theme} rows=${g.rows}`,
      );
      check(`${vp.tag} ${scheme}: 表格仍有行（不是空白页）`, g.rows > 0, `rows=${g.rows}`);
      await shotAt(`dash-${scheme}-${vp.tag}.png`);
    }
  }

  group("④ 详情弹窗（只读：数据已在内存里，不发请求）");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await sleep(300);
  const beforeMutations = mutations.slice();
  const detailBtn = page.locator("#userRows tr:first-child td.actions button").first();
  if (await detailBtn.count()) {
    await detailBtn.click();
    const ok = await waitStable("dialog .sheet, dialog[open], .sheet");
    check("详情弹窗可打开", ok, "");
    await sleep(400);
    await shotAt("detail-1440.png");
    const overflow = await page.evaluate(() => {
      const d = document.querySelector("dialog, .sheet");
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { h: Math.round(r.height), vh: window.innerHeight, w: Math.round(r.width) };
    });
    check(
      "弹窗不超出视口高度",
      overflow && overflow.h <= overflow.vh,
      JSON.stringify(overflow),
    );
    // 关掉弹窗（Esc 或 ×），不影响任何服务端状态
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(320);
    await shotAt("detail-closed-1440.png");
  } else {
    check("找到行内「管理」入口", false, "未找到按钮");
  }

  group("⑤ 只读守卫：全程不得出现非 GET 的管理接口请求");
  const unexpected = mutations.slice();
  check(
    "没有任何写请求发出",
    unexpected.length === 0,
    unexpected.length ? unexpected.join(", ") : "0 条",
  );
  check(
    "详情弹窗期间也没发请求",
    beforeMutations.length === 0,
    `before=${beforeMutations.length}`,
  );

  group("⑥ 控制台体检");
  const csp = consoleErrors.filter((t) => /Content Security Policy|Refused to apply/i.test(t));
  check("0 个 pageerror", pageErrors === 0, `pageErrors=${pageErrors}`);
  check("0 个 console error", consoleErrors.length === 0, `${consoleErrors.length} 条`);
  check("0 个 CSP 违规", csp.length === 0, csp.join(" | ").slice(0, 160));
  if (consoleErrors.length) console.log("    样本:", consoleErrors.slice(0, 3));
} finally {
  await browser.close();
}

console.log("\n" + "=".repeat(60));
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
console.log(`截图: ${SHOTS}`);
console.log("=".repeat(60));
process.exit(fail ? 1 : 0);
