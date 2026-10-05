# lceda-pcb-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org)
[English](README.en.md) | 简体中文

用 **AI + 嘉立创 EDA MCP** 自动生成 PCB 的工具链与示例工程。

本项目不是为了"手动画一块板"，而是验证一条**端到端自动化链路**：从自然语言意图出发，
经由 MCP Server → Bridge → 嘉立创 EDA 专业版，自动完成「放置元件 → 赋网络 → 布线 →
铺铜 → 保存 → 导出制造文件」全流程，并把成果（Gerber / BOM / 网表 / 3D 模型）直接落盘，
可立即拿去打样。

> 本项目是 [jlcmcp](https://github.com/hyl64/jlcmcp)（嘉立创 EDA MCP Server，MIT）的上层
> 工具链与示例。它不重新实现 MCP Server，而是补齐**工程化交付**所需的部分：制造文件导出、
> 板面几何体检、异步 DRC，以及一个完整的真实示例。

---

## 架构

```
┌─────────────┐   stdio    ┌──────────────────┐  HTTP /execute  ┌──────────────────────┐
│  AI 助手     │ ─────────▶ │  jlcmcp          │ ────────────────▶│  Bridge Server        │
│  (WorkBuddy)│            │  (MCP Server)    │                  │  127.0.0.1:49620-29  │
└─────────────┘            └──────────────────┘                  └──────────┬───────────┘
                                                                   WebSocket /eda │
                                                                           ▼
                                                              ┌──────────────────────────┐
                                                              │ 嘉立创 EDA 专业版          │
                                                              │ Run API Gateway 扩展      │
                                                              │ eda.* 扩展 API             │
                                                              └──────────────────────────┘
```

本地脚本（`scripts/`）绕过 MCP 工具 30s 超时，直连 Bridge 的 `/execute` 接口，适合
跑耗时操作（大文件导出、DRC 轮询）。

---

## 前置条件

1. **嘉立创 EDA 专业版 V3.2+ 桌面客户端**（网页版不在官方支持范围）。
2. 扩展广场安装官方扩展 **Run API Gateway**
   （`https://jlcext.com/item/oshwhub-official/run-api-gateway`）。
3. 在 EDA 内：**高级 → 扩展管理器 → Run API Gateway → 配置 → 勾选「允许外部交互」**，
   并打开目标工程（顶部出现 **API Gateway** 菜单即表示已连上 Bridge）。
4. **Node.js 18+**（仅用于本地脚本；MCP Server 自带运行时）。
5. 本机部署 **jlcmcp** MCP Server，并在你的 MCP 客户端（如 WorkBuddy）中**信任**该连接器。

安装 jlcmcp：

```bash
git clone https://github.com/hyl64/jlcmcp
cd jlcmcp
# 国内镜像，避免默认源卡死
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
npx tsc
```

---

## 快速开始

1. 把 `mcp.json.example` 复制为你的 MCP 配置文件（WorkBuddy 在 `~/.workbuddy/mcp.json`，
   Claude Desktop 在 `claude_desktop_config.json`），并把 `args[0]` 改成 jlcmcp 的
   `dist/index.js` 绝对路径：

   ```json
   {
     "mcpServers": {
       "jlceda": {
         "command": "node",
         "args": ["/absolute/path/to/jlcmcp/dist/index.js"],
         "env": { "AUTO_SPAWN_BRIDGE": "true", "KILL_BRIDGE_ON_EXIT": "0" },
         "disabled": false
       }
     }
   }
   ```

2. 在 MCP 客户端里**信任** `jlceda` 连接器（未信任时工具不会出现）。
3. 打开嘉立创 EDA 工程，确认顶部出现 **API Gateway** 菜单。
4. 让 AI 用 `pcb_*` / `sch_*` 工具（或本项目脚本）开始操作。

---

## 脚本用法

所有脚本零第三方依赖，只需 Node 18+。

### 导出制造文件

```bash
node scripts/export-fab.mjs                  # 导出到 examples/<工程名>/fabrication/
node scripts/export-fab.mjs ./my-out        # 导出到指定目录
node scripts/export-fab.mjs ./my-out --no-step   # 跳过约 20MB 的 STEP 导出
```

导出：Gerber 压缩包、BOM（xlsx）、网表（.enet）、STEP 3D 模型。
输出文件名前缀自动取自当前打开的工程名（如 `TitrationCtrl_Gerber.zip`）。

### 板面几何体检（连通性 + 异网间距）

```bash
node scripts/analyze-board.mjs             # 默认安全间距 6 mil
node scripts/analyze-board.mjs 8           # 自定义间距
```

把全部铜皮拉到本地做并查集连通性检查与异网最近距离计算，1 秒内完成，是 DRC 的轻量替代。
**已知局限**：不读取铺铜(Pour)形状，GND 等靠铺铜连通的网络会误报"多簇"，最终判定请用 EDA DRC。

### 异步 DRC

```bash
node scripts/poll-drc.mjs                  # 默认轮询 30 次（每次 3s）
node scripts/poll-drc.mjs 60               # 加长轮询
```

绕开单次调用 30s 超时：不 await 地启动 `eda.pcb_Drc.check()`，再轮询全局变量拿真值。

---

## 示例工程：TitrationCtrl

`examples/TitrationCtrl/` 是一块**基于分光光度计的自动滴定仪控制板**，作为端到端验证的物证：

| 位号 | 器件 | 功能 |
|------|------|------|
| U1 | STM32F103C8T6 | 主控 MCU |
| U2 | ADS1115 (16-bit) | 光电信号 ADC |
| U3 | LM358 | 光电前置放大 |
| U4 | A4988 | 滴定泵步进驱动 |
| U5 | DRV8833 | 搅拌直流电机驱动 |
| U6 | MAX485 | RS485 上报 |
| U7 | AMS1117-3.3 | 3.3V LDO |
| DC1 | DC-005 | 电源输入座 |

板框 75.1 × 49.8 mm（2960 × 1960 mil），两层板，顶层/底层 GND 铺铜。
导出物位于 `examples/TitrationCtrl/fabrication/`：

- `TitrationCtrl_Gerber.zip` — 14 个 Gerber 层文件，CRC 校验通过
- `TitrationCtrl_BOM.xlsx` — 物料清单
- `TitrationCtrl_Netlist.txt` — 网络表
- `TitrationCtrl_3D.step` — 3D STEP 模型（约 22MB，未纳入 git，可用 `export-fab` 重新生成）

> 该示例由 AI 自主设计、自动放置/布线/铺铜并导出，**用于验证链路可行性**，不保证电气正确性。

板子布局示意见 [examples/TitrationCtrl/layout.svg](examples/TitrationCtrl/layout.svg)。

---

## 目录结构

```
lceda-pcb-automation/
├── README.md                 # 本文件
├── README.en.md              # English
├── LICENSE                   # MIT
├── .gitignore
├── mcp.json.example          # MCP 配置模板
├── package.json
├── scripts/
│   ├── _bridge.mjs           # 直连 Bridge 的共享模块
│   ├── export-fab.mjs        # 导出制造文件
│   ├── analyze-board.mjs     # 板面几何体检
│   └── poll-drc.mjs          # 异步 DRC
├── docs/
│   └── api-notes.md          # eda.* API 实战踩坑
└── examples/
    └── TitrationCtrl/
        ├── README.md
        ├── layout.svg
        ├── TitrationCtrl_BOM.xlsx
        ├── TitrationCtrl_Netlist.txt
        └── fabrication/
            ├── TitrationCtrl_Gerber.zip
            └── TitrationCtrl_3D.step    # 未纳入 git，export-fab 重新生成
```

---

## 贡献

欢迎 Issue / PR：新脚本、更多示例工程、对 `docs/api-notes.md` 的补充。请保持零第三方依赖（仅用 Node 内置 API）。

## 许可证

[MIT](./LICENSE) © 2026 Yueqi-Wang-795

---

## 致谢

- [hyl64/jlcmcp](https://github.com/hyl64/jlcmcp) — 嘉立创 EDA MCP Server
- 立创/嘉立创官方 **Run API Gateway** 扩展
