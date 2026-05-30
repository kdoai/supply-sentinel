# Requirements

## MVP Goal

Build a minimal but convincing prototype that demonstrates:

1. External supply-risk detection.
2. Internal business impact assessment.
3. First-response recommendation.
4. Alert and report generation.

## Must-Have Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| FR-001 | Scheduled execution | Run the monitoring workflow on a timer. |
| FR-002 | External input ingestion | Load sample news and supplier notices. |
| FR-003 | AI risk extraction | Extract material, risk type, period, severity, and evidence. |
| FR-004 | Internal data lookup | Load inventory, BOM, orders, and alternatives. |
| FR-005 | Impacted product detection | Identify products using the affected material. |
| FR-006 | Inventory day calculation | Calculate days of supply by plant and material. |
| FR-007 | Customer impact detection | Identify orders and customers connected to impacted products. |
| FR-008 | Risk scoring | Calculate risk score using transparent rules. |
| FR-009 | Recommended actions | Generate first-response recommendations. |
| FR-010 | Alert generation | Generate Teams-style alert content. |
| FR-011 | Management report | Generate a concise management report. |

## Should-Have Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| FR-101 | Alert history | Save generated alerts and status. |
| FR-102 | Unresolved alert review | Re-evaluate unresolved alerts on the next run. |
| FR-103 | Evidence display | Show which external/internal data caused the alert. |
| FR-104 | Manual approval status | Track proposed actions as pending, approved, or rejected. |

## Out Of Scope

| Area | Reason |
|---|---|
| Real-time streaming | Timer-based execution is enough for the demo. |
| SNS/X analysis | Noisy and implementation-heavy for MVP. |
| Stock prediction | Changes the product category and risk profile. |
| Automatic ordering | Requires stronger governance and system integration. |
| Production planning optimization | Separate problem from early warning. |
| Full ERP integration | Use sample CSV/JSON for hackathon realism. |
| Multi-tenant auth | Not needed for MVP. |

## Non-Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| NFR-001 | Explainability | Alerts must include evidence and calculation basis. |
| NFR-002 | Safety | Final business actions require human approval. |
| NFR-003 | Cost control | Use small sample data and limited AI calls. |
| NFR-004 | Replaceable data | Sample CSV/JSON can later be replaced by ERP or data lake inputs. |
| NFR-005 | Demo reliability | Demo can run deterministically with local sample data. |

## Risk Score Requirements

Risk score should be transparent and partly deterministic.

Suggested scoring:

| Factor | Points |
|---|---:|
| External event severity | 30 |
| Supplier notice confidence | 20 |
| Inventory days risk | 25 |
| Customer/order priority | 15 |
| Alternative availability | 10 |
| Total | 100 |

## Acceptance Criteria

The MVP is acceptable if it can show:

- A naphtha risk event is extracted from external input.
- Impacted products are found from BOM.
- Remaining inventory days are calculated.
- High-priority customers are identified.
- Risk score is produced with evidence.
- A Teams alert and management report are generated.
