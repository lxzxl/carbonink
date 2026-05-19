# 测试用资料与数据

本目录与 `tests/fixtures/smoke/` 一起提供完整的端到端手工测试材料。本 README 按"我要测哪个流程"组织。

## 一次性准备

1. **启动应用 + 完成 onboarding 创建组织 + 首个 site**（首次运行）
   ```bash
   pnpm dev
   ```
   走完向导后回到此终端继续。

2. **种入 2025 活动数据 + 排放源 + reporting period**
   ```bash
   node scripts/seed-test-data.mjs
   ```
   - 幂等：重跑安全，已存在的行会跳过
   - 写入 `~/Library/Application Support/carbonbook/app.sqlite`（macOS）
   - 自定义路径用 `--db /path/to/app.sqlite`
   - 写入：1 个 2025 reporting_period · 5 个 emission_source · 8 条 activity_data（约 95k kWh 电、2.4k L 柴油、4.2k m³ 天然气、出差 86k passenger-km）

3. **重启 app**（看到种好的数据）

   仪表盘应该显示非零 scope 1/2/3 排放、`/活动数据` 看到 8 条记录。

---

## 流程 A：5 个 PDF 抽取阶段（Phase 1d）

每个 stage 的合成发票/单据 PDF。所有都用 `scripts/generate-smoke-fixtures.mjs` 由 HTML 渲染生成，可重生：

| 文件 | 阶段 | 关键字段 |
|---|---|---|
| `tests/fixtures/smoke/01-utility-sample.pdf` | `china_utility.v1` | 国家电网, 1234.56 kWh, 678.50 元 |
| `tests/fixtures/smoke/02-fuel-receipt-sample.pdf` | `fuel_receipt.v1` | 中石化, 0号柴油, 45.60 升 |
| `tests/fixtures/smoke/03-freight-sample.pdf` | `freight.v1` | 顺丰, 北京→上海, 1500 kg, 2800 元 |
| `tests/fixtures/smoke/04-purchase-sample.pdf` | `purchase.v1` | 宝钢, 冷轧钢板 5000 kg, 25000 元 |
| `tests/fixtures/smoke/05-travel-sample.pdf` | `travel.v1` | 国航 CA1234, 经济舱, 北京→上海 |

**走法**：`/文档` → 上传 PDF → 自动分类（也可手动选阶段）→ 点行进入 review → 验证字段 → 选 emission source → 看推荐 EF → Confirm → 仪表盘看新增 activity_data。

---

## 流程 B：问卷（Phase 2.2 + Routing）

**问卷模板**：`samples/test-questionnaire-2025.xlsx`（13 道题，三个 sheet — 公司信息 / 温室气体排放 / 能源与水耗）

重生：`node scripts/generate-test-questionnaire.mjs`

**走法**：
1. `/问卷` → `新建问卷`
2. 客户名称随便（如"测试客户A"）·年度 `2025` ·选择 `test-questionnaire-2025.xlsx`
3. `上传 Excel 并解析` → 跳到详情页
4. 顶部不应出现"暂无活动数据"banner（因为已种 2025 数据）
5. 单题 `生成答案` → AI 用库存数据推断 → 填回数值
6. 批量 `生成所有未答` → 并发 3 处理剩余题
7. 编辑数值 → `保存并定稿`
8. `导出 Excel` → 选保存位置 → 检查导出的 .xlsx 是否填回了答案

---

## 流程 C：路由 API（freight / 出差距离）

需要 AMap key。`/设置` → 填写 `高德 API key`（[免费申请](https://lbs.amap.com/dev/)，10 万次/日额度）。

走法（在某个 freight 抽取的 ActivityForm 或 travel 行）：
- `起点` / `终点` 填好，`distance_km` 留空
- 点 `查询距离` →
  - 陆运/打车 → AMap driving / transit → 返回 km
  - 飞机（用 IATA 代码如 `PEK`、`JFK`）→ 本地 haversine

---

## 清空 / 重置

不想动 SQL 的话，关掉 app 后直接：
```bash
rm ~/Library/Application\ Support/carbonbook/app.sqlite
```
下次启动重新走 onboarding。

或只清问卷与答案：
```bash
sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite \
  "DELETE FROM answer; DELETE FROM question; DELETE FROM questionnaire;"
```

---

## 已知行为

- **`生成答案` 在 inventory 为空时报 `InventoryEmpty`**：是预期。先 `node scripts/seed-test-data.mjs`。
- **LLM 返回 `value=""`** 时不再保存空答案、抛 `LLMNoData`：是 `df1507e` 的修复。卡片保持"尚未生成"+ 红色"上次失败"小框。
- **AMap key 没填**：`routing:lookup` 报 `AmapApiKeyMissing`，UI toast "AMap API key not configured"。
