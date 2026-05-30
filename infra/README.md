# Infrastructure Plan

## Minimal Azure Services

| Purpose | Service |
|---|---|
| Scheduled runtime | Azure Functions Timer Trigger |
| AI extraction/report generation | Azure OpenAI via Microsoft Foundry |
| State/history | Azure Cosmos DB |
| Notification | Microsoft Teams via Power Automate or Logic Apps |
| Identity | Microsoft Entra ID |

## Cost-Minimal Strategy

- Run the Function only on schedule or manually during demo.
- Use sample files for the hackathon demo.
- Keep AI prompts short.
- Cache extracted events for demo reliability.
- Use Cosmos DB only for alert state if needed.

## Environment Variables

Suggested variables:

```text
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
COSMOS_ENDPOINT=
COSMOS_KEY=
COSMOS_DATABASE=
COSMOS_CONTAINER_ALERTS=
TEAMS_WEBHOOK_URL=
RUN_MODE=demo
```

## Deployment Notes

Start with local execution. Deploy only after the full data-to-alert flow works locally.

For the hackathon demo, prioritize repeatability over infrastructure complexity.
