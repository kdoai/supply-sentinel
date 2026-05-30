# Business Workflow

## Operating Model

Supply Sentinel supports early warning and first response. It does not replace procurement, production control, sales, or management decisions.

## Current-State Problem

When external risk appears, teams usually perform the following manually:

1. Someone notices news or supplier email.
2. Procurement checks whether the material is relevant.
3. Production control checks inventory.
4. Engineering or master data checks BOM.
5. Sales checks impacted customers.
6. Teams discuss priority.
7. A manager asks for a summary report.
8. Actions are assigned manually.

This creates delay and inconsistent response quality.

## Future-State Workflow

1. Azure Functions starts Supply Sentinel on a schedule.
2. The agent collects external news and supplier notices.
3. AI extracts structured supply-risk events.
4. The impact engine checks internal inventory, BOM, alternatives, and orders.
5. If risk is above threshold, the agent creates an alert.
6. Teams receives impact summary and recommended first actions.
7. Procurement confirms supplier status.
8. Production control confirms operational impact.
9. Sales prepares customer response if needed.
10. Management approves major actions.
11. The alert remains unresolved until action status is updated.

## Human Roles

| Role | Responsibility |
|---|---|
| Procurement | Confirm supplier situation and procurement options. |
| Production Control | Validate plant and production impact. |
| Sales Operations | Identify customer communication needs. |
| Plant Manager | Confirm operational constraints. |
| Management | Approve supplier switching, customer notice, and major plan changes. |
| Supply Sentinel | Prepare evidence, impact assessment, recommendations, alert, and report. |

## AI Responsibility

AI can:

- Collect external information.
- Extract risk events.
- Summarize supplier notices.
- Compare risk to internal data.
- Generate recommended actions.
- Draft management report.
- Create alert or ticket draft.

AI must not independently:

- Change purchase orders.
- Switch suppliers.
- Notify customers formally.
- Change sales price.
- Change confirmed production plan.

## Alert Severity

| Severity | Condition | Action |
|---|---|---|
| Low | External risk exists but inventory is sufficient. | Store and monitor. |
| Medium | Impact exists, but shortage is not immediate. | Notify procurement and monitor. |
| High | Shortage likely within threshold period. | Notify cross-functional team. |
| Critical | High-priority customer or plant shutdown risk. | Escalate to management. |

## Recommended Thresholds For Demo

| Metric | Threshold |
|---|---:|
| High risk score | 70+ |
| Critical risk score | 85+ |
| Short inventory days | 7 days or fewer |
| Watch inventory days | 14 days or fewer |

## Business KPI Candidates

For judging, emphasize operational outcomes:

- Time to identify impacted products
- Time to identify impacted customers
- Time to prepare management report
- Reduction in manual investigation effort
- Earlier supplier/customer communication
- Fewer missed early-warning signals

## Demo Business Claim

Before Supply Sentinel:

- Teams need several hours to connect news, supplier notices, inventory, BOM, and orders.

After Supply Sentinel:

- The first impact assessment and response draft are generated in minutes.
