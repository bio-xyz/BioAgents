---
title: Tools Reference
sidebar_position: 4
---

# Tools Reference

Available AI tools that can be invoked during chat interactions.

## Planning Tool

**Name:** `planning`

Strategic planning and task decomposition for complex queries.

**Parameters:**
- `objective` (string) - The goal to plan for
- `constraints` (array) - Any constraints to consider

---

## Semantic Scholar

**Name:** `semanticScholar`

Search and retrieve scientific papers from Semantic Scholar.

**Parameters:**
- `query` (string) - Search query
- `limit` (number) - Maximum results (default: 10)

---

## Hypothesis Generation

**Name:** `hypothesisGeneration`

Generate scientific hypotheses based on research context.

**Parameters:**
- `context` (string) - Research context
- `domain` (string) - Scientific domain

---

## Code Execution

**Name:** `codeExecution`

Execute Python code in an isolated sandbox.

**Parameters:**
- `code` (string) - Python code to execute
- `context` (object) - Execution context and variables

---

## Knowledge Retrieval

**Name:** `knowledge`

Retrieve information from the knowledge base.

**Parameters:**
- `query` (string) - Query for knowledge retrieval
- `filters` (object) - Optional filters

---

## File Processing

**Name:** `fileUpload`

Process uploaded files (PDF, CSV, TXT, images).

**Parameters:**
- `fileId` (string) - ID of the uploaded file
- `operation` (string) - Operation to perform: `parse | analyze | extract`

---

## Deep Research

**Name:** `deepResearch`

Perform comprehensive multi-source research.

**Parameters:**
- `query` (string) - Research question
- `depth` (string) - Research depth: `basic | intermediate | comprehensive`
- `sources` (array) - Preferred sources

---

## Next Steps

- [REST API Reference](./rest-api) - HTTP endpoints
- [WebSocket API](./websocket) - Real-time streaming
- [Download OpenAPI Spec](pathname:///openapi.yaml) - Machine-readable API specification

