/*
 * warden-worker / shypwd.cc.cd — 自定义前端增强 (v3)
 *
 * 功能:
 *   1) 保险库列表每行末尾、三点菜单之前常显 TOTP 动态码
 *   2) 徽章下边缘 = 剩余时间进度条, 中间截断处显示剩余秒数, <5s 转红
 *   3) 首行"选择"按钮 -> 选择模式(放出复选框列, 应用自带的"全选"同时生效)
 *      + 底部批量操作条(全选 / 已选N项 / 移入回收站 / 取消)
 *   4) 独立的"验证码"页(复刻 Bitwarden Authenticator 卡片式列表)
 *   5) 窄屏底部标签栏(密码库/验证码/发送/工具/设置)
 *
 * 线上实测结论(勿轻易改动):
 *   - 该版本 Web Vault 的加解密跑在 Rust/WASM 核心里, 不走 crypto.subtle,
 *     无法通过 hook SubtleCrypto 拿明文; 生产构建下 __ngContext__ 是数字,
 *     window.ng 不存在, 也拿不到组件实例。
 *   - 唯一可靠路径: 在 Angular 启动前劫持 fetch/XHR, 截获应用自身发出的
 *     带 Authorization 头的 /api/sync 响应, 再用 window.bitwardenContainerService
 *     的 KeyService/EncryptService 解密。
 *   - 行结构 <tr appvaultcipherrow> 共 5 个 td:
 *       [0]复选框 [1]站标图标 [2]名称+用户名 [3]组织徽标 [4]操作菜单
 *     名称 = cell[2] 里 button[bitlink].innerText。
 *   - 表格是 table-fixed, 列宽只由 <thead> 决定, 表头 4 个 th 覆盖 5 列
 *     (th.tw-w-24 带 colspan=2 覆盖 复选框+图标)。所以:
 *       不可新增 <td>(会凭空多出第 6 列, 名称列被挤到 48px);
 *       不可给表头/单元格 display:none(会打乱列映射)。
 *     徽章放进已有的菜单单元格, 列宽收缩靠改 th.tw-w-24 的宽度。
 */

(function () {
  "use strict";

  var STEP = 30;
  var LOG = "[shypwd]";

  /* =====================================================================
   * 1. 提前劫持 fetch / XHR —— 必须在 Angular 发起请求之前装好
   *    同时抓两样东西: /api/sync 的响应体 + Authorization 请求头
   * ===================================================================== */

  var SYNC = null;         // 最近一次 /api/sync 的原始 JSON
  var AUTH = null;         // 应用自身的 Authorization 头, 复用于批量删除
  var syncWaiters = [];

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

  function pickAuth(headers) {
    if (!headers) return;
    try {
      if (typeof headers.get === "function") {
        var v = headers.get("Authorization");
        if (v) AUTH = v;
        return;
      }
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === "authorization") AUTH = headers[i][1];
        }
        return;
      }
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) &&
            String(k).toLowerCase() === "authorization") {
          AUTH = headers[k];
        }
      }
    } catch (e) { /* ignore */ }
  }

  if (typeof window.fetch === "function") {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
      var url = "";
      try {
        url = typeof input === "string" ? input : (input && input.url) || "";
      } catch (e) { /* ignore */ }

      try {
        pickAuth(init && init.headers);
        if (!AUTH) {
          var h = (input && typeof input === "object" && input.headers) || null;
          if (h) pickAuth(h);
        }
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
    var _setHdr = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__wardenUrl = url; } catch (e) { /* ignore */ }
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (String(name).toLowerCase() === "authorization") AUTH = value;
      } catch (e) { /* ignore */ }
      return _setHdr.apply(this, arguments);
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

  var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var keyCache = {};

  function base32Decode(input) {
    var clean = String(input).replace(/=+$/g, "").toUpperCase().replace(/[\s-]/g, "");
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean.charAt(i));
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

  function importKey(secret, alg) {
    var ck = secret + "|" + alg;
    if (!keyCache[ck]) {
      var raw = base32Decode(secret);
      if (!raw.length) return null;
      keyCache[ck] = crypto.subtle.importKey(
        "raw", raw, { name: "HMAC", hash: alg }, false, ["sign"]
      );
    }
    return keyCache[ck];
  }

  async function totpAt(secret, digits, period, alg, atSeconds) {
    var key = importKey(secret, alg || "SHA-1");
    if (!key) return "";
    var secs = typeof atSeconds === "number" ? atSeconds : Math.floor(Date.now() / 1000);
    var counter = Math.floor(secs / period);

    var buf = new ArrayBuffer(8);
    var dv = new DataView(buf);
    dv.setUint32(0, Math.floor(counter / 4294967296));
    dv.setUint32(4, counter >>> 0);

    var sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key, buf));
    var off = sig[sig.length - 1] & 0x0f;
    var binary =
      ((sig[off] & 0x7f) << 24) |
      ((sig[off + 1] & 0xff) << 16) |
      ((sig[off + 2] & 0xff) << 8) |
      (sig[off + 3] & 0xff);

    var s = String(binary % Math.pow(10, digits));
    while (s.length < digits) s = "0" + s;
    return s;
  }

  /* "068822" -> "068 822"; 8 位 -> "0688 2299" */
  function groupCode(code) {
    if (!code) return "------";
    if (code.length === 6) return code.slice(0, 3) + " " + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + " " + code.slice(4);
    return code;
  }

  /* 解析 totp 字段: otpauth:// URI 或裸 base32 */
  function parseTotp(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    if (!raw) return null;

    if (raw.toLowerCase().indexOf("otpauth://") === 0) {
      try {
        var u = new URL(raw.replace(/^otpauth:\/\//i, "https://"));
        var secret = u.searchParams.get("secret");
        if (!secret) return null;
        var alg = (u.searchParams.get("algorithm") || "SHA1").toUpperCase();
        if (alg === "SHA1") alg = "SHA-1";
        else if (alg === "SHA256") alg = "SHA-256";
        else if (alg === "SHA512") alg = "SHA-512";
        else alg = "SHA-1";
        var d = parseInt(u.searchParams.get("digits") || "6", 10);
        var p = parseInt(u.searchParams.get("period") || "30", 10);
        return {
          secret: secret,
          digits: (isNaN(d) || d < 4 || d > 10) ? 6 : d,
          period: (isNaN(p) || p < 1) ? STEP : p,
          algorithm: alg
        };
      } catch (e) {
        return null;
      }
    }
    var bare = raw.replace(/[\s-]+/g, "");
    if (!/^[A-Za-z2-7=]+$/.test(bare)) return null;
    return { secret: bare, digits: 6, period: STEP, algorithm: "SHA-1" };
  }

  /* =====================================================================
   * 3. 通过官方 DI 容器解密 /api/sync 中的密文
   * ===================================================================== */

  function container() {
    return window.bitwardenContainerService || null;
  }

  /* decryptString 只读 encryptedString + encryptionType, 故构造 shim */
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
   * 4. 建立 TOTP 索引
   * ===================================================================== */

  var index = [];            // [{id,label,username,name,secret,digits,period,algorithm}]
  var indexBuiltFor = null;
  var deletedIds = {};       // 本地已删除(移入回收站)的 id, 防止 SYNC 未刷新时又出现

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
      if (!c || !c.id || c.deletedDate) continue;
      if (deletedIds[c.id]) continue;

      var login = c.login;
      if (!login || !login.totp) continue;

      /* 组织条目用独立 cipher key 加密, 需额外一轮密钥派生, 这里跳过并计数 */
      if (c.key) { skippedOrg++; continue; }

      var rawTotp = await dec(es, userKey, login.totp);
      var p = parseTotp(rawTotp);
      if (!p) continue;

      var label = await dec(es, userKey, c.name);
      var user = login.username ? await dec(es, userKey, login.username) : "";

      out.push({
        id: c.id,
        label: label || "(未命名)",
        username: user || "",
        name: norm(label),
        secret: p.secret,
        digits: p.digits,
        period: p.period,
        algorithm: p.algorithm
      });
    }

    index = out;
    console.log(LOG, "索引完成, 带验证码的条目:", out.length,
      skippedOrg ? "(跳过组织条目 " + skippedOrg + " 个)" : "");
    return true;
  }

  /* =====================================================================
   * 5. 行匹配
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
    var td = row.cells && row.cells[2];
    var txt = td ? norm(td.innerText) : "";
    for (var i = 0; i < index.length; i++) {
      if (index[i].name !== name) continue;
      if (!fallback) fallback = index[i];
      if (index[i].username && txt.indexOf(norm(index[i].username)) !== -1) return index[i];
    }
    return fallback;
  }

  /* 操作菜单所在的单元格(通常最后一个 td) */
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

  /* =====================================================================
   * 6. TOTP 徽章: 下边缘 = 剩余时间进度条, 中间截断处显示秒数
   * ===================================================================== */

  function ensureStyle() {
    if (document.getElementById("warden-totp-style")) return;
    var s = document.createElement("style");
    s.id = "warden-totp-style";
    s.textContent =
      ".warden-totp-code{position:relative;display:inline-flex;flex-direction:column;" +
      "align-items:center;justify-content:center;box-sizing:border-box;" +
      "min-width:84px;padding:3px 9px 13px;border:1px solid #b9cdf3;border-bottom:none;" +
      "border-radius:7px 7px 0 0;background:#eef3ff;cursor:pointer;" +
      "user-select:none;-webkit-tap-highlight-color:transparent}" +
      ".warden-totp-code:hover{background:#e3ecff}" +
      ".warden-totp-digits{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:13px;font-weight:700;letter-spacing:.05em;color:#175ddc;line-height:1.25;white-space:nowrap}" +
      ".warden-totp-sec{position:absolute;left:50%;transform:translateX(-50%);bottom:-2px;" +
      "background:#eef3ff;padding:0 4px;border-radius:2px;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:10px;font-weight:700;line-height:1.5;color:#175ddc;opacity:.8}" +
      ".warden-totp-meter{position:absolute;left:-1px;right:-1px;bottom:0;height:3px;" +
      "border-radius:0 0 6px 6px;background:#cfdefa;overflow:hidden}" +
      ".warden-totp-meter>i{display:block;height:100%;width:100%;background:#175ddc;" +
      "transition:width .9s linear}" +
      ".warden-totp-low{border-color:#f0b4b4;background:#fdecec}" +
      ".warden-totp-low .warden-totp-digits,.warden-totp-low .warden-totp-sec{color:#c62828}" +
      ".warden-totp-low .warden-totp-sec{background:#fdecec}" +
      ".warden-totp-low .warden-totp-meter{background:#f6d3d3}" +
      ".warden-totp-low .warden-totp-meter>i{background:#e24b4a}" +
      ".warden-totp-copied{background:#dff3e6!important;border-color:#9fd8b6!important}" +
      ".warden-totp-copied .warden-totp-digits{color:#1b7a44!important}";
    document.head.appendChild(s);
  }

  function paintBadgeStructure(el) {
    if (el.__built) return;
    el.__built = true;
    el.textContent = "";

    var digits = document.createElement("span");
    digits.className = "warden-totp-digits";
    digits.textContent = "--- ---";

    var meter = document.createElement("span");
    meter.className = "warden-totp-meter";
    var fill = document.createElement("i");
    meter.appendChild(fill);

    var sec = document.createElement("span");
    sec.className = "warden-totp-sec";
    sec.textContent = "--";

    el.appendChild(digits);
    el.appendChild(meter);
    el.appendChild(sec);
    el.__digits = digits;
    el.__fill = fill;
    el.__sec = sec;
  }

  /* 换码(仅在跨越 30s 步长时调用, 避免每秒做一次 HMAC) */
  async function refreshCode(el) {
    var period = parseFloat(el.dataset.period) || STEP;
    var step = Math.floor(Date.now() / 1000 / period);
    if (el.__step === step && el.__code) return;

    var code = await totpAt(
      el.dataset.secret,
      parseInt(el.dataset.digits, 10) || 6,
      period,
      el.dataset.algorithm || "SHA-1"
    );
    if (!code) return;
    el.__step = step;
    el.__code = code;
    el.dataset.code = code;
    if (el.__digits) el.__digits.textContent = groupCode(code);
  }

  /* 时间条/秒数: 每秒更新, 不做加密运算 */
  function paintTimer(el) {
    var period = parseFloat(el.dataset.period) || STEP;
    var now = Math.floor(Date.now() / 1000);
    var remain = period - (now % period);

    if (el.__sec) el.__sec.textContent = String(remain);
    if (el.__fill) el.__fill.style.width = (remain / period * 100).toFixed(1) + "%";
    el.classList.toggle("warden-totp-low", remain <= 5);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("execCommand failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function flashCopied(el) {
    var prev = { digits: el.__digits ? el.__digits.textContent : "" };
    el.classList.add("warden-totp-copied");
    if (el.__digits) el.__digits.textContent = "已复制";
    setTimeout(function () {
      el.classList.remove("warden-totp-copied");
      if (el.__digits) el.__digits.textContent = prev.digits || groupCode(el.dataset.code);
    }, 700);
  }

  function bindCopy(el, getCode) {
    function doCopy(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      var code = getCode();
      if (!code) return;
      copyText(code).then(function () {
        flashCopied(el);
      }).catch(function () {
        try {
          var r = document.createRange();
          r.selectNodeContents(el);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e) { /* ignore */ }
      });
    }
    el.addEventListener("click", doCopy);
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") doCopy(ev);
    });
  }

  function makeBadge(c) {
    var el = document.createElement("span");
    el.className = "warden-totp-code";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "点击复制验证码");
    el.dataset.secret = c.secret;
    el.dataset.digits = c.digits || 6;
    el.dataset.period = c.period || STEP;
    el.dataset.algorithm = c.algorithm || "SHA-1";
    paintBadgeStructure(el);
    bindCopy(el, function () { return el.dataset.code || ""; });
    refreshCode(el);
    paintTimer(el);
    return el;
  }

  function insertTotp(row, c) {
    if (row.querySelector(".warden-totp-code")) return;
    var menu = menuCell(row);
    if (!menu) return;

    menu.classList.add("warden-totp-host");
    menu.insertBefore(makeBadge(c), menu.firstChild);
  }

  /* =====================================================================
   * 7. "选择"按钮 + 选择模式
   *    应用自带每行复选框(aria-label="选择密码库项目")与表头全选(aria-label="全选"),
   *    平时用 CSS 把这两列塌缩为 0, 进入选择模式再放出来。
   * ===================================================================== */

  var selecting = false;

  function ensureSelectBar() {
    if (document.getElementById("warden-selbar")) return;
    var items = document.querySelector("app-vault-items");
    var host = items ? items.parentNode : null;
    if (!host || !items) return;

    var bar = document.createElement("div");
    bar.id = "warden-selbar";
    bar.className = "warden-selbar";

    var seed = document.createElement("button");
    seed.type = "button";
    seed.className = "warden-selbar-toggle";
    seed.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 7l4.5 5L4 17"/><path d="M12 19h8"/></svg><span>选择</span>';
    seed.addEventListener("click", function (ev) {
      ev.stopPropagation();
      setSelecting(!selecting);
    });

    bar.appendChild(seed);
    host.insertBefore(bar, items);
  }

  function setSelecting(on) {
    selecting = on;
    document.body.classList.toggle("warden-selecting", on);
    if (!on) uncheckAll();
    updateSelbar();
  }

  function uncheckAll() {
    var boxes = document.querySelectorAll(
      'tr[appvaultcipherrow] input[type="checkbox"]:checked, thead input[type="checkbox"]:checked'
    );
    for (var i = 0; i < boxes.length; i++) {
      try { boxes[i].click(); } catch (e) { /* ignore */ }
    }
  }

  function checkedRows() {
    var out = [];
    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    for (var i = 0; i < rows.length; i++) {
      var cb = rows[i].querySelector('input[type="checkbox"]');
      if (cb && cb.checked) out.push(rows[i]);
    }
    return out;
  }

  /* =====================================================================
   * 8. 底部批量操作条
   * ===================================================================== */

  function ensureBulkBar() {
    if (document.getElementById("warden-bulkbar")) return;

    var bar = document.createElement("div");
    bar.id = "warden-bulkbar";
    bar.className = "warden-bulkbar";

    var all = document.createElement("button");
    all.type = "button";
    all.className = "warden-bulk-all";
    all.addEventListener("click", function () {
      var head = document.querySelector('thead input[aria-label="全选"]');
      if (head) head.click();
    });

    var count = document.createElement("span");
    count.className = "warden-bulk-count";

    var del = document.createElement("button");
    del.type = "button";
    del.className = "warden-bulk-del";
    del.textContent = "移入回收站";
    del.addEventListener("click", bulkTrash);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "warden-bulk-cancel";
    close.textContent = "取消";
    close.addEventListener("click", function () { setSelecting(false); });

    bar.appendChild(all);
    bar.appendChild(count);
    bar.appendChild(del);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  function updateSelbar() {
    ensureBulkBar();
    var bar = document.getElementById("warden-bulkbar");
    if (!bar) return;

    if (!selecting) {
      bar.classList.remove("warden-bulk-on");
      return;
    }
    var rows = checkedRows();
    var total = document.querySelectorAll("tr[appvaultcipherrow]").length;

    bar.classList.add("warden-bulk-on");
    bar.querySelector(".warden-bulk-count").textContent = "已选 " + rows.length + " 项";
    var all = bar.querySelector(".warden-bulk-all");
    all.textContent = (total && rows.length === total) ? "取消全选" : "全选";
    bar.querySelector(".warden-bulk-del").disabled = rows.length === 0;
  }

  async function bulkTrash() {
    var rows = checkedRows();
    if (!rows.length) return;

    var ids = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var c = findCipher(rows[i]);
      if (c && c.id && !seen[c.id]) { seen[c.id] = 1; ids.push(c.id); }
    }
    if (!ids.length) {
      window.alert("无法确定选中条目的 ID, 已取消操作。");
      return;
    }
    if (!AUTH) {
      window.alert("未取得会话令牌, 请刷新页面后重试。");
      return;
    }
    if (!window.confirm("将选中的 " + ids.length + " 个项目移入回收站？\n\n可在「回收站」中恢复。")) return;

    var del = document.querySelector("#warden-bulkbar .warden-bulk-del");
    if (del) { del.disabled = true; del.textContent = "处理中…"; }

    try {
      var resp = await fetch("/api/ciphers/delete", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ ids: ids })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      for (var k = 0; k < ids.length; k++) deletedIds[ids[k]] = 1;
      index = index.filter(function (e) { return !deletedIds[e.id]; });

      for (var j = 0; j < rows.length; j++) {
        if (rows[j].parentNode) rows[j].parentNode.removeChild(rows[j]);
      }
      if (window.__wardenAuthRerender) window.__wardenAuthRerender();
      setSelecting(false);
      toast("已移入回收站 (" + ids.length + " 项)");
    } catch (e) {
      window.alert("删除失败：" + (e && e.message ? e.message : e));
    } finally {
      if (del) { del.disabled = false; del.textContent = "移入回收站"; }
      updateSelbar();
    }
  }

  function toast(msg) {
    var t = document.getElementById("warden-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "warden-toast";
      t.className = "warden-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("warden-toast-on");
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.classList.remove("warden-toast-on"); }, 2400);
  }

  /* =====================================================================
   * 9. 独立的"验证码"页(复刻 Bitwarden Authenticator 的卡片式列表)
   * ===================================================================== */

  var authOpen = false;

  function ensureAuthView() {
    if (document.getElementById("warden-authview")) return;

    var v = document.createElement("div");
    v.id = "warden-authview";
    v.className = "warden-authview";

    var head = document.createElement("div");
    head.className = "warden-auth-head";
    var h = document.createElement("div");
    h.className = "warden-auth-title";
    h.textContent = "验证码";
    head.appendChild(h);

    var search = document.createElement("input");
    search.type = "search";
    search.className = "warden-auth-search";
    search.placeholder = "搜索条目";
    search.addEventListener("input", renderAuthList);
    head.appendChild(search);

    var list = document.createElement("div");
    list.className = "warden-auth-list";
    list.id = "warden-auth-list";

    v.appendChild(head);
    v.appendChild(list);
    document.body.appendChild(v);

    window.__wardenAuthRerender = renderAuthList;
  }

  function renderAuthList() {
    var list = document.getElementById("warden-auth-list");
    if (!list) return;

    var q = "";
    var input = document.querySelector(".warden-auth-search");
    if (input) q = norm(input.value);

    var items = index.filter(function (c) {
      if (!q) return true;
      return c.name.indexOf(q) !== -1 || norm(c.username).indexOf(q) !== -1;
    });

    var subtitle = document.querySelector(".warden-auth-count");
    if (subtitle) subtitle.textContent = String(index.length);

    list.textContent = "";

    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "warden-auth-empty";
      empty.textContent = index.length ? "没有匹配的条目" : "还没有带验证码的条目";
      list.appendChild(empty);
      return;
    }

    var card = document.createElement("div");
    card.className = "warden-auth-card";

    for (var i = 0; i < items.length; i++) {
      (function (c) {
        var row = document.createElement("div");
        row.className = "warden-auth-row";

        var meta = document.createElement("div");
        meta.className = "warden-auth-meta";
        var nm = document.createElement("div");
        nm.className = "warden-auth-name";
        nm.textContent = c.label;                       // 用户数据 -> textContent
        var un = document.createElement("div");
        un.className = "warden-auth-user";
        un.textContent = c.username || "—";
        meta.appendChild(nm);
        meta.appendChild(un);

        var badge = makeBadge(c);
        badge.classList.add("warden-auth-badge");

        row.appendChild(meta);
        row.appendChild(badge);
        card.appendChild(row);
      })(items[i]);
    }
    list.appendChild(card);
    tickAll();
  }

  function openAuthView() {
    authOpen = true;
    ensureAuthView();
    renderAuthList();
    document.body.classList.add("warden-authview-on");
    updateTabbar();
  }

  function closeAuthView() {
    authOpen = false;
    document.body.classList.remove("warden-authview-on");
    updateTabbar();
  }

  /* =====================================================================
   * 10. 底部标签栏
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
    { key: "totp", label: "验证码", route: "/vault", auth: true },
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
      if (key === "totp") active = authOpen;
      else if (key === "vault") active = onVault && !authOpen;
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
          if (t.auth) {
            if (!onVault) location.hash = "#/vault";
            openAuthView();
          } else {
            closeAuthView();
            if (!(t.key === "vault" && onVault)) location.hash = "#" + t.route;
          }
        });
        bar.appendChild(a);
      })(TABS[i]);
    }
    document.body.appendChild(bar);
    updateTabbar();
  }

  /* =====================================================================
   * 11. 每秒 tick
   * ===================================================================== */

  function tickAll() {
    var badges = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < badges.length; i++) paintTimer(badges[i]);
  }

  async function refreshCodes() {
    var badges = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < badges.length; i++) {
      try { await refreshCode(badges[i]); } catch (e) { /* 忽略单行错误 */ }
    }
  }

  /* =====================================================================
   * 12. 装饰列表 + 主循环
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

    ensureSelectBar();
    ensureTabbar();
  }

  async function boot() {
    if (!SYNC) return;
    if (SYNC !== indexBuiltFor) {
      var ok = await buildIndex(SYNC);
      if (ok) indexBuiltFor = SYNC;
      else return;
    }
    await decorate();
  }

  function init() {
    ensureStyle();
    ensureBulkBar();
    onFirstSync(function () { boot(); });
    boot();

    window.addEventListener("hashchange", function () {
      updateTabbar();
      if (currentRoute().indexOf("/vault") !== 0) closeAuthView();
    });

    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.type === "checkbox") updateSelbar();
    }, true);

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && selecting) setSelecting(false);
    });

    setInterval(function () {
      tickAll();
      refreshCodes();
    }, 1000);
    setInterval(function () { boot(); }, 2000);

    var observer = new MutationObserver(function () {
      clearTimeout(window.__wardenScanT);
      window.__wardenScanT = setTimeout(function () { boot(); }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log(LOG, "injected (v3)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
