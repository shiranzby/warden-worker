/**
 * 第十七批(U 段) 桌面端回归 —— U 段全部只在窄屏生效, 这里证明宽屏一点没变。
 *   node .deploycheck/probe-u17-desktop.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const OUT = path.join(SHOTS, "u17");
fs.mkdirSync(OUT, { recursive: true });
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 860 },
  locale: "zh-CN",
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE = ${BASE}  viewport=1280x860(桌面)`);

/* ① 安全页: 桌面**保留** tab 条那层浅灰底(U1 只在窄屏生效) */
console.log("\n########## 桌面 ① 安全页 tab 条 ##########");
await goRoute(page, "/settings/security/session-timeout", "main#main-content", 20000);
await sleep(900);
const s1 = await page.evaluate(() => {
  const h = document.querySelector("main#main-content app-header header");
  return { bg: getComputedStyle(h).backgroundColor };
});
console.log("  ", JSON.stringify(s1));
check("桌面端 tab 条背景**未被**改成透明(U1 不越界)", s1.bg !== "rgba(0, 0, 0, 0)", `bg=${s1.bg}`);
await page.screenshot({ path: path.join(OUT, "20-desktop-security.png") });

/* ⑤ 发送列表页: 桌面**保留** tw-mt-4 */
console.log("\n########## 桌面 ⑤ 发送列表页 ##########");
await goRoute(page, "/sends", "main#main-content", 20000);
await sleep(1000);
const s5 = await page.evaluate(() => {
  const flt = document.querySelector('main#main-content tools-send-list > [slot="filters"]');
  const tg = document.querySelector("main#main-content bit-toggle-group");
  return { mt: flt ? getComputedStyle(flt).marginTop : null, toggleVisible: !!tg && tg.getClientRects().length > 0 };
});
console.log("  ", JSON.stringify(s5));
check("桌面端 filters 仍是 16px 上边距(U5 不越界)", s5.mt === "16px", `mt=${s5.mt}`);
await page.screenshot({ path: path.join(OUT, "21-desktop-sendlist.png") });

/* ④ 导出页: 桌面端也应是 bit-select */
console.log("\n########## 桌面 ④ 导出页 ##########");
await goRoute(page, "/tools/export", "main#main-content", 20000);
await sleep(1200);
const exp = await page.evaluate(() => ({
  native: document.querySelectorAll('select[formcontrolname="format"]').length,
  bitSel: document.querySelectorAll('main#main-content bit-select').length,
}));
console.log("  ", JSON.stringify(exp));
check("桌面端文件格式也是 bit-select(替换是全局的)", exp.native === 0 && exp.bitSel >= 1, JSON.stringify(exp));
await page.screenshot({ path: path.join(OUT, "24-desktop-export.png") });

/* ②③④ 发送表单(桌面是对话框): 多行输入保持多行, 底栏正常 */
console.log("\n########## 桌面 ②③④ 发送表单 ##########");
// 上面「导出页」那段把路由带走了, 先回 /sends(SPA 内部跳 hash, 不 reload ——
// reload 会把应用踢去 #/lock?promptBiometric=true, 见第十三批 probe-b13-select)。
await goRoute(page, "/sends", "main#main-content", 20000);
await sleep(1000);
const addBtn = page.locator('button:visible', { hasText: "新增 Send" }).first();
check("能定位到「新增 Send」按钮(否则下面的检查全是空转)", (await addBtn.count()) > 0);
if (await addBtn.count()) {
  await addBtn.click();
  await sleep(500);
  const item = page.locator('[role=menuitem], button[bitmenuitem]').filter({ hasText: "文本" }).first();
  await item.click();
  await sleep(1400);
  const d = await page.evaluate(() => {
    const tas = [...document.querySelectorAll("bit-dialog textarea")].map((t) => ({
      fc: t.getAttribute("formcontrolname"),
      h: Math.round(t.getBoundingClientRect().height),
    }));
    const maxA = document.querySelector('input[formcontrolname="maxAccessCount"]');
    const step = document.querySelectorAll('[data-testid^="max-access-count-"]').length;
    const header = document.querySelector("bit-dialog > section > header");
    return {
      textareas: tas,
      maxPh: maxA?.getAttribute("placeholder") ?? null,
      stepBtns: step,
      headerPadTop: header ? getComputedStyle(header).paddingTop : null,
      tabbarDisplay: document.getElementById("warden-tabbar")
        ? getComputedStyle(document.getElementById("warden-tabbar")).display
        : "(无标签栏)",
    };
  });
  console.log("  ", JSON.stringify(d));
  const textH = d.textareas.find((t) => t.fc === "text")?.h;
  const notesH = d.textareas.find((t) => t.fc === "notes")?.h;
  check("桌面端「要分享的文本」仍是多行(未被压成 32px)", textH > 40, `h=${textH}`);
  check("桌面端「私密备注」仍是多行(未被压成 32px)", notesH > 40, `h=${notesH}`);
  check("桌面端页头未被压扁(U2 不越界)", d.headerPadTop !== "2px", `padTop=${d.headerPadTop}`);
  check("桌面端标签栏仍按原样(U3 不越界, 桌面本来就没有)", d.tabbarDisplay === "(无标签栏)" || d.tabbarDisplay === "none", `display=${d.tabbarDisplay}`);
  check("− / + 按钮在桌面端同样存在(新增功能, 非移动端专属)", d.stepBtns === 2, `n=${d.stepBtns}`);
  check("placeholder 桌面端也是「不限制」", d.maxPh === "不限制", `ph=${d.maxPh}`);
  await page.screenshot({ path: path.join(OUT, "22-desktop-sendform.png") });
}

/* ④ 桌面端下拉: 点输入框应能展开(原生路径没被破坏) */
console.log("\n########## 桌面 ④ 下拉展开 ##########");
const sel = page.locator("bit-dialog bit-select:visible").first();
check("能定位到对话框里的下拉(否则下面的检查会静默跳过)", (await sel.count()) > 0);
if (await sel.count()) {
  await sel.locator(".ng-select-container").first().click();
  await sleep(800);
  const open = await page.evaluate(() => [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0).length);
  check("桌面端点输入框能展开面板(原生路径完好)", open >= 1, `可见面板=${open}`);
  await page.screenshot({ path: path.join(OUT, "23-desktop-panel.png") });
}

console.log(`\npageerror: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
console.log(`\n===== 桌面回归: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
