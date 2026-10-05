# lceda-pcb-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org)
English | [简体中文](README.md)

A toolchain and example project for **generating PCBs with AI + the JLCPCB/LCEDA EDA MCP**.

This project is not about drawing a board by hand — it verifies an end-to-end automation
pipeline: from a natural-language intent, through MCP Server → Bridge → LCEDA Pro, it
automatically places components, assigns nets, routes traces, pours copper, saves, and exports
fabrication files (Gerber / BOM / netlist / 3D) ready for manufacturing.

> This repo is an upper-layer toolchain and example on top of
> [jlcmcp](https://github.com/hyl64/jlcmcp) (the LCEDA EDA MCP Server, MIT). It does not
> reimplement the server; it adds the engineering glue: fabrication export, board geometry
> analysis, async DRC, and a complete real example.

## Architecture

```
AI assistant ──stdio──▶ jlcmcp (MCP Server) ──HTTP /execute──▶ Bridge (127.0.0.1:49620-29)
                                                                      │ WS /eda
                                                                      ▼
                                                            LCEDA Pro + Run API Gateway
```

The local `scripts/` talk directly to the Bridge `/execute` endpoint, bypassing the 30s
timeout of MCP tools — ideal for long operations (large exports, DRC polling).

## Prerequisites

1. **LCEDA EDA Pro V3.2+ desktop client** (web editor is not officially supported).
2. Install the official **Run API Gateway** extension from the extension marketplace.
3. In EDA: **Advanced → Extension Manager → Run API Gateway → Config → enable "Allow external interaction"**,
   then open a project (the **API Gateway** menu at the top means Bridge is connected).
4. **Node.js 18+** (for local scripts only).
5. Deploy **jlcmcp** and **trust** the connector in your MCP client.

```bash
git clone https://github.com/hyl64/jlcmcp
cd jlcmcp
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
npx tsc
```

## Quick start

1. Copy `mcp.json.example` to your MCP config and set `args[0]` to the absolute path of
   jlcmcp's `dist/index.js`.
2. **Trust** the `jlceda` connector in your MCP client.
3. Open an LCEDA project; confirm the **API Gateway** menu appears.
4. Let the AI drive `pcb_*` / `sch_*` tools, or use the scripts below.

## Scripts (Node 18+, zero dependencies)

| Script | What it does |
|--------|--------------|
| `node scripts/export-fab.mjs [dir] [--no-step]` | Export Gerber / BOM / netlist / STEP 3D (file names auto-prefixed with the project name) |
| `node scripts/analyze-board.mjs [clearance_mil]` | Connectivity + inter-net clearance (local geometry, ~1s) |
| `node scripts/poll-drc.mjs [max_polls]` | Async DRC that bypasses the 30s timeout |

## Example: TitrationCtrl

`examples/TitrationCtrl/` is a **spectrophotometer-based auto-titrator control board**, used as
proof of the end-to-end link. Board 75.1 × 49.8 mm, 2 layers, top/bottom GND pour. Artifacts
in `examples/TitrationCtrl/fabrication/`:

- `TitrationCtrl_Gerber.zip` — 14 Gerber layers, CRC verified
- `TitrationCtrl_BOM.xlsx` — bill of materials
- `TitrationCtrl_Netlist.txt` — netlist
- `TitrationCtrl_3D.step` — 3D STEP model (~22MB; not in git, regenerate via `export-fab`)

> Designed and routed autonomously by AI to validate the pipeline; not guaranteed electrically correct.

## License

[MIT](./LICENSE) © 2026 Yueqi-Wang-795
