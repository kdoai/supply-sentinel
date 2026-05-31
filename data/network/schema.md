# 多段サプライネットワーク データ契約 (LOCKED — Phase A)

このファイルは Phase B/C のエージェントが従う唯一の契約。`src/supply_sentinel/networkSchema.mjs` が機械検証する。
**Phase B/C は networkSchema.mjs / propagationEngine.mjs を変更してはならない。**

## 目的
自社（川下メーカー）を中心に「自社 ← 1次サプライヤ ← 2次サプライヤ ←（原産地）」の多段つながりを表現し、
上流のどのノードが揺れても下流（自社の製品・受注・売上）への波及を、式で算出した意味のある数値で追えるようにする。
（"川上/川中/川下" の語は UI で使わない。tier で表す。）

## ノード node
```jsonc
{
  "id": "n_sup_demo",          // 一意。英数_。
  "tier": 1,                    // 0=自社(工場/製品/顧客) / 1=1次サプライヤ / 2=2次サプライヤ / 3=原産地(製油所等)
  "kind": "supplier",          // self | plant | product | customer | supplier | refinery | port
  "name": "デモ石化サプライヤ",
  "makes": "ナフサ供給(東南アジア)",   // 何を作る/担う会社か(素人向け1行)。任意。
  "country": "シンガポール",          // 任意
  "region": "Southeast Asia",       // 任意
  "lat": 1.26, "lng": 103.83,        // 任意(あると地図に出る)。製品/顧客はnull可。
  "role_note": "今回の通知元",        // 任意の補足
  "priority": "high"                 // kind=customer のとき任意
}
```

## エッジ edge（source が target に供給する有向辺）
```jsonc
{
  "id": "e_demo_chiba",
  "source": "n_sup_demo", "target": "n_plant_chiba",
  "material": "naphtha",        // 供給材料(製品→顧客辺など物量無しは省略可)
  "monthly_volume": 9000, "unit": "ton",
  "unit_price_usd": 400,
  "monthly_spend_usd": 3600000, // = round(monthly_volume * unit_price_usd) ←検証される
  "share_percent": 46,          // この辺が target の当該材料調達に占める割合。Σ≈100 per (target,material)
  "dependency": 0.4615,         // = share_percent/100(±0.02)。target の当該供給源への依存度。
  "lead_time_days": 12,
  "transport_mode": "sea",      // 任意
  "order_id": "SO-1001",        // 製品→顧客辺で任意
  "status": "normal"            // baseline。実行時にエンジンが上書き。
}
```

## 検証不変条件（networkSchema.validateNetwork）
- すべての edge の source/target が実在ノード。source≠target。
- グラフは DAG（循環なし）。
- monthly_volume と unit_price_usd がある辺は `monthly_spend_usd == round(volume*price)`（±1）。
- 物量のある材料辺について、各 (target, material) で `Σ share_percent ≈ 100`（±1.5）かつ `dependency ≈ share/100`（±0.02）。

## シナリオ scenario（`web/assets/scenarios/<id>.json`）
```jsonc
{
  "id": "naphtha-asia-allocation",
  "label": "ナフサ: アジア製油所障害→割当制限",
  "material": "naphtha",
  "headline": "アジアの製油所障害でナフサ割当が70%に制限",
  "layperson_story": "自社はナフサを原料に樹脂A・溶剤B・コーティングCを作っています。…",
  "focal_material": "naphtha",
  "network": { "focal_material": "naphtha", "nodes": [...], "edges": [...] },
  "disruption": { "type":"allocation", "hit_nodes":["n_ref_jurong","n_ref_ulsan","n_ref_maptaput"], "capacity_drop":0.30 },
  "inventory": [ { "plant":"千葉工場","material":"naphtha","stock_qty":500,"daily_usage":100,"unit":"ton" }, ... ],
  "alternatives": [ { "material":"naphtha","alternative_material":"NAP-ALT-01","approved":true,"lead_time_days":10,"constraints":"…" } ],
  "risk_inputs": { "severity":"high", "confidence":"high" },   // scoring.mjs 用(透明スコア)
  "provenance": [ { "id":"src-supplier","kind":"supplier_notice","label":"サプライヤ通知","source":"…","ref":"notice-2026-001","confidence":"高","claim":"…","feeds":["e_demo_chiba","n_ref_jurong"] }, ... ],
  "timeseries_ref": "./naphtha-asia-allocation.timeseries.json"
}
```
- `provenance[].kind` は `news | supplier_notice | logistics | price_feed` のいずれか。`feeds` は裏付ける node/edge id。

## 時系列 timeseries（`web/assets/scenarios/<id>.timeseries.json`）
```jsonc
{
  "scenario_id": "naphtha-asia-allocation",
  "unit": "month",
  "months": [
    {
      "month":"2026-05", "label":"5月(現在)",
      "price_index":112, "naphtha_price_usd_per_ton":448,
      "disruption": { "hit_nodes":["n_ref_jurong","n_ref_ulsan","n_ref_maptaput"], "capacity_drop":0.30 },
      "inventory": [ {"plant":"千葉工場","material":"naphtha","stock_qty":500,"daily_usage":100,"unit":"ton"}, ... ],
      "risk_inputs": { "severity":"high","confidence":"high" },
      "metrics": { "risk_score":82,"severity":"high","affected_supply_ratio":65,"spend_at_risk_usd":7800000,"total_spend_usd":12000000,"inventory_days_min":5 },
      "events": [ {"kind":"supplier_notice","text":"割当を通常の70%に制限する通知","ref":"notice-2026-001"} ],
      "sources": ["src-supplier","src-logi","src-price"]
    }
  ]
}
```
- 各月の `metrics` は `computeMetrics(network, month.disruption, {inventory, alternatives, risk_inputs})` の出力と一致しなければならない（network_build テストで検証）。ベイク方式。

## モデル契約（フロントが受け取る1オブジェクト）
`{ meta, risk_event, assessment, route_intel, supply_network, propagation, provenance, month, timeline }`
既存 `panels.js` の KPI/受注/在庫/ゲージは `assessment`・`route_intel.kpis` を読むので、`buildModelForMonth()` がそれらを `propagation.metrics` から埋めれば概ね無改修で動く。

## 状態色トークン（全エージェント共通）
- disrupted `#c9362f` / exposed `#b66a00` / resilient `#18794e` / normal `#2563a8`
- 顧客優先度 high `#c9362f` / medium `#b66a00` / low `#637083`
