---
sidebar_position: 2
title: Deep Research
description: How the research pipeline works and starting a session
---

# Deep Research

Deep Research is BioAgents' comprehensive literature review and analysis system. It orchestrates multiple AI agents to conduct thorough research on biological topics.

## How It Works

When you start a deep research session, BioAgents executes a multi-stage pipeline:

```
User Query
    │
    ▼
┌─────────────────┐
│ Planning Agent  │  → Creates research plan with tasks
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Literature Agent│  → Searches OpenScholar, Edison, Knowledge bases
│ Analysis Agent  │  → Processes uploaded datasets (if any)
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Hypothesis Agent│  → Generates research hypotheses
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Reflection Agent│  → Synthesizes findings, updates world state
└─────────────────┘
    │
    ▼
┌─────────────────┐
│   Reply Agent   │  → Generates comprehensive response
└─────────────────┘
```

## Starting a Research Session

### API Request

```bash
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are the key molecular pathways involved in cellular senescence?"
  }'
```

### Response

```json
{
  "jobId": "job_dr_abc123",
  "messageId": "msg_xyz789",
  "conversationId": "conv_123456",
  "userId": "user_001",
  "status": "queued",
  "pollUrl": "/api/deep-research/status/msg_xyz789"
}
```

## Checking Progress

Poll the status endpoint to track research progress:

```bash
curl "https://api.bioagents.xyz/api/deep-research/status/msg_xyz789" \
  -H "Authorization: Bearer <token>"
```

### Status Values

| Status | Description |
|--------|-------------|
| `queued` | Job is waiting to be processed |
| `processing` | Research is in progress |
| `completed` | Research finished successfully |
| `failed` | An error occurred |

## Research Plan

The Planning Agent creates a structured plan with tasks:

```json
{
  "currentObjective": "Investigate cellular senescence pathways",
  "plan": [
    {
      "type": "LITERATURE",
      "objective": "Search for p53/p21 pathway studies",
      "level": 0
    },
    {
      "type": "LITERATURE",
      "objective": "Search for SASP factor research",
      "level": 0
    }
  ]
}
```

### Task Types

- **LITERATURE** - Search academic databases and knowledge bases
- **ANALYSIS** - Process uploaded datasets with AI analysis

## Literature Sources

Deep Research queries multiple sources:

| Source | Description |
|--------|-------------|
| OpenScholar | Academic paper search |
| Edison | BioAgents literature database |
| Knowledge Base | Custom RAG-powered retrieval |

## Real-time Updates

Subscribe to WebSocket notifications for live progress:

```javascript
const ws = new WebSocket('wss://api.bioagents.xyz/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'research:progress') {
    console.log('Task completed:', data.task);
  }

  if (data.type === 'research:complete') {
    console.log('Research finished:', data.result);
  }
};
```

## Response Time

Typical research sessions take 5-30 minutes depending on:

- Complexity of the research question
- Number of literature sources found
- Whether dataset analysis is required
- Current system load

## Best Practices

1. **Be specific** - Clear questions yield better results
2. **Provide context** - Include relevant background in your query
3. **Upload data** - Include datasets for analysis when relevant
4. **Iterate** - Use follow-up questions to refine findings
