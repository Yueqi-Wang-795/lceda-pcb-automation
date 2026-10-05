#!/usr/bin/env node
// scripts/export-fab.mjs
//
// 从当前打开的嘉立创 EDA PCB 文档一键导出制造文件：
//   - Gerber 压缩包（顶层/底层/丝印/阻焊/钢网/板框/钻孔/飞针测试）
//   - BOM（xlsx）
//   - 网表（.enet）
//   - STEP 3D 模型（可选，约 20MB）
//
// 输出文件名前缀自动取自当前工程名（如 TitrationCtrl -> TitrationCtrl_Gerber.zip）。
//
// 用法:
//   node scripts/export-fab.mjs                # 导出到 examples/<工程名>/fabrication/
//   node scripts/export-fab.mjs ./my-out      # 导出到指定目录
//   node scripts/export-fab.mjs ./my-out --no-step   # 跳过较大的 STEP 3D 导出
//
// 前置: 嘉立创 EDA 专业版已打开目标工程，且 Run API Gateway 已启用「允许外部交互」，
//       且 jlcmcp MCP Server 已启动（会在首次调用时自动拉起 Bridge）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBridge, execOnEda } from './_bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INCLUDE_STEP = !process.argv.includes('--no-step');
const OUT_DIR = process.argv[2] || null; // 稍后拿到工程名后再定默认目录

// 把 EDA 返回的 File 转 base64 后落盘到本地（绕开 EDA 自身的路径白名单限制）。
async function grabFile(port, windowId, getterExpr, destPath) {
  const code = `
    const f = await ${getterExpr};
    const buf = await f.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return { name: f.name, size: u8.length, b64: btoa(s) };
  `;
  const res = await execOnEda(port, code, windowId, 120000);
  const buf = Buffer.from(res.b64, 'base64');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return { file: destPath, name: res.name, bytes: buf.length };
}

(async () => {
  const b = await findBridge();
  if (!b) {
    console.error('未找到 Bridge Server。请确认：\n  1) 嘉立创 EDA 专业版已打开目标工程\n  2) 已安装 Run API Gateway 扩展并勾选「允许外部交互」\n  3) jlcmcp 已配置并信任');
    process.exit(1);
  }
  console.log(`Bridge @ :${b.port}  活动窗口: ${b.activeWindowId || '(无)'}`);

  // 从 EDA 取当前工程名，作为导出文件名前缀
  let prefix = 'PCB';
  try {
    const info = await execOnEda(
      b.port,
      `const p = await eda.dmt_Project.getCurrentProjectInfo(); return p.name;`,
      b.activeWindowId
    );
    prefix = String(info || '').replace(/^\/+/, '') || 'PCB';
  } catch (e) {
    console.warn(`[提示] 未能读取工程名（${e.message}），使用默认前缀 PCB`);
  }
  prefix = prefix.replace(/[\\/:*?"<>|\s]+/g, '_');

  const OUT = OUT_DIR
    ? path.resolve(OUT_DIR)
    : path.resolve(__dirname, '..', 'examples', prefix, 'fabrication');
  console.log(`工程前缀: ${prefix}  输出目录: ${OUT}`);

  // [标签, eda.* 取值表达式, 导出文件名]
  const TARGETS = [
    ['Gerber', 'eda.pcb_ManufactureData.getGerberFile()', `${prefix}_Gerber.zip`],
    ['BOM', 'eda.pcb_ManufactureData.getBomFile()', `${prefix}_BOM.xlsx`],
    ['Netlist', 'eda.pcb_ManufactureData.getNetlistFile()', `${prefix}_Netlist.txt`],
    ['STEP3D', 'eda.pcb_ManufactureData.get3DFile()', `${prefix}_3D.step`],
  ].filter(([label]) => label !== 'STEP3D' || INCLUDE_STEP);

  for (const [label, expr, fname] of TARGETS) {
    try {
      const r = await grabFile(b.port, b.activeWindowId, expr, path.join(OUT, fname));
      console.log(`  [OK]   ${label.padEnd(8)} -> ${path.relative(process.cwd(), r.file)}  (${r.bytes} B)`);
    } catch (e) {
      console.warn(`  [跳过] ${label}: ${e.message}`);
    }
  }
  console.log('完成。把 Gerber 压缩包发给板厂即可打样。');
})();
