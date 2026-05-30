# Supply Sentinel

Supply Sentinel is an early-warning AI agent for supply risk.

It monitors external signals such as news and supplier notices, matches them with internal inventory, BOM, alternatives, and order data, then generates business impact assessments and first-response recommendations.

## Core Message

Supply Sentinel translates external supply risks into internal business impact.

Instead of trying to predict the future perfectly, it shortens the time from "something happened outside the company" to "we know which products, customers, plants, and actions are affected."

## MVP Scope

The hackathon MVP focuses on one high-impact scenario:

- Detect naphtha supply risk from external news and supplier notice text.
- Extract material, region, period, delay, and confidence using Azure OpenAI.
- Compare the event with sample inventory, BOM, alternatives, and order data.
- Calculate affected products, customers, plants, remaining inventory days, and risk score.
- Generate a Teams-style alert and management report.
- Keep final decisions human-approved.

## Quick Start

This MVP runs with Node.js (>=20) and **no external packages, no API keys** — all
external AI/data is mocked locally so the demo is fully reproducible offline.

### Interactive map dashboard (main demo)

```powershell
node src\serve.mjs
```

Then open http://localhost:4173 in a browser. The server regenerates the impact
data on startup and serves a dark "mission-control" dashboard:

- **World map with glowing import routes** ("光のルート") — where each material is
  sourced from (upstream refineries → midstream suppliers/ports → our downstream
  plants). Disrupted routes pulse red, resilient routes glow green.
- **Sourcing mix & spend** — share (%) and monthly procurement spend (課金額) per
  route, with the portion now at risk highlighted.
- **Risk score, KPIs, and impact** — affected products, customers, plants, and
  minimum inventory days.
- **Process-mining flow** — Origin → Supplier/Port → Plant → Product → Customer.
- Impacted orders, evidence, recommended first actions, and human-approval items.

### Headless pipeline / artifacts

```powershell
node src\run-demo.mjs
```

On Windows PowerShell, `npm.ps1` may be blocked by execution policy. Use `npm.cmd`:

```powershell
npm.cmd test          # run unit tests
npm.cmd run demo      # run the headless pipeline
npm.cmd run build:web # prepare static GitHub Pages assets
npm.cmd start         # launch the dashboard server (alias: npm.cmd run dev)
```

Generated demo outputs are written to:

```text
outputs/latest/
+-- risk_event.json
+-- impact_assessment.json
+-- dashboard_data.json   <- consolidated model consumed by the dashboard
+-- teams_alert.md
+-- management_report.md
+-- dashboard.html        <- legacy static one-page summary
+-- alert_history.json
```

## Repository Structure

```text
.
+-- README.md
+-- docs/
|   +-- 00_executive_summary.md
|   +-- 01_product_concept.md
|   +-- 02_requirements.md
|   +-- 03_architecture.md
|   +-- 04_business_workflow.md
|   +-- 05_implementation_plan.md
|   +-- 06_demo_script.md
|   +-- 07_judging_strategy.md
|   +-- 08_hackathon_master_plan_ja.md
|   +-- 09_mvp_spec_ja.md
|   +-- 10_demo_storyboard_ja.md
|   +-- 11_implementation_notes_ja.md
|   +-- 12_azure_cloud_requirements_ja.md
|   +-- 13_azure_basic_design_ja.md
|   +-- 14_github_cicd_azure_ja.md
|   +-- 15_azure_cloud_plan_summary_ja.html
+-- data/
|   +-- README.md
|   +-- samples/
|   |   +-- news_events.json
|   |   +-- supplier_notices.json
|   |   +-- inventory.csv
|   |   +-- bom.csv
|   |   +-- orders.csv
|   |   +-- alternatives.csv
|   |   +-- supply_routes.csv      <- geo sourcing routes (origin/supplier/port/plant, share %, spend)
|   +-- geo/
|       +-- world_countries.geojson
+-- prompts/
|   +-- risk_extraction.md
|   +-- impact_summary.md
|   +-- management_report.md
+-- src/
|   +-- run-demo.mjs               <- headless pipeline
|   +-- serve.mjs                  <- local dashboard server (no deps)
|   +-- supply_sentinel/
|   |   +-- ingestion.mjs
|   |   +-- riskExtraction.mjs     <- AI boundary (mocked, deterministic)
|   |   +-- impactEngine.mjs       <- products/customers/plants/inventory + score
|   |   +-- routeEngine.mjs        <- geo routes, sourcing mix, spend, process flow
|   |   +-- scoring.mjs
|   |   +-- alertWriter.mjs
|   |   +-- reportWriter.mjs
|   |   +-- dashboardWriter.mjs
|   |   +-- stateStore.mjs
|   |   +-- workflow.mjs           <- orchestration + dashboard model
|   +-- function_app/
|       +-- timerTrigger.mjs
+-- web/                            <- interactive map dashboard (offline, no CDN)
|   +-- index.html
|   +-- styles.css
|   +-- js/
|   |   +-- app.js                 <- fetch data + wire modules
|   |   +-- map.js                 <- canvas world map + glowing routes
|   |   +-- flow.js                <- process-mining flow graph (SVG)
|   |   +-- panels.js              <- KPIs / sourcing mix / tables
|   +-- assets/
|       +-- world.geojson
+-- tests/
|   +-- scoring.test.mjs
|   +-- impact_engine.test.mjs
|   +-- route_engine.test.mjs
+-- infra/
    +-- README.md
```

## Recommended Microsoft Stack

- Runtime: Azure Functions with Timer Trigger
- AI: Microsoft Foundry / Azure OpenAI / Azure AI Agent Service
- State: Azure Cosmos DB
- Notification: Microsoft Teams via Power Automate or Logic Apps
- Auth: Microsoft Entra ID
- Development: GitHub / GitHub Copilot

## What We Deliberately Do Not Build

- Stock trading prediction
- Full demand forecasting
- Automatic purchase order execution
- Automatic supplier switching
- Full-scale ERP integration
- Broad multi-material monitoring
- Large dashboard platform

The MVP wins by doing one thing clearly: external risk detection plus internal impact assessment.
