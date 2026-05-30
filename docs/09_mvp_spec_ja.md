# MVP仕様書

## 目的

Supply Sentinel のMVPは、ナフサ供給不安を題材に、外部リスク検知から自社影響評価、初動対応案の生成までを一気通貫で見せる。

## 対象シナリオ

ナフサ供給に関する外部ニュースとサプライヤ通知を検知し、自社の製品・顧客・工場への影響を判定する。

## 入力データ

### 外部データ

- ニュースイベント
- サプライヤ通知

### 社内データ

- 在庫データ
- BOM
- 受注データ
- 代替材マスタ

## 出力

### アラート

- 対象原材料
- リスクスコア
- 危険度
- 根拠
- 影響製品
- 影響顧客
- 影響工場
- 在庫残日数
- 推奨初動
- 人の承認が必要な事項

### 管理職向けレポート

- 要約
- 外部根拠
- 自社影響
- 対応選択肢
- 承認事項
- 次回確認ポイント

## 機能要件

| ID | 機能 | 優先度 |
|---|---|---|
| FR-001 | 定期実行 | Must |
| FR-002 | 外部ニュース/通知の読み込み | Must |
| FR-003 | AIによるリスク抽出 | Must |
| FR-004 | 在庫・BOM・受注・代替材の読み込み | Must |
| FR-005 | 影響製品の特定 | Must |
| FR-006 | 影響顧客/工場の特定 | Must |
| FR-007 | 在庫残日数の算出 | Must |
| FR-008 | リスクスコア算出 | Must |
| FR-009 | 初動対応案生成 | Must |
| FR-010 | Teams向け通知文生成 | Must |
| FR-011 | 管理職向けレポート生成 | Should |
| FR-012 | アラート履歴保存 | Should |

## 非機能要件

| ID | 要件 | 内容 |
|---|---|---|
| NFR-001 | 再現性 | デモはサンプルデータだけで安定して動く |
| NFR-002 | 説明可能性 | スコアと根拠を表示する |
| NFR-003 | 安全性 | 重要判断は人が承認する |
| NFR-004 | 低コスト | AI呼び出し回数を最小化する |
| NFR-005 | 拡張性 | CSV/JSONを将来ERPやPLMに差し替え可能にする |

## データモデル

### RiskEvent

```json
{
  "material": "naphtha",
  "risk_type": "supply_delay",
  "region": "Asia",
  "affected_period": "next 2-3 weeks",
  "delay_days_min": 5,
  "delay_days_max": 7,
  "allocation_rate_percent": 70,
  "severity": "high",
  "confidence": "high",
  "evidence": ["supplier notice says allocation volume may be limited to 70%"],
  "summary": "Naphtha-derived feedstock may face temporary allocation and delay."
}
```

### ImpactAssessment

```json
{
  "material": "naphtha",
  "risk_score": 82,
  "severity": "high",
  "inventory_days_min": 5,
  "impacted_products": ["Resin A", "Solvent B"],
  "impacted_customers": ["Customer Alpha", "Customer Beta"],
  "impacted_plants": ["Chiba Plant"],
  "alternatives": ["NAP-ALT-01"],
  "recommended_actions": [
    "Confirm allocation volume with supplier",
    "Reserve inventory for high-priority orders",
    "Check approved alternative material"
  ]
}
```

## 判定ロジック

1. 抽出された原材料名をBOMに照合する。
2. BOMから影響製品を特定する。
3. 影響製品に紐づく受注を特定する。
4. 工場別の在庫残日数を計算する。
5. 代替材の承認状態とリードタイムを確認する。
6. リスクスコアを算出する。
7. 閾値を超えた場合にアラートを生成する。

## 完了条件

MVPは、1回の実行で以下を生成できれば完了とする。

- 構造化されたリスクイベント
- 自社影響評価
- リスクスコア
- Teams通知文
- 管理職向けレポート
