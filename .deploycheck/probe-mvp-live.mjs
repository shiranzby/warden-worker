/**
 * 第二十批(X 段) 电脑端验收 + 移动端回归 —— 一个脚本跑两个视口。
 *
 *   node .deploycheck/probe-x20-verify.mjs                    # 桌面 1280x860 (默认)
 *   RECON_W=390 RECON_H=844 node .deploycheck/probe-x20-verify.mjs   # 手机回归
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-x20-verify.mjs                  # 线上
 *
 * 🔴 本批的存在意义之一就是"改动不能只在一个视口宽度上验收" ——
 *    第十三~十九批全部只跑了 390px, 于是"电脑端所有下拉点了没反应"这个
 *    第十三批就引入的功能性缺陷活了 6 批。所以本脚本默认跑**桌面**宽度。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280);
const H = Number(process.env.RECON_H || 860);
const isNarrow = W <= 768;

const OUT = path.join(SHOTS, `mvp-live-${W}x${H}`);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: W, height: H },
  locale: "zh-CN",
  isMobile: isNarrow,
  hasTouch: isNarrow,
  deviceScaleFactor: isNarrow ? 3 : 1,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE = ${BASE}   viewport = ${W}x${H}${PROXY ? "   proxy = " + PROXY : ""}`);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

async function closeAllDialogs() {
  /*
   * ⚠️ 登录后会弹一个 `web-vault-extension-prompt-dialog`（「获取扩展以轻松访问密码库」），
   *    它**不是** `bit-dialog`，所以下面的 `bit-dialog` 循环完全看不见它，
   *    而它的 `cdk-overlay-backdrop` 会盖住整页 —— 于是"点下拉没反应"其实是
   *    点击落在了遮罩上（实测 elementFromPoint 命中
   *    `div.tw-max-w-3xl… / web-vault-extension-prompt-dialog / cdk-overlay-backdrop` 这一摞）。
   *    第一轮 MVP 验收里"设置·外观"那 3 个 ❌ 就是被它害的（现在改成先按 Escape 关掉）。
   */
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(700);
  for (const t of ["跳过", "Skip", "稍后", "关闭"]) {
    const b = page.locator(`web-vault-extension-prompt-dialog >> text="${t}"`).first();
    if ((await b.count().catch(() => 0)) > 0 && (await b.isVisible().catch(() => false))) {
      await b.click({ timeout: 3000 }).catch(() => {});
      await sleep(900);
    }
  }
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
    await sleep(1400);
  }
  return (await page.evaluate(() => document.querySelectorAll("bit-dialog").length)) === 0;
}

/* =====================================================================
 * ① 页头：产品切换器隐藏 + 头像一致性
 * ===================================================================== */
console.log("\n########## ① 页头（产品切换器 / 头像）##########");
await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);
const head = await page.evaluate(() => {
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return { disp: cs.display, vis: cs.visibility, w: Math.round(b.width), h: Math.round(b.height),
             shown: cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0 };
  };
  const ps = document.querySelector("main#main-content app-header header product-switcher");
  const gridBtn = document.querySelector('main#main-content button[aria-label="切换产品"]');
  const avatarSvg = document.querySelector("main#main-content app-header bit-avatar svg");
  const avatarBtns = [...document.querySelectorAll('main#main-content button[aria-label="切换产品"], main#main-content app-header button')];
  return {
    productSwitcher: vis(ps),
    gridBtn: vis(gridBtn),
    avatarSvgPresent: !!avatarSvg,
    avatarText: avatarSvg ? (avatarSvg.querySelector("text")?.textContent || "").trim() : null,
    topButtons: avatarBtns.slice(0, 4).map((b) => ({ aria: b.getAttribute("aria-label"), title: b.getAttribute("title"),
      text: (b.innerText || "").trim().slice(0, 12), ...vis(b) })),
  };
});
console.log("  " + JSON.stringify(head));
await shot("01-vault.png");
check("① 产品切换器（宫格）已隐藏", head.productSwitcher ? !head.productSwitcher.shown : head.gridBtn ? !head.gridBtn.shown : false,
  JSON.stringify(head.productSwitcher || head.gridBtn));

// 头像一致性：模拟"用户已选本地头像"（CSS 变量 + body 类），验证规则确实生效
const avatarRule = await page.evaluate(() => {
  const svg = document.querySelector("main#main-content app-header bit-avatar svg");
  if (!svg) return { ok: false, reason: "页头没有 bit-avatar svg" };
  const before = getComputedStyle(svg).backgroundImage;
  const dataUrl = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'8\'><rect width=\'8\' height=\'8\' fill=\'%230f7b7b\'/></svg>")';
  document.body.style.setProperty("--warden-avatar", dataUrl);
  document.body.classList.add("warden-avatar-on");
  const cs = getComputedStyle(svg);
  const textDisp = getComputedStyle(svg.querySelector("text")).display;
  const after = cs.backgroundImage;
  document.body.classList.remove("warden-avatar-on");
  document.body.style.removeProperty("--warden-avatar");
  return { ok: true, before, after, size: cs.backgroundSize, textDisp, changed: before !== after };
});
console.log("  头像规则:", JSON.stringify(avatarRule));
check("① 页头头像会跟随本地头像(--warden-avatar)",
  avatarRule.ok && avatarRule.changed && avatarRule.after.includes("data:image/svg") && avatarRule.textDisp === "none",
  JSON.stringify(avatarRule));

/* =====================================================================
 * ③ 下拉：点开后面板必须贴在输入框下方，且不产生页面滚动条
 * ===================================================================== */
console.log("\n########## ③ 下拉（跨 4 个页面）##########");

const snap = () =>
  page.evaluate(() => {
    const de = document.documentElement;
    const panels = [...document.querySelectorAll("ng-dropdown-panel, .ng-dropdown-panel")].filter(
      (p) => getComputedStyle(p).display !== "none" && p.getBoundingClientRect().height > 0,
    );
    const p = panels[panels.length - 1];
    const r = p ? p.getBoundingClientRect() : null;
    return {
      open: !!p,
      rect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      opts: p ? p.querySelectorAll(".ng-option").length : 0,
      docH: de.scrollHeight, docC: de.clientHeight, hasVScroll: de.scrollHeight > de.clientHeight + 1,
      opened: document.querySelectorAll("ng-select.ng-select-opened").length,
    };
  });

async function testSelect(label, container, hint) {
  const target = await page.evaluate(({ c, h }) => {
    const root = c === "dialog" ? document.querySelector("bit-dialog") : document;
    const sels = [...(root || document).querySelectorAll("bit-select")];
    const pick = h ? sels.find((s) => (s.innerText || "").includes(h)) || sels[0] : sels[0];
    if (!pick) return null;
    const b = pick.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
             text: (pick.innerText || "").trim().slice(0, 24) };
  }, { c: container, h: hint });
  if (!target) { console.log(`  （${label}：没找到 bit-select）`); return null; }

  const before = await snap();
  await page.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(900);
  const after = await snap();
  console.log(`  [${label}] <${target.text}> 点前=${JSON.stringify(before)}`);
  console.log(`            点后=${JSON.stringify(after)}`);

  check(`③ ${label}: 面板真的打开了`, after.open && after.opened > 0, `opened=${after.opened}`);
  check(`③ ${label}: 面板贴在输入框下方(不跑到视口外)`,
    after.rect ? Math.abs(after.rect[1] - (target.y + target.h)) <= 12 && after.rect[1] < H && after.rect[1] > 0 : false,
    `面板 y=${after.rect && after.rect[1]}  输入框底=${target.y + target.h}`);
  check(`③ ${label}: 面板宽度贴合输入框`, after.rect ? Math.abs(after.rect[2] - target.w) <= 8 : false,
    `面板宽=${after.rect && after.rect[2]} 输入框宽=${target.w}`);
  check(`③ ${label}: 没有因为面板多出页面滚动条`, !after.hasVScroll, `docH=${after.docH} docC=${after.docC}`);

  await page.keyboard.press("Escape");
  await sleep(500);
  return after;
}

await goRoute(page, "/settings/appearance", undefined, 25000).catch(() => {});
await sleep(3000);
// ⚠️ 必须先关掉登录后残留的扩展安装提示框 —— 它的遮罩会吃掉点击
await closeAllDialogs();
await testSelect("设置·外观", "page");
await shot(`${W}-appearance-open.png`);

await goRoute(page, "/tools/export", undefined, 25000).catch(() => {});
await sleep(3000);
await testSelect("工具·导出", "page");

await goRoute(page, "/tools/import", undefined, 25000).catch(() => {});
await sleep(3000);
await testSelect("工具·导入", "page");

/* =====================================================================
 * ②④ Send 对话框：一行字段 + 数字微调箭头
 * ===================================================================== */
console.log("\n########## ②④ 新增文本 Send ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
await closeAllDialogs();
// 桌面端「新增」在页头工具条里；窄屏在列表行里
const createBtn = isNarrow
  ? page.locator('main#main-content tools-send-list button:has-text("新增 Send")').first()
  : page.locator('main#main-content button:has-text("新增")').first();
await createBtn.click();
await sleep(1000);
await page.locator('.cdk-overlay-container button:has-text("文本 Send")').first().click();
await sleep(2800);
await page.locator(".warden-send-options-toggle").first().click().catch(() => {});
await sleep(1300);

const fields = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  const R = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) };
  };
  const one = (sel) => {
    const c = d.querySelector(sel);
    if (!c) return null;
    let bx = c.parentElement;
    while (bx && getComputedStyle(bx).borderTopWidth === "0px") bx = bx.parentElement;
    const cs = getComputedStyle(c);
    return { ctl: R(c), box: R(bx), appearance: cs.appearance,
             type: c.getAttribute("type"), rows: c.getAttribute("rows") };
  };
  return {
    name: one('input[formcontrolname="name"]'),
    text: one('textarea[formcontrolname="text"]'),
    notes: one('textarea[formcontrolname="notes"]'),
    maxAccess: one('input[formcontrolname="maxAccessCount"]'),
    spinnerHidden: (() => {
      const i = d.querySelector('input[formcontrolname="maxAccessCount"]');
      return i ? getComputedStyle(i).appearance : null;
    })(),
  };
});
console.log("  " + JSON.stringify(fields));
await shot("02-send-dialog.png");

const nameBox = fields.name && fields.name.box ? fields.name.box.h : null;
check("② 名称可见框 ≈ 40px", nameBox !== null && Math.abs(nameBox - 40) <= 1.5, `h=${nameBox}`);
for (const k of ["text", "notes"]) {
  const f = fields[k];
  if (!f) { check(`② ${k} 字段存在`, false); continue; }
  check(`② ${k} 的可见框与名称同高`, nameBox !== null && Math.abs(f.box.h - nameBox) <= 1, `${f.box.h} vs ${nameBox}`);
  check(`② ${k} 本体是 38px(一行)`, Math.abs(f.ctl.h - 38) <= 1, `h=${f.ctl.h}`);
}
check("④ 最大访问次数已去掉原生数字微调箭头",
  fields.spinnerHidden === "textfield" || fields.spinnerHidden === "none",
  `appearance=${fields.spinnerHidden}`);

/* =====================================================================
 * ⑤ 设置页：截图留档（排版方案待确认后再改）
 * ===================================================================== */
console.log("\n########## ⑤ 设置·我的账户(截图) ##########");
await closeAllDialogs();
await goRoute(page, "/settings/account", undefined, 25000).catch(() => {});
await sleep(3000);
await shot("05-settings-account.png");
const acct = await page.evaluate(() => {
  const m = document.querySelector("main#main-content");
  const b = m.getBoundingClientRect();
  return { mainW: Math.round(b.width), sections: m.querySelectorAll("bit-section").length,
           fields: m.querySelectorAll("bit-form-field").length,
           contentH: Math.round(m.scrollHeight) };
});
console.log("  " + JSON.stringify(acct));

/* =====================================================================
 * ⑥ MVP 上线验收：设计系统是否真的作用到了这个域上
 *    判据一律量"渲染出来的东西"，不看文件是否存在。
 *    ⚠️ 两个视口都要跑 —— 这是第二十批用 6 个批次换来的教训。
 * ===================================================================== */
console.log("\n########## ⑥ MVP 上线验收（设计系统 / 图标栏 / 导航）##########");
{
  /* ⚠️ 必须回到 /vault 再量。设计稿那 6 项导轨对应的是"分组全收起"的状态；
     而本段紧跟在 ⑤(设置页)之后，那时「工具」「设置」两个组是**展开**的：
       · 导轨里会多出子项(生成器/导入/导出、我的账户/安全/外观/域)
       · 组头自身的容器带 `bit-nav-group` 祖先 ⇒ 被下面的过滤排除掉，
         于是"六项"变成四项(实测 got=["密码库","验证码","发送","报告"]) */
  await closeAllDialogs();
  await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
  await sleep(2500);
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => s.href || "(inline)"));
  check("⑥ warden-design.css 已加载", sheets.some((h) => h.includes("warden-design.css")),
    sheets.filter((h) => h.includes("warden") || h.includes("vaultwarden")).join(" , "));

  const d = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const grid = document.querySelector("app-layout div.tw-grid");
    const rail = document.querySelector("app-side-nav");
    // ⚠️ 一级导航**不要**靠 DOM 层级判断（试过两次都错）：
    //    · `app-side-nav > bit-nav-item` 命中 0 个 —— 项目被投影进 bit-side-nav 内层
    //    · 用 `!closest("bit-nav-group")` 过滤组内子项会**连组头一起滤掉**：
    //      「工具」「设置」本身就是 bit-nav-group，它们的组头容器也在 bit-nav-group 里
    //      ⇒ 六项变四项（missing=["工具","设置"]，白跑一轮）
    //    ⇒ 判据改成"每个期望的名字，都必须能在**已渲染**的导航项文字里找到"，
    //      这既不依赖层级，也天然排除"没画出来"的项。
    const containers = [...document.querySelectorAll('app-side-nav [data-testid="nav-item-container"]')];
    const painted = (e) => {
      if (!e) return false;
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && e.getClientRects().length > 0;
    };
    const itemText = (c) => {
      const sp = c.querySelector("span.tw-truncate");
      return ((sp ? sp.textContent : (c.textContent || "")) || "").trim().replace(/\s+/g, "");
    };
    const items = containers.filter(painted);
    const nav0 = containers[0];
    const icon0 = nav0 ? nav0.querySelector("bit-icon") : null;
    const label0 = nav0 ? nav0.querySelector("span.tw-truncate") : null;
    const b0 = nav0 ? nav0.getBoundingClientRect() : null;
    return {
      hasWd: document.body.classList.contains("wd"),
      bg: root.getPropertyValue("--bg").trim(),
      accent: root.getPropertyValue("--accent").trim(),
      fg: root.getPropertyValue("--fg").trim(),
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : null,
      onVault: location.hash.replace(/^#/, "").startsWith("/vault"),
      paintedTexts: [...new Set(items.map(itemText).filter(Boolean))],
      allContainerCount: containers.length,
      nav0Rect: b0 ? [Math.round(b0.x), Math.round(b0.y), Math.round(b0.width), Math.round(b0.height)] : null,
      icon0Painted: painted(icon0),
      label0Painted: painted(label0),
      icon0Rect: icon0 ? (() => { const q = icon0.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })() : null,
      label0Rect: label0 ? (() => { const q = label0.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })() : null,
      railText: rail ? (rail.innerText || "").replace(/\s+/g, "") : "",
      innerDisplay: nav0 ? getComputedStyle(nav0.querySelector('[data-testid="nav-item-container"] > div')).display : null,
    };
  });
  console.log("  " + JSON.stringify(d));

  /* 期望的一级导航（与 user-layout.component.html 里那 6 个 bit-nav-item 对齐）。
     ⚠️ 用"逐个都必须出现在已渲染项里"，而不是"个数 == 6" —— 个数对不上时
     还能一眼看出**缺了哪一项**；同时不依赖"组有没有展开"。 */
  const EXPECT_NAV = ["密码库", "验证码", "发送", "工具", "报告", "设置"];
  const got = d.paintedTexts;
  const missing = EXPECT_NAV.filter((t) => !got.includes(t));

  check("⑥ body 带 wd 作用域类", d.hasWd === true, String(d.hasWd));
  check("⑥ 设计 token 已注入 --bg/--fg/--accent", !!d.bg && !!d.fg && !!d.accent,
    d.bg + " / " + d.fg + " / " + d.accent);
  check("⑥ 侧栏是 68px 图标栏", d.railW !== null && Math.abs(d.railW - 68) <= 2, "rail=" + d.railW + "px");
  check("⑥ 一级导航六项都渲染出来了", missing.length === 0 && d.onVault,
    "missing=" + JSON.stringify(missing) + " onVault=" + d.onVault +
    " painted=" + JSON.stringify(got) + " 容器总数=" + d.allContainerCount);
  check("⑥ 导航含「验证码」", got.includes("验证码"), JSON.stringify(got));
  /* 🔴 判据必须落在"用户看见的东西"上：容器有高度**不代表**内容画出来了
     —— 线上曾经出现"容器 56×52 但图标/标签全是 0×0"的空白黑条。 */
  check("⑥ 导轨内容层没被 display:none", d.innerDisplay === "block" || d.innerDisplay === "flex",
    String(d.innerDisplay));
  check("⑥ 首项图标真的画出来了", d.icon0Painted, JSON.stringify(d.icon0Rect));
  check("⑥ 首项标签真的画出来了", d.label0Painted, JSON.stringify(d.label0Rect));
  check("⑥ 导轨里能读到导航文字", d.railText.length >= 12, JSON.stringify(d.railText.slice(0, 30)));

  // 暗色桥接：切到 dark 后 --bg 必须真的变（否则整套暗色 token 是死的）
  const dark = await page.evaluate(() => {
    const r = document.documentElement;
    const before = getComputedStyle(r).getPropertyValue("--bg").trim();
    r.classList.remove("theme_light");
    r.classList.add("theme_dark");
    const after = getComputedStyle(r).getPropertyValue("--bg").trim();
    r.classList.remove("theme_dark");
    r.classList.add("theme_light");
    return { before, after, changed: before !== after };
  });
  console.log("  暗色桥接: " + JSON.stringify(dark));
  check("⑥ 暗色主题能真的换掉 --bg", dark.changed, JSON.stringify(dark));

  await shot("06-mvp-layout.png");
}

/* =====================================================================
 * ⑦ 窄屏回归 —— **同一个会话里切视口**，不再登录第二次。
 *
 *   为什么这么做：b8-lib 里写明"短时间重复登录会被服务端限流(第 3 次起停在
 *   #/login 且没有任何提示)"，而本项目又硬性要求"改动必须在两个视口验收"
 *   (第十三~十九批只跑 390px，漏掉了电脑端一个功能性缺陷，活了 6 批)。
 *   两个约束的交集就是这里：**一次登录、两次视口**。
 *   ⚠️ 只切 width/height 是有意为之 —— 我们的断点是 `@media (min-width:769px)`
 *      (纯视口宽度)，所以媒体查询会如实切换；`isMobile` 那类只能建 context 时
 *      指定的东西这里用不到，也就没必要为它再登录一次。
 * ===================================================================== */
console.log("\n########## ⑦ 窄屏回归（390×844，同一会话切视口）##########");
{
  await closeAllDialogs();
  await page.setViewportSize({ width: 390, height: 844 });
  await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
  await sleep(3000);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const rail = document.querySelector("app-side-nav");
    const railCs = rail ? getComputedStyle(rail) : null;
    const railRect = rail ? rail.getBoundingClientRect() : null;
    const tabbar = document.getElementById("warden-tabbar");
    const tabCs = tabbar ? getComputedStyle(tabbar) : null;
    const rows = [...document.querySelectorAll("main#main-content app-vault-items table tbody tr")];
    return {
      railW: railRect ? Math.round(railRect.width) : null,
      railDisp: railCs ? railCs.display : null,
      tabbarPresent: !!tabbar,
      tabbarDisp: tabCs ? tabCs.display : null,
      tabbarH: tabbar ? Math.round(tabbar.getBoundingClientRect().height) : null,
      docScrollW: de.scrollWidth,
      clientW: de.clientWidth,
      rowCount: rows.length,
      firstRowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
    };
  });
  console.log("  " + JSON.stringify(m));

  check("⑦ 窄屏不再出现 68px 图标栏",
    m.railW === null || m.railW < 40 || m.railDisp === "none", "railW=" + m.railW + " disp=" + m.railDisp);
  check("⑦ 窄屏一级导航走底部标签栏", m.tabbarPresent && m.tabbarDisp !== "none",
    "present=" + m.tabbarPresent + " disp=" + m.tabbarDisp + " h=" + m.tabbarH);
  check("⑦ 没有横向溢出", m.docScrollW <= m.clientW + 1, m.docScrollW + " vs " + m.clientW);
  check("⑦ 密码库表格仍渲染出行", m.rowCount > 0 && m.firstRowH !== null && m.firstRowH > 20,
    "rows=" + m.rowCount + " firstRowH=" + m.firstRowH);
  await shot("07-mvp-narrow.png");
}

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));
console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图目录: ${OUT}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
