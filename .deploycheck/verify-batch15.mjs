/**
 * 第十五批(S 段)运行期验收 —— 用户本轮 4 组反馈逐条断言。
 *
 * 约定: 每条打印 `✅/❌` 与实测数字, 全部通过时退出码 0。
 * ⚠️ 判据只用"可观测行为"(尺寸/位置/是否展开/display/opacity), 不断言"某条 CSS 写没写"。
 * ⚠️ 可见性不要用 offsetParent(祖先 position:fixed 时它是 null, 会误杀) —— 用 getClientRects()。
 * ⚠️ 触摸用 page.touchscreen.tap, 不要用 page.click(模拟的是鼠标, 走不到真实 touch 链)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

let fail = 0;
const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) fail += 1;
};
const SHOTS = path.resolve(import.meta.dirname, "shots-b15");
fs.mkdirSync(SHOTS, { recursive: true });

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
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));
console.log("BASE = " + BASE);

await ensureLoggedIn(page, ctx, { verbose: false });
const goto = async (hash, sel, t = 20000) => {
  await goRoute(page, hash, sel, t);
  await sleep(1300);
};

const tabbar = () =>
  page.evaluate(() => {
    const t = document.getElementById("warden-tabbar");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), z: getComputedStyle(t).zIndex };
  });

/** 当前可见的下拉面板(过滤掉 display:none 与零尺寸的)。 */
const panels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("ng-dropdown-panel")]
      .filter((p) => getComputedStyle(p).display !== "none" && p.getClientRects().length > 0)
      .map((p) => {
        const r = p.getBoundingClientRect();
        return {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          h: Math.round(r.height),
          cls: p.className,
          pos: getComputedStyle(p).position,
        };
      }),
  );

const selectInfo = () =>
  page.evaluate(() => {
    const sel = document.querySelector("bit-select");
    if (!sel) return null;
    const input = sel.querySelector("input");
    const cont = sel.querySelector(".ng-select-container");
    const r = cont.getBoundingClientRect();
    /* ⚠️ 覆盖层按钮是 bit-select **宿主**的后代(结构: bit-select > div.tw-relative >
       ng-select + button.warden-select-open), 不是宿主的兄弟 —— 别写成 parentElement。 */
    const overlay = sel.querySelector(".warden-select-open");
    return {
      readOnly: input ? input.readOnly : null,
      inputExists: !!input,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      overlayShown: overlay ? getComputedStyle(overlay).display : "无此元素",
    };
  });

/* ===================== 问题 1: 窄屏下拉 ===================== */
console.log("\n【问题1】窄屏下拉: 不弹键盘 / 整块可点 / 再点关闭 / 面板让开底栏");
console.log("  (用「工具 → 导入」页试点: 它上面有多个 bit-select; 发送页本身没有下拉控件)");

await goto("#/tools/import", "bit-select");
const tb = await tabbar();
console.log(`  底栏: top=${tb?.top} h=${tb?.h} z-index=${tb?.z}`);
const s0 = await selectInfo();
ok(s0?.readOnly === true, "① 窄屏输入框是只读 ⇒ 真机不弹软键盘", `readOnly=${s0?.readOnly}`);
ok(s0?.overlayShown === "none", "② R 段那个透明热点按钮在窄屏已隐藏", `display=${s0?.overlayShown}`);

/* 点"整块"的**左半边**(远离箭头) —— 用户要的是"整个表单都可以点击" */
const contBox = await page.evaluate(() => {
  const r = document.querySelector("bit-select .ng-select-container").getBoundingClientRect();
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
});
await page.touchscreen.tap(contBox.x, contBox.y);
await sleep(600);
const open1 = await panels();
ok(open1.length === 1, "③ 点输入框左侧(非箭头区)就展开面板", `面板数=${open1.length}`);
if (open1.length) {
  console.log(`     面板: top=${open1[0].top} bottom=${open1[0].bottom} h=${open1[0].h} pos=${open1[0].pos} cls=${open1[0].cls}`);
  ok(open1[0].pos === "fixed", "④ 窄屏面板由源码接管定位(position:fixed ⇒ 能躲键盘)", `pos=${open1[0].pos}`);
  ok(open1[0].bottom <= tb.top, "⑤ 面板不覆盖底部导航栏", `面板底=${open1[0].bottom} ≤ 底栏顶=${tb.top}`);
}

/* 核心: 再点**同一位置**必须收起(用户报的就是这条做不到) */
await page.touchscreen.tap(contBox.x, contBox.y);
await sleep(600);
const afterClose = await panels();
ok(afterClose.length === 0, "⑥ 再点同一位置 ⇒ 面板收起", `面板数=${afterClose.length}`);

/* 上翻: 构造"下方放不下"的确定性场景。
   ⚠️ 不要靠"滚到页面底部": 页面长度不由我们决定(实测外观页滚不动, 控件停在 y=218,
     看起来像"没上翻", 其实是场景没构造出来 —— 无效断言比失败断言更危险)。
   这里改成**压视口**: 控件在视口里的位置基本只由它上面的内容决定, 把视口高度压到
   "控件底边 + 80px"即可保证下方只剩几像素(还要扣底栏) ⇒ 必然上翻。
   压完要**重新量**, 因为换更高的视口会让布局回流(实测控件底从 230 变到 163)。 */
await goto("#/tools/import", "bit-select");
let vhTry = 844;
for (let i = 0; i < 4; i++) {
  const bottom = await page.evaluate(() =>
    Math.round(document.querySelector("bit-select .ng-select-container").getBoundingClientRect().bottom),
  );
  vhTry = Math.max(320, Math.min(844, bottom + 80));
  await page.setViewportSize({ width: 390, height: Math.round(vhTry) });
  await sleep(450);
}
const upBox = await page.evaluate(() => {
  const c = document.querySelector("bit-select .ng-select-container").getBoundingClientRect();
  return {
    x: Math.round(c.left + 20),
    y: Math.round(c.top + c.height / 2),
    cTop: Math.round(c.top),
    cBottom: Math.round(c.bottom),
    vh: window.innerHeight,
  };
});
const tb2 = await tabbar();
const belowSpace = tb2.top - upBox.cBottom;
const aboveSpace = upBox.cTop;
console.log(`  视口压到 ${upBox.vh}px: 控件 y=${upBox.cTop}..${upBox.cBottom}; 下方可用=${belowSpace}px(已扣底栏) / 上方=${aboveSpace}px`);
ok(belowSpace < aboveSpace, "⑦-前置 场景构造成功: 下方可用空间确实小于上方", `${belowSpace} < ${aboveSpace}`);
await page.touchscreen.tap(upBox.x, upBox.y);
await sleep(700);
const up = await panels();
if (up.length) {
  console.log(`     面板: top=${up[0].top} bottom=${up[0].bottom} h=${up[0].h} cls=${up[0].cls}`);
}
ok(up.length === 1 && up[0].bottom <= upBox.cTop + 2, "⑦ 下方放不下时改为**向上**展开(默认向下)", `面板底=${up[0]?.bottom} ≤ 控件顶=${upBox.cTop}`);
ok(up.length === 1 && up[0].top >= 0, "⑧ 上翻后面板没有顶出屏幕", `top=${up[0]?.top}`);
await page.touchscreen.tap(upBox.x, upBox.y);
await sleep(500);
await page.setViewportSize({ width: 390, height: 844 });
await sleep(500);

/* ===================== 三处左上角标题 ===================== */
console.log("\n【标题】验证码页 / 发送页 / 报告页的左上角标题在窄屏隐去");

await goto("#/totp", ".warden-auth-card, .warden-auth-empty");
const authTitle = await page.evaluate(() => {
  const h = document.querySelector("h1.warden-auth-title");
  if (!h) return null;
  return { display: getComputedStyle(h).display, rects: h.getClientRects().length };
});
ok(authTitle?.display === "none" && authTitle?.rects === 0, "⑨ 验证码页「验证码」标题已隐去", JSON.stringify(authTitle));

const headerState = async (hash, sel) => {
  await goto(hash, sel);
  return page.evaluate(() => {
    const app = document.querySelector("main#main-content app-header.warden-bare-header");
    if (!app) return { found: false };
    const bh = app.querySelector("bit-header");
    const r = app.getBoundingClientRect();
    return {
      found: true,
      bhDisplay: bh ? getComputedStyle(bh).display : "无 bit-header",
      bhH: bh ? Math.round(bh.getBoundingClientRect().height) : null,
      appH: Math.round(r.height),
      h1Visible: [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length > 0).length,
    };
  });
};
const sendHdr = await headerState("#/sends", "app-header");
ok(sendHdr.found && sendHdr.bhDisplay === "none", "⑩ 发送页页头(含「Send」标题)已隐去", JSON.stringify(sendHdr));
ok(sendHdr.found && sendHdr.appH <= 8, "⑪ 发送页页头不再占纵向空间", `页头高=${sendHdr.appH}px`);

const repHdr = await headerState("#/reports", "bit-container");
ok(repHdr.found && repHdr.bhDisplay === "none", "⑫ 报告页页头(含「报告」标题)已隐去", JSON.stringify(repHdr));
ok(repHdr.found && repHdr.appH <= 8, "⑬ 报告页页头不再占纵向空间", `页头高=${repHdr.appH}px`);

/* ===================== 问题 5b: 域名输入框 placeholder 居中 ===================== */
console.log("\n【问题5b】自定义域名输入框: placeholder 相对输入框高度垂直居中");

await goto("#/settings/domain-rules", "bit-container");
/* 先点「新增自定义域名」确保有输入行(第一次进入可能一行都没有) */
const addBtn = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const b = btns.find((x) => /新增自定义域名|newCustomDomain|addCustomDomain/i.test(x.textContent || ""));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (addBtn) {
  await page.touchscreen.tap(addBtn.x, addBtn.y);
  await sleep(700);
}
const dom = await page.evaluate(() => {
  const ta = document.querySelector("bit-form-field textarea[bitInput]");
  if (!ta) return null;
  const cs = getComputedStyle(ta);
  const r = ta.getBoundingClientRect();
  /* 找到"画边框"的那个祖先 —— 那才是用户眼里那个输入框 */
  let box = ta;
  for (let el = ta; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (parseFloat(s.borderTopWidth) > 0 || parseFloat(s.boxShadow) !== 0) {
      box = el;
      break;
    }
  }
  const br = box.getBoundingClientRect();
  const pt = parseFloat(cs.paddingTop) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const textCenter = r.top + bt + pt + lh / 2;
  const boxCenter = br.top + br.height / 2;
  return {
    taH: Math.round(r.height),
    boxH: Math.round(br.height),
    lh,
    pt,
    delta: Math.round((textCenter - boxCenter) * 10) / 10,
    boxTag: box.tagName.toLowerCase() + "." + String(box.className).split(" ").slice(0, 2).join("."),
  };
});
ok(!!dom, "⑭ 找到自定义域名输入框", dom ? `textarea 高=${dom.taH} 输入框高=${dom.boxH} line-height=${dom.lh}` : "未找到");
if (dom) {
  ok(Math.abs(dom.delta) <= 1.5, "⑮ placeholder 垂直居中(文本中心与框中心偏差 ≤1.5px)", `偏差=${dom.delta}px (框=${dom.boxTag})`);
}

/* ===================== 10b: 验证码「下一代码」 ===================== */
console.log("\n【10b】验证码徽章显示下一代码: 尺寸零变化 / 主次分明 / 升格正确");

await goto("#/totp", ".warden-auth-card");
const badgeSig = () =>
  page.evaluate(() => {
    const b = document.querySelector("vault-totp-badge .warden-totp-code");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const nx = b.querySelector(".warden-totp-next");
    const ghost = b.querySelector(".warden-totp-ghost");
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      sec: Number(b.querySelector(".warden-totp-sec").textContent),
      cur: b.querySelector(".warden-totp-digits").textContent.replace(/\s/g, ""),
      next: nx.textContent.replace(/\s/g, ""),
      nextOpacity: parseFloat(getComputedStyle(nx).opacity),
      ghostOpacity: parseFloat(getComputedStyle(ghost).opacity),
      hasWarn: b.classList.contains("warden-totp-warn"),
      hasRolling: b.classList.contains("warden-totp-rolling"),
      text: b.textContent.replace(/\s+/g, ""),
      fillTransition: getComputedStyle(b.querySelector(".warden-totp-fill-a")).transitionDuration,
    };
  });

/* 装上"升格哨兵": 记录 0.3s 窗口是否真的出现过, 以及那一刻进度条过渡时长 */
await page.evaluate(() => {
  window.__roll = 0;
  window.__rollFillDur = "";
  const b = document.querySelector("vault-totp-badge .warden-totp-code");
  const obs = new MutationObserver(() => {
    if (b.classList.contains("warden-totp-rolling")) {
      window.__roll += 1;
      window.__rollFillDur = getComputedStyle(b.querySelector(".warden-totp-fill-a")).transitionDuration;
    }
  });
  obs.observe(b, { attributes: true, attributeFilter: ["class"] });
  window.__obs = obs;
});

/* 常态(>10s): 次码必须**不可见**且徽章尺寸记录为基线
   ⚠️ 等到 sec>12 之后必须再 settle 一下: 这一等很可能**正好在跨窗口那一帧**满足
   (sec 刚回满 30), 此刻上一窗口的次码正在 0.22s 内淡出、ghost 还带着旧码 ——
   立刻读数会看到 opacity=0.92 + ghost 有文本, 误判成"常态还显示次码"。 */
await page.waitForFunction(
  () => Number(document.querySelector(".warden-totp-code .warden-totp-sec").textContent) > 12,
  { timeout: 40000 },
);
await sleep(800);
const idle = await badgeSig();
console.log(`  常态: sec=${idle.sec} 徽章 ${idle.w}×${idle.h} 主=${idle.cur} 次=(${idle.next}) opacity=${idle.nextOpacity}`);
ok(idle.nextOpacity === 0, "⑯ 剩余 >10s 时次码不可见", `opacity=${idle.nextOpacity}`);
ok(!/下一个/.test(idle.text), "⑰ 次码不带「下一个」文字标签", `徽章文本=${idle.text}`);

/* 最后 10 秒: 次码淡入, 且徽章尺寸**一动不动** */
await page.waitForFunction(
  () => Number(document.querySelector(".warden-totp-code .warden-totp-sec").textContent) <= 8,
  { timeout: 40000 },
);
await sleep(400);
const warn = await badgeSig();
console.log(`  最后10s: sec=${warn.sec} 徽章 ${warn.w}×${warn.h} 主=${warn.cur} 次=${warn.next} opacity=${warn.nextOpacity} warn=${warn.hasWarn}`);
ok(warn.nextOpacity > 0.5, "⑱ 剩余 ≤10s 时次码淡入可见", `opacity=${warn.nextOpacity}`);
ok(warn.next.length === idle.cur.length && warn.next.length >= 5, "⑲ 次码是完整的码(位数与主码一致)", `${warn.next} vs ${idle.cur}`);
ok(warn.w === idle.w && warn.h === idle.h, "⑳ 徽章尺寸零变化(用户否掉了「变高变宽」那版)", `${idle.w}×${idle.h} → ${warn.w}×${warn.h}`);
await page.screenshot({ path: path.join(SHOTS, "b15-totp-warn.png"), clip: { x: 0, y: 0, width: 390, height: 700 } });

/* 升格: 等跨窗口那一刻
   ⚠️ 必须先把哨兵**清零** —— 上面那次 sec>12 的等待几乎总是发生在一次跨窗口之后,
   计数器此时已经是 1, 不清零 waitForFunction 会立刻返回, 于是后面量到的还是"升格前"。 */
const before = warn.next;
await page.evaluate(() => {
  window.__roll = 0;
  window.__rollFillDur = "";
});
await page.waitForFunction(() => window.__roll > 0, { timeout: 40000 });
const rolling = await badgeSig();
console.log(`  升格瞬间: rolling=${rolling.hasRolling} ghost=${rolling.ghostOpacity} 进度条过渡=${rolling.fillTransition} (哨兵记录=${await page.evaluate(() => window.__rollFillDur)})`);
const rollCount = await page.evaluate(() => window.__roll);
ok(rollCount > 0, "㉑ 捕获到「升格」那一帧(0.3s 窗口内挂过 .warden-totp-rolling)", `命中 ${rollCount} 次`);
const rollFillDur = await page.evaluate(() => window.__rollFillDur);
ok(/0?\.3s/.test(rollFillDur), "㉒ 升格时进度条过渡 = 0.3s(与主码闪光同步)", `实测=${rollFillDur}`);

await sleep(1800);
const after = await badgeSig();
console.log(`  升格后: sec=${after.sec} 徽章 ${after.w}×${after.h} 主=${after.cur} 次 opacity=${after.nextOpacity}`);
ok(after.cur === before, "㉓ 升格: 旧次码 === 新主码(最硬的一条)", `${before} → ${after.cur}`);
ok(after.w === idle.w && after.h === idle.h, "㉔ 升格后徽章尺寸仍与常态一致", `${after.w}×${after.h}`);
ok(after.nextOpacity === 0, "㉕ 升格后次码回到不可见(新窗口还有 30s)", `opacity=${after.nextOpacity}`);

/* ===================== 桌面端不应被改动 ===================== */
console.log("\n【桌面端】断点外必须保持「可搜索」原样");
const deskCtx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
  locale: "zh-CN",
});
const dpage = await deskCtx.newPage();
await ensureLoggedIn(dpage, deskCtx, { verbose: false });
await goRoute(dpage, "#/tools/import", "bit-select");
await sleep(1200);
const d = await dpage.evaluate(() => {
  const sel = document.querySelector("bit-select");
  const input = sel.querySelector("input");
  const ov = sel.querySelector(".warden-select-open");
  return { readOnly: input.readOnly, overlay: ov ? getComputedStyle(ov).display : "无" };
});
ok(d.readOnly === false, "㉖ 桌面端输入框仍可输入(未误伤搜索)", `readOnly=${d.readOnly}`);
ok(d.overlay !== "none", "㉗ 桌面端保留 R 段的箭头热点按钮", `display=${d.overlay}`);
await deskCtx.close();

console.log("\n======== 结论 ========");
console.log(errs.length ? `❌ pageerror ${errs.length} 条: ${errs.join(" | ")}` : "✅ 0 pageerror");
ok(errs.length === 0, "㉘ 全程无页面错误");

await browser.close();
console.log(fail === 0 ? "\n全部通过 ✅" : `\n有 ${fail} 条未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
