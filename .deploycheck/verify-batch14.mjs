/**
 * 第十四批(R 段)运行期验收 —— 用户第二轮反馈逐条断言。
 *
 * 约定: 每条打印 `✅/❌` 与实测数字, 全部通过时退出码 0。
 * ⚠️ 判据只用"可观测行为"(尺寸/位置/是否展开/display), 不断言"某条 CSS 写没写"。
 * ⚠️ 数行数/可见性都不要用 offsetParent(祖先 position:fixed 时它是 null, 会误杀)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

let fail = 0;
const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) fail += 1;
};

const SHOTS = path.resolve(import.meta.dirname, "shots-b14");
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
page.on("pageerror", (e) => console.log("  [pageerror] " + String(e.message).slice(0, 120)));
console.log("BASE = " + BASE);

await ensureLoggedIn(page, ctx, { verbose: false });
const goto = async (hash, sel, t = 20000) => {
  await goRoute(page, hash, sel, t);
  await sleep(1300);
};
const panelCount = () => page.evaluate(() => document.querySelectorAll("ng-dropdown-panel").length);

/* ================= 问题 1 / 3: 点箭头(不输入任何内容)就能展开 ================= */
console.log("\n【问题1/3】点最右侧箭头即可展开 —— 全程不输入任何内容");
const SELECT_PAGES = [
  ["#/tools/import", "工具页导入"],
  ["#/settings/security/session-timeout", "设置-会话超时"],
  ["#/settings/security/security-keys", "设置-密钥算法"],
  ["#/settings/appearance", "设置-外观"],
];
for (const [route, name] of SELECT_PAGES) {
  await goto(route);
  const n = await page.locator("bit-select").count();
  let allOk = n > 0;
  const details = [];
  for (let i = 0; i < n; i++) {
    const sel = page.locator("bit-select").nth(i);
    const info = await sel.evaluate((el) => {
      const btn = el.querySelector(".warden-select-open");
      const ctrl = el.querySelector(".ng-select-container");
      const b = btn ? btn.getBoundingClientRect() : null;
      const c = ctrl ? ctrl.getBoundingClientRect() : null;
      return {
        hasBtn: !!btn,
        btnW: b ? Math.round(b.width) : 0,
        btnH: b ? Math.round(b.height) : 0,
        ctrlH: c ? Math.round(c.height) : 0,
        // 覆盖层中心点命中的必须是它自己(不能被别的元素挡住)
        hit: btn ? (() => { const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e ? e.className.toString().slice(0, 40) : "(null)"; })() : "",
      };
    });
    const before = await panelCount();
    const box = await sel.locator(".warden-select-open").boundingBox().catch(() => null);
    if (box) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(750);
    }
    const opened = (await panelCount()) > before;
    // 再点一次应当关闭(证明是同一个开关, 而不是"只能开")
    if (opened) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(600);
    }
    const closedAgain = (await panelCount()) <= before;
    const good = info.hasBtn && info.btnW >= 44 && info.btnH >= info.ctrlH - 1 && opened && closedAgain;
    if (!good) allOk = false;
    details.push(`#${i}${good ? "" : "✗"}(btn ${info.btnW}x${info.btnH}/ctrl ${info.ctrlH})`);
  }
  ok(allOk, `${name}: ${n} 个下拉全部「点箭头展开 / 再点收起」`, details.join(" "));
}

/* ================= 问题 5: 域名规则输入框与按钮等高 ================= */
console.log("\n【问题5】域名规则: 新增的自定义域名输入框 == 按钮高度");
await goto("#/settings/domain-rules", "bit-container");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /新增自定义域名/.test(x.textContent || ""));
  b?.click();
});
await sleep(1300);
const d5 = await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  const btn = [...document.querySelectorAll("button")].find((x) => /新增自定义域名/.test(x.textContent || ""));
  // 输入框"壳"= 最外层那个带边框的容器(含 textarea 的、向上最近的一个有 border 的祖先)
  let shell = ta;
  for (let n = ta, i = 0; n && i < 4; i++, n = n.parentElement) {
    if (parseFloat(getComputedStyle(n).borderTopWidth) > 0) { shell = n; break; }
  }
  const h = (e) => (e ? Math.round(e.getBoundingClientRect().height) : null);
  return { ta: h(ta), shell: h(shell), shellCls: String(shell.className).slice(0, 40), btn: h(btn) };
});
ok(d5.shell !== null && d5.btn !== null && Math.abs(d5.shell - d5.btn) <= 1,
  "输入框壳与按钮等高", `壳 ${d5.shell}px vs 按钮 ${d5.btn}px (textarea ${d5.ta}px, 原壳 56px)`);
await page.screenshot({ path: path.join(SHOTS, "v14-domain.png") });

/* ================= 问题 7 / 8: 发送页与报告页的冗余入口 ================= */
console.log("\n【问题7】发送页 / 报告页 右上角的「产品切换宫格」已隐藏");
for (const [route, name] of [["#/sends", "发送页"], ["#/reports", "报告页"]]) {
  await goto(route);
  const r = await page.evaluate(() => {
    const ps = [...document.querySelectorAll("main#main-content app-header product-switcher")];
    return ps.map((e) => getComputedStyle(e).display);
  });
  ok(r.length > 0 && r.every((d) => d === "none"), `${name}: product-switcher 已隐藏`, JSON.stringify(r));
}
console.log("\n【问题8】发送页页头的新增已藏, 页面中间那个保留");
await goto("#/sends");
const d8 = await page.evaluate(() => {
  const header = [...document.querySelectorAll("main#main-content app-header tools-new-send-dropdown")].map((e) => getComputedStyle(e).display);
  const all = [...document.querySelectorAll("tools-new-send-dropdown")].map((e) => {
    const q = e.getBoundingClientRect();
    return { disp: getComputedStyle(e).display, h: Math.round(q.height) };
  });
  const visibleOthers = all.filter((x) => x.disp !== "none" && x.h > 0).length;
  return { header, all, visibleOthers };
});
ok(d8.header.length > 0 && d8.header.every((d) => d === "none"), "页头新增已隐藏", JSON.stringify(d8.header));
ok(d8.visibleOthers >= 1, "页面中间的「新增」仍在", `可见数=${d8.visibleOthers}`);

/* ================= 问题 9: 搜索框点击后的外部高亮 ================= */
console.log("\n【问题9】密码库页搜索框: 聚焦后不再出现外部高亮");
await goto("#/vault");
const before9 = await page.evaluate(() => {
  const f = document.querySelector("main#main-content bit-search form");
  return f ? getComputedStyle(f).boxShadow : null;
});
await page.locator("main#main-content bit-search input").first().click().catch(() => {});
await sleep(700);
const after9 = await page.evaluate(() => {
  const f = document.querySelector("main#main-content bit-search form");
  return { shadow: f ? getComputedStyle(f).boxShadow : null, ring: f ? getComputedStyle(f).getPropertyValue("--tw-ring-shadow") : null, border: f ? getComputedStyle(f).borderTopWidth : null };
});
ok(after9.shadow === "none" && before9 === "none", "聚焦后 box-shadow 仍是 none", `前=${before9} 后=${after9.shadow}`);
ok(after9.border !== "0px", "常态的 1px 边框没被误删", `border=${after9.border}`);
await page.screenshot({ path: path.join(SHOTS, "v14-search.png") });

/* ================= 问题 10a: 三处空白冗余 ================= */
console.log("\n【问题10a】设置页三处空白冗余");
/**
 * 量「内容区里 A 块下沿 → 紧随其后的 B 块上沿」的竖直间距。
 *
 * ⚠️ 搜索范围**必须限定 `main#main-content`**。早期版本在主文档里挑"含该文案的最小元素",
 *    结果在 two-factor 页命中的是**移动端设置页顶部的横向导航标签**(`span.tw-truncate`,
 *    y≈51–72), 量出来的是"导航条 → 内容区"那 27px —— 与标题间距毫无关系, 属于假失败。
 *    A/B 都只能取自内容区, 且 A 不能是 B 的祖先/后代。
 *
 * ⚠️ 面积比较要用**元素自己的 rect**, 不能写 `best.q`(best 就是元素本身, 身上没有 .q)。
 */
async function gapAfter(route, aSel, needle) {
  await goto(route);
  return page.evaluate(([sel, nd]) => {
    const id = (e) =>
      e.tagName.toLowerCase() +
      (typeof e.className === "string" && e.className ? "." + e.className.split(/\s+/)[0] : "");
    const main = document.querySelector("main#main-content");
    if (!main) return { err: "无 main#main-content" };

    /* A: ① 显式选择器 → ② 内容区里的**标题元素**(用户抱怨的就是"标题" ↔ 下一块的留白)
       → ③ 兜底: 内容区里"含该文案的最小可见元素"。
       ⚠️ 为什么必须先找标题: 移动端设置页顶部的横向导航标签也在 `main#main-content` 里,
          且其中就有「两步登录」这一项 —— 只按"最小面积"挑会挑中它, 量到的是
          "导航条 → 内容区"的 27px, 与标题间距无关(假失败)。 */
    let A = sel ? main.querySelector(sel) : null;
    if (!A) {
      A =
        [...main.querySelectorAll("h1,h2,h3,h4,bit-h1,bit-h2,bit-h3")].find(
          (e) => (e.textContent || "").includes(nd) && e.getBoundingClientRect().height > 0,
        ) ?? null;
    }
    if (!A) {
      let bestArea = Infinity;
      for (const e of main.querySelectorAll("*")) {
        if (!(e.textContent || "").includes(nd)) continue;
        const q = e.getBoundingClientRect();
        if (q.width <= 0 || q.height <= 0) continue;
        if (q.width * q.height < bestArea) {
          bestArea = q.width * q.height;
          A = e;
        }
      }
    }
    if (!A) return { err: "内容区里找不到 A" };

    const ab = A.getBoundingClientRect();
    /* B: 内容区里 top 最靠上的下一个块(排除 A 自身 / 后代 / 祖先)。
       ⚠️ 同一 top 上往往既有块级盒也有它内部的行内文本盒(行内盒只有文字高度,
          量出来会偏大 4~6px) ⇒ 先按 top 取最靠上的一组(容差 2px), 组内取**面积最大**的,
          即最外层那个块级盒, 结果才稳定。 */
    const cand = [...main.querySelectorAll("*")].filter((e) => {
      if (e === A || A.contains(e) || e.contains(A)) return false;
      const q = e.getBoundingClientRect();
      return q.height > 0 && q.width > 0 && q.top >= ab.bottom - 1;
    });
    cand.sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
    const topMin = cand.length ? cand[0].getBoundingClientRect().top : 0;
    const tie = cand.filter((e) => e.getBoundingClientRect().top <= topMin + 2);
    const B = tie.reduce(
      (acc, e) => {
        const q = e.getBoundingClientRect();
        const area = q.width * q.height;
        return !acc || area > acc.area ? { e, area } : acc;
      },
      null,
    )?.e;
    if (!B) return { err: "内容区里找不到 B" };

    const bq = B.getBoundingClientRect();
    return {
      A: `${id(A)}「${(A.textContent || "").trim().replace(/\s+/g, " ").slice(0, 14)}」`,
      B: `${id(B)}「${(B.textContent || "").trim().replace(/\s+/g, " ").slice(0, 14)}」`,
      间距: Math.round(bq.top - ab.bottom),
    };
  }, [aSel || "", needle || ""]);
}
const g1 = await gapAfter("#/settings/security/two-factor", "", "两步登录");
console.log("     两步登录: " + JSON.stringify(g1));
ok(g1.间距 !== undefined && g1.间距 <= 12, "两步登录 标题↔说明 留白已收紧", `${g1.间距}px (原 ~26px: 8+10 冗余 + h1 自身 8)`);
const g2 = await gapAfter("#/settings/security/device-management", "", "您的账户在以下设备上登录过");
console.log("     设备页: " + JSON.stringify(g2));
ok(g2.间距 !== undefined && g2.间距 <= 20, "设备页 说明↔首条记录 留白已收紧", `${g2.间距}px (原 ~34px)`);
const g3 = await gapAfter("#/settings/security/security-keys", "app-change-kdf", "");
console.log("     密钥页: " + JSON.stringify(g3));
ok(g3.间距 !== undefined && g3.间距 <= 24, "密钥页 更新加密设置↔API密钥 留白已收紧", `${g3.间距}px (原 64px)`);

console.log(`\n================ ${fail === 0 ? "全部通过 ✅" : `${fail} 条失败 ❌`} ================`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
