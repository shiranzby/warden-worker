/**
 * 第十九批(W 段) 窄屏验收 —— 用户验收第十八批后提的两条, 逐条断。
 *
 * 用法(同一个脚本跑两个环境, 不拆成两份):
 *   # 本地 dev server(8099)
 *   node .deploycheck/probe-w19-verify.mjs
 *   # 线上 shypwd.cc.cd —— 本机直连不通, 必须显式挂代理
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-w19-verify.mjs
 *
 * 🔴 本批最大的教训写在判据里: **要对着"用户看见的东西"量**。
 *   第十八批断言的是:
 *     W1 → 输入框**本体**的高度(早就统一 38px, 当时全绿)
 *     W2 → "新增按钮 32px == 单个 toggle 32px"(也是真的)
 *   但用户看到的分别是:
 *     W1 → **带边框的可见框**(Send 名称 40 / 要分享的文本 64)
 *     W2 → **整条切换条**(42)与按钮的**底边**和**字号**
 *   所以这里一律量"可见框"(第一个有边框的祖先), 而不是控件本体。
 *
 * 探针顺序按 MEMORY ⑮: 对话框的量测排最后(cdk overlay 不随路由卸载)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const OUT = path.join(SHOTS, "w19");
fs.mkdirSync(OUT, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
if (PROXY) console.log(`proxy = ${PROXY}`);
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE = ${BASE}`);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

async function closeAllDialogs() {
  for (let i = 0; i < 6; i++) {
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
    await sleep(1500);
  }
  return (await page.evaluate(() => document.querySelectorAll("bit-dialog").length)) === 0;
}

/* =====================================================================
 * ② 切换行 vs 新增 Send(无浮层, 先量)
 * ===================================================================== */
console.log("\n########## ② 切换行 vs 新增 Send ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
await closeAllDialogs();
const row = await page.evaluate(() => {
  const R = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             bottom: +b.bottom.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1), fs: cs.fontSize };
  };
  const q = (s) => document.querySelector(s);
  const group = q("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group");
  const toggles = [...document.querySelectorAll("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group bit-toggle")];
  const newHost = q("main#main-content tools-send-list > .warden-send-filters > .warden-send-filters-new");
  const newBtn = newHost ? newHost.querySelector("button") : null;
  const inner = newBtn ? newBtn.firstElementChild : null;
  return {
    group: R(group),
    toggle0: toggles[0] ? R(toggles[0]) : null,
    toggleLabel0: toggles[0] ? R(toggles[0].querySelector("label")) : null,
    toggleFs: toggles[0] && toggles[0].querySelector("label") ? getComputedStyle(toggles[0].querySelector("label")).fontSize : null,
    hasDropdownFallback: !!q("main#main-content tools-send-list bit-toggle-dropdown"),
    newHost: R(newHost),
    newBtn: R(newBtn),
    newInner: R(inner),
    newBtnText: newBtn ? (newBtn.innerText || "").trim() : null,
  };
});
console.log("  " + JSON.stringify(row));
await shot("02-filters.png");

check("② 切换条没降级成下拉框", !row.hasDropdownFallback, `dropdown=${row.hasDropdownFallback}`);
check(
  "② 新增 Send 的**可见高度** == 切换条(42)",
  row.group && row.newBtn && Math.abs(row.newBtn.h - row.group.h) <= 1,
  `newBtn.h=${row.newBtn && row.newBtn.h} group.h=${row.group && row.group.h}`,
);
check(
  "② 新增 Send 与切换条**上下沿对齐**(不再顶对齐)",
  row.group && row.newBtn
    ? Math.abs(row.newBtn.y - row.group.y) <= 1 && Math.abs(row.newBtn.bottom - row.group.bottom) <= 1
    : false,
  `new=[${row.newBtn && row.newBtn.y}..${row.newBtn && row.newBtn.bottom}] group=[${row.group && row.group.y}..${row.group && row.group.bottom}]`,
);
check(
  "② 字号与切换标签一致(14px)",
  row.newBtn && row.toggleFs && row.newBtn.fs === row.toggleFs,
  `newBtn.fs=${row.newBtn && row.newBtn.fs} toggle.fs=${row.toggleFs}`,
);
check(
  "② 文字在新按钮里垂直居中",
  row.newBtn && row.newInner ? Math.abs(row.newInner.cy - row.newBtn.cy) <= 1.5 : false,
  `inner.cy=${row.newInner && row.newInner.cy} btn.cy=${row.newBtn && row.newBtn.cy}`,
);
check("② 文字仍是「新增 Send」且没换行", row.newBtnText === "新增 Send", `text=${row.newBtnText}`);

/* =====================================================================
 * ① 「要分享的文本」「私密备注」与「Send 名称」同高
 * ===================================================================== */
const measureFields = () =>
  page.evaluate(() => {
    const d = document.querySelector("bit-dialog");
    const R = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { y: +b.y.toFixed(1), h: +b.height.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1),
               padT: cs.paddingTop, padB: cs.paddingBottom };
    };
    const field = (sel) => {
      const ctl = d.querySelector(sel);
      if (!ctl) return null;
      let ff = ctl;
      while (ff && ff.tagName.toLowerCase() !== "bit-form-field") ff = ff.parentElement;
      const wrap = ctl.parentElement;
      // 「可见框」= 第一个有边框的祖先(用户看到的那个框)
      let boxEl = wrap;
      while (boxEl && getComputedStyle(boxEl).borderTopWidth === "0px") boxEl = boxEl.parentElement;
      return { ctl: R(ctl), wrap: R(wrap), box: R(boxEl), formField: R(ff) };
    };
    return {
      name: field('input[formcontrolname="name"]'),
      text: field('textarea[formcontrolname="text"]'),
      notes: field('textarea[formcontrolname="notes"]'),
      maxAccess: field('input[formcontrolname="maxAccessCount"]'),
    };
  });

async function openSend(kind) {
  await goRoute(page, "/sends", "tools-send-list", 25000);
  await sleep(2200);
  await closeAllDialogs();
  const entry = page.locator("main#main-content tools-send-list > .warden-send-filters > .warden-send-filters-new button");
  await entry.first().click();
  await sleep(900);
  await page.locator(`.cdk-overlay-container button:has-text("${kind}")`).first().click();
  await sleep(2800);
  await page.locator(".warden-send-options-toggle").first().click();
  await sleep(1300);
}

for (const kind of ["文本 Send", "文件 Send"]) {
  console.log(`\n########## ① 新增${kind}(展开附加选项) ##########`);
  await openSend(kind);
  const f = await measureFields();
  console.log("  " + JSON.stringify(f));
  await shot(`01-${kind === "文本 Send" ? "text" : "file"}.png`);
  const present = Object.entries(f).filter(([, v]) => v);
  for (const [k, v] of present) {
    console.log(`     ${k.padEnd(10)} 可见框.h=${v.box && v.box.h}  本体.h=${v.ctl && v.ctl.h}  formField.h=${v.formField && v.formField.h}`);
  }
  const nameBox = f.name && f.name.box ? f.name.box.h : null;
  check(`① ${kind}: 名称可见框 ≈ 40px`, nameBox !== null && Math.abs(nameBox - 40) <= 1.5, `h=${nameBox}`);
  for (const key of ["text", "notes"]) {
    const v = f[key];
    if (!v) continue;
    check(
      `① ${kind}: ${key} 的可见框与名称同高`,
      Math.abs(v.box.h - nameBox) <= 1,
      `${key}.box=${v.box.h} name.box=${nameBox}`,
    );
    check(
      `① ${kind}: ${key} 本体仍是 38px(V 段未回归)`,
      Math.abs(v.ctl.h - 38) <= 1,
      `h=${v.ctl.h}`,
    );
  }
  // 断言"整块字段"的高度也基本相等(不然框一样高、外面还有别的空当)
  if (f.text) {
    check(
      `① ${kind}: 文本字段整块高度 == 名称字段整块高度(±3)`,
      Math.abs(f.text.formField.h - f.name.formField.h) <= 3,
      `text=${f.text.formField.h} name=${f.name.formField.h}`,
    );
  }
}

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));
console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
