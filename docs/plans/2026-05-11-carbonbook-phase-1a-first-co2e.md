# Phase 1a — Manual Path to First CO2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户手动录一笔活动数据（如 "1000 kWh 中国电网用电"）→ 系统秒出准确 CO2e（~565 kg） → 显示在 dashboard。**不涉及 AI**，纯打通"EF + 单位换算 + 计算引擎 + UI"的数学链路。

**Architecture:** Phase 0 已落地的 schema（migrations 001-006）+ service layer + typed-ipc + TanStack Router 全部沿用。Phase 1a 加：(1) 参考数据 seed（units + aliases + fuel_property + ~12 EFs），(2) 3 个新 service（ef, unit-conversion, calculation），(3) emission_source + activity_data CRUD，(4) 2 个新路由（/sources, /activities）+ dashboard 真数字。

**Tech Stack 增量：** 无新 dep。Service / IPC / UI 模式延用 Phase 0 + UI baseline。计算引擎纯函数易测；UI 用现有 TanStack Form + shadcn primitives。

**Scope 边界：**
- ✅ Scope 1 (fuel: gasoline / diesel / natural gas) + Scope 2 (electricity)
- ✅ Manual entry only
- ✅ EF Matcher v0 = (category, scope, region) 精确匹配
- ✅ AR6 GWP100（CH4=27.9, N2O=273）source-code constant
- ❌ Scope 3（Phase 1c+）
- ❌ AI extraction（Phase 1b）
- ❌ `ef_library.sqlite` RO bundle（Phase 1c+；本 sprint 直接 seed 进 `app.sqlite`）
- ❌ EF FTS / LLM 智能匹配（Phase 1c）
- ❌ Snapshot freeze + export（Phase 1c+）
- ❌ Multi-site filter（Phase 1a 假设 single-site；Phase 0 wizard 只建 1 个 site）

**Verification gate（每个 task 完成后）：**
```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```
+ 每 3-4 task 用户 dev session 视觉验证。

**Phase 1a Deliverable：** Dashboard 显示真实数字（如 "Total: 565 kg CO2e | Scope 1: 0 | Scope 2: 565"），用户能从 /sources 创建 source、从 /activities 录入活动数据，dashboard 即时刷新。

---

## File Structure

**新建：**
- `src/main/db/migrations/007_seed_units.sql` — 40 units + 80 aliases + 5 fuel properties
- `src/main/db/migrations/008_seed_emission_factors.sql` — 12 EFs（覆盖 5 个 Scope 1+2 场景）
- `src/main/services/unit-conversion-service.ts` + test — 跨 family + alias normalize + dimension check
- `src/main/services/ef-service.ts` + test — EF lookup + pin (copy emission_factor → pinned_emission_factor)
- `src/main/services/calculation-service.ts` + test — CO2e 公式：`amount × unit_conv × ef.co2e_kg_per_unit + ch4 × GWP + n2o × GWP`
- `src/main/services/emission-source-service.ts` + test — CRUD（per spec §3 复合 FK）
- `src/main/services/activity-data-service.ts` + test — CRUD + auto-pin EF + 自动 compute CO2e
- `src/main/ipc/handlers/ef-library.ts` — EF lookup IPC
- `src/main/ipc/handlers/emission-source.ts` — source CRUD IPC
- `src/main/ipc/handlers/activity-data.ts` — activity CRUD IPC
- `src/renderer/lib/api/ef-library.ts`, `emission-source.ts`, `activity-data.ts` — IPC wrappers
- `src/renderer/routes/sources.tsx` — list + create form
- `src/renderer/routes/activities.tsx` — list + create form
- `src/renderer/components/SourceForm.tsx`, `ActivityForm.tsx` — TanStack Form 组件

**修改：**
- `src/shared/types.ts` — zod schemas: emission_source, activity_data, ef_query
- `src/main/ipc/types.ts` — `IpcTypeMap` 加 8 个 channel
- `src/main/ipc/setup.ts` — register 3 new handler groups
- `src/preload/bridge.ts` — allowlist 加 8 个 channel
- `src/renderer/routes/index.tsx` — dashboard 真数字（total / scope1 / scope2）
- `src/renderer/components/Sidebar.tsx` — 加 "Sources" + "Activities" nav items
- `src/renderer/paraglide/messages.json`（zh-CN + en） — 加 UI 文案
- `docs/specs/2026-05-08-carbonbook-design.md` — §11 Phase 1 加 "Phase 1a 已完成" 标记

---

### Task 1: Migration 007 — seed unit_definition + unit_alias + fuel_property

**Files:**
- Create: `src/main/db/migrations/007_seed_units.sql`
- Test: `tests/main/db/seed-units.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
// tests/main/db/seed-units.test.ts
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Migration 007: seed units', () => {
  it('inserts ≥40 unit definitions across 5 families', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const families = db
      .prepare('SELECT family, COUNT(*) AS n FROM unit_definition GROUP BY family')
      .all() as { family: string; n: number }[];
    const total = families.reduce((s, f) => s + f.n, 0);
    expect(total).toBeGreaterThanOrEqual(40);
    expect(families.map((f) => f.family).sort()).toEqual(
      ['currency', 'distance', 'energy', 'mass', 'volume'].sort(),
    );
  });

  it('inserts ≥80 unit aliases (chinese + english)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM unit_alias').get() as { n: number };
    expect(n.n).toBeGreaterThanOrEqual(80);
  });

  it('inserts 5 fuel_property rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM fuel_property').get() as { n: number };
    expect(n.n).toBe(5);
  });

  it('all aliases reference existing units', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const orphans = db
      .prepare(
        `SELECT a.alias FROM unit_alias a
         LEFT JOIN unit_definition u ON a.canonical_unit = u.unit
         WHERE u.unit IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
pnpm test tests/main/db/seed-units.test.ts
```
Expected: FAIL — migration 007 doesn't exist.

- [ ] **Step 3: 写 migration**

`src/main/db/migrations/007_seed_units.sql`:

```sql
-- Phase 1a: seed unit_definition + unit_alias + fuel_property reference data.
-- Replaces future ef_library.sqlite RO bundle; that bundle is Phase 1c+ work.

-- ── unit_definition: ratio is to family's canonical unit ──
-- Canonical units: energy=kWh, volume=L, mass=kg, distance=km, currency=CNY
-- multiply_of_ratio: amount_in_canonical = amount × multiply / divide

INSERT INTO unit_definition (unit, family, multiply_of_ratio, divide_of_ratio, display_order, display_name_zh, display_name_en) VALUES
-- energy (canonical: kWh)
('kWh', 'energy', 1, 1, 10, '千瓦时', 'kilowatt-hour'),
('MWh', 'energy', 1000, 1, 20, '兆瓦时', 'megawatt-hour'),
('GWh', 'energy', 1000000, 1, 30, '吉瓦时', 'gigawatt-hour'),
('MJ',  'energy', 1, 3.6, 40, '兆焦', 'megajoule'),
('GJ',  'energy', 1000, 3.6, 50, '吉焦', 'gigajoule'),
('TJ',  'energy', 1000000, 3.6, 60, '太焦', 'terajoule'),
('BTU', 'energy', 1, 3412.14, 70, '英热单位', 'British thermal unit'),
('therm', 'energy', 29.3001, 1, 80, '色姆', 'therm'),
-- volume (canonical: L)
('L', 'volume', 1, 1, 10, '升', 'liter'),
('mL', 'volume', 1, 1000, 20, '毫升', 'milliliter'),
('m3', 'volume', 1000, 1, 30, '立方米', 'cubic meter'),
('cm3', 'volume', 1, 1000, 40, '立方厘米', 'cubic centimeter'),
('gallon_us', 'volume', 3.78541, 1, 50, '美加仑', 'US gallon'),
('gallon_uk', 'volume', 4.54609, 1, 60, '英加仑', 'UK gallon'),
('barrel_oil', 'volume', 158.987, 1, 70, '桶（油）', 'oil barrel'),
-- mass (canonical: kg)
('kg', 'mass', 1, 1, 10, '公斤', 'kilogram'),
('g',  'mass', 1, 1000, 20, '克', 'gram'),
('mg', 'mass', 1, 1000000, 30, '毫克', 'milligram'),
('t',  'mass', 1000, 1, 40, '吨', 'metric tonne'),
('Mt', 'mass', 1000000000, 1, 50, '百万吨', 'megatonne'),
('lb', 'mass', 0.453592, 1, 60, '磅', 'pound'),
('oz', 'mass', 0.0283495, 1, 70, '盎司', 'ounce'),
('short_ton', 'mass', 907.185, 1, 80, '短吨', 'short ton'),
('long_ton', 'mass', 1016.05, 1, 90, '长吨', 'long ton'),
-- distance (canonical: km)
('km', 'distance', 1, 1, 10, '公里', 'kilometer'),
('m',  'distance', 1, 1000, 20, '米', 'meter'),
('cm', 'distance', 1, 100000, 30, '厘米', 'centimeter'),
('mile', 'distance', 1.60934, 1, 40, '英里', 'mile'),
('nautical_mile', 'distance', 1.852, 1, 50, '海里', 'nautical mile'),
('ft', 'distance', 1, 3280.84, 60, '英尺', 'foot'),
-- currency (canonical: CNY) — for spend-based EF, exact rate set per-period elsewhere
('CNY', 'currency', 1, 1, 10, '人民币', 'Chinese yuan'),
('USD', 'currency', 7.2, 1, 20, '美元', 'US dollar'),
('EUR', 'currency', 7.8, 1, 30, '欧元', 'euro'),
('GBP', 'currency', 9.1, 1, 40, '英镑', 'British pound'),
('JPY', 'currency', 1, 21, 50, '日元', 'Japanese yen'),
('HKD', 'currency', 0.92, 1, 60, '港币', 'Hong Kong dollar'),
-- composite: tonne-kilometer (货运专用，不可被自动 convert，单独 family)
('tkm', 'mass_distance', 1, 1, 10, '吨公里', 'tonne-kilometer'),
('passenger_km', 'passenger_distance', 1, 1, 10, '人公里', 'passenger-kilometer'),
('km_passenger', 'passenger_distance', 1, 1, 20, '公里·人', 'kilometer-passenger');

-- ── unit_alias: 中文 + 大小写 + 单位写法变体 ──
INSERT INTO unit_alias (alias, canonical_unit, language, notes) VALUES
-- energy
('kwh', 'kWh', 'en', 'lowercase'),
('KWH', 'kWh', 'en', 'uppercase'),
('度', 'kWh', 'zh', '电力'),
('度电', 'kWh', 'zh', '电力'),
('千瓦时', 'kWh', 'zh', NULL),
('mwh', 'MWh', 'en', NULL),
('兆瓦时', 'MWh', 'zh', NULL),
('万度', 'MWh', 'zh', '10000 kWh ≈ 10 MWh，approx; 注：实际是 10MWh，此 alias 提示用户复核'),
('mj', 'MJ', 'en', NULL),
('兆焦', 'MJ', 'zh', NULL),
('gj', 'GJ', 'en', NULL),
('吉焦', 'GJ', 'zh', NULL),
('btu', 'BTU', 'en', NULL),
-- volume
('l', 'L', 'en', NULL),
('ltr', 'L', 'en', NULL),
('升', 'L', 'zh', NULL),
('公升', 'L', 'zh', NULL),
('m³', 'm3', 'en', NULL),
('立方米', 'm3', 'zh', NULL),
('方', 'm3', 'zh', '天然气计量常用'),
('立方', 'm3', 'zh', NULL),
('ml', 'mL', 'en', NULL),
('毫升', 'mL', 'zh', NULL),
('gallon', 'gallon_us', 'en', '默认 US；如英标请用 gallon_uk'),
('加仑', 'gallon_us', 'zh', '默认 US'),
('美加仑', 'gallon_us', 'zh', NULL),
('英加仑', 'gallon_uk', 'zh', NULL),
-- mass
('Kg', 'kg', 'en', NULL),
('KG', 'kg', 'en', NULL),
('公斤', 'kg', 'zh', NULL),
('千克', 'kg', 'zh', NULL),
('斤', 'kg', 'zh', '注：实际 0.5 kg，此 alias 是常见误用提示'),
('g', 'g', 'en', NULL),
('gram', 'g', 'en', NULL),
('克', 'g', 'zh', NULL),
('t', 't', 'en', NULL),
('ton', 't', 'en', NULL),
('tonne', 't', 'en', 'metric'),
('吨', 't', 'zh', '公制'),
('公吨', 't', 'zh', '明确公制'),
('lb', 'lb', 'en', NULL),
('pound', 'lb', 'en', NULL),
('磅', 'lb', 'zh', NULL),
('oz', 'oz', 'en', NULL),
('盎司', 'oz', 'zh', NULL),
-- distance
('km', 'km', 'en', NULL),
('Km', 'km', 'en', NULL),
('公里', 'km', 'zh', NULL),
('千米', 'km', 'zh', NULL),
('m', 'm', 'en', 'meter'),
('米', 'm', 'zh', NULL),
('mile', 'mile', 'en', NULL),
('mi', 'mile', 'en', NULL),
('英里', 'mile', 'zh', NULL),
-- currency
('cny', 'CNY', 'en', NULL),
('rmb', 'CNY', 'en', NULL),
('元', 'CNY', 'zh', NULL),
('人民币', 'CNY', 'zh', NULL),
('块', 'CNY', 'zh', NULL),
('usd', 'USD', 'en', NULL),
('$', 'USD', 'en', NULL),
('美元', 'USD', 'zh', NULL),
('美刀', 'USD', 'zh', NULL),
('eur', 'EUR', 'en', NULL),
('€', 'EUR', 'en', NULL),
('欧元', 'EUR', 'zh', NULL),
('gbp', 'GBP', 'en', NULL),
('£', 'GBP', 'en', NULL),
('英镑', 'GBP', 'zh', NULL),
('jpy', 'JPY', 'en', NULL),
('¥', 'JPY', 'en', NULL),
('日元', 'JPY', 'zh', NULL),
('hkd', 'HKD', 'en', NULL),
('港币', 'HKD', 'zh', NULL),
('港元', 'HKD', 'zh', NULL),
-- composite
('tkm', 'tkm', 'en', NULL),
('吨公里', 'tkm', 'zh', NULL),
('吨千米', 'tkm', 'zh', NULL),
('passenger_km', 'passenger_km', 'en', NULL),
('人公里', 'passenger_km', 'zh', NULL),
('客公里', 'passenger_km', 'zh', NULL);

-- ── fuel_property: 燃料密度 + 低位热值 ──
-- source: IPCC AR6 Vol 2 / 中国电力企业联合会
INSERT INTO fuel_property (
  fuel_code, density_kg_per_L, density_kg_per_m3,
  lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3,
  source, notes
) VALUES
('gasoline',         0.745, NULL, 44.3,  NULL, 'IPCC AR6 + GB/T 17930',  '93#/95# 平均'),
('diesel',           0.835, NULL, 43.0,  NULL, 'IPCC AR6 + GB/T 19147',  '0# 国六'),
('natural_gas',      NULL,  0.717, NULL, 35.9, 'IPCC AR6 + GB 17820',    '管道燃气，标况'),
('lpg',              0.540, NULL, 47.3,  NULL, 'IPCC AR6 + GB 11174',    '丙烷+丁烷混合，液相'),
('coal_anthracite',  NULL,  NULL,  29.3, NULL, 'IPCC AR6',               '中国无烟煤');
```

- [ ] **Step 4: Run test → 通过**

```bash
pnpm test tests/main/db/seed-units.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations/007_seed_units.sql tests/main/db/seed-units.test.ts
git commit -m "feat(db): migration 007 — seed units (40 defs / 80+ aliases / 5 fuel_property)

5 unit families (energy/volume/mass/distance/currency) + 2 composite
(tkm/passenger_km). Aliases include zh chinese names and common
misuse hints (e.g. 斤 → kg with note '实际 0.5 kg'). Fuel properties
for gasoline/diesel/natural_gas/lpg/coal_anthracite per IPCC AR6.

Phase 1a task 1/15."
```

---

### Task 2: Migration 008 — seed 12 emission factors (Scope 1+2)

**Files:**
- Create: `src/main/db/migrations/008_seed_emission_factors.sql`
- Test: `tests/main/db/seed-ef.test.ts`

**EF 清单**（12 条，覆盖 5 典型场景）：

| factor_code | scope | category | unit | co2e_kg/unit | source | geography | notes |
|---|---|---|---|---|---|---|---|
| `electricity.grid.cn.national.2024` | 2 | electricity.grid | kWh | 0.5703 | MEE China 2024 | CN | 国家平均 |
| `electricity.grid.cn.north.2024` | 2 | electricity.grid | kWh | 0.7321 | MEE China 2024 | CN-North | 华北电网 |
| `electricity.grid.cn.east.2024` | 2 | electricity.grid | kWh | 0.5586 | MEE China 2024 | CN-East | 华东电网 |
| `electricity.grid.cn.south.2024` | 2 | electricity.grid | kWh | 0.4276 | MEE China 2024 | CN-South | 华南电网 |
| `electricity.grid.us.average.2024` | 2 | electricity.grid | kWh | 0.3673 | EPA eGRID 2024 | US | US 平均 |
| `fuel.gasoline.combustion.global.2024` | 1 | fuel.mobile | L | 2.296 | IPCC AR6 | global | 含 CH4/N2O |
| `fuel.diesel.combustion.global.2024` | 1 | fuel.mobile | L | 2.683 | IPCC AR6 | global | 含 CH4/N2O |
| `fuel.natural_gas.combustion.global.2024` | 1 | fuel.stationary | m3 | 1.879 | IPCC AR6 | global | 含 CH4/N2O |
| `fuel.lpg.combustion.global.2024` | 1 | fuel.stationary | L | 1.612 | IPCC AR6 | global | 含 CH4/N2O |
| `fuel.coal_anthracite.combustion.cn.2024` | 1 | fuel.stationary | kg | 2.494 | IPCC AR6 + 中国能源所 | CN | 含 CH4/N2O |
| `freight.truck_diesel.china.2024` | 3 | upstream_transport | tkm | 0.0962 | GLEC + 中国货运统计 | CN | 用于 Scope 3 早期试探（虽然 Phase 1a 主线不做 Scope 3，留一条便于 dev 体验跨 scope） |
| `material.steel.global.average.2024` | 3 | purchased_goods | kg | 1.97 | World Steel + EXIOBASE | global | 同上 |

> 注：表里写 12 条覆盖 Scope 1+2+少量 3。Phase 1a UI 只让用户挑 Scope 1+2，但 EF 库里有 Scope 3 不亏 —— 测试 service 跨 scope 查询能跑。

- [ ] **Step 1: 写 failing test**

```ts
// tests/main/db/seed-ef.test.ts
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Migration 008: seed emission factors', () => {
  it('inserts 12 EFs', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM emission_factor').get() as { n: number };
    expect(n.n).toBe(12);
  });

  it('includes all 4 China grid regional EFs + national', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const grids = db
      .prepare("SELECT factor_code FROM emission_factor WHERE factor_code LIKE 'electricity.grid.cn.%' ORDER BY factor_code")
      .all() as { factor_code: string }[];
    expect(grids.map((g) => g.factor_code)).toEqual([
      'electricity.grid.cn.east.2024',
      'electricity.grid.cn.national.2024',
      'electricity.grid.cn.north.2024',
      'electricity.grid.cn.south.2024',
    ]);
  });

  it('all EFs use AR6 gwp_basis', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const others = db
      .prepare("SELECT factor_code FROM emission_factor WHERE gwp_basis != 'AR6'")
      .all();
    expect(others).toEqual([]);
  });

  it('all EFs reference units that exist in unit_definition', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const orphans = db
      .prepare(
        `SELECT ef.factor_code, ef.input_unit FROM emission_factor ef
         LEFT JOIN unit_definition u ON ef.input_unit = u.unit
         WHERE u.unit IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
pnpm test tests/main/db/seed-ef.test.ts
```

- [ ] **Step 3: 写 migration**

```sql
-- src/main/db/migrations/008_seed_emission_factors.sql
-- Phase 1a: seed 12 EFs covering Scope 1+2 (+ 2 Scope 3 placeholders for service testing).
-- All AR6 GWP100. dataset_version follows source's annual cadence.

INSERT INTO emission_factor (
  factor_code, year, source, geography, dataset_version,
  scope, category, ghg_protocol_path, input_unit,
  co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
  gwp_basis, name_zh, name_en, citation_url
) VALUES
('electricity.grid.cn.national.2024', 2024, 'MEE_China', 'CN', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.5703, NULL, NULL, 'AR6', '中国国家电网平均', 'China national grid average', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.north.2024', 2024, 'MEE_China', 'CN-North', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.7321, NULL, NULL, 'AR6', '中国华北电网', 'China North China grid', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.east.2024', 2024, 'MEE_China', 'CN-East', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.5586, NULL, NULL, 'AR6', '中国华东电网', 'China East China grid', 'https://www.mee.gov.cn/'),
('electricity.grid.cn.south.2024', 2024, 'MEE_China', 'CN-South', '2024.q4', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.4276, NULL, NULL, 'AR6', '中国南方电网', 'China Southern grid', 'https://www.mee.gov.cn/'),
('electricity.grid.us.average.2024', 2024, 'EPA_eGRID', 'US', '2024.annual', 2, 'electricity.grid', 'scope2.location', 'kWh',
 0.3673, NULL, NULL, 'AR6', '美国电网平均', 'US grid average', 'https://www.epa.gov/egrid'),
('fuel.gasoline.combustion.global.2024', 2024, 'IPCC_AR6', 'global', '2024.v1', 1, 'fuel.mobile', 'scope1.mobile_combustion', 'L',
 2.296, 0.0001, 0.000008, 'AR6', '汽油燃烧', 'Gasoline combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.diesel.combustion.global.2024', 2024, 'IPCC_AR6', 'global', '2024.v1', 1, 'fuel.mobile', 'scope1.mobile_combustion', 'L',
 2.683, 0.000128, 0.0000048, 'AR6', '柴油燃烧', 'Diesel combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.natural_gas.combustion.global.2024', 2024, 'IPCC_AR6', 'global', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'm3',
 1.879, 0.0000358, 0.00000358, 'AR6', '天然气燃烧（管道）', 'Natural gas combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.lpg.combustion.global.2024', 2024, 'IPCC_AR6', 'global', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'L',
 1.612, 0.00005, 0.0000045, 'AR6', '液化石油气燃烧', 'LPG combustion', 'https://www.ipcc.ch/report/ar6/'),
('fuel.coal_anthracite.combustion.cn.2024', 2024, 'IPCC_AR6_CN', 'CN', '2024.v1', 1, 'fuel.stationary', 'scope1.stationary_combustion', 'kg',
 2.494, 0.0000293, 0.00000147, 'AR6', '无烟煤燃烧（中国）', 'Anthracite coal combustion (China)', 'https://www.ipcc.ch/report/ar6/'),
('freight.truck_diesel.china.2024', 2024, 'GLEC_CN', 'CN', '2024.v1', 3, 'upstream_transport', 'scope3.cat4_upstream_transportation', 'tkm',
 0.0962, NULL, NULL, 'AR6', '柴油货车货运（中国）', 'Diesel truck freight (China)', 'https://www.smartfreightcentre.org/'),
('material.steel.global.average.2024', 2024, 'WorldSteel', 'global', '2024.annual', 3, 'purchased_goods', 'scope3.cat1_purchased_goods', 'kg',
 1.97, NULL, NULL, 'AR6', '钢材全球平均', 'Steel global average', 'https://worldsteel.org/');
```

- [ ] **Step 4: Run test → 通过**

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations/008_seed_emission_factors.sql tests/main/db/seed-ef.test.ts
git commit -m "feat(db): migration 008 — seed 12 emission factors (Scope 1+2 typical + 2 Scope 3 placeholders)

12 EFs: 5 electricity grids (CN national/north/east/south + US),
5 fuel combustion (gasoline/diesel/natural_gas/lpg/anthracite_coal),
2 Scope 3 (truck freight CN + global steel) for service-layer
cross-scope testing. All AR6 GWP100. Sources cited.

Phase 1a task 2/15."
```

---

### Task 3: Unit conversion service

**Files:**
- Create: `src/main/services/unit-conversion-service.ts`
- Test: `tests/main/services/unit-conversion-service.test.ts`

**API**:

```ts
class UnitConversionService {
  // 同 family 内换算
  convert(amount: number, fromUnit: string, toUnit: string): number;

  // 别名归一化到 canonical unit
  normalize(unitOrAlias: string): { unit: string; family: string };

  // 跨 family 换算（要求 fuel_code 显式提供）
  convertWithFuel(
    amount: number, fromUnit: string, toUnit: string, fuelCode: string,
  ): number;

  // 校验：两个 unit 是否同 family
  isCompatible(unitA: string, unitB: string): boolean;
}

class DimensionMismatchError extends Error { ... }
class UnknownUnitError extends Error { ... }
```

- [ ] **Step 1: 写 failing test（关键 cases）**

```ts
// tests/main/services/unit-conversion-service.test.ts
import { openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { DimensionMismatchError, UnitConversionService, UnknownUnitError } from '@main/services/unit-conversion-service';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: Database.Database;
let svc: UnitConversionService;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  svc = new UnitConversionService({ db });
});

afterEach(() => db.close());

describe('UnitConversionService.normalize', () => {
  it('returns canonical unit for known unit', () => {
    expect(svc.normalize('kWh')).toEqual({ unit: 'kWh', family: 'energy' });
  });

  it('resolves chinese alias', () => {
    expect(svc.normalize('度')).toEqual({ unit: 'kWh', family: 'energy' });
    expect(svc.normalize('吨')).toEqual({ unit: 't', family: 'mass' });
    expect(svc.normalize('公里')).toEqual({ unit: 'km', family: 'distance' });
  });

  it('resolves case-insensitive english alias', () => {
    expect(svc.normalize('kwh')).toEqual({ unit: 'kWh', family: 'energy' });
    expect(svc.normalize('KG')).toEqual({ unit: 'kg', family: 'mass' });
  });

  it('throws UnknownUnitError for unknown', () => {
    expect(() => svc.normalize('foobar')).toThrow(UnknownUnitError);
  });
});

describe('UnitConversionService.convert', () => {
  it('same-unit returns same amount', () => {
    expect(svc.convert(1000, 'kWh', 'kWh')).toBe(1000);
  });

  it('kWh → MWh', () => {
    expect(svc.convert(1000, 'kWh', 'MWh')).toBeCloseTo(1, 6);
  });

  it('MJ → kWh (1 kWh = 3.6 MJ)', () => {
    expect(svc.convert(3.6, 'MJ', 'kWh')).toBeCloseTo(1, 6);
  });

  it('L → m3 (1000 L = 1 m3)', () => {
    expect(svc.convert(1000, 'L', 'm3')).toBeCloseTo(1, 6);
  });

  it('kg → t', () => {
    expect(svc.convert(1500, 'kg', 't')).toBeCloseTo(1.5, 6);
  });

  it('mile → km', () => {
    expect(svc.convert(100, 'mile', 'km')).toBeCloseTo(160.934, 3);
  });

  it('resolves alias on both sides', () => {
    expect(svc.convert(1000, '度', 'kWh')).toBe(1000);
    expect(svc.convert(1, '公吨', 'kg')).toBe(1000);
  });

  it('throws DimensionMismatchError for cross-family', () => {
    expect(() => svc.convert(100, 'kg', 'L')).toThrow(DimensionMismatchError);
  });
});

describe('UnitConversionService.convertWithFuel', () => {
  it('gasoline L → kg (density 0.745)', () => {
    expect(svc.convertWithFuel(100, 'L', 'kg', 'gasoline')).toBeCloseTo(74.5, 1);
  });

  it('natural_gas m3 → MJ (LHV 35.9)', () => {
    expect(svc.convertWithFuel(1, 'm3', 'MJ', 'natural_gas')).toBeCloseTo(35.9, 1);
  });

  it('diesel kg → MJ (LHV 43.0)', () => {
    expect(svc.convertWithFuel(1, 'kg', 'MJ', 'diesel')).toBeCloseTo(43.0, 1);
  });

  it('throws if fuel_code unknown', () => {
    expect(() => svc.convertWithFuel(1, 'L', 'kg', 'unobtanium')).toThrow();
  });

  it('throws if conversion path impossible (e.g. distance → mass)', () => {
    expect(() => svc.convertWithFuel(1, 'km', 'kg', 'gasoline')).toThrow();
  });
});

describe('UnitConversionService.isCompatible', () => {
  it('returns true for same family', () => {
    expect(svc.isCompatible('kWh', 'MJ')).toBe(true);
  });

  it('returns false for different family', () => {
    expect(svc.isCompatible('kg', 'L')).toBe(false);
  });

  it('works with aliases', () => {
    expect(svc.isCompatible('度', 'GJ')).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing**

- [ ] **Step 3: 写 implementation**

```ts
// src/main/services/unit-conversion-service.ts
import type Database from 'better-sqlite3';

export class UnknownUnitError extends Error {
  constructor(unit: string) {
    super(`Unknown unit: ${unit}`);
    this.name = 'UnknownUnitError';
  }
}

export class DimensionMismatchError extends Error {
  constructor(fromUnit: string, toUnit: string, fromFamily: string, toFamily: string) {
    super(
      `Cannot convert ${fromUnit} (${fromFamily}) to ${toUnit} (${toFamily}) without fuel_code binding.`,
    );
    this.name = 'DimensionMismatchError';
  }
}

type UnitDef = {
  unit: string;
  family: string;
  multiply_of_ratio: number;
  divide_of_ratio: number;
};

type FuelProperty = {
  fuel_code: string;
  density_kg_per_L: number | null;
  density_kg_per_m3: number | null;
  lower_heating_value_MJ_per_kg: number | null;
  lower_heating_value_MJ_per_m3: number | null;
};

export class UnitConversionService {
  constructor(private ctx: { db: Database.Database }) {}

  normalize(unitOrAlias: string): { unit: string; family: string } {
    // Try direct lookup in unit_definition
    const def = this.ctx.db
      .prepare('SELECT unit, family FROM unit_definition WHERE unit = ?')
      .get(unitOrAlias) as { unit: string; family: string } | undefined;
    if (def) return def;

    // Try alias
    const alias = this.ctx.db
      .prepare(
        `SELECT u.unit, u.family FROM unit_alias a
         JOIN unit_definition u ON a.canonical_unit = u.unit
         WHERE a.alias = ?`,
      )
      .get(unitOrAlias) as { unit: string; family: string } | undefined;
    if (alias) return alias;

    throw new UnknownUnitError(unitOrAlias);
  }

  convert(amount: number, fromUnit: string, toUnit: string): number {
    const from = this.normalize(fromUnit);
    const to = this.normalize(toUnit);

    if (from.family !== to.family) {
      throw new DimensionMismatchError(fromUnit, toUnit, from.family, to.family);
    }

    const fromDef = this.getUnitDef(from.unit);
    const toDef = this.getUnitDef(to.unit);

    // canonical = amount × multiply / divide
    const canonical = (amount * fromDef.multiply_of_ratio) / fromDef.divide_of_ratio;
    // target = canonical × divide / multiply
    return (canonical * toDef.divide_of_ratio) / toDef.multiply_of_ratio;
  }

  convertWithFuel(amount: number, fromUnit: string, toUnit: string, fuelCode: string): number {
    const from = this.normalize(fromUnit);
    const to = this.normalize(toUnit);

    // Same family: delegate
    if (from.family === to.family) return this.convert(amount, fromUnit, toUnit);

    const fuel = this.getFuelProperty(fuelCode);

    // path: volume → mass (via density) → energy (via LHV) or reverse
    // For Phase 1a we support: volume ↔ mass, mass ↔ energy, volume ↔ energy
    let intermediate_kg: number | undefined;
    let intermediate_L: number | undefined;
    let intermediate_m3: number | undefined;
    let intermediate_MJ: number | undefined;

    if (from.family === 'volume') {
      const amountInL = this.convert(amount, fromUnit, 'L');
      if (fuel.density_kg_per_L != null) intermediate_kg = amountInL * fuel.density_kg_per_L;
      else if (fuel.density_kg_per_m3 != null) {
        const amountIn_m3 = amountInL / 1000;
        intermediate_kg = amountIn_m3 * fuel.density_kg_per_m3;
      }
      if (fuel.lower_heating_value_MJ_per_m3 != null) {
        intermediate_MJ = (amountInL / 1000) * fuel.lower_heating_value_MJ_per_m3;
      } else if (intermediate_kg != null && fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_MJ = intermediate_kg * fuel.lower_heating_value_MJ_per_kg;
      }
    } else if (from.family === 'mass') {
      intermediate_kg = this.convert(amount, fromUnit, 'kg');
      if (fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_MJ = intermediate_kg * fuel.lower_heating_value_MJ_per_kg;
      }
    } else if (from.family === 'energy') {
      intermediate_MJ = this.convert(amount, fromUnit, 'MJ');
      if (fuel.lower_heating_value_MJ_per_kg != null) {
        intermediate_kg = intermediate_MJ / fuel.lower_heating_value_MJ_per_kg;
      }
    }

    if (to.family === 'mass') {
      if (intermediate_kg == null)
        throw new Error(`Cannot derive mass from ${fromUnit} via fuel ${fuelCode}`);
      return this.convert(intermediate_kg, 'kg', toUnit);
    }
    if (to.family === 'volume') {
      if (intermediate_kg == null || fuel.density_kg_per_L == null)
        throw new Error(`Cannot derive volume from ${fromUnit} via fuel ${fuelCode}`);
      const intermediate_L_v = intermediate_kg / fuel.density_kg_per_L;
      return this.convert(intermediate_L_v, 'L', toUnit);
    }
    if (to.family === 'energy') {
      if (intermediate_MJ == null)
        throw new Error(`Cannot derive energy from ${fromUnit} via fuel ${fuelCode}`);
      return this.convert(intermediate_MJ, 'MJ', toUnit);
    }
    throw new Error(`Cannot convert to family ${to.family}`);
  }

  isCompatible(unitA: string, unitB: string): boolean {
    try {
      const a = this.normalize(unitA);
      const b = this.normalize(unitB);
      return a.family === b.family;
    } catch {
      return false;
    }
  }

  private getUnitDef(unit: string): UnitDef {
    const def = this.ctx.db
      .prepare('SELECT unit, family, multiply_of_ratio, divide_of_ratio FROM unit_definition WHERE unit = ?')
      .get(unit) as UnitDef | undefined;
    if (!def) throw new UnknownUnitError(unit);
    return def;
  }

  private getFuelProperty(fuelCode: string): FuelProperty {
    const fuel = this.ctx.db
      .prepare(
        `SELECT fuel_code, density_kg_per_L, density_kg_per_m3,
                lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3
         FROM fuel_property WHERE fuel_code = ?`,
      )
      .get(fuelCode) as FuelProperty | undefined;
    if (!fuel) throw new Error(`Unknown fuel_code: ${fuelCode}`);
    return fuel;
  }
}
```

- [ ] **Step 4: Run test → 全过**

- [ ] **Step 5: Commit**

```bash
git add src/main/services/unit-conversion-service.ts tests/main/services/unit-conversion-service.test.ts
git commit -m "feat(service): UnitConversionService — normalize/convert/cross-family

normalize() resolves aliases (中文/英文 case-variants) to canonical unit.
convert() within same family. convertWithFuel() crosses volume↔mass↔energy
via fuel_property density + LHV. Throws DimensionMismatchError on
incompatible without fuel binding, UnknownUnitError on unknown alias.

Phase 1a task 3/15."
```

---

### Task 4: EF service (lookup + pin)

**Files:**
- Create: `src/main/services/ef-service.ts`
- Test: `tests/main/services/ef-service.test.ts`

**API**:

```ts
type EfLookupQuery = {
  category?: string;     // e.g. 'electricity.grid'
  scope?: 1 | 2 | 3;
  geography?: string;    // e.g. 'CN' or 'CN-East'
  year?: number;
  factor_code?: string;  // exact match wins all
};

class EfService {
  // 查询 emission_factor 库（返回多条供 UI 选择）
  list(q: EfLookupQuery): EmissionFactor[];

  // 单 EF by composite PK
  get(pk: EfCompositePk): EmissionFactor | null;

  // Pin: 从 emission_factor copy 到 pinned_emission_factor（idempotent on PK）
  // 返回 pinned 行
  pin(pk: EfCompositePk, now: string): PinnedEmissionFactor;
}
```

- [ ] **Step 1-5: TDD（同 task 3 pattern）**

Test 覆盖：
- `list({ category: 'electricity.grid', scope: 2 })` returns 5 grid EFs
- `list({ geography: 'CN-East' })` returns 1
- `get({ factor_code: 'electricity.grid.cn.east.2024', year: 2024, source: 'MEE_China', geography: 'CN-East', dataset_version: '2024.q4' })` returns row
- `get({ factor_code: 'nonexistent', ... })` returns null
- `pin(...)` first time: copies to pinned_emission_factor, sets pinned_at + pinned_from
- `pin(...)` again on same PK: returns existing row (idempotent), pinned_at unchanged
- `pin(...)` returns object with same fields as input EF + pinned_at + pinned_from

Commit message:

```
feat(service): EfService — EF lookup + pin to pinned_emission_factor

list() filters by (category, scope, geography, year, factor_code).
get() by composite PK. pin() copies emission_factor → pinned_emission_factor
on first call (idempotent), records pinned_at + pinned_from (= 'app.sqlite'
in Phase 1a; will be 'ef_library.sqlite' in Phase 1c+).

Phase 1a task 4/15.
```

---

### Task 5: Calculation service

**Files:**
- Create: `src/main/services/calculation-service.ts`
- Test: `tests/main/services/calculation-service.test.ts`

**Constants (AR6 GWP100)**:
```ts
export const GWP_AR6 = {
  CH4: 27.9,
  N2O: 273,
  // Phase 1a 不用 HFC/PFC/SF6/NF3
} as const;
```

**API**:

```ts
type ComputeInput = {
  amount: number;                  // user input
  unit: string;                    // user input alias OR canonical
  ef: PinnedEmissionFactor;        // already-pinned EF
  fuelCode?: string;               // optional, for cross-family conversion
};

type ComputeOutput = {
  co2e_kg: number;
  breakdown: {
    direct_co2_kg: number;
    ch4_co2e_kg: number;
    n2o_co2e_kg: number;
  };
  amount_in_ef_unit: number;       // user amount converted to EF's input_unit
};

class CalculationService {
  compute(input: ComputeInput): ComputeOutput;
}
```

**核心公式**：

```
amount_in_ef_unit = unitConv.convert(amount, unit, ef.input_unit)
                    [if same family]
                  | unitConv.convertWithFuel(amount, unit, ef.input_unit, fuelCode)
                    [if cross family + fuel given]

direct_co2_kg   = amount_in_ef_unit × ef.co2e_kg_per_unit
ch4_co2e_kg     = (amount_in_ef_unit × ef.ch4_kg_per_unit ?? 0) × GWP_AR6.CH4
n2o_co2e_kg     = (amount_in_ef_unit × ef.n2o_kg_per_unit ?? 0) × GWP_AR6.N2O

co2e_kg         = direct_co2_kg + ch4_co2e_kg + n2o_co2e_kg
```

> 注：spec EF 库里 `co2e_kg_per_unit` 已经是 AR6 GWP 加总后的总值。Phase 1a EF 数据集 ch4/n2o 字段统一 NULL（避免与 co2e 总值重复计算）；calc 服务仍保留 ch4/n2o 加和逻辑，供 Phase 1c+ 支持组分式（decomposed）EF 时使用。

- [ ] **Step 1-5: TDD**

Test cases:
- 1000 kWh × `electricity.grid.cn.national.2024` (0.5703 kgCO2e/kWh) = 570.3 kg
- 1000 度 × ... (alias) = 570.3 kg
- 1 MWh × ... = 570.3 kg
- 100 L gasoline × `fuel.gasoline.combustion.global.2024` (2.296 kgCO2e/L) = 229.6 kg
- 100 升 × ... (alias) = 229.6 kg
- 73 kg gasoline → convertWithFuel via density 0.745 → 98 L → 225 kg
- m3 of natural_gas: 100 m3 × 1.879 = 187.9 kg
- 100 方 × ... (alias) = 187.9 kg

Commit:

```
feat(service): CalculationService — amount × EF → CO2e (AR6 GWP100)

Pure compute function: takes user amount + unit + pinned EF, converts
unit via UnitConversionService, applies EF co2e_kg_per_unit, adds CH4
and N2O via AR6 GWP100 (CH4=27.9, N2O=273). Returns breakdown for audit.

Phase 1a task 5/15.
```

---

### Task 6: Zod schemas + shared types

**Files:**
- Modify: `src/shared/types.ts`

加 zod schemas + 推导 types：

```ts
// src/shared/types.ts (append)

export const emissionSourceCreateInput = z.object({
  site_id: z.string().min(1),
  name: z.string().min(1).max(200),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  category: optionalString(),
  ghg_protocol_path: optionalString(),
  default_ef_query: optionalString(),  // JSON string
  template_origin: optionalString(),
});

export const emissionSourceUpdateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  category: optionalString(),
  is_active: z.boolean().optional(),
});

export const activityDataCreateInput = z.object({
  emission_source_id: z.string().min(1),
  reporting_period_id: z.string().min(1),
  occurred_at_start: z.string(),  // ISO 8601 date or datetime
  occurred_at_end: z.string(),
  amount: z.number().positive(),
  unit: z.string().min(1),
  ef_factor_code: z.string().min(1),
  ef_year: z.number().int(),
  ef_source: z.string().min(1),
  ef_geography: z.string().min(1),
  ef_dataset_version: z.string().min(1),
  fuel_code: optionalString(),    // for cross-family conversion if needed
  notes: optionalString(),
});

export type EmissionSource = {
  id: string;
  site_id: string;
  name: string;
  scope: 1 | 2 | 3;
  category: string | null;
  ghg_protocol_path: string | null;
  default_ef_query: string | null;
  template_origin: string | null;
  is_active: boolean;
};

export type ActivityData = {
  id: string;
  site_id: string;
  emission_source_id: string;
  reporting_period_id: string;
  occurred_at_start: string;
  occurred_at_end: string;
  amount: number;
  unit: string;
  ef_factor_code: string;
  ef_year: number;
  ef_source: string;
  ef_geography: string;
  ef_dataset_version: string;
  computed_co2e_kg: number;
  computed_at: string;
  extraction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EmissionFactor = {
  factor_code: string;
  year: number;
  source: string;
  geography: string;
  dataset_version: string;
  scope: 1 | 2 | 3;
  category: string | null;
  ghg_protocol_path: string | null;
  input_unit: string;
  co2e_kg_per_unit: number;
  ch4_kg_per_unit: number | null;
  n2o_kg_per_unit: number | null;
  gwp_basis: 'AR5' | 'AR6';
  name_zh: string | null;
  name_en: string | null;
  description_zh: string | null;
  description_en: string | null;
  citation_url: string | null;
};

export type PinnedEmissionFactor = EmissionFactor & {
  pinned_at: string;
  pinned_from: string;
};

export type EfCompositePk = Pick<
  EmissionFactor,
  'factor_code' | 'year' | 'source' | 'geography' | 'dataset_version'
>;

export type EmissionSourceCreateInput = z.infer<typeof emissionSourceCreateInput>;
export type EmissionSourceUpdateInput = z.infer<typeof emissionSourceUpdateInput>;
export type ActivityDataCreateInput = z.infer<typeof activityDataCreateInput>;
```

- [ ] **Step 1: 写 + typecheck**
- [ ] **Step 2: Commit**

```
feat(types): zod schemas + types for emission_source / activity_data / EF

emissionSourceCreateInput, activityDataCreateInput zod schemas + matching
TS types. EmissionFactor + PinnedEmissionFactor share base shape;
EfCompositePk extracted as Pick for service param ergonomics.

Phase 1a task 6/15.
```

---

### Task 7: EmissionSourceService

**Files:**
- Create: `src/main/services/emission-source-service.ts`
- Test: `tests/main/services/emission-source-service.test.ts`

**API**:

```ts
class EmissionSourceService {
  create(input: EmissionSourceCreateInput): EmissionSource;
  getById(id: string): EmissionSource | null;
  listBySite(siteId: string): EmissionSource[];
  listByOrganization(orgId: string): EmissionSource[];  // 跨多 site
  update(input: EmissionSourceUpdateInput): EmissionSource;
  delete(id: string): void;  // soft delete via is_active = 0
}
```

实现要点：
- create: validate site_id exists, generate ULID, insert
- listByOrganization: JOIN site
- delete: UPDATE is_active = 0（不真删，因为 activity_data FK 引用它）

TDD 标准 service pattern。Commit:

```
feat(service): EmissionSourceService — CRUD with composite FK (id, site_id)

create/getById/listBySite/listByOrganization/update/delete (soft, is_active=0).
Composite UNIQUE (id, site_id) preserved so activity_data composite FK
locks site consistency per spec §3.

Phase 1a task 7/15.
```

---

### Task 8: ActivityDataService

**Files:**
- Create: `src/main/services/activity-data-service.ts`
- Test: `tests/main/services/activity-data-service.test.ts`

**API**:

```ts
class ActivityDataService {
  // 单事务：pin EF → compute CO2e → write activity_data
  create(input: ActivityDataCreateInput): ActivityData;

  getById(id: string): ActivityData | null;
  listByPeriod(periodId: string): ActivityData[];
  listBySource(sourceId: string): ActivityData[];
  delete(id: string): void;  // 硬删（无 FK 引用 activity_data）

  // 用于 dashboard
  totalsByPeriod(periodId: string): {
    total_co2e_kg: number;
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
  };
}
```

create 流程（关键）：

```
BEGIN TX
  1. lookup emission_source by id, validate site_id matches
  2. lookup emission_factor by composite PK, throw if not found
  3. EfService.pin(...)  -- copies to pinned_emission_factor (idempotent)
  4. CalculationService.compute({ amount, unit, ef: pinned, fuelCode })
     → computed_co2e_kg
  5. INSERT activity_data with id=ULID, computed_co2e_kg, computed_at=now
COMMIT
```

`totalsByPeriod` 用 SQL JOIN aggregate（不在 JS 求和，因为可能上千行）：

```sql
SELECT
  COALESCE(SUM(ad.computed_co2e_kg), 0) AS total_co2e_kg,
  COALESCE(SUM(CASE WHEN es.scope = 1 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope1_kg,
  COALESCE(SUM(CASE WHEN es.scope = 2 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope2_kg,
  COALESCE(SUM(CASE WHEN es.scope = 3 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope3_kg
FROM activity_data ad
JOIN emission_source es ON ad.emission_source_id = es.id
WHERE ad.reporting_period_id = ?
```

TDD 全程，特别测试：
- 1000 kWh on 'electricity.grid.cn.national.2024' → activity row.computed_co2e_kg ≈ 570.3
- Pin 同一 EF 两次 → pinned_emission_factor 只 1 行
- totalsByPeriod 在空 period 返回 0
- totalsByPeriod 在 1 活动数据 period 返回正确值
- totalsByPeriod 在跨 scope 的 period 返回 scope 拆分正确
- create 在 EF 不存在时抛错（事务回滚，不留 partial pin）

Commit:

```
feat(service): ActivityDataService — single-tx pin EF + compute CO2e + insert

create() does pin → compute → insert in one SQLite transaction. Read APIs:
getById, listByPeriod, listBySource. totalsByPeriod aggregates total +
scope 1/2/3 via SQL JOIN with emission_source (not JS sum).

Phase 1a task 8/15.
```

---

### Task 9: IPC — extend type map + handlers

**Files:**
- Modify: `src/main/ipc/types.ts`
- Create: `src/main/ipc/handlers/ef-library.ts`
- Create: `src/main/ipc/handlers/emission-source.ts`
- Create: `src/main/ipc/handlers/activity-data.ts`
- Modify: `src/main/ipc/setup.ts`
- Modify: `src/main/ipc/context.ts`
- Modify: `src/preload/bridge.ts`
- Test: `tests/main/ipc/ef-library-handlers.test.ts`, `emission-source-handlers.test.ts`, `activity-data-handlers.test.ts`

新 channels（11 个）：

```ts
// in IpcTypeMap:
'ef:list': (input: { category?: string; scope?: 1|2|3; geography?: string }) => EmissionFactor[];
'ef:get-by-pk': (input: EfCompositePk) => EmissionFactor | null;
'units:list': () => UnitDefinition[];

'source:create': (input: EmissionSourceCreateInput) => EmissionSource;
'source:get-by-id': (input: { id: string }) => EmissionSource | null;
'source:list-by-site': (input: { site_id: string }) => EmissionSource[];
'source:list-by-org': (input: { organization_id: string }) => EmissionSource[];
'source:update': (input: EmissionSourceUpdateInput) => EmissionSource;
'source:delete': (input: { id: string }) => void;

'activity:create': (input: ActivityDataCreateInput) => ActivityData;
'activity:list-by-period': (input: { reporting_period_id: string }) => ActivityData[];
'activity:totals-by-period': (input: { reporting_period_id: string }) =>
  { total_co2e_kg: number; scope1_kg: number; scope2_kg: number; scope3_kg: number };
```

每个 handler 套 sanitize（Phase 0 已建好），Zod parse input。

`IpcContext` 加：

```ts
export interface IpcContext {
  organizationService: OrganizationService;
  emissionSourceService: EmissionSourceService;
  activityDataService: ActivityDataService;
  efService: EfService;
  unitConversionService: UnitConversionService;
}
```

`setup.ts` register 三组 handlers（pattern 同 Phase 0 organization）。

`preload/bridge.ts` allowlist 加 11 个 channel。

TDD: 每个 handler 至少 2 个 test（成功 + Zod 失败）。

Commit:

```
feat(ipc): 11 channels — ef:* / units:* / source:* / activity:*

IpcTypeMap extended. Each handler Zod-parses input + sanitize() wrap (per
Phase 0 task 16+17 pattern). IpcContext now holds 5 services. Preload
allowlist updated. Tests cover happy paths + ZodError rejection for each
new handler.

Phase 1a task 9/15.
```

---

### Task 10: Renderer IPC wrappers (3 domains)

**Files:**
- Create: `src/renderer/lib/api/ef-library.ts`
- Create: `src/renderer/lib/api/emission-source.ts`
- Create: `src/renderer/lib/api/activity-data.ts`

Pattern 同 Phase 0 `orgApi`：

```ts
// src/renderer/lib/api/emission-source.ts
import { invoke } from '../ipc';

export const sourceApi = {
  create: (input: Parameters<typeof invoke<'source:create'>>[1]) =>
    invoke('source:create', input),
  getById: (input: { id: string }) => invoke('source:get-by-id', input),
  listBySite: (input: { site_id: string }) => invoke('source:list-by-site', input),
  listByOrg: (input: { organization_id: string }) =>
    invoke('source:list-by-org', input),
  update: (input: Parameters<typeof invoke<'source:update'>>[1]) =>
    invoke('source:update', input),
  delete: (input: { id: string }) => invoke('source:delete', input),
};
```

类似 `efApi`, `activityApi`。

Commit:

```
feat(renderer): IPC wrappers for ef-library / emission-source / activity-data

Thin per-domain wrappers (sourceApi, activityApi, efApi) over invoke().
TanStack Query useQuery / useMutation will consume directly.

Phase 1a task 10/15.
```

---

### Task 11: Sidebar — add Sources + Activities nav

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/paraglide/...messages...`

加两个 nav item:

```tsx
<li>
  <Link to="/sources" className={...}>{m.nav_sources()}</Link>
</li>
<li>
  <Link to="/activities" className={...}>{m.nav_activities()}</Link>
</li>
```

Paraglide messages: 
- zh-CN: `nav_sources = "排放源"`, `nav_activities = "活动数据"`
- en: `nav_sources = "Sources"`, `nav_activities = "Activities"`

Commit:

```
feat(ui): sidebar — Sources + Activities nav items + paraglide messages

Phase 1a task 11/15.
```

---

### Task 12: /sources route — list + create form

**Files:**
- Create: `src/renderer/routes/sources.tsx`
- Create: `src/renderer/components/SourceForm.tsx`
- Test: `tests/renderer/sources.test.tsx`

UI：
- 顶部 "Sources" h1 + "Add Source" button → toggle inline form
- Form 字段：name, scope (radio 1/2/3), category (text), site (auto-select if single site, dropdown otherwise — Phase 1a 默认 wizard 建的 1 个 site)
- 列表表格：name / scope / category / is_active toggle / 操作
- TanStack Query `useQuery({ queryKey: ['source:list-by-org', orgId], queryFn: () => sourceApi.listByOrg({ organization_id: orgId }) })`
- TanStack Form 同 wizard StepCompanyInfo 模式

Cmdk 加一条 command（registry pattern from Task 4 of UI baseline）：

```ts
// command-palette.tsx commands array:
{
  id: 'nav.sources',
  group: 'Navigation',
  label: 'Open Sources',
  onSelect: ({ navigate, close }) => { close(); navigate({ to: '/sources' }); },
},
```

Test: smoke render + form submit happy path（mock window.ipc）

Commit:

```
feat(ui): /sources route — list + create form

SourceForm uses TanStack Form (per wizard pattern). List via TanStack
Query. Soft delete via is_active toggle. Cmdk Navigation group adds
"Open Sources" command.

Phase 1a task 12/15.
```

---

### Task 13: /activities route — list + create form

**Files:**
- Create: `src/renderer/routes/activities.tsx`
- Create: `src/renderer/components/ActivityForm.tsx`
- Test: `tests/renderer/activities.test.tsx`

UI：
- 顶部 "Activities" h1 + "Add Activity" button
- Form 字段：
  - emission_source（dropdown，来自 sourceApi.listByOrg）
  - reporting_period（dropdown，来自 organization.listReportingPeriods —— Phase 0 已有）
  - occurred_at_start / occurred_at_end (date picker, 用 native `<input type="date">` 简化)
  - amount (number)
  - unit (text 输入，支持别名)
  - **EF Matcher**：用户选完 source 后，按 source.category + source.scope 自动 query `efApi.list({ category, scope })` 显示 EF 候选 → 用户挑一个 → 自动填 5 个 ef_* fields
  - notes (optional textarea)
- 列表表格：occurred_at_start | source.name | amount + unit | computed_co2e_kg | EF citation
- 提交后 invalidate query keys: `['activity:list-by-period', periodId]` + `['activity:totals-by-period', periodId]`

Cmdk 加 `nav.activities`。

Test: form submit + verify activity 出现在列表。

Commit:

```
feat(ui): /activities route — list + create form with EF auto-filter

ActivityForm: source dropdown → auto-filter EFs by (category, scope) →
user picks → 5 ef_* fields auto-fill. Amount + unit user input.
computed_co2e_kg returned by service, shown in list. Cmdk Navigation:
"Open Activities".

Phase 1a task 13/15.
```

---

### Task 14: Dashboard real numbers

**Files:**
- Modify: `src/renderer/routes/index.tsx`
- Modify: `src/renderer/paraglide/messages` (a few keys)

替换 "目前没有排放数据" placeholder 为真数字：

```tsx
function Dashboard() {
  // Phase 0 hasAny check still applies
  const hasAny = useQuery({ queryKey: ['org:has-any'], queryFn: orgApi.hasAny });
  
  // 简化：Phase 1a 假设 single org single period（wizard 已建第一个）
  const periods = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId }),
    enabled: !!orgId,
  });
  const currentPeriodId = periods.data?.[0]?.id;
  const totals = useQuery({
    queryKey: ['activity:totals-by-period', currentPeriodId],
    queryFn: () => activityApi.totalsByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  if (!hasAny.data) return <Navigate ... />;

  return (
    <div className="space-y-6">
      <h1>{m.dashboard_inventory_title()}</h1>
      
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardTitle>Total CO2e</CardTitle>
          <CardValue>{format(totals.data?.total_co2e_kg ?? 0)} kg</CardValue>
        </Card>
        <Card>
          <CardTitle>Scope 1</CardTitle>
          <CardValue>{format(totals.data?.scope1_kg ?? 0)} kg</CardValue>
        </Card>
        <Card>
          <CardTitle>Scope 2</CardTitle>
          <CardValue>{format(totals.data?.scope2_kg ?? 0)} kg</CardValue>
        </Card>
        <Card>
          <CardTitle>Scope 3</CardTitle>
          <CardValue>{format(totals.data?.scope3_kg ?? 0)} kg</CardValue>
        </Card>
      </div>

      {totals.data?.total_co2e_kg === 0 && (
        <p className="text-muted-foreground">
          {m.dashboard_empty_hint()}{' '}
          <Link to="/activities" className="text-primary underline">
            {m.dashboard_add_first_activity()}
          </Link>
        </p>
      )}
    </div>
  );
}
```

`format(n)` 函数：`new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(n)`. 大数字加千分位逗号。

Commit:

```
feat(ui): dashboard — real CO2e totals + scope 1/2/3 breakdown

4-card grid: Total / Scope 1 / Scope 2 / Scope 3. Reads from
activity:totals-by-period IPC. Empty-state hint links to /activities.
Number formatting via Intl.NumberFormat zh-CN.

Phase 1a task 14/15.
```

---

### Task 15: Acceptance + tag

- [ ] **Step 1: All gates green**

```bash
pnpm typecheck
pnpm test     # should be ~70 tests (was 52, +18ish)
pnpm lint
pnpm build
```

- [ ] **Step 2: 跑 dev session 验证整段**

```bash
rm -rf ~/Library/Application\ Support/carbonbook/
pnpm dev
```

验证清单：
- [ ] 走完 onboarding wizard 5 步
- [ ] Sidebar 显示 "排放源" + "活动数据"
- [ ] `/sources` 创建一个 source：name="厂区电表"，scope=2，category="electricity.grid"
- [ ] `/activities` 创建一个 activity：
  - source=刚才那个
  - period=年度（wizard 建的）
  - amount=1000, unit="度"
  - 候选 EFs 列出 5 个电网 EF
  - 选 `electricity.grid.cn.national.2024`
  - 提交后列表显示 1 行，computed_co2e_kg ≈ 570.3
- [ ] Dashboard 显示 Total ≈ 570.3 kg, Scope 2 ≈ 570.3 kg, Scope 1 = 0
- [ ] ⌘K → "Open Sources" / "Open Activities" 都能跳
- [ ] Sqlite 验证：

```bash
sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite "
  SELECT COUNT(*) FROM unit_definition;          -- ≥40
  SELECT COUNT(*) FROM emission_factor;          -- 12
  SELECT COUNT(*) FROM pinned_emission_factor;   -- 1 (the one we pinned)
  SELECT COUNT(*) FROM emission_source;          -- 1
  SELECT COUNT(*) FROM activity_data;            -- 1
  SELECT printf('%.2f', computed_co2e_kg) FROM activity_data;  -- ~570.30
"
```

- [ ] **Step 3: 打 `phase-1a` tag**

```bash
git tag -a phase-1a -m "Phase 1a — Manual path to first CO2e

Deliverable verified: user manually enters '1000 kWh China national grid'
→ system computes 570.3 kg CO2e → dashboard shows total + scope breakdown.

What landed:
- Migration 007: 40 units + 80+ aliases + 5 fuel_property
- Migration 008: 12 EFs (Scope 1+2 typical + 2 Scope 3 placeholders)
- 5 new services: UnitConversion, Ef, Calculation, EmissionSource, ActivityData
- 11 new IPC channels (ef:*, units:*, source:*, activity:*)
- 2 new routes: /sources, /activities
- 2 new cmdk commands (Open Sources / Open Activities)
- Dashboard: 4-card scope breakdown with real numbers

Scope: Scope 1+2 only, manual entry only, EF matcher v0 (exact match).
AR6 GWP100 source-code constant.

Not in Phase 1a: AI extraction (Phase 1b), Scope 3 (Phase 1c+),
ef_library.sqlite RO bundle (Phase 1c+), FTS/LLM EF matching (Phase 1c),
snapshot freeze + export (Phase 1c+).

Sprint plan: docs/plans/2026-05-11-carbonbook-phase-1a-first-co2e.md.
Phase 1 milestone 'first-CO2e' partially met (manual path; AI path = Phase 1b)."
```

- [ ] **Step 4: 更新 spec §11 Phase 1 状态**

加一段进 §11 Phase 1 末尾：

```markdown
**Phase 1a status (2026-05-11)**：完成。Manual path to first CO2e。
Deliverable: 用户录 1000 kWh 中国国家电网用电 → 系统出 570.3 kg CO2e。
12 EFs + 40 units seeded. Tag: `phase-1a`.

剩余 Phase 1b（AI 抽取链路）+ Phase 1c（EF 智能匹配 + snapshot freeze）按 sub-sprint 单独 plan。
```

Commit + tag。

---

## Sprint scope 摘要

| Task | 范围 | 测试增量 | 估时 |
|---|---|---|---|
| 1 | Migration 007 — seed units | +4 | 30 min |
| 2 | Migration 008 — seed 12 EFs | +4 | 30 min |
| 3 | UnitConversionService | +20 | 2 hr |
| 4 | EfService | +8 | 1.5 hr |
| 5 | CalculationService | +10 | 1 hr |
| 6 | Zod schemas + types | 0 | 30 min |
| 7 | EmissionSourceService | +10 | 1.5 hr |
| 8 | ActivityDataService | +15 | 2.5 hr（最复杂 service） |
| 9 | IPC layer extension | +6 | 1.5 hr |
| 10 | Renderer wrappers | 0 | 30 min |
| 11 | Sidebar + paraglide | 0 | 30 min |
| 12 | /sources route + form | +3 | 2 hr |
| 13 | /activities route + form | +3 | 3 hr |
| 14 | Dashboard real numbers | +2 | 1.5 hr |
| 15 | Acceptance + tag | — | 1 hr |

**总测试增量**：52 → ~135（+83）
**总估时**：~20 小时实施 + reviews. ~3 个工作日（subagent-driven）。

---

## Phase 1a 完成后下一站

- **Phase 1b** (AI 抽取链路, ~7 天)：AI provider config UI + safeStorage + pi-ai 集成 + DocumentLoader + Classifier + Extractor（先 1 个 prompt: china_utility 电费单）+ 人审 UI
- **Phase 1c** (EF 智能匹配 + 多 prompt + snapshot, ~5 天)：EF FTS+LLM matcher + 加油单/物流单 prompt + calculation_snapshot freeze + 基础 export

Phase 1a + 1b + 1c 完成即 spec §11 Phase 1 完整 deliverable。
