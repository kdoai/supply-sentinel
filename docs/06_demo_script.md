# Demo Script

## Demo Goal

Show that Supply Sentinel can detect an external naphtha supply risk, evaluate internal impact, and prepare the first response.

## Demo Length

5 minutes.

## Storyline

The company uses naphtha-derived materials in multiple products. A new external signal indicates supply instability. The team needs to know whether this matters, which products are exposed, and what action should be taken first.

## Demo Flow

### 1. Open With Business Problem

Message:

> Supply risks do not become business problems when the news appears. They become business problems when we do not know which products, customers, and plants are exposed.

Show:

- News input
- Supplier notice input
- Internal inventory/BOM/order sample

### 2. Start Scheduled Monitoring

Message:

> Supply Sentinel runs as a scheduled monitoring agent using Azure Functions.

Show:

- Timer trigger or local command representing scheduled run

### 3. AI Extracts Risk Event

Message:

> Azure OpenAI extracts the affected material, risk type, delay period, severity, and evidence.

Show extracted JSON:

```json
{
  "material": "naphtha",
  "risk_type": "supply_delay",
  "severity": "high",
  "affected_period": "next 2-3 weeks",
  "evidence": "supplier allocation and refinery disruption signals"
}
```

### 4. Impact Engine Checks Internal Data

Message:

> The important step is not just detecting the news. The agent checks whether this external risk affects our own products.

Show:

- BOM match
- Inventory days
- Orders and customer priority
- Alternatives

### 5. Risk Score And Impact

Message:

> The result is a company-specific risk assessment.

Show:

```text
Risk Score: 82/100
Material: Naphtha
Inventory Days: 5
Impacted Products: Resin A, Solvent B
Impacted Customers: Customer Alpha, Customer Beta
Impacted Plant: Chiba Plant
Severity: High
```

### 6. Teams Alert

Message:

> The agent posts an alert with evidence and recommended first actions.

Show alert:

```text
[Supply Sentinel] High supply risk detected

Material: Naphtha
Risk Score: 82/100
Estimated inventory days: 5
Impacted products: Resin A, Solvent B
Impacted customers: Customer Alpha, Customer Beta

Recommended first actions:
- Confirm allocation volume with supplier.
- Reserve inventory for high-priority orders.
- Check approved alternative material NAP-ALT-01.
- Prepare customer communication draft.
```

### 7. Management Report

Message:

> Management receives a concise report. AI prepares the evidence; humans approve major actions.

Show:

- Summary
- Evidence
- Impact
- Options
- Human approval required

### 8. Closing

Message:

> Supply Sentinel does not replace business judgment. It shortens the time required to gather evidence, identify impact, and prepare the first response.

## Backup Demo Plan

If live AI call fails:

- Use pre-extracted JSON from sample data.
- Explain that demo mode uses cached extraction for reliability.
- Continue with impact assessment, alert, and report generation.

## Presenter Notes

Avoid claiming perfect prediction.

Use these phrases:

- Early warning
- Business impact translation
- First-response acceleration
- Evidence-backed recommendation
- Human approval

Avoid these phrases:

- Perfect prediction
- Fully automatic procurement
- Stock trading signal
- Autonomous supplier switching
