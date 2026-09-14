/**
 * 第十三批(第十三批/Q 段)运行期验收 —— 六条问题逐条断言。
 *
 * 约定: 每条打印 `✅/❌` 与实测数字, 全部通过时退出码 0。
 * ⚠️ 只用"可观测行为"做判据(尺寸/位置/文本), 不断言"某条 CSS 写没写" —— 后者
 *    只能证明改了什么, 不能证明生效了什么(P 段的教训: 竖直居中那条断言在缺陷存在时照样通过)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import { BASE, CHROME, sleep, ensureLoggedIn } from "./b8-lib.mjs";

const SHOTS = path.resolve(import.meta.dirname, "shots-b13");
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 375, height: 812 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

let fail = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
};

console.log(`BASE = ${BASE}`);
await ensureLoggedIn(page, ctx, { verbose: false });

const goto = async (hash, marker, wait = 14000) => {
  await page.evaluate((h) => (location.hash = h), hash);
  const t0 = Date.now();
  let hit = false;
  while (Date.now() - t0 < wait) {
    hit = await page.evaluate((m) => !!document.querySelector(m), marker);
    if (hit) break;
    await sleep(400);
  }
  await sleep(1800);
  return hit;
};

/** 面板相对 select 的几何 + 我们钉没钉 !important。 */
const panelGeom = () =>
  page.evaluate(() => {
    const host = [...document.querySelectorAll("bit-select")].find(
      (h) => h.getBoundingClientRect().width > 0,
    );
    const panel = document.querySelector("ng-dropdown-panel, .ng-dropdown-panel");
    if (!host || !panel) return null;
    const hb = host.getBoundingClientRect();
    const pb = panel.getBoundingClientRect();
    return {
      gap: Math.round(pb.top - hb.bottom),
      panelTop: Math.round(pb.top),
      panelH: Math.round(pb.height),
      selBottom: Math.round(hb.bottom),
      opts: panel.querySelectorAll(".ng-option").length,
      pos: getComputedStyle(panel).position,
      inSide: panel.style.getPropertyPriority("top"),
      inlinetop: panel.style.getPropertyValue("top"),
    };
  });

const tapArrow = async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("bit-select")].find(
      (x) => x.getBoundingClientRect().width > 0,
    );
    const a = h.querySelector(".ng-arrow-wrapper").getBoundingClientRect();
    window.__pt = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
  });
  const pt = await page.evaluate(() => window.__pt);
  await page.touchscreen.tap(pt.x, pt.y);
  await sleep(1000);
};

/* ============================================================
 * 问题 1 / 3: 下拉面板不再被 ng-select 的滚动重定位甩飞
 * ============================================================ */
console.log("\n【问题1/3】下拉面板躲开软键盘: 我们把它放到输入框上方后, 现场滚动一次还在不在原处");
await goto("/settings/security/session-timeout", "bit-session-timeout-settings");
{
  /* 「超时时间」在页面中部, 面板往下弹; 换到 security-keys 的「算法」那一颗才是在页面
     下部、必须往上弹(正是会被键盘盖住、也正是会被甩飞的那种)。 */
  await goto("/settings/security/security-keys", "bit-container");
  await tapArrow();
  const before = await panelGeom();
  ok(!!before && before.opts > 0, "「算法」面板能打开", before ? `opts=${before.opts}` : "打不开");
  if (!before) {
    console.log("  (打不开就没法继续验, 直接失败)");
    fail++;
  } else {
    ok(before.pos === "fixed", "面板被改成 fixed 定位(软键盘才不会盖住它)", `position=${before.pos}`);
    ok(before.gap < 0, "面板弹在输入框**上方**", `gap=${before.gap}px top=${before.panelTop}`);
    console.log(`     行内几何: top=${before.inlinetop}${before.inSide ? " (!" + before.inSide + ")" : ""}`);
    // 合成 scroll —— 这正是 ng-select `_handleWindowScroll()` 的触发条件
    await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
    await sleep(600);
    const after = await panelGeom();
    ok(!!after, "滚动后面板仍在 DOM");
    if (after) {
      ok(Math.abs(after.gap - before.gap) <= 2, "滚动后面板**没有**被甩到下方(原 Δ=585px)", `gap ${before.gap} -> ${after.gap}`);
      ok(after.gap < 0, "滚动后仍在输入框上方", `gap=${after.gap}`);
    }
    // 真滚一下滚动容器: 面板应当跟着输入框走(而不是滞留在原处)
    const scrolled = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 300);
      if (!el) return null;
      const t0 = el.scrollTop;
      el.scrollTop = t0 + 80;
      return { before: t0, after: el.scrollTop };
    });
    await sleep(700);
    const after2 = await panelGeom();
    if (scrolled && after2 && scrolled.after !== scrolled.before) {
      /* ⚠️ 这里**不能**断言"相对间距不变": 面板高 466px, 输入框往上一挪, 上方就放不下了,
         `top` 会被钳在视口上沿(实测 panelTop≈8) ⇒ gap 必然变化。要断的是"还贴着、还在视口内、
         没有被甩到输入框下方":
         (不要写成 gap 差值 ≤3 —— 第一版就是这么写的, 把**正确**的钳位判成了失败) */
      ok(
        after2.gap < 0 && after2.panelTop >= 0 && after2.panelTop <= before.panelTop + 4,
        "真实滚动后面板仍贴着输入框(向上跟随/钳在视口上沿, 不是被甩走)",
        `top ${before.panelTop} -> ${after2.panelTop}, gap ${before.gap} -> ${after2.gap}, h=${after2.panelH}`,
      );
    } else {
      console.log(`     (本页没找到可滚容器, 跳过"跟随"那一条: ${JSON.stringify(scrolled)})`);
    }
    await page.touchscreen.tap(4, 740);
    await sleep(400);
  }

  /* 中部字段: 往下弹, 同样不能被甩走 */
  await goto("/settings/security/session-timeout", "bit-session-timeout-settings");
  await tapArrow();
  const b2 = await panelGeom();
  if (b2) {
    await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
    await sleep(600);
    const a2 = await panelGeom();
    ok(!!a2 && Math.abs(a2.gap - b2.gap) <= 2, "「超时时间」(往下弹)滚动后位置不变", a2 ? `gap ${b2.gap} -> ${a2.gap}` : "面板消失");
  } else {
    ok(false, "「超时时间」面板能打开");
  }
  await page.screenshot({ path: path.join(SHOTS, "v13-select.png") });
}

/* ============================================================
 * 问题 2: 名称保存 + 两处空白行
 * ============================================================ */
console.log("\n【问题2】名称保存 与 两处空白行");
await goto("/settings/account", "app-profile");

const readAcct = () =>
  page.evaluate(() => {
    const input = document.querySelector('app-profile input[formcontrolname="name"]');
    const card = document.querySelector("#warden-acctcard .warden-acct-name");
    const fp = document.querySelector("app-account-fingerprint");
    const nameField = document.querySelector(".warden-name-field");
    const emailRow = document.querySelector(".warden-email-row");
    const danger = document.querySelector("app-danger-zone");
    const rf = fp?.getBoundingClientRect();
    const rn = nameField?.getBoundingClientRect();
    const re = emailRow?.getBoundingClientRect();
    const rd = danger?.getBoundingClientRect();
    return {
      input: input?.value ?? null,
      card: card?.textContent?.trim() ?? null,
      gapFingerprintToName: rf && rn ? Math.round(rn.top - rf.bottom) : null,
      gapEmailToDanger: re && rd ? Math.round(rd.top - re.bottom) : null,
    };
  });

const original = await readAcct();
console.log(`     原始: name="${original.input}" card="${original.card}" 空白行 ${original.gapFingerprintToName}px / ${original.gapEmailToDanger}px`);

ok((original.gapFingerprintToName ?? 999) <= 12, "指纹短语→名称 之间没有空白行(原 40px)", `${original.gapFingerprintToName}px`);
ok((original.gapEmailToDanger ?? 999) <= 12, "电子邮箱→危险操作区 之间没有空白行(原 24px)", `${original.gapEmailToDanger}px`);

const putStatus = [];
page.on("response", (r) => {
  if (r.url().includes("/accounts/profile") && r.request().method() === "PUT") putStatus.push(r.status());
});

const TEST_NAME = "十三批验证名";
await page.locator('app-profile input[formcontrolname="name"]').first().fill(TEST_NAME);
await sleep(300);
await page.locator(".warden-save-inline").first().click({ timeout: 8000 }).catch(() => {});
await sleep(3000);
const afterSave = await readAcct();
console.log(`     PUT 状态=${JSON.stringify(putStatus)}  保存后 card="${afterSave.card}"`);
ok(putStatus.includes(200), "改名请求返回 200");
ok(afterSave.card === TEST_NAME, "账户卡片的名字**立即**跟着变了(原来一直停在旧值)", `card="${afterSave.card}"`);

/* 复原, 别把测试账号留在改名状态 */
await page.locator('app-profile input[formcontrolname="name"]').first().fill(original.input);
await sleep(300);
await page.locator(".warden-save-inline").first().click().catch(() => {});
await sleep(2500);
const restored = await readAcct();
ok(restored.card === original.input, "已复原为原名", `card="${restored.card}"`);

/* ============================================================
 * 问题 4: 账户卡片只在「我的账户」页
 * ============================================================ */
console.log("\n【问题4】账户卡片只在「我的账户」页");
for (const [hash, marker, want] of [
  ["/settings/account", "app-profile", true],
  ["/settings/security/session-timeout", "bit-session-timeout-settings", false],
  ["/settings/security/security-keys", "bit-container", false],
  ["/settings/appearance", "bit-container form", false],
  ["/settings/domain-rules", "bit-container", false],
  ["/settings/emergency-access", "bit-container", false],
]) {
  await goto(hash, marker);
  const has = await page.evaluate(() => !!document.querySelector("#warden-acctcard"));
  const headerMenu = await page.evaluate(
    () => !!document.querySelector("app-header app-account-menu")?.getClientRects().length,
  );
  ok(has === want, `${hash} 卡片${want ? "存在" : "不存在"}`, `acctcard=${has} 页头头像可见=${headerMenu}`);
}

/* ============================================================
 * 问题 5: 域名规则新增表单默认一行、内容换行时自己长高
 * ============================================================ */
console.log("\n【问题5】域名规则: 新增表单默认一行, 能换行长高");
await goto("/settings/domain-rules", "bit-container");
await page.getByRole("button", { name: /自定义域名|新增/ }).first().click({ timeout: 8000 }).catch(() => {});
await sleep(1200);
const taGeom = () =>
  page.evaluate(() => {
    const t = document.querySelector('textarea[formcontrolname="domain"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { h: Math.round(r.height), rows: t.rows, lh: getComputedStyle(t).lineHeight, val: t.value.length };
  });
const t1 = await taGeom();
console.log(`     新增后: ${JSON.stringify(t1)}`);
ok(!!t1 && t1.h <= 34, "默认高度是一行(原 rows=2 → 40px)", t1 ? `${t1.h}px (原 40px)` : "找不到 textarea");
await page.screenshot({ path: path.join(SHOTS, "v13-domain-1row.png") });

/* 填一段会长到第二行的内容 */
await page.locator('textarea[formcontrolname="domain"]').first().fill("google.com, gmail.com, outlook.com, hotmail.com, live.com, yahoo.com");
await sleep(900);
const t2 = await taGeom();
console.log(`     填长内容后: ${JSON.stringify(t2)}`);
/* 判据: 内容折成两行时, 盒子高度要够放两行(行高 20px ⇒ 两行 40px)。
   ⚠️ 不能写成"比初始高 18px": 初始已经是 min-height 30px(而不是裸的 20px),
      30 → 40 只涨 10px。第一版就是按 30+18 写的, 结果把**通过**的用例判成了失败。 */
ok(!!t2 && !!t1 && t2.h >= 38 && t2.h > t1.h, "内容折行后自己长高到两行(第二行可见)", t2 && t1 ? `${t1.h}px -> ${t2.h}px` : "-");
await page.screenshot({ path: path.join(SHOTS, "v13-domain-2row.png") });

/* ============================================================
 * 问题 6: 紧急访问标题行拆成两行
 * ============================================================ */
console.log("\n【问题6】紧急访问: 标题一行 + 按钮另起一行");
await goto("/settings/emergency-access", "bit-container");
const ea = await page.evaluate(() => {
  const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("紧急联系人"));
  if (!h) return null;
  const row = h.parentElement;
  const btnBox = [...row.children].find((c) => c.textContent.includes("添加紧急联系人"));
  const hr = h.getBoundingClientRect();
  const br = btnBox?.getBoundingClientRect();
  const cs = getComputedStyle(row);
  /* 数"真实行数": 用 Range 取客户矩形并按纵向重叠聚类(容差 4px)。
     为什么要聚类: 按钮里"图标 + 文字"是两个 rect 且 top 差 1~3px, 不去重会把**单行按钮**
     数成 2 行(踩过一次)。真正折行的两行 top 相差约一个行高(20px+), 容差不会掩盖它。
     ⚠️ 也不要用 height/lineHeight —— 上一版取的是**父容器**的 lineHeight(normal→24px),
        而 h2 自身是 36px, 36/24=1.5 把**已经修好的单行**判成失败。 */
  const lineCount = (el) => {
    if (!el) return null;
    const r = document.createRange();
    r.selectNodeContents(el);
    const boxes = [...r.getClientRects()]
      .filter((x) => x.width > 0 && x.height > 0)
      .map((x) => ({ top: x.top, bottom: x.bottom }))
      .sort((a, b) => a.top - b.top);
    let lines = 0;
    let cur = null;
    for (const box of boxes) {
      if (!cur || box.top > cur.bottom - 4) {
        lines += 1;
        cur = { bottom: box.bottom };
      } else {
        cur.bottom = Math.max(cur.bottom, box.bottom);
      }
    }
    return lines;
  };
  return {
    dir: cs.flexDirection,
    titleW: Math.round(hr.width),
    titleH: Math.round(hr.height),
    titleLines: lineCount(h),
    rowW: Math.round(row.getBoundingClientRect().width),
    btnY: br ? Math.round(br.y) : null,
    btnH: br ? Math.round(br.height) : null,
    btnLines: lineCount(btnBox),
  };
});
console.log(`     ${JSON.stringify(ea)}`);
ok(!!ea && ea.dir === "column", "标题行改成纵向两行", ea ? `flex-direction=${ea.dir}` : "-");
/* 判据用"Range 数出来的行数"(1 = 单行), 不用固定像素: 原来被挤成 3 行(h=72px)。 */
ok(!!ea && ea.titleLines === 1, "标题只占一行(原来折成 3 行 h=72px)", ea ? `${ea.titleLines} 行 / h=${ea.titleH}px, w=${ea.titleW}/${ea.rowW}` : "-");
ok(!!ea && ea.btnY !== null && ea.btnY > 0, "按钮在第二行", ea ? `btnY=${ea.btnY}` : "-");
ok(!!ea && ea.btnLines === 1, "按钮不再被挤成两行(原 h=60px)", ea ? `${ea.btnLines} 行 / h=${ea.btnH}px` : "-");
await page.screenshot({ path: path.join(SHOTS, "v13-emergency-2row.png") });

console.log(`\n================ ${fail === 0 ? "全部通过 ✅" : `${fail} 条失败 ❌`} ================`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
