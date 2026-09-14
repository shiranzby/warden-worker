/**
 * 第十六批(T 段)S2 选择器收窄的**回归守卫** —— 防止"修好一处、压坏一片"。
 *
 * 背景: S 段为了让自定义域名输入框里的 placeholder 垂直居中, 写了一条
 *   `main#main-content bit-form-field textarea[bitInput] { height: 32px !important; … }`
 * 而 `textarea[bitInput]` 全仓库 20+ 处(备注 rows=5 / Send / 导入 / SM 申请…)
 * ⇒ 移动端这些多行框会被压成 32px 一行。第十六批把选择器收窄成
 * `main#main-content .warden-domain-row bit-form-field textarea[bitInput]`。
 *
 * 本脚本同时钉住两头(少一头都不算过):
 *   A. 自定义域名页: 那个 textarea **必须**仍是 32px, 且**在** `.warden-domain-row` 内;
 *   B. 新增登录项目对话框: 备注 `rows="5"` 的 textarea **必须不是** 32px(即没被误伤),
 *      且**不在**任何 `.warden-domain-row` 内。
 * 另外全页扫一遍: 除自定义域名页外, 不允许有任何 `textarea[bitInput]` 的 height 恰为 32px
 * 且同时被 `.warden-domain-row` 命中(结构上不可能, 但用运行时数据把它钉死)。
 *
 * 用法: node .deploycheck/probe-b16-notes.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

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
console.log("BASE = " + BASE);
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

await ensureLoggedIn(page, ctx, { verbose: false });

/** 页面上所有 textarea[bitInput] 的读数。 */
const textareas = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("textarea[bitInput]")].map((t) => {
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      return {
        h: Math.round(r.height),
        computedH: cs.height,
        lh: cs.lineHeight,
        rows: t.getAttribute("rows"),
        inDomainRow: !!t.closest(".warden-domain-row"),
        visible: t.getClientRects().length > 0,
        placeholder: t.getAttribute("placeholder"),
      };
    }),
  );

/** 用文本/aria 找到可见控件并点它(复用 dialog 探针的写法)。 */
const findAndTap = (pattern, kind = "button, a") =>
  page.evaluate(
    ({ pattern, kind }) => {
      const re = new RegExp(pattern);
      const el = [...document.querySelectorAll(kind)].find((e) => {
        const t = (e.getAttribute("aria-label") || "") + " " + (e.textContent || "");
        return re.test(t) && e.getBoundingClientRect().width > 0;
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...hit }));
      }
      return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 20);
    },
    { pattern, kind },
  );

/* ===================== A. 自定义域名页 ===================== */
console.log("\n########## A. 自定义域名页 (#/settings/domain-rules) ##########");
await goRoute(page, "#/settings/domain-rules", "main#main-content", 20000);
await sleep(1500);
let list = await textareas();
if (!list.length) {
  // 还没有行 → 点「自定义域名」那个新增按钮(与 probe-b16-domain.mjs 一致)
  const added = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (e) => /自定义域名/.test(e.textContent || "") && e.getBoundingClientRect().width > 0,
    );
    if (!b) return null;
    b.click();
    return (b.textContent || "").trim().slice(0, 20);
  });
  console.log("  点新增按钮: " + added);
  await sleep(900);
  list = await textareas();
}
console.log("  读到 textarea: " + JSON.stringify(list));
const dom = list.filter((t) => t.inDomainRow);
check("A1 自定义域名输入框存在且在 .warden-domain-row 内", dom.length >= 1, `命中 ${dom.length} 个`);
check(
  "A2 它仍是 32px(S2 的居中仍然生效)",
  dom.length >= 1 && dom.every((t) => t.h === 32),
  dom.map((t) => `${t.h}px/lh=${t.lh}`).join(", "),
);

/* ===================== B. 新增登录项目 → 备注框 ===================== */
console.log("\n########## B. 新增项目对话框里的备注框(rows=5) ##########");
await goRoute(page, "#/vault", "main#main-content", 20000);
await sleep(1200);
console.log("  点「新增」→ " + (await findAndTap("^新增$|新增")));
await sleep(700);
console.log("  点「登录」→ " + (await findAndTap("^\\s*登录\\s*$|登录", "button, a, [role='menuitem']")));
await sleep(1200);

list = await textareas();
console.log("  读到 textarea: " + JSON.stringify(list));
const notes = list.filter((t) => t.visible && !t.inDomainRow);
check("B1 备注区 textarea 渲染出来了", notes.length >= 1, `命中 ${notes.length} 个`);
check(
  "B2 备注框没有被压成 32px(S2 未误伤)",
  notes.length >= 1 && notes.every((t) => t.h !== 32),
  notes.map((t) => `rows=${t.rows} h=${t.h}px`).join(", "),
);
check(
  "B3 备注框不在 .warden-domain-row 内",
  notes.every((t) => !t.inDomainRow),
  notes.map((t) => `inDomainRow=${t.inDomainRow}`).join(", "),
);

/* ===================== C. 结构证明 ===================== */
console.log("\n########## C. 结构断言 ##########");
const domainRows = await page.evaluate(() => document.querySelectorAll(".warden-domain-row").length);
check("C1 新增项目页里没有 .warden-domain-row(钩子不外溢)", domainRows === 0, `count=${domainRows}`);

console.log(`\n===== 合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
