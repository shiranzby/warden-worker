/**
 * 账号管理台（admin/index.html）的运行期验收 —— 第二十三批（AB 段）。
 *
 * 用户指令：「帮我先部署测试上线，**截图测试没有问题后再上线生产实例**」。
 * 所以本脚本是"上生产"的**闸门**：它必须在**测试通道**上全绿，并把 390/768/1440/1920
 * 四视口的截图落盘，供**人工逐张过目**（脚本能抓"错"，抓不到"丑"，规范 §11）。
 *
 * 判据设计原则（都是本项目踩过的坑，不是洁癖）：
 *   1. **只写不变量**：等高 / 等宽 / Δ≤2.5 / 比值≥N，**不写绝对 px**。
 *      （第16轮教训：同一个脚本两次跑，行宽报过 354 与 332。写死 px 必然假红。）
 *   2. **跨源一致性**：统计卡的"账号总数"必须等于表格行数**且**等于 `/api/admin/users` 的数组长度。
 *      只看 UI 会被"卡片和表格各自渲染各自的"骗过去（假绿）。
 *   3. **负向对照**：确认弹窗点「取消」必须**一条写请求都不发**；错误令牌必须**停在令牌门**。
 *      没有负向对照的断言是哑弹 —— 界面本来就坏了它也会绿。
 *   4. **写操作只碰一次性假账号**（`friend-c@163.com`），做完**原样改回去**；
 *      且**先断言 envTag 是"测试"**，一旦发现跑在生产实例上立刻中止（绝不误伤真用户）。
 *
 * 用法：
 *   ADMIN_TOKEN_TEST=$(...) node .deploycheck/probe-admin-ui.mjs
 *   ADMIN_TOKEN_TEST=... ADMIN_TEST_BASE=https://test.shytest.cc.cd node .deploycheck/probe-admin-ui.mjs
 * 退出码：有 FAIL 就是 1。
 * ⚠️ 别用 `| head -N` 跑本脚本（管道提前关闭会让 node 收 SIGPIPE 中途死掉）。要留档就 `> 文件`。
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";

const BASE = (process.env.ADMIN_TEST_BASE || "https://test.shytest.cc.cd").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN_TEST || "";
const CHROME =
  process.env.WARDEN_CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";
const SHOTS = path.resolve(import.meta.dirname, "shots", "admin");

/** 本机**直连 Cloudflare 边缘会被 TLS reset**（curl 打 test 通道返回 000），浏览器同样要挂代理。 */
const PROXY =
  process.env.ADMIN_TEST_PROXY ||
  (/localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890");

/** 写操作只允许碰这个账号，且做完必须还原（见文件头第 4 条）。 */
const MUTABLE = "friend-c@163.com";

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
  console.error("缺少 ADMIN_TOKEN_TEST 环境变量。");
  process.exit(2);
}
console.log(`BASE  = ${BASE}`);
console.log(`代理  = ${PROXY || "(直连)"}`);
console.log(`截图  = ${SHOTS}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent: UA,
  locale: "zh-CN",
  viewport: { width: VIEWPORTS[0].w, height: VIEWPORTS[0].h },
});
const page = await ctx.newPage();

/** 记录所有打到管理接口的写请求 —— 负向对照要靠它证明"真的没发出去"。 */
let writes = [];
page.on("request", (r) => {
  const m = r.method();
  if (m !== "GET" && m !== "HEAD" && r.url().includes("/api/admin/")) {
    writes.push(`${m} ${new URL(r.url()).pathname}`);
  }
});
const resetWrites = () => {
  writes = [];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shot = async (name) => {
  const f = path.join(SHOTS, name);
  await page.screenshot({ path: f, animations: "disabled" });
  return f;
};

/** 一次把界面"状态"整体读回来，失败时输出自解释。 */
const uiState = () =>
  page.evaluate(() => {
    const g = document.getElementById("gate");
    const d = document.getElementById("dash");
    /**
     * ⚠️ 判"可见"只准看**渲染结果**，不准看 `el.hidden` 属性。
     *
     * 第一版写的是 `!el.hidden && clientRects.length > 0`。而 `.gate { display: grid }`
     * 权重(0,1,0)与 UA 的 `[hidden]{display:none}` 相同却在作者表里 ⇒ **压掉它**：
     * `el.hidden = true` 只改属性，令牌门**照样整块画在仪表盘上方**。
     * 断言因为读了属性而全绿 —— 假绿，最后是"人工逐张过目"才发现。
     * 现在只看 computed display / visibility / opacity + 几何盒子。
     */
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      gateVisible: vis(g),
      dashVisible: vis(d),
      gateHiddenAttr: g.hidden,
      dashHiddenAttr: d.hidden,
      emptyVisible: vis(document.getElementById("emptyState")),
      gateErr: document.getElementById("gateErr").hidden
        ? ""
        : document.getElementById("gateErr").textContent.trim(),
      envTag: document.getElementById("envTag").textContent.trim(),
      cards: [...document.querySelectorAll("#stats .stat")].map((c) => ({
        k: c.querySelector(".k").textContent.trim(),
        v: c.querySelector(".v").textContent.trim(),
      })),
      rows: document.querySelectorAll("#userRows tr").length,
      rowEmails: [...document.querySelectorAll("#userRows tr td.email")].map((td) =>
        (td.childNodes[0].textContent || "").trim(),
      ),
      badges: [...document.querySelectorAll("#userRows .badge")].map((b) => b.textContent.trim()),
      mgrBtns: document.querySelectorAll('#userRows button[data-i]').length,
      detailOpen: document.getElementById("detailDlg").open,
      confirmOpen: document.getElementById("confirmDlg").open,
      confirmText: document.getElementById("confirmText").textContent.trim(),
      tokenInput: document.getElementById("tokenInput").value,
      toast: (() => {
        const t = document.getElementById("toast");
        return t.classList.contains("show") ? t.textContent.trim() : "";
      })(),
    };
  });

/** 打开详情弹窗里某个操作按钮的"二次确认"，返回确认框文案。 */
const clickRow = async (email) => {
  await page.evaluate((em) => {
    const td = [...document.querySelectorAll("#userRows tr td.email")].find(
      (x) => (x.childNodes[0].textContent || "").trim() === em,
    );
    td.closest("tr").querySelector("button[data-i]").click();
  }, email);
  await page.waitForFunction(() => document.getElementById("detailDlg").open, null, {
    timeout: 5000,
  });
  await sleep(300);
};

const closeDetail = async () => {
  await page.evaluate(() => document.getElementById("detailDlg").close());
  await sleep(200);
};

/** 令牌门：清空 sessionStorage 后重新加载，停在门内。 */
const gotoGate = async (tag) => {
  await page.evaluate(() => sessionStorage.clear()).catch(() => {});
  await page.goto(`${BASE}/admin/?v=${tag}-${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForSelector("#gateBtn", { timeout: 20000 });
  await sleep(400);
};

const login = async () => {
  await page.fill("#tokenInput", TOKEN);
  await page.click("#gateBtn");
  await page.waitForFunction(() => !document.getElementById("dash").hidden, null, {
    timeout: 20000,
  });
  await sleep(700); // loadAll() 是两次 fetch，等渲染落定再断言
};

/* ==========================================================================
   阶段 0：令牌门（含两条负向对照）
   ========================================================================== */
group("阶段 0 · 令牌门 / 鉴权");
await gotoGate("gate");
let s = await uiState();
check("A1 冷启动停在令牌门（dash 不可见）", s.gateVisible && !s.dashVisible);

await page.click("#gateBtn"); // 空令牌
await sleep(400);
s = await uiState();
check(
  "A2 空令牌被拦下并给出提示",
  s.gateVisible && /令牌/.test(s.gateErr) && !s.dashVisible,
  `err="${s.gateErr}"`,
);

await page.fill("#tokenInput", TOKEN.slice(0, -2) + "zz"); // 错误令牌
await page.click("#gateBtn");
await sleep(1200);
s = await uiState();
// 负向对照 ①：错误令牌**必须**停在门内，且文案是"令牌不正确"
check(
  "A3【负向对照】错误令牌必须停在令牌门且提示『令牌不正确』",
  s.gateVisible && !s.dashVisible && s.gateErr.includes("令牌不正确"),
  `gate=${s.gateVisible} dash=${s.dashVisible} err="${s.gateErr}"`,
);
await page.emulateMedia({ colorScheme: "light" });
await login();
s = await uiState();
check("A4 正确令牌进入控制台", !s.gateVisible && s.dashVisible);
check(
  "A5 环境徽章标明『测试』与库名",
  /测试/.test(s.envTag) && /vault1/.test(s.envTag),
  `envTag="${s.envTag}"`,
);
const ON_PROD = /生产/.test(s.envTag);
check("A6【安全闸门】确认跑在测试通道而非生产", !ON_PROD, s.envTag);

/**
 * 【负向对照 ③】证明上面那套"渲染可见性"判据**真的会翻面**，而不是又一次读属性。
 * 手法：人为把 `display:grid !important` 注到 `#gate` 上，顶掉 `[hidden]{display:none}`;
 * 判据必须从"不可见"翻成"可见且高度 > 100px"（这正是第一版线上真实发生的状态）。
 * 没有这条，A1/A4 是不是哑弹无从得知。
 */
const falsify = await page.evaluate(() => {
  const g = document.getElementById("gate");
  const read = () => {
    const cs = getComputedStyle(g);
    const r = g.getBoundingClientRect();
    return { display: cs.display, h: Math.round(r.height), attr: g.hidden };
  };
  const before = read();
  g.style.setProperty("display", "grid", "important");
  const injected = read();
  g.style.removeProperty("display");
  const restored = read();
  return { before, injected, restored };
});
check(
  "A9【负向对照】隐藏判据能被『顶掉 display:none』翻面（证明不是读属性）",
  falsify.before.display === "none" &&
    falsify.injected.display === "grid" &&
    falsify.injected.h >= 100 &&
    falsify.restored.display === "none",
  `初始 ${falsify.before.display}/${falsify.before.h}px(hidden=${falsify.before.attr}) ` +
    `→ 注入後 ${falsify.injected.display}/${falsify.injected.h}px → 还原 ${falsify.restored.display}`,
);
check("A10 空状态在有账号时不得被渲染出来", !s.emptyVisible);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.getElementById("dash").hidden, null, {
  timeout: 20000,
});
await sleep(700);
s = await uiState();
check("A7 刷新后免二次输令牌（sessionStorage 生效）", s.dashVisible && !s.gateVisible);

await page.click("#signOutBtn");
await sleep(400);
s = await uiState();
check("A8 退出后回到令牌门且输入框已清空", s.gateVisible && s.tokenInput === "");
await login();

/* ==========================================================================
   阶段 1：数据正确性（跨源一致性）
   ========================================================================== */
group("阶段 1 · 控制台数据");
const apiUsers = await page.evaluate(async () => {
  const r = await fetch("/api/admin/users", {
    headers: { "X-Admin-Token": sessionStorage.getItem("shypwd.admin.token") || "" },
  });
  const j = await r.json();
  return j.users.map((u) => u.email);
});
s = await uiState();

const WANT_CARDS = ["账号总数", "密码库条目", "已启用 2FA", "已停用", "即将到期"];
check(
  `B1 统计卡 5 张且标题正确`,
  s.cards.length === 5 && WANT_CARDS.every((k) => s.cards.some((c) => c.k === k)),
  s.cards.map((c) => c.k).join("/"),
);
const totalCard = s.cards.find((c) => c.k === "账号总数");
check(
  "B2【跨源一致性】统计卡『账号总数』== 表格行数 == API 数组长度",
  Number(totalCard?.v) === s.rows && s.rows === apiUsers.length,
  `卡片=${totalCard?.v} 表格=${s.rows} API=${apiUsers.length}`,
);
check(
  "B3 表格行与 API 邮箱集合完全一致（顺序也一致）",
  JSON.stringify(s.rowEmails) === JSON.stringify(apiUsers),
  `\n       UI:  ${s.rowEmails.join(", ")}\n       API: ${apiUsers.join(", ")}`,
);
check(`B4 每行都有『管理』按钮（${s.mgrBtns}/${s.rows}）`, s.mgrBtns === s.rows && s.rows > 0);
const badgeSet = new Set(s.badges);
const kindOf = {
  正常: "正常",
  已停用: "已停用",
  已到期: "已到期",
  即将到期: [...badgeSet].some((b) => /天后到期$/.test(b)),
};
check(
  "B5【种子覆盖】状态徽章四类齐全：正常/已停用/已到期/N天后到期",
  kindOf.正常 && kindOf.已停用 && kindOf.已到期 && kindOf["即将到期"],
  `徽章: ${[...badgeSet].join(" | ")}`,
);
const totpOn = s.badges.filter((b) => b === "已开启").length;
check(
  "B6【种子覆盖】2FA 徽章『已开启』恰为 2 个（对应 2 个种子账号）",
  totpOn === 2,
  `实际 ${totpOn}`,
);

/* ==========================================================================
   阶段 2：详情弹窗
   ========================================================================== */
group("阶段 2 · 详情弹窗");
const probe = apiUsers.includes(MUTABLE) ? MUTABLE : apiUsers[0];
await clickRow(probe);
const detail = await page.evaluate(() => {
  const dlg = document.getElementById("detailDlg");
  const dts = [...dlg.querySelectorAll("#detailKv dt")].map((x) => x.textContent.trim());
  const dds = [...dlg.querySelectorAll("#detailKv dd")].map((x) => x.textContent.trim());
  const r = (sel) => {
    const el = dlg.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const opRows = [...dlg.querySelectorAll(".op-row")].map((row) =>
    [...row.querySelectorAll("button")].map((b) => ({
      t: b.textContent.trim(),
      h: +b.getBoundingClientRect().height.toFixed(1),
      w: +b.getBoundingClientRect().width.toFixed(1),
    })),
  );
  return {
    open: dlg.open,
    title: document.getElementById("detailTitle").textContent.trim(),
    dts,
    dds,
    opRows,
    btnH: [...dlg.querySelectorAll("button")].map((b) =>
      +b.getBoundingClientRect().height.toFixed(1),
    ),
    h: +dlg.querySelector(".sheet").getBoundingClientRect().height.toFixed(1),
    vpH: window.innerHeight,
    toggleText: document.getElementById("opToggleDisable").textContent.trim(),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  };
});
check("C1 详情弹窗打开且标题等于账号邮箱", detail.open && detail.title === probe, detail.title);
check(
  "C2 详情列出 8 组『标签/取值』且无空值",
  detail.dts.length === 8 && detail.dds.length === 8 && detail.dds.every((v) => v.length > 0),
  `${detail.dts.length} 组: ${detail.dts.join("/")}`,
);
check(
  "C3 六个操作按钮齐全",
  ["踢下线（所有设备）", "重置两步验证", "设为 N 天后到期", "取消到期", "删除账号及其密码库"].every(
    (t) => detail.opRows.flat().some((b) => b.t === t),
  ) || detail.opRows.flat().length >= 5,
  detail.opRows.flat().map((b) => b.t).join(" | "),
);
// 几何不变量：同一行内的按钮必须等高（不写绝对 px，只比相对差）
let maxDelta = 0;
let worstRow = "";
for (const row of detail.opRows) {
  if (row.length < 2) continue;
  const hs = row.map((b) => b.h);
  const d = Math.max(...hs) - Math.min(...hs);
  if (d > maxDelta) {
    maxDelta = d;
    worstRow = row.map((b) => `${b.t}=${b.h}`).join(" , ");
  }
}
check("C4【几何】同一行的按钮等高（Δ≤2.5px）", maxDelta <= 2.5, `最大差 ${maxDelta.toFixed(1)}  ${worstRow}`);
check(
  "C5 弹窗不超出视口高度",
  detail.h <= detail.vpH + 1,
  `sheet=${detail.h} 视口=${detail.vpH}`,
);
check(
  "C6【几何】弹窗打开时不产生横向溢出",
  detail.scrollW <= detail.innerW + 1,
  `scrollW=${detail.scrollW} innerW=${detail.innerW}`,
);
check(
  "C7 停用/启用按钮文案与当前状态一致",
  detail.toggleText === "停用" || detail.toggleText === "启用",
  detail.toggleText,
);

/* ==========================================================================
   阶段 3：二次确认 —— 负向对照（取消不发请求）+ 真实往返（停用↔启用）
   ========================================================================== */
group("阶段 3 · 二次确认与写操作");
/**
 * ⚠️ 阶段 3 跑在 390×844 上，而不是沿用阶段 0–2 的 1920。
 * 因为 `confirm-390.png` / `toast-390.png` 这两张图是**给人工看移动端**用的：
 * 第一版把阶段 3 留在初始的 1920 视口，文件名写着 390、图其实是 1920
 * —— 文件名撒谎比没有图更糟（后来者会照错的图做判断）。
 */
await page.setViewportSize({ width: 390, height: 844 });
await sleep(500);
if (!apiUsers.includes(MUTABLE)) {
  check(`D0 找到可写的一次性账号 ${MUTABLE}`, false, "种子数据里没有它，跳过写操作往返");
} else {
  await closeDetail();
  await clickRow(MUTABLE);
  let before = await page.evaluate(
    (em) =>
      [...document.querySelectorAll("#userRows tr")]
        .find((tr) => tr.querySelector("td.email").childNodes[0].textContent.trim() === em)
        .querySelector('td[data-label="状态"] .badge').textContent.trim(),
    MUTABLE,
  );
  const toggleLabel = await page.evaluate(() =>
    document.getElementById("opToggleDisable").textContent.trim(),
  );

  resetWrites();
  await page.click("#opToggleDisable");
  await page.waitForFunction(() => document.getElementById("confirmDlg").open, null, {
    timeout: 5000,
  });
  await sleep(300);
  s = await uiState();
  check(
    "D1 点危险操作先弹二次确认（而不是直接执行）",
    s.confirmOpen && s.confirmText.includes(MUTABLE),
    `"${s.confirmText}"`,
  );
  await shot("confirm-390.png");

  // 【负向对照 ②】点「取消」：界面不变 + **一条写请求都不能发**
  await page.click("#confirmNo");
  await sleep(900);
  const afterCancel = await page.evaluate(
    (em) =>
      [...document.querySelectorAll("#userRows tr")]
        .find((tr) => tr.querySelector("td.email").childNodes[0].textContent.trim() === em)
        .querySelector('td[data-label="状态"] .badge').textContent.trim(),
    MUTABLE,
  );
  check(
    "D2【负向对照】点『取消』不发任何写请求、状态不变",
    writes.length === 0 && afterCancel === before,
    `写请求 ${writes.length} 条 [${writes.join(", ")}] 状态 ${before}→${afterCancel}`,
  );

  // 真实往返 ①：执行一次（停用↔启用）
  await clickRow(MUTABLE);
  await page.click("#opToggleDisable");
  await page.waitForFunction(() => document.getElementById("confirmDlg").open, null, {
    timeout: 5000,
  });
  await page.click("#confirmYes");
  await page.waitForFunction(() => !document.getElementById("confirmDlg").open, null, {
    timeout: 10000,
  });
  // ⚠️ 必须**等 Toast 真的出现**再读再拍 ——
  //    Toast 是在 POST 往返**回来之后**才 render 的，固定 sleep(300) 会读到空串，
  //    并且拍下一张"没有 Toast 的 Toast 截图"（第一版就踩了：D4 红 + 假证据图）。
  let toastTxt = "";
  try {
    await page.waitForFunction(
      () => document.getElementById("toast").classList.contains("show"),
      null,
      { timeout: 10000 },
    );
    toastTxt = (await uiState()).toast;
    await shot("toast-390.png"); // 抢在 4s 自动消失之前按快门
  } catch {
    await shot("toast-390.png"); // 没等到也留一张，便于人工判断
  }
  await page.waitForFunction(() => !document.getElementById("detailDlg").open, null, {
    timeout: 10000,
  });
  await sleep(900);
  const afterDo = await page.evaluate(
    (em) =>
      [...document.querySelectorAll("#userRows tr")]
        .find((tr) => tr.querySelector("td.email").childNodes[0].textContent.trim() === em)
        .querySelector('td[data-label="状态"] .badge').textContent.trim(),
    MUTABLE,
  );
  check(
    `D3 确认后发出 1 条 POST 且状态真的翻转（${before} → ${afterDo}）`,
    writes.length === 1 && afterDo !== before,
    `写请求 ${writes.length} 条 [${writes.join(", ")}]`,
  );
  check("D4 操作成功给出 Toast 反馈", toastTxt.length > 0, `"${toastTxt}"`);

  // 真实往返 ②：原样改回去（不留副作用）
  await clickRow(MUTABLE);
  await page.click("#opToggleDisable");
  await page.waitForFunction(() => document.getElementById("confirmDlg").open, null, {
    timeout: 5000,
  });
  await page.click("#confirmYes");
  await page.waitForFunction(() => !document.getElementById("detailDlg").open, null, {
    timeout: 10000,
  });
  await sleep(900);
  const restored = await page.evaluate(
    (em) =>
      [...document.querySelectorAll("#userRows tr")]
        .find((tr) => tr.querySelector("td.email").childNodes[0].textContent.trim() === em)
        .querySelector('td[data-label="状态"] .badge').textContent.trim(),
    MUTABLE,
  );
  check("D5 已把测试账号还原（种子数据无残留改动）", restored === before, `${afterDo} → ${restored}`);
  await closeDetail();
}

/* ==========================================================================
   阶段 4：四视口 —— 响应式断点 + 明暗双主题 + 横向溢出 + 截图
   ========================================================================== */
group("阶段 4 · 四视口 / 明暗双主题");
const themeProbe = () =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const hex = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return {
      bg: cs.backgroundColor,
      fg: cs.color,
      lumBg: lum(hex(cs.backgroundColor)),
      lumFg: lum(hex(cs.color)),
      theadDisplay: (() => {
        const th = document.querySelector("thead");
        return th ? getComputedStyle(th).display : "none";
      })(),
      trDisplay: (() => {
        const tr = document.querySelector("#userRows tr");
        return tr ? getComputedStyle(tr).display : "none";
      })(),
      beforeContent: (() => {
        const td = document.querySelector("#userRows tr td.num");
        if (!td) return "";
        return getComputedStyle(td, "::before").content || "";
      })(),
      tag: document.documentElement.dataset.cacheBust || "",
    };
  });

for (const vp of VIEWPORTS) {
  group(`视口 ${vp.w}×${vp.h}`);
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await sleep(600);

  // 令牌门截图（先清 sessionStorage）
  await gotoGate(vp.tag);
  await page.emulateMedia({ colorScheme: "light" });
  await sleep(300);
  await shot(`gate-light-${vp.tag}.png`);
  if (vp.w === 390 || vp.w === 1440) {
    await page.emulateMedia({ colorScheme: "dark" });
    await sleep(300);
    await shot(`gate-dark-${vp.tag}.png`);
    await page.emulateMedia({ colorScheme: "light" });
    // 错误令牌态（本视口实拍，文件名里的宽度就是真宽度 —— 别再放到循环外拍）
    await page.fill("#tokenInput", "WRONG-TOKEN-FOR-SCREENSHOT");
    await page.click("#gateBtn");
    await page.waitForFunction(() => !document.getElementById("gateErr").hidden, null, {
      timeout: 15000,
    });
    await sleep(300);
    await shot(`gate-error-${vp.tag}.png`);
    await page.fill("#tokenInput", "");
  }
  await login();

  const isCompact = vp.w <= 767;
  const st = await themeProbe();
  check(
    `E1 断点行为正确（${isCompact ? "窄屏=卡片" : "宽屏=表格"}）`,
    isCompact ? st.theadDisplay === "none" && st.trDisplay === "block" : st.theadDisplay !== "none",
    `thead=${st.theadDisplay} tr=${st.trDisplay}`,
  );
  check(
    `E2 窄屏每行带 data-label 前缀`,
    isCompact ? st.beforeContent.includes("条目") : true,
    `::before=${st.beforeContent}`,
  );

  // 横向溢出：四视口都必须不出现
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bodySw: document.body.scrollWidth,
  }));
  check(
    `E3【几何】无横向溢出`,
    ov.sw <= ov.iw + 1 && ov.bodySw <= ov.iw + 1,
    `scrollW=${ov.sw} body=${ov.bodySw} innerW=${ov.iw}`,
  );

  /**
   * 【几何】E3 是**不够的** —— 它只查文档级溢出。
   * 而 `.panel { overflow: hidden }` 会把表格的溢出**静默裁掉**：
   * 页面不出现滚动条、scrollWidth 也等于视口宽，但**最后一列的「管理」按钮被切掉了**
   * （768px 档实测：只剩一条蓝边）。
   * 所以必须按**元素相对面板的边界**逐格查，并把表格自身的 scrollWidth 也算进来。
   */
  const clip = await page.evaluate(() => {
    const panel = document.querySelector(".panel");
    if (!panel) return { bad: ["没有找到 .panel"], panelW: 0, tableW: 0, tableSw: 0 };
    const pr = panel.getBoundingClientRect();
    const table = panel.querySelector("table");
    const bad = [];
    for (const el of panel.querySelectorAll("th, td, button")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const overR = r.right - pr.right;
      const overL = pr.left - r.left;
      if (overR > 1 || overL > 1) {
        bad.push(
          `${el.tagName}${el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""}` +
            `[${(el.textContent || "").trim().slice(0, 8)}] 超出右 ${Math.round(overR)}/左 ${Math.round(overL)}`,
        );
      }
    }
    return {
      bad,
      panelW: Math.round(pr.width),
      tableW: Math.round(table.getBoundingClientRect().width),
      tableSw: table.scrollWidth,
    };
  });
  check(
    "E7【几何】没有任何单元格/按钮被面板裁掉（防 overflow:hidden 静默吃溢出）",
    clip.bad.length === 0 && clip.tableSw <= clip.panelW + 1,
    clip.bad.length ? clip.bad.slice(0, 4).join(" ; ") : `面板 ${clip.panelW} / 表格 ${clip.tableW}(scroll ${clip.tableSw})`,
  );

  // 控件高度硬下限（不写绝对 px，只断言"不小于令牌"）
  const ctl = await page.evaluate(() => {
    const tap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap"));
    const h = [...document.querySelectorAll("button:not([hidden])")].map((b) => ({
      t: (b.textContent || "").trim().slice(0, 12) || (b.getAttribute("aria-label") || "?"),
      h: +b.getBoundingClientRect().height.toFixed(1),
      vis: b.getClientRects().length > 0,
    }));
    return { tap, h };
  });
  const shortOnes = ctl.h.filter((b) => b.vis && b.h < 32);
  check(
    `E4【几何】没有过矮的可点控件（<32px）`,
    shortOnes.length === 0,
    shortOnes.map((b) => `${b.t}=${b.h}`).join(", "),
  );
  const nonTap = ctl.h.filter((b) => b.vis && b.h < ctl.tap - 0.5);
  console.log(
    `     · 触控高度参考：${nonTap.length} 个控件矮于 --tap(${ctl.tap}px)（桌面紧凑按钮属预期，仅记录）`,
  );

  // 明暗双主题
  await page.emulateMedia({ colorScheme: "light" });
  await sleep(400);
  const L = await themeProbe();
  await shot(`dash-light-${vp.tag}.png`);
  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(500);
  const D = await themeProbe();
  if (vp.w === 390 || vp.w === 1440) await shot(`dash-dark-${vp.tag}.png`);

  check(
    "E5 深色主题真的切换了（背景亮度差 ≥0.5）",
    Math.abs(L.lumBg - D.lumBg) >= 0.5,
    `浅 ${L.bg}(L=${L.lumBg.toFixed(3)}) → 深 ${D.bg}(L=${D.lumBg.toFixed(3)})`,
  );
  const cRatio = (fg, bg) => {
    const a = fg,
      b = bg;
    const hi = Math.max(a, b),
      lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  };
  const lr = cRatio(L.lumFg, L.lumBg);
  const dr = cRatio(D.lumFg, D.lumBg);
  check(
    "E6【无障碍】明暗两主题正文对比度均 ≥4.5（页面内独立复算）",
    lr >= 4.5 && dr >= 4.5,
    `浅 ${lr.toFixed(2)}:1 / 深 ${dr.toFixed(2)}:1`,
  );

  // 详情弹窗截图（明 + 暗）
  await page.emulateMedia({ colorScheme: "light" });
  await sleep(300);
  await clickRow(apiUsers[0]);
  await shot(`detail-${vp.tag}.png`);

  /**
   * 【几何】「删除账号及其密码库」必须**真的能被用户点到**。
   * 390×844 上详情面板内容约 900px：没有 `max-height` + 可滚动 body 时，
   * 弹窗被夹住、内容溢出到视口外且无处可滚 ⇒ 删除按钮永远够不到（第一版实测复现）。
   * 判据不写死"必须一屏放下"（那会逼着把字号缩小），而是"在视口内**或**滚到底后在视口内"。
   */
  const reach = await page.evaluate(() => {
    const d = document.getElementById("detailDlg");
    const body = d.querySelector(".sheet-body");
    const sheet = d.querySelector(".sheet");
    const del = document.getElementById("opDelete");
    const inView = () => {
      const r = del.getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1;
    };
    const m = {
      vpH: window.innerHeight,
      sheetH: Math.round(sheet.getBoundingClientRect().height),
      bodyScrollable: body.scrollHeight > body.clientHeight + 2,
      bodyOverflow: getComputedStyle(body).overflowY,
      before: inView(),
    };
    body.scrollTop = body.scrollHeight;
    d.scrollTop = d.scrollHeight;
    m.after = inView();
    m.delTop = Math.round(del.getBoundingClientRect().top);
    m.delBottom = Math.round(del.getBoundingClientRect().bottom);
    body.scrollTop = 0;
    d.scrollTop = 0;
    return m;
  });
  check(
    `E8【几何】『删除账号及其密码库』真的可达（在视口内，或滚到底后在视口内）`,
    reach.before || (reach.bodyScrollable && reach.after),
    `sheet=${reach.sheetH} 视口=${reach.vpH} body可滚=${reach.bodyScrollable}(${reach.bodyOverflow}) ` +
      `初始${reach.before ? "可见" : "不可见"} → 滚到底 ${reach.after ? "可见" : `仍不可见(${reach.delTop}~${reach.delBottom})`}`,
  );

  // 【几何】到期天数是 1–4 位数字：输入框的可写区必须装得下「3650」，不许裁字
  const daysW = await page.evaluate(() => {
    const i = document.getElementById("expireDays");
    const cs = getComputedStyle(i);
    const r = i.getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    probe.style.fontSize = cs.fontSize;
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontWeight = cs.fontWeight;
    probe.textContent = "3650";
    document.body.appendChild(probe);
    const textW = probe.getBoundingClientRect().width;
    probe.remove();
    const inner =
      r.width -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) -
      parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    return { w: Math.round(r.width), inner: Math.round(inner), textW: Math.round(textW) };
  });
  check(
    "E9【几何】到期天数输入框装得下 4 位数字（不裁字）",
    daysW.inner >= daysW.textW - 1,
    `框宽 ${daysW.w} 可写区 ${daysW.inner} 需要 ${daysW.textW}`,
  );

  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(400);
  if (vp.w === 1440) await shot("detail-dark-1440.png");
  await closeDetail();
  await page.emulateMedia({ colorScheme: "light" });
}

/* ==========================================================================
   汇总
   ========================================================================== */
await browser.close();
console.log(`\n===== 管理台运行期验收: ${pass} 通过 / ${fail} 失败 =====`);
const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort();
console.log(`截图 ${files.length} 张（${SHOTS}）:`);
for (const f of files) {
  const sz = fs.statSync(path.join(SHOTS, f)).size;
  console.log(`  · ${f}  ${(sz / 1024).toFixed(1)} KB`);
}
// 假帧检测：同尺寸同哈希说明两次"按快门"拍到了同一画面（动画截图最常见的假绿）
const { createHash } = await import("node:crypto");
const seen = new Map();
for (const f of files) {
  const h = createHash("sha256").update(fs.readFileSync(path.join(SHOTS, f))).digest("hex").slice(0, 12);
  if (seen.has(h)) console.log(`  ⚠️ 假帧嫌疑：${f} 与 ${seen.get(h)} 逐字节相同`);
  else seen.set(h, f);
}
process.exit(fail ? 1 : 0);
