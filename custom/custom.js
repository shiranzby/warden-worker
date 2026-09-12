/*
 * warden-worker / shypwd.cc.cd — 自定义前端增强 (v2)
 *
 * 目标:
 *   1) 在保险库列表每一行末尾、三点菜单之前，常显该条目的 TOTP 动态码(点按复制)
 *   2) "验证码"视图: 只保留带 TOTP 的条目, 等价于把 Authenticator 合并进密码库
 *   3) 窄屏注入底部标签栏(密码库/验证码/发送/工具/设置), 弥补手机端无法导航的问题
 *      样式在 custom.css 的 .warden-tabbar
 *
 * 实现要点(均为线上实测结论, 勿轻易改动):
 *   - 该版本 Web Vault 的加解密跑在 Rust/WASM 核心里, 不走 crypto.subtle,
 *     因此无法通过 hook SubtleCrypto 拿到明文; 生产构建下 __ngContext__ 是数字,
 *     window.ng 不存在, 也无法从组件实例里取数据。
 *   - 唯一可靠路径: 在 Angular 启动前劫持 fetch/XHR, 截获应用自身发出的
 *     带 Authorization 头的 /api/sync 响应(含全部密文条目),
 *     再用 window.bitwardenContainerService 的 KeyService/EncryptService 解密。
 *   - 列表行的 DOM 结构: <tr appvaultcipherrow> 共 5 个 td
 *       [0]复选框 [1]图标 [2]名称+用户名 [3]组织徽标 [4]操作菜单
 *     条目名是 cell[2] 里的 button[bitlink].innerText, 菜单是 cell[4]。
 */

(function () {
  "use strict";

  var STEP = 30;
  var LOG = "[warden-totp]";

  /* =====================================================================
   * 1. 提前劫持 fetch / XHR —— 必须在 Angular 发起请求之前装好
   * ===================================================================== */

  var SYNC = null;            // 最近一次 /api/sync 的原始 JSON
  var syncWaiters = [];       // 等待首个 sync 的回调

  function isSyncUrl(u) {
    return typeof u === "string" && u.indexOf("/api/sync") !== -1;
  }

  function feedSync(json) {
    if (!json || !json.ciphers) return;
    SYNC = json;
    var w = syncWaiters;
    syncWaiters = [];
    for (var i = 0; i < w.length; i++) {
      try { w[i](json); } catch (e) { /* ignore */ }
    }
  }

  function onFirstSync(cb) {
    if (SYNC) { cb(SYNC); return; }
    syncWaiters.push(cb);
  }

  if (typeof window.fetch === "function") {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
      var url = "";
      try {
        url = typeof input === "string" ? input : (input && input.url) || "";
      } catch (e) { /* ignore */ }
      var p = _fetch.apply(this, arguments);
      if (isSyncUrl(url)) {
        try {
          p.then(function (resp) {
            if (!resp || !resp.ok) return;
            resp.clone().json().then(feedSync).catch(function () {});
          }).catch(function () {});
        } catch (e) { /* ignore */ }
      }
      return p;
    };
  }

  if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__wardenUrl = url; } catch (e) { /* ignore */ }
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      if (isSyncUrl(self.__wardenUrl)) {
        self.addEventListener("load", function () {
          try { feedSync(JSON.parse(self.responseText)); } catch (e) { /* ignore */ }
        });
      }
      return _send.apply(this, arguments);
    };
  }

  /* =====================================================================
   * 2. Base32 / HOTP / TOTP  (RFC 4648 / 4226 / 6238)
   * ===================================================================== */

  function base32Decode(input) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    var clean = String(input).replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = alphabet.indexOf(clean.charAt(i));
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  async function hotp(secretBytes, counter) {
    var buf = new ArrayBuffer(8);
    var dv = new DataView(buf);
    dv.setUint32(0, Math.floor(counter / 0x100000000));
    dv.setUint32(4, counter >>> 0);
    var key = await crypto.subtle.importKey(
      "raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    var sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
    var off = sig[sig.length - 1] & 0x0f;
    return (
      ((sig[off] & 0x7f) << 24) |
      ((sig[off + 1] & 0xff) << 16) |
      ((sig[off + 2] & 0xff) << 8) |
      (sig[off + 3] & 0xff)
    );
  }

  async function totp(secret, digits, period, atSeconds) {
    digits = digits || 6;
    period = period || STEP;
    var secs = typeof atSeconds === "number" ? atSeconds : Math.floor(Date.now() / 1000);
    var counter = Math.floor(secs / period);
    var binary = await hotp(base32Decode(secret), counter);
    var s = String(binary % Math.pow(10, digits));
    while (s.length < digits) s = "0" + s;
    return s;
  }

  function secondsLeft(period) {
    period = period || STEP;
    var elapsed = Math.floor(Date.now() / 1000) % period;
    return period - elapsed;
  }

  /* 解析 totp 字段: 支持 otpauth:// URI 或裸 base32 */
  function parseTotp(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    if (!raw) return null;
    if (raw.toLowerCase().indexOf("otpauth://") === 0) {
      try {
        var u = new URL(raw.replace(/^otpauth:\/\//i, "https://"));
        var secret = u.searchParams.get("secret");
        if (!secret) return null;
        var d = parseInt(u.searchParams.get("digits") || "6", 10);
        var p = parseInt(u.searchParams.get("period") || "30", 10);
        return {
          secret: secret,
          digits: isNaN(d) || d < 6 ? 6 : d,
          period: isNaN(p) || p < 1 ? STEP : p
        };
      } catch (e) {
        return null;
      }
    }
    // 裸 base32: 去掉空格, 非法字符直接判失败
    var bare = raw.replace(/\s+/g, "");
    if (!/^[A-Za-z2-7=]+$/.test(bare)) return null;
    return { secret: bare, digits: 6, period: STEP };
  }

  /* =====================================================================
   * 3. 通过官方 DI 容器解密 /api/sync 中的密文
   * ===================================================================== */

  function container() {
    return window.bitwardenContainerService || null;
  }

  /* decryptString 只读 encryptedString + encryptionType 两个字段, 故构造 shim */
  function encObj(s) {
    var t = parseInt(String(s).split(".")[0], 10);
    return { encryptedString: s, encryptionType: isNaN(t) ? 2 : t };
  }

  async function dec(es, key, s) {
    if (typeof s !== "string" || !s) return "";
    try {
      return (await es.decryptString(encObj(s), key)) || "";
    } catch (e) {
      return "";
    }
  }

  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase();
  }

  /* =====================================================================
   * 4. 建立 name -> TOTP 索引
   * ===================================================================== */

  var index = [];            // [{name, username, secret, digits, period}]
  var indexBuiltFor = null;  // 用 SYNC 对象引用做版本标记
  var lastSyncAt = 0;

  async function buildIndex(sync) {
    var cs = container();
    if (!cs) return false;

    var ks, es, userKey;
    try {
      ks = cs.getKeyService();
      es = cs.getEncryptService();
      userKey = await ks.getUserKey();
    } catch (e) {
      console.warn(LOG, "取 KeyService/EncryptService 失败", e);
      return false;
    }
    if (!userKey) return false;

    var list = (sync && sync.ciphers) || [];
    var out = [];
    var skippedOrg = 0;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.deletedDate) continue;
      var login = c.login;
      if (!login || !login.totp) continue;

      // 组织条目用独立的 cipher key 加密, 需要额外一轮密钥派生, 这里跳过并计数
      if (c.key) { skippedOrg++; continue; }

      var raw = await dec(es, userKey, login.totp);
      var p = parseTotp(raw);
      if (!p) continue;

      out.push({
        name: norm(await dec(es, userKey, c.name)),
        username: norm(login.username ? await dec(es, userKey, login.username) : ""),
        secret: p.secret,
        digits: p.digits,
        period: p.period
      });
    }

    index = out;
    lastSyncAt = Date.now();
    console.log(LOG, "索引完成, 带验证码的条目:", out.length,
      skippedOrg ? "(跳过组织条目 " + skippedOrg + " 个)" : "");
    return true;
  }

  /* =====================================================================
   * 5. 行匹配 + 插入
   * ===================================================================== */

  function rowName(row) {
    var btn = row.querySelector("button[bitlink], a[bitlink]");
    if (btn) return norm(btn.innerText || btn.textContent);
    var td = row.cells && row.cells[2];
    if (td) return norm(String(td.innerText || "").split("\n")[0]);
    return "";
  }

  function findCipher(row) {
    var name = rowName(row);
    if (!name) return null;
    var fallback = null;
    for (var i = 0; i < index.length; i++) {
      if (index[i].name !== name) continue;
      if (!fallback) fallback = index[i];
      var td = row.cells && row.cells[2];
      if (td) {
        var txt = norm(td.innerText);
        if (index[i].username && txt.indexOf(index[i].username) !== -1) return index[i];
      }
    }
    return fallback;
  }

  /* 找到操作菜单所在的单元格(通常最后一个 td) */
  function menuCell(row) {
    var cells = row.cells || [];
    for (var i = cells.length - 1; i >= 0; i--) {
      var c = cells[i];
      if (
        c.querySelector("bit-menu") ||
        c.querySelector("button[biticonbutton*='ellipsis']") ||
        c.querySelector(".bwi-ellipsis-v")
      ) {
        return c;
      }
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById("warden-totp-style")) return;
    var s = document.createElement("style");
    s.id = "warden-totp-style";
    s.textContent =
      ".warden-totp-code{display:inline-flex;align-items:center;gap:5px;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:13px;font-weight:700;letter-spacing:.06em;color:#175DDC;" +
      "background:#eef3ff;border:1px solid #c9d8ff;border-radius:6px;" +
      "padding:3px 9px;cursor:pointer;user-select:none;white-space:nowrap;" +
      "-webkit-tap-highlight-color:transparent}" +
      ".warden-totp-code:hover{background:#e0e9ff}" +
      ".warden-totp-code:active{transform:scale(.97)}" +
      ".warden-totp-code.warden-totp-expiring{color:#b35309;background:#fff4e6;border-color:#ffd8a8}" +
      ".warden-totp-code.warden-totp-copied{color:#0f7b3f;background:#e8f7ee;border-color:#b7e4c7}" +
      "@media (prefers-color-scheme:dark){" +
      ".warden-totp-code{color:#8ab4ff;background:#1d2a44;border-color:#2f4165}" +
      ".warden-totp-code:hover{background:#243356}" +
      ".warden-totp-code.warden-totp-expiring{color:#ffc078;background:#3a2a12;border-color:#5c421b}" +
      "}";
    document.head.appendChild(s);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject();
  }

  function insertTotp(row, cipher) {
    if (row.querySelector(".warden-totp-code")) return;

    var menu = menuCell(row);
    if (!menu) return;

    var span = document.createElement("span");
    span.className = "warden-totp-code";
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    span.dataset.secret = cipher.secret;
    span.dataset.digits = cipher.digits || 6;
    span.dataset.period = cipher.period || STEP;
    span.title = "点击复制验证码";
    span.textContent = "------";

    span.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      var code = span.dataset.code || "";
      if (!code) return;
      copyText(code).then(function () {
        span.classList.add("warden-totp-copied");
        span.textContent = "已复制";
        setTimeout(function () {
          span.classList.remove("warden-totp-copied");
          span.dataset.rendered = "";
        }, 700);
      }).catch(function () {
        // 剪贴板不可用(非 https / 无权限), 退化为选中文本
        try {
          var r = document.createRange();
          r.selectNodeContents(span);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e) { /* ignore */ }
      });
    });

    /*
     * 关键: 不能新增 <td>。
     * 该表是 table-fixed, 列宽由表头决定, 而表头只有 5 列
     * (tw-w-24 colspan=2 覆盖 复选框+图标, 名称 tw-w-3/5, 所有者 tw-w-2/5, 菜单 tw-w-12)。
     * 多插一个 <td> 会凭空造出第 6 列, 把名称列挤到 48px。
     * 因此把徽章放进已有的"菜单单元格"首位, 靠 CSS 把它撑宽成
     * [徽章][⋮] 的弹性布局 —— 视觉上仍在行末、且在三个点前面。
     */
    menu.classList.add("warden-totp-host");
    menu.insertBefore(span, menu.firstChild);
  }

  async function refreshCodes() {
    var spans = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.classList.contains("warden-totp-copied")) continue;
      try {
        var period = parseInt(sp.dataset.period, 10) || STEP;
        var code = await totp(sp.dataset.secret, parseInt(sp.dataset.digits, 10) || 6, period);
        sp.dataset.code = code;
        if (sp.dataset.rendered !== code) {
          sp.textContent = code;
          sp.dataset.rendered = code;
          if (secondsLeft(period) <= 5) sp.classList.add("warden-totp-expiring");
          else sp.classList.remove("warden-totp-expiring");
        } else {
          if (secondsLeft(period) <= 5) sp.classList.add("warden-totp-expiring");
          else sp.classList.remove("warden-totp-expiring");
        }
      } catch (e) { /* 单行失败不影响其他行 */ }
    }
  }

  /* =====================================================================
   * 6. "验证码" 视图 —— 把 Authenticator 合并进密码库
   *    触发后只保留带 TOTP 的条目, 等价于手机端 Bitwarden 的"验证器"标签页。
   * ===================================================================== */

  var onlyTotp = false;

  function applyFilter() {
    var strict = onlyTotp && index.length > 0;
    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (strict && !row.querySelector(".warden-totp-code")) {
        row.classList.add("warden-row-hidden");
      } else {
        row.classList.remove("warden-row-hidden");
      }
    }
    updateTabbar();
  }

  /* =====================================================================
   * 6b. 底部标签栏 —— 窄屏专用(样式在 custom.css 的 .warden-tabbar)
   *
   * 背景: 应用自身的侧边导航在窄屏被收成 0px, 且页面没有汉堡按钮,
   *       手机端因此完全无法切换到 发送/工具/设置。这里补一个底部标签栏,
   *       对齐 Bitwarden 手机端的底部导航设计。
   *       标签栏只在已登录布局中出现(由 SYNC 是否拿到间接保证)。
   * ===================================================================== */

  var TAB_ICONS = {
    vault: '<path d="M12 3l7 2.6v5.3c0 4.3-3 8.2-7 9.5-4-1.3-7-5.2-7-9.5V5.6L12 3z"/>',
    totp: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.4V12l3.1 1.9"/>',
    sends: '<path d="M4.2 11.9 20 4.6l-7.3 15.8-2.1-6.4-6.4-2.1z"/>',
    tools:
      '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/>' +
      '<rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 3.6v2.1M12 18.3v2.1M3.6 12h2.1M18.3 12h2.1' +
      'M6.1 6.1l1.5 1.5M16.4 16.4l1.5 1.5M17.9 6.1l-1.5 1.5M7.6 16.4l-1.5 1.5"/>'
  };

  var TABS = [
    { key: "vault", label: "密码库", route: "/vault" },
    { key: "totp", label: "验证码", route: "/vault", totp: true },
    { key: "sends", label: "发送", route: "/sends" },
    { key: "tools", label: "工具", route: "/tools" },
    { key: "settings", label: "设置", route: "/settings" }
  ];

  function currentRoute() {
    var h = (location.hash || "#/vault").replace(/^#/, "").split("?")[0];
    if (!h) return "/vault";
    if (h.charAt(0) !== "/") h = "/" + h;
    if (h === "/") return "/vault";
    return h;
  }

  function updateTabbar() {
    var bar = document.getElementById("warden-tabbar");
    if (!bar) return;
    var r = currentRoute();
    var onVault = r.indexOf("/vault") === 0;
    var links = bar.querySelectorAll("a[data-tab]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i], key = a.getAttribute("data-tab"), active;
      if (key === "totp") active = onVault && onlyTotp;
      else if (key === "vault") active = onVault && !onlyTotp;
      else active = r.indexOf(a.getAttribute("data-route")) === 0;
      if (active) a.classList.add("warden-tab-active");
      else a.classList.remove("warden-tab-active");
    }
  }

  function ensureTabbar() {
    if (document.getElementById("warden-tabbar")) return;
    if (!document.querySelector("bit-layout") || !document.getElementById("main-content")) return;

    var bar = document.createElement("nav");
    bar.id = "warden-tabbar";
    bar.className = "warden-tabbar";

    for (var i = 0; i < TABS.length; i++) {
      (function (t) {
        var a = document.createElement("a");
        a.setAttribute("data-tab", t.key);
        a.setAttribute("data-route", t.route);
        a.setAttribute("href", "#" + t.route);
        a.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true">' + TAB_ICONS[t.key] + "</svg>" +
          "<span>" + t.label + "</span>";
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          var onVault = currentRoute().indexOf("/vault") === 0;
          if (t.totp) {
            onlyTotp = true;
            if (!onVault) location.hash = "#/vault";
          } else {
            onlyTotp = false;
            if (!(t.key === "vault" && onVault)) location.hash = "#" + t.route;
          }
          applyFilter();
        });
        bar.appendChild(a);
      })(TABS[i]);
    }
    document.body.appendChild(bar);
    updateTabbar();
  }

  /* =====================================================================
   * 7. 主循环
   * ===================================================================== */

  async function decorate() {
    if (!SYNC || !index.length) return;
    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector(".warden-totp-code")) continue;
      var c = findCipher(row);
      if (c) insertTotp(row, c);
    }
    ensureTabbar();
    applyFilter();
    await refreshCodes();
  }

  async function boot() {
    if (!SYNC) return;
    if (SYNC !== indexBuiltFor) {
      var ok = await buildIndex(SYNC);
      if (ok) indexBuiltFor = SYNC;
    }
    await decorate();
  }

  function init() {
    ensureStyle();
    onFirstSync(function () { boot(); });
    boot();

    window.addEventListener("hashchange", updateTabbar);

    setInterval(function () { boot(); }, 2000);
    setInterval(refreshCodes, 1000);

    var observer = new MutationObserver(function () {
      clearTimeout(window.__wardenScanT);
      window.__wardenScanT = setTimeout(function () { decorate(); }, 350);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 10 秒仍未截获 /api/sync 时给出明确诊断
    setTimeout(function () {
      if (!SYNC) {
        console.warn(LOG, "未能截获 /api/sync —— custom.js 可能注入过晚, 请检查 index.html 中的脚本顺序");
      } else if (!index.length) {
        console.warn(LOG, "已拿到 /api/sync 但未解出任何带 totp 的条目(可能都未配置验证码, 或均为组织条目)");
      }
    }, 10000);

    console.log(LOG, "injected (v2)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
