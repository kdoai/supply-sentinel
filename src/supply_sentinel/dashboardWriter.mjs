export function writeDashboardHtml(assessment) {
  const productRows = assessment.impacted_orders
    .map(
      (order) => `
        <tr>
          <td>${escapeHtml(order.product)}</td>
          <td>${escapeHtml(order.customer)}</td>
          <td>${escapeHtml(order.plant)}</td>
          <td>${escapeHtml(order.due_date)}</td>
          <td><span class="priority priority-${escapeHtml(order.priority)}">${escapeHtml(order.priority)}</span></td>
        </tr>`,
    )
    .join("");

  const inventoryCards = assessment.inventory
    .map(
      (item) => `
        <article class="metric-card">
          <span class="metric-label">${escapeHtml(item.plant)}</span>
          <strong>${item.days_of_supply} days</strong>
          <small>${item.stock_qty} ${escapeHtml(item.unit)} / ${item.daily_usage} per day</small>
        </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Supply Sentinel Impact Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #607086;
      --line: #d9e0ea;
      --panel: #ffffff;
      --bg: #f5f7fb;
      --blue: #174a8b;
      --red: #c9362f;
      --amber: #b66a00;
      --green: #18794e;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
    }

    header {
      background: #0b2347;
      color: #fff;
      padding: 24px 32px;
      border-bottom: 4px solid #2f80ed;
    }

    header h1 {
      margin: 0 0 8px;
      font-size: 32px;
      letter-spacing: 0;
    }

    header p {
      margin: 0;
      max-width: 920px;
      color: #dce8f8;
      line-height: 1.5;
    }

    main {
      padding: 24px 32px 40px;
      max-width: 1180px;
      margin: 0 auto;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: 1.1fr 2fr;
      gap: 16px;
      align-items: stretch;
    }

    .score-panel,
    .panel,
    .metric-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
    }

    .score-panel {
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    .score {
      font-size: 64px;
      font-weight: 800;
      color: var(--red);
      line-height: 1;
    }

    .severity {
      display: inline-flex;
      width: fit-content;
      padding: 5px 10px;
      border-radius: 999px;
      color: #fff;
      background: var(--red);
      font-size: 13px;
      text-transform: uppercase;
      font-weight: 700;
    }

    .panel {
      padding: 20px;
    }

    .panel h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .fact {
      border-left: 4px solid var(--blue);
      padding: 8px 12px;
      background: #f8fbff;
    }

    .fact span,
    .metric-label {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 4px;
    }

    .fact strong {
      font-size: 18px;
    }

    .section-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .metric-card {
      padding: 16px;
    }

    .metric-card strong {
      display: block;
      font-size: 28px;
      color: var(--blue);
      margin-bottom: 4px;
    }

    .metric-card small {
      color: var(--muted);
    }

    ul {
      margin: 0;
      padding-left: 20px;
      line-height: 1.55;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th,
    td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-weight: 600;
      background: #f8fafc;
    }

    .priority {
      display: inline-flex;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      background: #edf2f7;
    }

    .priority-high {
      color: #fff;
      background: var(--red);
    }

    .priority-medium {
      color: #fff;
      background: var(--amber);
    }

    .footer-note {
      color: var(--muted);
      margin-top: 16px;
      font-size: 13px;
    }

    @media (max-width: 860px) {
      header,
      main {
        padding-left: 18px;
        padding-right: 18px;
      }

      .summary-grid,
      .section-grid,
      .facts,
      .metric-grid {
        grid-template-columns: 1fr;
      }

      .score {
        font-size: 48px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Supply Sentinel</h1>
    <p>External supply risk translated into company-specific impact: products, customers, plants, inventory days, evidence, and first actions.</p>
  </header>
  <main>
    <section class="summary-grid" aria-label="Risk summary">
      <article class="score-panel">
        <span class="severity">${escapeHtml(assessment.severity)}</span>
        <div>
          <div class="score">${assessment.risk_score}</div>
          <div>/ 100 risk score</div>
        </div>
        <div>
          <strong>${escapeHtml(assessment.material)}</strong>
          <p class="footer-note">Affected period: ${escapeHtml(assessment.affected_period)}</p>
        </div>
      </article>

      <article class="panel">
        <h2>Business Impact</h2>
        <div class="facts">
          <div class="fact"><span>Products</span><strong>${assessment.impacted_products.length}</strong></div>
          <div class="fact"><span>Customers</span><strong>${assessment.impacted_customers.length}</strong></div>
          <div class="fact"><span>Minimum inventory</span><strong>${assessment.inventory_days_min} days</strong></div>
        </div>
        <p class="footer-note">Generated at ${escapeHtml(assessment.generated_at)}. Major business actions require human approval.</p>
      </article>
    </section>

    <section class="section-grid">
      <article class="panel">
        <h2>Inventory Exposure</h2>
        <div class="metric-grid">${inventoryCards}</div>
      </article>

      <article class="panel">
        <h2>Recommended First Actions</h2>
        <ul>${assessment.recommended_actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>
      </article>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Impacted Orders</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Customer</th>
            <th>Plant</th>
            <th>Due date</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>${productRows}</tbody>
      </table>
    </section>

    <section class="section-grid">
      <article class="panel">
        <h2>Evidence</h2>
        <ul>${assessment.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>

      <article class="panel">
        <h2>Scoring Basis</h2>
        <ul>${Object.entries(assessment.scoring_factors)
          .map(([name, points]) => `<li>${escapeHtml(name.replaceAll("_", " "))}: ${points}</li>`)
          .join("")}</ul>
      </article>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
