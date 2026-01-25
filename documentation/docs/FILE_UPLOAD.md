# File Upload Guide

BioAgents uses presigned S3 URLs for secure, direct-to-storage file uploads. This allows large files (up to 2GB) to be uploaded without passing through the API server.

## Table of Contents

- [Overview](#overview)
- [Upload Flow](#upload-flow)
- [API Endpoints](#api-endpoints)
- [Configuration](#configuration)
- [Integration Examples](#integration-examples)
- [Security](#security)
- [Supported File Types](#supported-file-types)
- [Troubleshooting](#troubleshooting)

## Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           File Upload Flow                                    │
└──────────────────────────────────────────────────────────────────────────────┘

  Client                      API Server                         S3 Storage
    │                             │                                   │
    │  1. POST /api/files/upload-url                                  │
    │     {filename, contentType, size}                               │
    │────────────────────────────►│                                   │
    │                             │                                   │
    │                             │  Generate presigned URL           │
    │                             │──────────────────────────────────►│
    │                             │                                   │
    │  {fileId, uploadUrl, s3Key} │                                   │
    │◄────────────────────────────│                                   │
    │                             │                                   │
    │  2. PUT {uploadUrl}         │                                   │
    │     (raw file bytes)        │                                   │
    │─────────────────────────────────────────────────────────────────►
    │                             │                                   │
    │  3. POST /api/files/confirm │                                   │
    │     {fileId}                │                                   │
    │────────────────────────────►│                                   │
    │                             │  Verify file exists               │
    │                             │──────────────────────────────────►│
    │                             │                                   │
    │                             │  Process file (generate description)
    │                             │                                   │
    │  {status: "ready", description}                                 │
    │◄────────────────────────────│                                   │
```

### Why Presigned URLs?

| Benefit | Description |
|---------|-------------|
| **Large files** | Upload up to 2GB without server memory issues |
| **Direct upload** | Files go directly to S3, reducing server load |
| **Security** | URLs are time-limited and size-enforced |
| **Resumable** | Failed uploads can be retried with same URL |

## Upload Flow

### Step 1: Request Upload URL

Request a presigned URL from the API server.

```bash
curl -X POST https://api.example.com/api/files/upload-url \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "dataset.csv",
    "contentType": "text/csv",
    "size": 1048576,
    "conversationId": "optional-existing-conversation-id"
  }'
```

**Response:**
```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://bucket.s3.amazonaws.com/user/.../uploads/dataset.csv?X-Amz-...",
  "s3Key": "user/abc123/conversation/def456/uploads/dataset.csv",
  "expiresAt": "2024-01-15T12:00:00.000Z",
  "conversationId": "def456",
  "conversationStateId": "ghi789"
}
```

### Step 2: Upload to S3

Upload the file directly to S3 using the presigned URL.

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: text/csv" \
  -H "Content-Length: 1048576" \
  --data-binary @dataset.csv
```

**Important:** The `Content-Length` header must match the `size` declared in step 1. S3 will reject mismatched sizes.

### Step 3: Confirm Upload

Notify the server that the upload is complete.

```bash
curl -X POST https://api.example.com/api/files/confirm \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response:**
```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ready",
  "filename": "dataset.csv",
  "size": 1048576,
  "description": "CSV data with 10,000 rows of gene expression values"
}
```

## API Endpoints

### POST /api/files/upload-url

Request a presigned URL for uploading a file.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filename` | string | Yes | Name of the file |
| `contentType` | string | Yes | MIME type (e.g., `text/csv`) |
| `size` | number | Yes | File size in bytes |
| `conversationId` | string | No | Existing conversation ID |

**Response:**
| Field | Type | Description |
|-------|------|-------------|
| `fileId` | string | Unique file identifier |
| `uploadUrl` | string | Presigned S3 URL (valid for 1 hour) |
| `s3Key` | string | Full S3 path |
| `expiresAt` | string | URL expiration timestamp |
| `conversationId` | string | Conversation ID (created if not provided) |
| `conversationStateId` | string | Conversation state ID |

### POST /api/files/confirm

Confirm that the file upload is complete and trigger processing.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileId` | string | Yes | File ID from upload-url response |

**Response:**
| Field | Type | Description |
|-------|------|-------------|
| `fileId` | string | File identifier |
| `status` | string | `ready`, `processing`, or `error` |
| `filename` | string | Original filename |
| `size` | number | File size in bytes |
| `description` | string | AI-generated file description |
| `jobId` | string | Job ID (if queue mode enabled) |

### GET /api/files/:fileId/status

Check the processing status of an uploaded file.

**Response:**
| Field | Type | Description |
|-------|------|-------------|
| `fileId` | string | File identifier |
| `status` | string | `pending`, `uploaded`, `processing`, `ready`, `error` |
| `filename` | string | Original filename |
| `size` | number | File size in bytes |
| `description` | string | AI-generated description (when ready) |
| `error` | string | Error message (if failed) |

### DELETE /api/files/:fileId

Delete an uploaded file.

**Response:**
```json
{
  "success": true
}
```

## Configuration

### Environment Variables

```bash
# Storage provider (required for file uploads)
STORAGE_PROVIDER=s3

# S3 Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=your-bucket-name

# For S3-compatible services (DigitalOcean Spaces, MinIO, etc.)
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

### Limits

| Limit | Value | Location |
|-------|-------|----------|
| Max file size | 2GB | `src/services/files/index.ts` |
| URL expiration | 1 hour | `src/services/files/index.ts` |
| Max files per request | 5 | Client-side only |

### CORS Configuration

For S3-compatible services (DigitalOcean Spaces, MinIO), configure CORS:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-domain.com"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

## Integration Examples

### TypeScript/JavaScript

```typescript
interface UploadUrlResponse {
  fileId: string;
  uploadUrl: string;
  s3Key: string;
  expiresAt: string;
  conversationId: string;
  conversationStateId: string;
}

interface ConfirmResponse {
  fileId: string;
  status: 'ready' | 'processing' | 'error';
  filename: string;
  size: number;
  description?: string;
}

async function uploadFile(
  file: File,
  authToken: string,
  conversationId?: string
): Promise<ConfirmResponse> {
  const apiUrl = 'https://api.example.com';

  // Step 1: Request upload URL
  const urlResponse = await fetch(`${apiUrl}/api/files/upload-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      conversationId,
    }),
  });

  if (!urlResponse.ok) {
    throw new Error('Failed to get upload URL');
  }

  const { fileId, uploadUrl } = await urlResponse.json() as UploadUrlResponse;

  // Step 2: Upload to S3
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to S3');
  }

  // Step 3: Confirm upload
  const confirmResponse = await fetch(`${apiUrl}/api/files/confirm`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId }),
  });

  if (!confirmResponse.ok) {
    throw new Error('Failed to confirm upload');
  }

  return confirmResponse.json() as Promise<ConfirmResponse>;
}

// Usage
const file = document.querySelector('input[type="file"]').files[0];
const result = await uploadFile(file, 'your-jwt-token', 'conversation-id');
console.log('File ready:', result.description);
```

### React Hook

```typescript
import { useState } from 'react';

interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
}

export function useFileUpload(apiUrl: string, authToken: string) {
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const upload = async (file: File, conversationId?: string) => {
    setState({ isUploading: true, progress: 0, error: null });

    try {
      // Step 1: Get upload URL
      setState(s => ({ ...s, progress: 10 }));
      const urlRes = await fetch(`${apiUrl}/api/files/upload-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          conversationId,
        }),
      });

      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { fileId, uploadUrl } = await urlRes.json();

      // Step 2: Upload to S3
      setState(s => ({ ...s, progress: 30 }));
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadRes.ok) throw new Error('Upload failed');

      // Step 3: Confirm
      setState(s => ({ ...s, progress: 80 }));
      const confirmRes = await fetch(`${apiUrl}/api/files/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId }),
      });

      if (!confirmRes.ok) throw new Error('Confirm failed');

      setState({ isUploading: false, progress: 100, error: null });
      return confirmRes.json();
    } catch (error) {
      setState({
        isUploading: false,
        progress: 0,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      throw error;
    }
  };

  return { ...state, upload };
}
```

### Python

```python
import requests

def upload_file(file_path: str, auth_token: str, api_url: str, conversation_id: str = None):
    """Upload a file using presigned S3 URL."""

    import os
    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    # Guess content type
    import mimetypes
    content_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

    headers = {
        'Authorization': f'Bearer {auth_token}',
        'Content-Type': 'application/json'
    }

    # Step 1: Request upload URL
    url_response = requests.post(
        f'{api_url}/api/files/upload-url',
        headers=headers,
        json={
            'filename': filename,
            'contentType': content_type,
            'size': file_size,
            'conversationId': conversation_id
        }
    )
    url_response.raise_for_status()
    url_data = url_response.json()

    # Step 2: Upload to S3
    with open(file_path, 'rb') as f:
        upload_response = requests.put(
            url_data['uploadUrl'],
            headers={'Content-Type': content_type},
            data=f
        )
    upload_response.raise_for_status()

    # Step 3: Confirm upload
    confirm_response = requests.post(
        f'{api_url}/api/files/confirm',
        headers=headers,
        json={'fileId': url_data['fileId']}
    )
    confirm_response.raise_for_status()

    return confirm_response.json()

# Usage
result = upload_file(
    'data.csv',
    'your-jwt-token',
    'https://api.example.com'
)
print(f"File ready: {result['description']}")
```

## Security

### Size Enforcement

The presigned URL is signed with the exact `Content-Length`. S3 will reject uploads with different sizes:

```
# Declared size: 1MB
# Attempted upload: 5GB
# Result: 403 SignatureDoesNotMatch
```

This prevents abuse where someone might try to upload much larger files than declared.

### URL Expiration

Presigned URLs expire after **1 hour**. After expiration:
- Upload attempts fail with 403
- Client must request a new URL

### Authentication

All file upload endpoints require authentication:
- JWT token (`Authorization: Bearer <token>`)
- API key (`X-API-Key: <key>`)
- x402 payment (for payment-gated routes)

### File Ownership

Files are associated with:
- User ID (from auth token)
- Conversation ID

Users can only access their own files.

## Supported File Types

| Type | Extensions | Use Case |
|------|------------|----------|
| CSV | `.csv` | Tabular data |
| Excel | `.xlsx`, `.xls` | Spreadsheets |
| PDF | `.pdf` | Documents |
| JSON | `.json` | Structured data |
| Text | `.txt` | Plain text |
| Markdown | `.md` | Documentation |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp` | Visual data |

## Troubleshooting

### Upload URL Request Failed

**Error:** `Storage provider not configured`

**Solution:** Ensure S3 is configured in `.env`:
```bash
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=...
```

### S3 Upload Failed with 403

**Error:** `SignatureDoesNotMatch` or `AccessDenied`

**Solutions:**
1. **Size mismatch:** Ensure `Content-Length` header matches declared `size`
2. **URL expired:** Request a new upload URL (valid for 1 hour)
3. **CORS:** Configure CORS on your S3 bucket
4. **Credentials:** Verify AWS credentials have PutObject permission

### CORS Error in Browser

**Error:** `Access-Control-Allow-Origin` error

**Solution:** Configure CORS on your S3/Spaces bucket:
- Allow your frontend domain
- Allow PUT method
- Allow Content-Type header

### File Processing Stuck

**Error:** Status remains `processing`

**Solutions:**
1. Check worker logs: `docker compose logs -f worker`
2. Verify job queue is running: `USE_JOB_QUEUE=true`
3. Check Bull Board: `/admin/queues`

### File Not Found After Upload

**Error:** `File not found` when checking status

**Solutions:**
1. Verify upload completed successfully (step 2)
2. Check S3 bucket for the file
3. Ensure using correct `fileId` from step 1
