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

const OUT = path.join(SHOTS, `x20-${W}x${H}`);
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

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));
console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图目录: ${OUT}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
