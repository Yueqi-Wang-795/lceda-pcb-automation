// scripts/_bridge.mjs
// 直连本机 jlcmcp Bridge Server（127.0.0.1:49620-49629），把任意 JS 代码转发到
// 已连接的嘉立创 EDA 专业版客户端中执行，并取回结果。
//
// 链路: 本脚本 -> HTTP POST /execute -> Bridge Server -> WebSocket /eda -> Run API Gateway 扩展 -> EDA
//
// 仅依赖 Node 18+ 内置的 fetch / AbortController，零第三方依赖。

/**
 * 在 49620-49629 端口池中扫描 Bridge Server。
 * @returns {{port:number, activeWindowId:string}|null}
 */
export async function findBridge() {
  for (let p = 49620; p <= 49629; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
      const j = await r.json();
      if (j && j.service === 'easyeda-bridge') {
        return { port: p, activeWindowId: j.activeWindowId || null };
      }
    } catch (e) {
      // 端口未监听，继续扫下一个
    }
  }
  return null;
}

/**
 * 在 EDA 客户端内执行一段 JS（支持 await，以 return 返回结果）。
 * @param {number} port        Bridge 端口
 * @param {string} code        JS 源码
 * @param {string} [windowId]  目标 EDA 窗口 ID（默认活动窗口）
 * @param {number} [timeoutMs] 超时（默认 28s，绕开 MCP 工具 30s 硬限制）
 */
export async function execOnEda(port, code, windowId, timeoutMs = 28000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, windowId }),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'execute failed');
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
