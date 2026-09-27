# 示例工程：TitrationCtrl

基于**分光光度计**的自动滴定仪控制板，作为本项目「AI + 嘉立创 EDA MCP 端到端自动化」的验证物证。

## 功能

- 主控 STM32F103C8T6，读取 ADS1115（16 位）光电 ADC，经 LM358 前置放大的分光光度信号
- A4988 驱动滴定泵步进电机，DRV8833 驱动搅拌直流电机
- MAX485 把状态通过 RS485 上报
- AMS1117-3.3 供电，DC-005 直流输入座

## 规格

- 板框：75.1 × 49.8 mm（2960 × 1960 mil）
- 层数：2 层，顶层 / 底层 GND 铺铜
- 元件：8 个（U1–U7 + DC1）
- 网络：26 个；焊盘 114；过孔 49

## 文件

| 文件 | 说明 |
|------|------|
| `TitrationCtrl_BOM.xlsx` | 物料清单 |
| `TitrationCtrl_Netlist.txt` | 网络表（.enet） |
| `fabrication/TitrationCtrl_Gerber.zip` | 14 个 Gerber 层 + 钻孔 + 飞针测试，CRC 通过 |
| `fabrication/TitrationCtrl_3D.step` | 3D STEP 模型（~22MB，未纳入 git） |
| `layout.svg` | PCB 布局示意俯视图 |

## 复现

```bash
# 在嘉立创 EDA 打开本工程后：
node ../../scripts/export-fab.mjs fabrication   # 重新导出制造文件
node ../../scripts/analyze-board.mjs            # 板面几何体检
```

> 该板由 AI 自主设计、自动放置 / 布线 / 铺铜并导出，用于验证链路可行性，不保证电气正确性。
