---
sidebar_position: 3
title: File Upload
description: Uploading datasets, supported formats, and processing
---

# File Upload

Upload biological datasets for AI-powered analysis in your research sessions.

## Supported File Types

| Format | Extensions | Description |
|--------|------------|-------------|
| CSV | `.csv` | Comma-separated values |
| TSV | `.tsv`, `.txt` | Tab-separated values |
| Excel | `.xlsx`, `.xls` | Microsoft Excel files |
| PDF | `.pdf` | Research papers, documents |
| Text | `.txt`, `.md` | Plain text files |

## Upload Flow

File upload uses a two-step process for reliability:

```
1. Request Upload URL  →  Get presigned S3 URL
2. Upload to S3        →  Direct upload to storage
3. Confirm Upload      →  Trigger processing
```

## Step 1: Request Upload URL

```bash
curl -X POST "https://api.bioagents.xyz/api/files/request-upload" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "gene_expression.csv",
    "contentType": "text/csv",
    "size": 1048576,
    "conversationId": "conv_123456"
  }'
```

### Response

```json
{
  "ok": true,
  "data": {
    "fileId": "file_abc123",
    "uploadUrl": "https://s3.amazonaws.com/bucket/...",
    "s3Key": "uploads/user_001/conv_123/file_abc123/gene_expression.csv",
    "expiresAt": "2025-12-18T11:00:00Z"
  }
}
```

## Step 2: Upload to S3

Upload the file directly to the presigned URL:

```bash
curl -X PUT "${uploadUrl}" \
  -H "Content-Type: text/csv" \
  --data-binary @gene_expression.csv
```

## Step 3: Confirm Upload

Notify BioAgents that the upload is complete:

```bash
curl -X POST "https://api.bioagents.xyz/api/files/confirm-upload" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_abc123"
  }'
```

### Response

```json
{
  "ok": true,
  "data": {
    "fileId": "file_abc123",
    "status": "processing",
    "jobId": "job_fp_xyz789"
  }
}
```

## File Processing

After confirmation, BioAgents processes the file:

1. **Download** - Retrieves file from S3
2. **Preview** - Generates data preview (first rows)
3. **Description** - AI generates file description
4. **Indexing** - Makes file available for analysis

## Check File Status

```bash
curl "https://api.bioagents.xyz/api/files/file_abc123/status" \
  -H "Authorization: Bearer <token>"
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Upload URL generated, waiting for upload |
| `uploaded` | File received, not yet processed |
| `processing` | AI is analyzing the file |
| `ready` | File processed and ready for use |
| `error` | Processing failed |

### Ready Response

```json
{
  "ok": true,
  "data": {
    "fileId": "file_abc123",
    "status": "ready",
    "filename": "gene_expression.csv",
    "size": 1048576,
    "description": "CSV file containing gene expression data with 10,000 genes across 50 samples. Columns include gene_id, sample identifiers, and normalized expression values.",
    "preview": {
      "columns": ["gene_id", "sample_1", "sample_2"],
      "rows": 10000,
      "sample": [...]
    }
  }
}
```

## Using Files in Research

Once processed, reference files in your research queries:

```bash
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Analyze the differential expression patterns in my uploaded dataset and identify key longevity-related genes",
    "conversationId": "conv_123456"
  }'
```

The Analysis Agent will automatically use files attached to the conversation.

## Size Limits

| Limit | Value |
|-------|-------|
| Max file size | 2 GB |
| Max files per conversation | 10 |
| Upload URL expiry | 1 hour |

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `file_too_large` | File exceeds 2GB | Split into smaller files |
| `invalid_type` | Unsupported format | Convert to supported format |
| `upload_expired` | URL expired | Request new upload URL |
| `processing_failed` | Analysis error | Check file format, retry |
