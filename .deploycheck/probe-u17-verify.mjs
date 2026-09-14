/**
 * 第十七批(U 段) 验收 —— 五个问题逐条断, 全部在 dev server(8099) 上跑。
 *   node .deploycheck/probe-u17-verify.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const OUT = path.join(SHOTS, "u17");
fs.mkdirSync(OUT, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};
const R = (b) => (b ? `[${Math.round(b.y)}..${Math.round(b.y + b.height)}]` : "null");

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
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
const cdp = await ctx.newCDPSession(page);
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE = ${BASE}`);

const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

/* ================= ① 安全页 tab 条背景 ================= */
console.log("\n########## ① 设置/安全: tab 条背景 ⇒ 白 ##########");
await goRoute(page, "/settings/security/session-timeout", "main#main-content", 20000);
await sleep(800);
const s1 = await page.evaluate(() => {
  const h = document.querySelector("main#main-content app-header header");
  const m = document.querySelector("main#main-content");
  const cs = getComputedStyle(h);
  return {
    headerBg: cs.backgroundColor,
    mainBg: getComputedStyle(m).backgroundColor,
    // tab 条那一条的像素(取 tab 行中间一行扫一遍最左 6px)
    tabRowY: (() => {
      const t = document.querySelector("main#main-content app-header bit-tab-header");
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return Math.round(r.y + r.height / 2);
    })(),
    activeTabColor: (() => {
      // ⚠️ 必须限定在 `bit-tab-nav-bar` 里: 设置页顶部那排「我的账户/安全/外观…」胶囊
      //    也带 aria-current="page", 直接查 `a[aria-current=page]` 会命中那颗蓝底白字的胶囊。
      const a = document.querySelector(
        'main#main-content app-header bit-tab-nav-bar a[aria-current="page"]',
      );
      if (!a) return null;
      const cs = getComputedStyle(a);
      const after = getComputedStyle(a, "::after");
      return {
        color: cs.color,
        fontWeight: cs.fontWeight,
        underlineOpacity: after.opacity,
        underlineBg: after.backgroundColor,
        text: (a.textContent || "").trim(),
      };
    })(),
  };
});
console.log("  ", JSON.stringify(s1));
const tab = s1.activeTabColor || {};
// 品牌蓝: rgb(65, 139, 251) → 蓝分量明显大于红分量
const isBlue = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.test(tab.color || "") &&
  Number((tab.color || "").match(/\d+/g)[0]) < Number((tab.color || "").match(/\d+/g)[2]);
check("① 页头背景已变透明(露出白底)", s1.headerBg === "rgba(0, 0, 0, 0)", `bg=${s1.headerBg}`);
check("① 选中 tab 仍是品牌蓝", isBlue, `active=${tab.text} color=${tab.color}`);
check("① 选中 tab 的下划线强调线仍在(opacity=1)", tab.underlineOpacity === "1", `::after opacity=${tab.underlineOpacity} bg=${tab.underlineBg}`);
console.log("  → 截图", await shot("10-u1-security.png"));

/* ================= ⑤ 发送列表页顶部空隙 ================= */
console.log("\n########## ⑤ 发送页: 切换条上方空隙 ##########");
await goRoute(page, "/sends", "main#main-content", 20000);
await sleep(800);
const s5 = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  const flt = main.querySelector('tools-send-list > [slot="filters"]');
  const tg = main.querySelector("bit-toggle-group");
  const cs = (e) => (e ? getComputedStyle(e) : null);
  return {
    filterMt: cs(flt)?.marginTop ?? null,
    filterRect: flt ? [Math.round(flt.getBoundingClientRect().y), Math.round(flt.getBoundingClientRect().bottom)] : null,
    toggleRect: tg ? [Math.round(tg.getBoundingClientRect().y), Math.round(tg.getBoundingClientRect().bottom)] : null,
    tableHeaders: [...main.querySelectorAll("table thead th, table tr th")].map((t) => t.textContent.trim()),
  };
});
console.log("  ", JSON.stringify(s5));
check("⑤ filters 容器的 margin-top 已清零", s5.filterMt === "0px", `mt=${s5.filterMt}`);
check("⑤ 切换条贴到内容顶部(<=10px)", s5.toggleRect != null && s5.toggleRect[0] <= 10, `toggle y=${s5.toggleRect?.[0]}`);
console.log("  → 截图", await shot("11-u5-sendlist.png"));

/* ================= ④ 导出页 文件格式 ================= */
console.log("\n########## ④ 导出页 文件格式 ##########");
// ⚠️⚠️ **这一段必须排在「打开新增 Send 对话框」之前**。不是洁癖, 是被三个坑逼出来的:
//  ① 「新增 Send」对话框是 cdk overlay(**挂在 body, 不随路由切换卸载**)。它一开着,
//     应用根 `main#main-content` 就被压成 **20px 宽** ⇒ 导出页的 `bit-select` 量出来是
//     退化盒 `11,15,0x34`(宽 0) ⇒ 点过去必然落空。现象与"导出的下拉没生效"**一模一样**,
//     我一度当成产品缺陷 —— 实测产品是好的(.scratch-u17-export: 面板贴在框下方, 4 个选项, 0 error)。
//  ② 想收拾它? Escape **关不掉**(第十三批 probe-b13-select 已记录); 点页脚「取消」也不稳
//     (DOM 里会留下"已关闭但未销毁"的 bit-dialog, 选择器容易选中隐藏的那个, `.tap()` 抛
//     "不可见"被 catch 吞掉, 循环空转) ⇒ **与其跟它纠缠, 不如根本不开**。
//  ③ **不能整页 reload 兜底**: 登录态在 sessionStorage, 一 reload 就被踢去
//     `#/lock?promptBiometric=true`(实测轮询 15s, `main#main-content` 全空);
//     `page.goto(BASE + "/#/tools/export")` 也不行 —— 只差一个 hash 属 **same-document 导航**,
//     页面压根不重新加载(实测 `dialogOpen` 仍为 true, 白忙一轮)。
// ✅ 结论: 用 goRoute 在 SPA 内部跳 hash, 且**趁页面干净时先量**。
await goRoute(page, "/tools/export", "main#main-content", 20000);
await sleep(1200);
const expMainW = await page.evaluate(() =>
  Math.round(document.querySelector("main#main-content")?.getBoundingClientRect().width ?? 0),
);
check("④ 导出页根容器是全宽(没有被对话框挤压)", expMainW >= 300, `main width=${expMainW}`);
const exp = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  return {
    nativeSelects: main.querySelectorAll('select[formcontrolname="format"]').length,
    bitSelects: main.querySelectorAll("bit-select").length,
    options: [...main.querySelectorAll("bit-option")].map((o) => o.textContent.trim()).filter(Boolean).slice(0, 8),
  };
});
console.log("  ", JSON.stringify(exp));
check("④ 「文件格式」已不是原生 select", exp?.nativeSelects === 0, `native=${exp?.nativeSelects}`);
check("④ 「文件格式」已是 bit-select", (exp?.bitSelects ?? 0) >= 1, `bitSelect=${exp?.bitSelects}`);
const fmt = page.locator("main#main-content bit-select").first();
const fmtBox = page.locator("main#main-content bit-select .ng-select-container").first();
if (await fmt.count()) {
  // ⚠️ 用「量 box + touchscreen」而不是 `.tap()`: `bit-select` 宿主是 `tw-h-full`,
  //    在 form-field 里拿不到高度 ⇒ 宿主 box 高 0, Playwright 会判"不可见"而拒绝点;
  //    真正可点的是里面的 `.ng-select-container`。
  // ⚠️ 等布局稳定再量: 导出页首帧里上方那段(调用/说明)还没占位, 量早了 y 会差 100px,
  //    且 `.ng-select-container` 那一帧 **宽度还是 0**(flex 尚未定宽) ⇒ 点过去落在 (11,32) 空白.
  //    所以判据必须同时要求: ① 宽度/高度是"真实尺寸" ② 连续两次测量完全一致.
  //    只比 y/height 会**在退化帧上提前收敛**(两次都是 y=15,w=0 ⇒ 误判"已稳定")。
  await fmtBox.waitFor({ state: "attached", timeout: 15000 });
  const boxKey = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : "null");
  let prev = null;
  let settleTrace = [];
  for (let i = 0; i < 40; i++) {
    const b = await fmtBox.boundingBox();
    if (i < 4 || i === 39) settleTrace.push(boxKey(b));
    const real = !!b && b.width > 100 && b.height >= 20;
    if (real && prev && boxKey(b) === boxKey(prev)) break;
    prev = b;
    await sleep(150);
  }
  console.log("  稳定过程:", settleTrace.join(" → "), "| 最终:", boxKey(prev));
  // 诊断: 到底量到了哪个控件? (若 hash 还停在上一页/量到隐藏控件, 这一行能立刻看出来)
  const diag = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}`;
    };
    return {
      hash: location.hash,
      mains: document.querySelectorAll("main#main-content").length,
      dialogOpen: !!document.querySelector("bit-dialog"),
      mainRect: r(main),
      fields: [...main.querySelectorAll("bit-select")].map(
        (s) => `${s.closest("bit-form-field")?.querySelector("bit-label")?.textContent?.trim() ?? "?"}@${r(s)}`,
      ),
      containers: [...main.querySelectorAll("bit-select .ng-select-container")].map(r),
    };
  });
  console.log("  诊断:", JSON.stringify(diag));
  const readPanel = () =>
    page.evaluate(() => {
      const list = [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0);
      if (!list.length) return null;
      const x = list[list.length - 1];
      const r = x.getBoundingClientRect();
      return {
        rect: [Math.round(r.y), Math.round(r.bottom)],
        opts: x.querySelectorAll(".ng-option").length,
        texts: [...x.querySelectorAll(".ng-option")].map((o) => o.textContent.trim()).slice(0, 5),
      };
    });

  let inline = null;
  let lastBox = null;
  for (let attempt = 0; attempt < 3 && !inline; attempt++) {
    lastBox = await fmtBox.boundingBox();
    await page.touchscreen.tap(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
    await sleep(900);
    inline = await readPanel();
    if (!inline) await sleep(700);
  }
  console.log("  面板:", JSON.stringify(inline), " box:", JSON.stringify(lastBox));
  check("④ 点它弹的是站内下拉面板(不是系统弹窗)", inline != null && inline.opts > 0, JSON.stringify(inline));
  check(
    "④ 面板贴在框下方",
    !!(inline && lastBox && Math.abs(inline.rect[0] - (lastBox.y + lastBox.height)) <= 12),
    `panel top=${inline?.rect[0]} field bottom=${lastBox ? Math.round(lastBox.y + lastBox.height) : "?"}`,
  );
  console.log("  → 截图", await shot("15-export-format.png"));
  // 再点一次 ⇒ 收回
  await page.touchscreen.tap(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  await sleep(700);
  check("④ 再点一次 ⇒ 收回", (await readPanel()) == null);
}


/* ================= 打开新增文本 Send 对话框 ================= */
console.log("\n########## ②④ 新增文本 Send 对话框 ##########");
// 上面「导出页」那一段把路由带走了, 这里先回 /sends(SPA 内部跳 hash, 不 reload)。
await goRoute(page, "/sends", "main#main-content", 20000);
await sleep(1000);
await page.locator('button:visible', { hasText: "新增 Send" }).first().tap();
await sleep(500);
await page.locator('[role=menuitem], button[bitmenuitem]').filter({ hasText: "文本" }).first().tap();
await sleep(1500);

const dlg = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const rc = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.y), Math.round(b.bottom), Math.round(b.height)];
  };
  const header = q("bit-dialog > section > header");
  const footer = [...document.querySelectorAll("button")].filter((b) => /保存|取消/.test(b.textContent || ""));
  const tabbar = document.getElementById("warden-tabbar");
  return {
    headerRect: rc(header),
    headerPadTop: header ? getComputedStyle(header).paddingTop : null,
    headerPadBottom: header ? getComputedStyle(header).paddingBottom : null,
    contentTop: rc(q("[bitDialogContent]"))?.[0] ?? null,
    footerButtons: footer.map((b) => ({ t: b.textContent.trim(), r: rc(b) })),
    tabbarDisplay: tabbar ? getComputedStyle(tabbar).display : null,
    tabbarRect: rc(tabbar),
    textareas: [...document.querySelectorAll("bit-dialog textarea")].map((t) => ({
      fc: t.getAttribute("formcontrolname"),
      rows: t.getAttribute("rows"),
      h: Math.round(t.getBoundingClientRect().height),
    })),
    maxAccess: (() => {
      const i = document.querySelector('input[formcontrolname="maxAccessCount"]');
      if (!i) return null;
      return { ph: i.getAttribute("placeholder"), h: Math.round(i.getBoundingClientRect().height) };
    })(),
    stepBtns: [...document.querySelectorAll('[data-testid^="max-access-count-"]')].map((b) => ({
      id: b.getAttribute("data-testid"),
      vis: b.getClientRects().length > 0,
      label: b.getAttribute("aria-label") || b.getAttribute("label"),
    })),
    sendFormTag: !!document.querySelector("tools-send-form"),
  };
});
console.log("  ", JSON.stringify(dlg, null, 2));

check("② 页头已压缩(padTop<=2px)", dlg.headerPadTop === "2px", `padTop=${dlg.headerPadTop}`);
check("② 页头高度 <= 64px", dlg.headerRect && dlg.headerRect[2] <= 64, `h=${dlg.headerRect?.[2]}`);
check("③ 底部标签栏已隐藏(不再盖住页脚)", dlg.tabbarDisplay === "none", `display=${dlg.tabbarDisplay}`);
check(
  "③ 页脚「保存/取消」可见且不被遮挡",
  dlg.footerButtons.length >= 2 && dlg.footerButtons.every((b) => b.r[1] <= 844),
  JSON.stringify(dlg.footerButtons),
);
const ta = Object.fromEntries(dlg.textareas.map((t) => [t.fc, t.h]));
check("④ 「要分享的文本」压成一行 32px", ta["text"] === 32, `h=${ta["text"]} (rows=${dlg.textareas.find((t) => t.fc === "text")?.rows})`);
check("④ 「私密备注」压成一行 32px", ta["notes"] === 32, `h=${ta["notes"]}`);
check("⑤ placeholder = 不限制", dlg.maxAccess.ph === "不限制", `ph=${dlg.maxAccess?.ph}`);
check("⑤ − / + 按钮都存在且可见", dlg.stepBtns.length === 2 && dlg.stepBtns.every((b) => b.vis), JSON.stringify(dlg.stepBtns));
console.log("  → 截图", await shot("12-u234-dialog.png"));

/* ---- −/+ 行为 ---- */
const val = () => page.locator('input[formcontrolname="maxAccessCount"]').inputValue();
await page.locator('[data-testid="max-access-count-increase"]').tap();
await sleep(250);
const v1 = await val();
await page.locator('[data-testid="max-access-count-increase"]').tap();
await sleep(250);
const v2 = await val();
await page.locator('[data-testid="max-access-count-decrease"]').tap();
await sleep(250);
const v3 = await val();
await page.locator('[data-testid="max-access-count-decrease"]').tap();
await sleep(250);
const v4 = await val();
console.log(`  −/+ 序列: 空 → +${v1} → +${v2} → −${v3} → −"${v4}"`);
check("⑤ + 从「不限制」开始 ⇒ 1", v1 === "1");
check("⑤ 再 + ⇒ 2", v2 === "2");
check("⑤ − ⇒ 1", v3 === "1");
check("⑤ 1 再 − ⇒ 回到「不限制」(空)", v4 === "");

/* ================= ② 下拉面板几何(必须贴着框) ================= */
console.log("\n########## ② 下拉面板位置 ##########");
const sels = page.locator("bit-dialog bit-select");
const nSel = await sels.count();
check("② 对话框里有 2 个下拉(删除日期 / 谁可以查看)", nSel === 2, `n=${nSel}`);
for (let i = 0; i < nSel; i++) {
  const el = sels.nth(i);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  const fc = await el.evaluate((e) => e.querySelector("input")?.getAttribute("formcontrolname") ?? e.getAttribute("id"));
  await el.tap();
  await sleep(700);
  const p = await page.evaluate(() => {
    const list = [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0);
    if (!list.length) return null;
    const x = list[list.length - 1];
    const r = x.getBoundingClientRect();
    return { rect: [Math.round(r.y), Math.round(r.bottom), Math.round(r.height)], pos: getComputedStyle(x).position };
  });
  const nearBelow = p && Math.abs(p.rect[0] - (b.y + b.height)) <= 10;
  const nearAbove = p && Math.abs(p.rect[1] - b.y) <= 10;
  check(
    `② #${i}(${fc}) 面板贴着输入框(下 ${R(b)})`,
    !!(nearBelow || nearAbove),
    `panel=${p ? R({ y: p.rect[0], height: p.rect[2] }) : "无"} ${nearBelow ? "(下方)" : nearAbove ? "(上方)" : "(悬浮!)"}`,
  );
  console.log("     → 截图", await shot(`13-panel-${i}.png`));
  // 再点同一处 ⇒ 收起
  await el.tap();
  await sleep(500);
  const still = await page.evaluate(() => [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0).length);
  check(`② #${i} 再点输入框 ⇒ 面板收起`, still === 0, `可见面板=${still}`);
  // 打开后用「点空白/另一个框」收起
  await el.tap();
  await sleep(600);
  await page.touchscreen.tap(20, 120);
  await sleep(600);
  const afterBlank = await page.evaluate(() => [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0).length);
  check(`② #${i} 点空白处 ⇒ 面板收起`, afterBlank === 0, `可见面板=${afterBlank}`);
}

/* ================= ④ 松手才展开(CDP 真触摸) ================= */
console.log("\n########## ④ 松手才展开 ##########");
const anyPanel = () =>
  page.evaluate(() => [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0).length);
const firstSel = page.locator("bit-dialog bit-select").first();
await firstSel.scrollIntoViewIfNeeded().catch(() => {});
const fb = await firstSel.boundingBox();
const px = Math.round(fb.x + fb.width / 2);
const py = Math.round(fb.y + fb.height / 2);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: px, y: py }] });
await sleep(400);
const downCount = await anyPanel();
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(600);
const upCount = await anyPanel();
console.log(`  按下时可见面板=${downCount}, 松手后可见面板=${upCount}`);
check("④ 按下(未松手)不展开", downCount === 0, `down=${downCount}`);
check("④ 松手才展开", upCount === 1, `up=${upCount}`);
await page.touchscreen.tap(px, py);
await sleep(500);

/* ================= 密码区(说明"其实已存在") ================= */
console.log("\n########## 密码授权区 ##########");
const authSel = page.locator("bit-dialog bit-select").last();
await authSel.scrollIntoViewIfNeeded().catch(() => {});
await authSel.tap();
await sleep(700);
const pwdOpt = page.locator('ng-dropdown-panel .ng-option:has-text("密码")').first();
check("②「谁可以查看」里能选到「拥有您设置的密码的任何人的」", (await pwdOpt.count()) > 0);
if (await pwdOpt.count()) {
  await pwdOpt.tap();
  await sleep(900);
  const pwd = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[formcontrolname="password"]')].find((i) => i.getClientRects().length);
    if (!inp) return { found: false };
    const ff = inp.closest("bit-form-field");
    const suffix = ff?.querySelector("[bitsuffix]");
    return {
      found: true,
      type: inp.getAttribute("type"),
      h: Math.round(inp.getBoundingClientRect().height),
      suffixText: suffix ? (suffix.textContent || "").trim() : "",
      btnCount: suffix ? suffix.querySelectorAll("button").length : 0,
    };
  });
  console.log("  ", JSON.stringify(pwd));
  check("非密码区: 密码输入框出现", pwd.found === true);
  check("非密码区: 眼睛/随机/复制 三个按钮齐全", pwd.btnCount === 3, `btnCount=${pwd.btnCount}`);
  console.log("  → 截图", await shot("14-password.png"));
}


console.log(`\npageerror: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
console.log(`\n===== U 段验收: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
