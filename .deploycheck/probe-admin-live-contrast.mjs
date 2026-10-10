// 一次性探针：在**线上真实页面**上读出徽章的实际渲染色, 实算对比度。
// 存在的理由：静态令牌表已经算过(33/0), 但那算的是 CSS 里的声明; 而"深色模式下巴掌大的
// 灰底徽章里文字到底够不够亮"肉眼分辨不了(截图被缩放后尤其骗人)。按项目规矩「对比度必须实算」,
// 这里直接问浏览器要 resolved 值。
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";

const TOKEN = process.env.ADMIN_TOKEN;
const BASE = "https://shypwd.cc.cd";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  proxy: { server: "http://127.0.0.1:7890", bypass: "localhost,127.0.0.1" },
});

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/admin/", { waitUntil: "domcontentloaded" });
  await page.fill("#gate input", TOKEN);
  await page.locator("#gate button").first().click();
  await page.waitForSelector('#dash:not([hidden]) td[data-label="账号"]', { timeout: 20000 });
  await page.emulateMedia({ colorScheme: scheme });
  await new Promise((r) => setTimeout(r, 500));

  const out = await page.evaluate(() => {
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba?\(0, 0, 0, 0\)/.test(c)) return c;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const lin = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const parse = (s) => {
      const m = s.match(/[\d.]+/g).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] };
    };
    const over = (f, bg) => ({
      r: f.r * f.a + bg.r * (1 - f.a),
      g: f.g * f.a + bg.g * (1 - f.a),
      b: f.b * f.a + bg.b * (1 - f.a),
      a: 1,
    });
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => {
      const l1 = lum(a);
      const l2 = lum(b);
      const hi = l1 > l2 ? l1 : l2;
      const lo = l1 > l2 ? l2 : l1;
      return (hi + 0.05) / (lo + 0.05);
    };

    const res = [];
    const seen = new Set();
    document.querySelectorAll(".badge").forEach((el) => {
      const txt = el.innerText.trim();
      if (seen.has(txt)) return;
      seen.add(txt);
      const cs = getComputedStyle(el);
      const host = el.closest("tr") || el.closest(".panel") || document.body;
      const pageBg = parse(bgOf(host));
      const pill = over(parse(cs.backgroundColor), pageBg);
      res.push({
        txt: txt,
        cls: el.className,
        fg: cs.color,
        pill: cs.backgroundColor,
        cr: +ratio(over(parse(cs.color), pill), pill).toFixed(2),
      });
    });
    // 顺手量一下表格表头与正文的对比度（这两处最容易被"次一级灰"坑掉）
    const probe = (sel, name) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const pageBg = parse(bgOf(el.closest("tr") || el.closest(".panel") || document.body));
      return { name: name, cr: +ratio(over(parse(cs.color), pageBg), pageBg).toFixed(2), fg: cs.color };
    };
    const extra = [probe("thead th", "表头"), probe("td.email", "账号单元格"), probe(".stat .k", "统计卡标签")]
      .filter(Boolean);
    return { badges: res, extra: extra, bodyBg: getComputedStyle(document.body).backgroundColor };
  });

  console.log("");
  console.log("[" + scheme + "] bodyBg=" + out.bodyBg);
  for (const x of out.badges) {
    console.log("  " + String(x.cr).padStart(6) + "  " + x.txt.padEnd(6) + " " + x.cls.padEnd(9) +
      " fg=" + x.fg + " pill=" + x.pill);
  }
  for (const x of out.extra) {
    console.log("  " + String(x.cr).padStart(6) + "  " + x.name + " fg=" + x.fg);
  }
  await ctx.close();
}
await browser.close();
