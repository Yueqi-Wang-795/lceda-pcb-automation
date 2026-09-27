#!/usr/bin/env node
// scripts/poll-drc.mjs
//
// 异步触发 EDA 的 DRC 检查并轮询结果。
//
// 为什么需要它: 板面较复杂时，eda.pcb_Drc.check() 可能运行 30 秒以上，超过 MCP 工具
// 以及 Bridge 的默认 30s 超时。本脚本改为「不 await 地启动检查」+「另开请求轮询全局变量」，
// 从而突破单次调用超时，拿到最终真值。
//
// 用法: node scripts/poll-drc.mjs [max_polls]

import { findBridge, execOnEda, sleep } from './_bridge.mjs';

const MAX_POLLS = Number(process.argv[2]) || 30;

(async () => {
  const b = await findBridge();
  if (!b) { console.error('未找到 Bridge Server。'); process.exit(1); }
  const port = b.port, win = b.activeWindowId;

  // 1) 不 await 地启动 DRC，结果写入 globalThis.__drc
  await execOnEda(port, `
    globalThis.__drc = { done: false };
    (async () => {
      try {
        const t0 = Date.now();
        const r = await eda.pcb_Drc.check();
        globalThis.__drc = { done: true, ok: true, value: r, ms: Date.now() - t0 };
      } catch (e) {
        globalThis.__drc = { done: true, ok: false, err: String(e) };
      }
    })();
    return 'started';
  `, win);

  // 2) 轮询
  let drc = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(3000);
    try { drc = await execOnEda(port, 'return globalThis.__drc;', win); }
    catch (e) { drc = { pollErr: e.message }; }
    console.log(`poll#${i} -> ${JSON.stringify(drc)}`);
    if (drc && drc.done) break;
  }

  if (drc && drc.done) {
    if (drc.ok) console.log(`\n>>> DRC 完成，check() 返回 ${JSON.stringify(drc.value)}（耗时 ${drc.ms} ms）。false = 无违规。`);
    else console.log(`\n>>> DRC 执行报错: ${drc.err}`);
  } else {
    console.log('\n>>> 轮询超时仍未出结果，可增大 MAX_POLLS 或到 EDA 内手动查看 DRC 面板。');
  }
})();
