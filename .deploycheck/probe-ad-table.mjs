/**
 * AD 段（第二十四批）账号表的**几何审计**探针。
 *
 * 只做一件事：把"表格在各种宽度下到底长什么样"量出来 —— 列宽、对齐、可见列、底色、有没有溢出。
 * 设计期用它取基线（`--measure`），改完用它守行为（默认就是断言模式）。
 *
 * 为什么要专门量：需求里"中间列均分 / 内容居中 / 表头与数据行不一样"这三条，
 * **构建和静态 grep 都证明不了**，只有 getBoundingClientRect + getComputedStyle 能证明。
 *
 * 用法（在 warden-worker 目录下）：
 *   node .deploycheck/probe-ad-table.mjs            # 量 + 断言
 *   node .deploycheck/probe-ad-table.mjs --measure   # 只量不断言（取基线用）
 *   AC_UI_BASE=https://shypwd.cc.cd WARDEN_TEST_BASE=https://shypwd.cc.cd \
 *     node .deploycheck/probe-ad-table.mjs
 *
 * ⚠️ 别用 `| head -N` 跑本脚本（管道提前关闭 ⇒ node 收 SIGPIPE 中途死掉）。要留档就 `> 文件`。
 */
import fs from "node:fs";
import path from "node:path";

process.env.WARDEN_TEST_BASE ||= "https://test.shytest.cc.cd";
const { login, sleep, CHROME, UA, clickSkips } = await import("./b8-lib.mjs");

const { chromium } = await import(
  "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs"
);

const MEASURE_ONLY = process.argv.includes("--measure");
const BASE = (process.env.AC_UI_BASE || "https://test.shytest.cc.cd").replace(/\/+$/, "");
const PROD = process.env.AC_PROD || "https://shypwd.cc.cd";
const PROXY = /localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890";

// 凭据只从环境变量 / .env.local 读（仓库是 public，绝不硬编码）
const ENV_FILE = path.join(import.meta.dirname, ".env.local");
function envOf(key, fallback = "") {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync(ENV_FILE)) return fallback;
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(`${key}=`)) return t.slice(key.length + 1).trim();
  }
  return fallback;
}
const TOKEN = envOf("ADMIN_TOKEN");
const MAIL = envOf("WARDEN_TEST_MAIL");

/* --------------------------------- API --------------------------------- */
import { execFileSync } from "node:child_process";
function api(method, p, body) {
  const cmd = [
    "curl", "-sS", "-x", "http://127.0.0.1:7890", "--retry", "3", "--retry-all-errors",
    "--max-time", "40", "-X", method, "-w", "\n%{http_code}", "-H", `X-Admin-Token: ${TOKEN}`,
  ];
  if (body !== undefined) cmd.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  cmd.push(PROD + p);
  const raw = execFileSync(cmd[0], cmd.slice(1), { encoding: "utf-8" }).trimEnd();
  const i = raw.lastIndexOf("\n");
  return { status: Number(raw.slice(i + 1).trim()), data: (() => { try { return JSON.parse(raw.slice(0, i)); } catch { return raw.slice(0, i); } })() };
}
const users = () => { const r = api("GET", "/api/admin/users"); return r.status === 200 && r.data?.users ? r.data.users : []; };

/* ------------------------------- 量尺 ------------------------------- */
const WIDTHS = [390, 480, 560, 640, 720, 860, 1024, 1280, 1440, 1920];

/** 期望的可见列数（容器宽 → 可见列名）。阶梯定义见 CSS 的 `@container warden-admin`。 */
function expectCols(containerW, isCard) {
  if (isCard) return ["账号", "角色", "状态", "操作"];
  if (containerW >= 860) return ["账号", "角色", "状态", "条目", "设备", "两步验证", "操作"];
  if (containerW >= 700) return ["账号", "角色", "状态", "条目", "两步验证", "操作"];
  if (containerW >= 620) return ["账号", "角色", "状态", "两步验证", "操作"];
  if (containerW >= 500) return ["账号", "角色", "状态", "操作"];
  return null; // 500 以下应是卡片模式
}

const probe = () =>
  page.evaluate(() => {
    const wrap = document.querySelector(".warden-admin-tablewrap");
    const table = document.querySelector(".warden-admin-table");
    const ths = [...document.querySelectorAll(".warden-admin-table thead th")];
    const rows = [...document.querySelectorAll(".warden-admin-table tbody tr")];
    const tr1 = rows[0];
    const shown = (el) => !!el && el.getClientRects().length > 0;
    const bgOf = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    const isCard = tr1 ? getComputedStyle(tr1).display === "block" : false;
    const cols = ths.map((th, i) => {
      const td = tr1 ? tr1.children[i] : null;
      // ⚠️ 卡片模式下 thead 整体是 display:none ⇒ 判"这一列还在不在"必须看 <td>。
      //    只判 <th> 的话窄屏会恒报"0 列可见"（第一版探针就是这么误报了 6 条）。
      const vis = isCard ? !!td && shown(td) : shown(th) && !!td && shown(td);
      // 内容真实居中了吗？**光看 `text-align: center` 不够** —— 徽章是 inline-block、
      // 数字是纯文本节点，两者居中后的观感可以差十几像素。这里量"内容包围盒的中心"。
      const cx = (el) => {
        const r = el.getBoundingClientRect();
        return Math.round(r.left + r.width / 2);
      };
      const contentBox = (() => {
        if (!td || !vis || isCard) return null;
        // ⚠️ 一律走 Range 量**文本/内容本身**，不能用 `td.firstElementChild`：
        //    首列的 <b>/<span> 是 `display: block` ⇒ 它的盒子铺满整格，
        //    盒子中心恒等于格子中心，于是"贴左"会被误判成"居中"（第一版就是这么误报的 7 条）。
        //    Range 拿到的是文字自己的实心矩形，能真实反映"文字落在哪"。
        const range = document.createRange();
        range.selectNodeContents(td);
        const r = range.getBoundingClientRect();
        return r.width ? { l: Math.round(r.left), w: Math.round(r.width), cx: Math.round(r.left + r.width / 2) } : null;
      })();
      return {
        i,
        label: th.textContent.trim(),
        vis,
        thW: Math.round(th.getBoundingClientRect().width),
        tdW: td ? Math.round(td.getBoundingClientRect().width) : null,
        tdL: td ? Math.round(td.getBoundingClientRect().left) : null,
        tdCx: td ? cx(td) : null,
        contentL: contentBox ? contentBox.l : null,
        contentW: contentBox ? contentBox.w : null,
        contentCx: contentBox ? contentBox.cx : null,
        thH: Math.round(th.getBoundingClientRect().height),
        thAlign: getComputedStyle(th).textAlign,
        tdAlign: td ? getComputedStyle(td).textAlign : null,
        thBg: bgOf(th),
        tdBg: bgOf(td),
      };
    });
    return {
      hash: location.hash,
      innerW: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
      wrapW: wrap ? wrap.clientWidth : -1,
      wrapScrollW: wrap ? wrap.scrollWidth : -1,
      tableW: table ? Math.round(table.getBoundingClientRect().width) : -1,
      tableLayout: table ? getComputedStyle(table).tableLayout : null,
      cardMode: isCard,
      cols,
      rowBg: rows.slice(0, 3).map((tr) => bgOf(tr.children[0])),
      thFontSize: ths[0] ? getComputedStyle(ths[0]).fontSize : null,
      tdFontSize: tr1 ? getComputedStyle(tr1.children[0]).fontSize : null,
      thLetterSpacing: ths[0] ? getComputedStyle(ths[0]).letterSpacing : null,
    };
  });

/* ------------------------------- 断言 ------------------------------- */
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? "  " + extra : ""}`); }
};

/* ------------------------------- 开跑 ------------------------------- */
console.log(`\n========== AD 段账号表几何审计（${BASE}）==========`);
console.log(`测量模式 = ${MEASURE_ONLY ? "只量不断言" : "量 + 断言"}`);

const target = users().find((u) => u.email === MAIL);
if (!target) { console.error(`❌ 生产库里找不到 ${MAIL}，无法进入管理页`); process.exit(1); }
const before = target.role;
console.log(`目标账号 ${MAIL} 当前 role=${before}（临时提为 owner，跑完复原）`);
api("POST", `/api/admin/users/${target.id}/role`, { role: "owner" });

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true, userAgent: UA, locale: "zh-CN", viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
// ⚠️ **登录要重试**：本机实测约 1/3 的概率前端资源还没就绪（刚部署完尤其明显），
//    `keyboard.type` 敲进去时输入框还没拿到焦点 ⇒ 邮箱为空 ⇒ 卡在"必须输入内容"。
//    这是环境抖动，不是回归 —— 直接重试比人工再跑一遍省事。
let logged = false;
for (let i = 1; i <= 3 && !logged; i++) {
  try {
    await login(page, { verbose: i === 1 });
    logged = true;
  } catch (e) {
    console.log(`  ⚠️ 第 ${i} 次登录失败（${String(e).split("\n").slice(-1)[0].slice(0, 60)}…），重试`);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(4000);
  }
}
if (!logged) { console.error("❌ 三次登录都失败，放弃"); await browser.close(); process.exit(1); }
// ⚠️ 每次都是全新的浏览器上下文 ⇒ **每次首登都会弹「您已成功加入！欢迎使用 Bitwarden」**。
//    不点掉它，截图会被这个引导弹窗整个盖住（第一版就是这么拍到一张废图的）。
await clickSkips(page);
await sleep(800);
await page.evaluate(() => { location.hash = "#/settings/account-admin"; });
await sleep(5000);
await clickSkips(page); // 进页面后偶尔还会再弹一次
await sleep(1200);

const snapshots = [];
// 截图目录。生产复验时用 `AC_SHOTS=...` 另开一个，**别覆盖测试通道那份证据**。
const SHOT_DIR = process.env.AC_SHOTS
  ? path.resolve(process.env.AC_SHOTS)
  : path.resolve(import.meta.dirname, "shots", "ad-table");
fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 900 });
  await sleep(1200);
  const m = await probe();
  snapshots.push({ w, m });
  // 📸 先滚到表格再拍（表格可能在首屏之下，直接拍会拍到空的设置页头）
  await page.locator(".warden-admin-tablewrap").scrollIntoViewIfNeeded().catch(() => {});
  await sleep(400);
  await page.screenshot({ path: path.join(SHOT_DIR, `table-${w}.png`) });
  const vis = m.cols.filter((c) => c.vis);
  console.log(`\n── 视口 ${String(w).padStart(4)} · 容器 ${String(m.wrapW).padStart(4)} · 表 ${String(m.tableW).padStart(4)} · ` +
    `${m.cardMode ? "卡片模式" : "表格模式"} · layout=${m.tableLayout}`);
  console.log(`   可见列(${vis.length})  ` + vis.map((c) => `${c.label}:${c.tdW}px/${c.tdAlign}`).join("  "));
  console.log(`   隐藏列        ` + m.cols.filter((c) => !c.vis).map((c) => c.label).join(" ") || "   (无)");
  console.log(`   溢出          doc=${m.docScrollW}/${m.innerW}  wrap=${m.wrapScrollW}/${m.wrapW}`);
  console.log(`   底色          表头=${m.cols[0].thBg}  行1=${m.rowBg[0]}  行2=${m.rowBg[1]}`);
  console.log(`   字号          表头=${m.thFontSize}/ls=${m.thLetterSpacing}/h=${m.cols[0].thH}  数据=${m.tdFontSize}`);
  if (m.cardMode) {
    console.log(`   卡片模式：tr.display=block, 无需均分/居中约束（纵向堆叠）`);
  }

  if (MEASURE_ONLY) continue;

  const tag = `[${w}]`;
  const visibleCols = m.cols.filter((c) => c.vis).map((c) => c.label);
  const exp = expectCols(m.wrapW, m.cardMode);
  if (exp) {
    ok(`${tag} 可见列与阶梯一致`, JSON.stringify(visibleCols) === JSON.stringify(exp),
      `实际=${visibleCols.join("/")}  期望=${exp.join("/")}`);
  } else {
    ok(`${tag} 容器 <520 ⇒ 卡片模式`, m.cardMode === true, `wrapW=${m.wrapW} cardMode=${m.cardMode}`);
  }
  ok(`${tag} 账号/角色/操作 三列必可见`, ["账号", "角色", "操作"].every((l) => visibleCols.includes(l)),
    visibleCols.join("/"));
  ok(`${tag} 无横向滚动（文档）`, m.docScrollW <= m.innerW + 1, `doc=${m.docScrollW} win=${m.innerW}`);
  ok(`${tag} 无横向滚动（表格容器）`, m.wrapScrollW <= m.wrapW + 1, `wrap=${m.wrapScrollW}/${m.wrapW}`);

  if (!m.cardMode) {
    // 中间列 = 去掉首列与末列
    const mids = m.cols.filter((c) => c.vis && c.i !== 0 && c.i !== m.cols.length - 1);
    if (mids.length >= 2) {
      const ws = mids.map((c) => c.tdW);
      const spread = Math.max(...ws) - Math.min(...ws);
      ok(`${tag} 中间列**均分**（Δ ≤ 2px）`, spread <= 2, `${ws.join("/")}  Δ=${spread}`);
    }
    ok(`${tag} 首列左对齐`, m.cols[0].tdAlign === "left", `align=${m.cols[0].tdAlign}`);
    ok(`${tag} 中间列与末列居中`, m.cols.slice(1).every((c) => !c.vis || c.tdAlign === "center"),
      m.cols.slice(1).filter((c) => c.vis).map((c) => `${c.label}=${c.tdAlign}`).join(" "));
    ok(`${tag} 表头与数据行底色不同`, m.cols[0].thBg !== m.cols[0].tdBg,
      `th=${m.cols[0].thBg} td=${m.cols[0].tdBg}`);
    ok(`${tag} 数据行之间底色一致`, m.rowBg[0] === m.rowBg[1], `${m.rowBg[0]} vs ${m.rowBg[1]}`);
    ok(`${tag} 表头与数据行字号不同`, m.thFontSize !== m.tdFontSize, `${m.thFontSize} vs ${m.tdFontSize}`);
    // 🔴 **内容包围盒**真的落在列中间吗？ —— `text-align: center` 只说明声明对了，
    //    徽章(inline-block)与纯文本节点居中后的实际像素位置才是用户看到的东西。
    //    这条是"肉眼会骗人"的直接对策：截图上看 20px 的偏差，两种判据给出的结论可以相反。
    const off = m.cols
      .filter((c) => c.vis && c.i !== 0 && c.contentCx !== null)
      .map((c) => ({ label: c.label, d: Math.abs(c.contentCx - c.tdCx) }));
    const worst = off.reduce((a, b) => (b.d > a.d ? b : a), { label: "-", d: -1 });
    ok(`${tag} 中间/末列的内容**实测**落在列中心（Δ ≤ 2px）`, worst.d <= 2,
      off.map((o) => `${o.label}:${o.d}`).join(" ") + `  (最大 ${worst.label} ${worst.d}px)`);
    // 内容**完整**放进格子里了吗（没被切）—— "能完整展示就完整展示"的最小保证。
    const clipped = m.cols
      .filter((c) => c.vis && c.i !== 0 && c.contentW !== null && c.tdW !== null)
      .filter((c) => c.contentW > c.tdW - 8)
      .map((c) => `${c.label}:${c.contentW}>${c.tdW - 8}`);
    ok(`${tag} 中间/末列内容没有被切（内容宽 ≤ 格宽−8）`, clipped.length === 0, clipped.join(" ") || "全部放得下");
    // 首列反过来：内容必须**贴着左内边距**起排。
    //    ⚠️ 这里不能判"内容中心 < 格子中心" —— 首列的长邮箱（12px × 20 字 ≈ 135px）
    //       在窄的可用宽度下会接近格子中心，用"中心"判会把左对齐误判成居中。
    //       只有量**左边缘到格子左边**的距离才稳（应等于单元格的 16px 左内边距）。
    const c0 = m.cols[0];
    const padL = c0.contentL !== null && c0.tdL !== null ? c0.contentL - c0.tdL : null;
    ok(`${tag} 首列内容贴着左内边距起排（padding-left ≈ 16px）`,
      padL !== null && padL >= 8 && padL <= 24, `实测 ${padL}px`);
  }
}

/* --------------------- 跨视口的不变量（"字号不一 / 控件不等高"是零容忍项）-------------------- */
if (!MEASURE_ONLY) {
  console.log(`\n── 跨视口不变量 ──`);
  const tableModes = snapshots.filter((s) => !s.m.cardMode);
  const thH = [...new Set(tableModes.map((s) => s.m.cols[0].thH))];
  ok("表头行高在所有表格模式下一致", thH.length === 1, `值=${thH.join("/")}  取 ${tableModes.length} 个视口`);
  const thFs = [...new Set(tableModes.map((s) => s.m.thFontSize))];
  ok("表头字号在所有表格模式下一致", thFs.length === 1, `值=${thFs.join("/")}`);
  const thBg = [...new Set(tableModes.map((s) => s.m.cols[0].thBg))];
  ok("表头底色在所有表格模式下一致", thBg.length === 1, `值=${thBg.join("/")}`);
  const ladderOk = tableModes.every((s) => s.m.cols.filter((c) => c.vis).length >= 4);
  ok("表格模式下至少保留 4 列（账号/角色/状态/操作）", ladderOk,
    tableModes.map((s) => `${s.w}:${s.m.cols.filter((c) => c.vis).length}`).join(" "));
}

/* ------------------------------ 收尾 ------------------------------ */
api("POST", `/api/admin/users/${target.id}/role`, { role: before === "owner" ? "user" : before });
console.log(`\n已把 ${MAIL} 的 role 复原为 ${before === "owner" ? "user" : before}`);

const dir = SHOT_DIR;
fs.mkdirSync(dir, { recursive: true });
await browser.close();

if (!MEASURE_ONLY) {
  console.log(`截图: ${dir}`);
  console.log(`\n==============================================================`);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  console.log(`==============================================================`);
}
process.exit(fail > 0 ? 1 : 0);
