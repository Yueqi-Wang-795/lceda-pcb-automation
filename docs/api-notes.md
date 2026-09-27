# eda.* API 实战踩坑笔记

本文档记录在用 **jlcmcp + Run API Gateway** 驱动嘉立创 EDA 专业版画图时，从官方
`eda.*` 扩展 API 中踩到的坑与正确用法。所有代码都通过 `pcb_execute_code`（MCP）
或直连 Bridge `/execute`（见 `scripts/_bridge.mjs`）执行，运行于 EDA 扩展沙盒内。

---

## 1. 对象命名：必须是 `eda.pcb_PrimitivePad`，不是 `eda.pcb_Pad`

`Object.keys(eda)` 能列出全部顶层对象，但**方法挂在原型上**，直接 `Object.keys(eda.pcb_PrimitivePad)`
会返回空数组。要沿原型链枚举：

```js
const list = (o) => { let r=[]; let p=o; while(p && p!==Object.prototype){ r=r.concat(Object.getOwnPropertyNames(p)); p=Object.getPrototypeOf(p);} return r; };
list(eda.pcb_PrimitivePad); // create/delete/modify/get/getAll/getAllPrimitiveId
```

常用对象：`pcb_PrimitivePad / pcb_PrimitiveComponent / pcb_PrimitiveLine / pcb_PrimitiveVia /
pcb_PrimitivePour / pcb_Net / pcb_Drc / pcb_Document / pcb_ManufactureData / sys_FileSystem / sys_FileManager`。

---

## 2. 给焊盘赋网络：用 `pcb_PrimitivePad.modify`，不要用 `pcb_Net.setNetlist`

`setNetlist` 返回 `true` 但**不落盘**（netlist 里 pin 的 net 仍为空）。正确做法：

```js
const comps = await eda.pcb_PrimitiveComponent.getAll();
for (const c of comps) {
  const pins = M[c.designator];          // { padNumber: netName }
  for (const p of c.pads) {
    const net = pins[p.padNumber];
    if (!net) continue;
    await eda.pcb_PrimitivePad.modify(c.primitiveId + p.primitiveId, { net });
  }
}
```

`modify` 的第一个参数是 **`component.primitiveId + pad.primitiveId`**（字符串拼接），不是数组坐标。

---

## 3. 读焊盘属性：MCP 的 `pcb_get_pads` 不可信

`pcb_get_pads` 返回的 `designator / net / parentPrimitiveId` 全是空字符串。要自己用
底层 API 拼映射：

```js
const comps = await eda.pcb_PrimitiveComponent.getAll();
const id2des = {};
for (const c of comps)
  for (const p of c.pads)
    id2des[c.primitiveId + p.primitiveId] = c.designator + '.' + p.padNumber;
```

读单个焊盘坐标/形状用 `eda.pcb_PrimitivePad.getAll()`（每项含 `x, y, net, pad[类型,w,h], hole, layer`）。

---

## 4. `pcb_get_tracks` 的 `width` 恒为 0

该读取接口的 `width` 字段永远返回 0，**不代表真实线宽**。真实线宽在 `pcb_PrimitiveLine.getAll()`
里（`lineWidth` 字段）才是准的。走线时务必显式传 `lineWidth`。

---

## 5. 自动布线两种模式都有坑

| 模式 | 行为 | 问题 |
|------|------|------|
| `two_layer_l` | 双层 + 过孔 | 不同网络的垂直转孔段会叠在同一直角路径上（间距 0） |
| `single_layer_obstacle_aware` | 单层 | 实为直连、不避让，平行网络会重合 |

实测后更靠谱的是：**关键信号手工精布（精确验算坐标 + 脚本校验间距），其余网络用
`two_layer_l` 补，再用 `analyze-board.mjs` 体检**。

`eda.pcb_Document.autoRouting({RoutingNets:[...]})` 在 Node 端会 30s 超时，不推荐。

---

## 6. 导出制造文件：绕开 EDA 路径白名单

`eda.sys_FileSystem.saveFileToFileSystem` 会报 `not of type 'Blob'`，`fetch('app://api/client/writeFileSync')`
返回 `路径不允许`（EDA 只允许白名单目录，且 `getDocumentsPath` 等返回空）。

**可落地方案**：把 `File` 转 base64 后通过 `return` 回传，再在本地解码落盘：

```js
const f = await eda.pcb_ManufactureData.getGerberFile();   // File, 17872 bytes, application/zip
const buf = await f.arrayBuffer();
const u8 = new Uint8Array(buf);
let s = ''; const CH = 0x8000;
for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
return btoa(s);   // 注意：沙盒内 btoa 可用；不要在 MCP 里回传超长字符串（易截断）
```

⚠️ 模型侧回传超长 base64 易被截断 → 更稳妥的是用 `scripts/export-fab.mjs` **直连 Bridge
HTTP 接口**取数据，完全绕开模型转写。

`ManufactureData` 还提供：`getBomFile() / getNetlistFile() / get3DFile() / getPdfFile()`，
分别返回 `File`（BOM 实为 xlsx，重命名为 `.xlsx` 即可用 Excel 打开）。

---

## 7. DRC 超时：用异步轮询

`eda.pcb_Drc.check()` 返回布尔（`false` = 无违规），但板面复杂时运行 >30s，超过 Bridge / MCP 超时。
方案：不 await 地启动，把结果存全局，再轮询：

```js
globalThis.__drc = { done:false };
(async()=>{ try { const r = await eda.pcb_Drc.check(); globalThis.__drc = {done:true, ok:true, value:r}; }
            catch(e){ globalThis.__drc = {done:true, ok:false, err:String(e)}; } })();
return 'started';
// 另一次请求: return globalThis.__drc;
```

`eda.pcb_Drc` 还有 `getRealTimeDrcStatus() / getRuleConfiguration()` 等大量规则配置方法。

---

## 8. 坐标与层 ID 约定

- 坐标单位一律 **mil**。
- 层 ID：1=Top Layer，2=Bottom Layer，3=Top Silkscreen，11=Board Outline，
  12=插件焊盘层，14=Mechanical。
- 铺铜 `pcb_PrimitivePour` 无 re-pour / 灌注公开方法，改完网络后通常需要在 EDA 内手动 re-pour。

---

## 9. 轻量替代 DRC：板面几何体检

`scripts/analyze-board.mjs` 把全部铜皮拉到本地，做并查集连通性 + 异网间距计算，
1 秒内完成。**已知局限**：不读取铺铜(Pour)形状，所以 GND 这类靠大面积铺铜连通的网络
会被判为"多簇"，属误报，需用 EDA 自带 DRC 最终确认。
