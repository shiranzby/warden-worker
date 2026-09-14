/**
 * 第八批运行期验证用的 webpack-dev-server 包装配置。
 *
 * 为什么需要它: `shypwd.cc.cd` 在**本机直连不通**(curl 直连 HTTP=000, 经 127.0.0.1:7890
 * 才 200), 而 webpack-dev-server 的 `proxy` 用的是 http-proxy-middleware, **不读**
 * 系统/环境变量里的 HTTP(S)_PROXY —— 结果 `/api/*`、`/identity/*` 全部 504
 * ("Error occurred while trying to proxy"), 表现是登录页填完主密码毫无反应、页面不动。
 *
 * 这里把上游代理作为 `agent` 挂到每一条 proxy 规则上, 而**不动 fork 源码**
 * (webpack.base.js 是仓库文件, 不该为了本地跑测试而改)。
 *
 * ⚠️ 两个坑:
 *   ① `https-proxy-agent@9` 是 `"type":"module"` 的纯 ESM 包 —— `require()` 会报
 *      "Cannot find module .../https-proxy-agent"(踩过一次)。所以用动态 `import()`,
 *      并把配置导出成 **async 函数**(webpack-cli 支持 await 配置函数返回的 Promise)。
 *   ② 路径要用 `pathToFileURL()` 转成 file:// URL, Windows 盘符路径不能直接丢给 import。
 *
 * 用法(在 apps/web 下):
 *   npx webpack serve --config <这个文件的绝对路径> --port 8099
 */
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = "F:/WorkSpace/Workbuddy/Github项目分析部署/vw_web_builds";
const APP = path.join(ROOT, "apps/web");
const PROXY = process.env.SHYPROXY || "http://127.0.0.1:7890";

const realConfig = require(path.join(APP, "webpack.config.js"));

let agentPromise = null;
function getAgent() {
  if (!agentPromise) {
    const entry = path.join(ROOT, "node_modules/https-proxy-agent/dist/index.js");
    agentPromise = import(pathToFileURL(entry).href).then((m) => new m.HttpsProxyAgent(PROXY));
  }
  return agentPromise;
}

module.exports = async (env, argv) => {
  const cfg = realConfig(env, argv);
  const agent = await getAgent();
  const list = cfg.devServer && cfg.devServer.proxy;

  if (Array.isArray(list)) {
    for (const rule of list) {
      rule.agent = agent;
    }
    console.log(`[b8-devcfg] 已给 ${list.length} 条 devServer.proxy 规则挂上上游代理 ${PROXY}`);
  } else {
    console.log("[b8-devcfg] ⚠️ 没找到 devServer.proxy 数组, 上游代理未生效");
  }
  return cfg;
};
