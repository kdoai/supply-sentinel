# Data Design

The MVP uses small sample files instead of real company data.

This keeps the demo stable, cheap, and safe while still showing how real ERP, PLM, supplier, and order data would connect later.

## Sample Files

| File | Purpose |
|---|---|
| `samples/news_events.json` | External news-like supply risk signals. |
| `samples/supplier_notices.json` | Supplier notice text for AI extraction. |
| `samples/inventory.csv` | Material inventory by plant. |
| `samples/bom.csv` | Product-to-material relationship. |
| `samples/orders.csv` | Customer orders and priority. |
| `samples/alternatives.csv` | Approved alternative materials. |

## MVP Data Flow

1. External risk is extracted from news and supplier notices.
2. Extracted material is matched to BOM.
3. Related products are matched to customer orders.
4. Inventory days are calculated.
5. Alternatives are checked.
6. Risk score is calculated.
7. Alert and report are generated.

## Future Data Sources

- ERP inventory
- PLM/BOM master
- Supplier portal
- Email inbox
- PDF notices
- CRM/customer order system
- Logistics feeds
- Market price APIs
