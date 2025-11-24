---
sidebar_position: 4
---

# Security Framework

## Sandboxing Strategy

All code executes in **isolated E2B (Execute to Build) sandboxes**:

- Complete process isolation
- Separate filesystem per execution
- No persistent state between runs
- Automatic cleanup after execution
- No access to host system

## Permission Management

### Sandbox Permissions

- **Read/Write**: Limited to sandbox filesystem
- **Network**: Isolated (configurable)
- **System Calls**: Restricted by E2B
- **File Access**: Scoped to uploaded files only

### API Authentication

```bash
X-API-Key: your-secret-api-key-here
```

All requests require valid API key authentication to access code execution endpoints.

## Resource Limitations

### Execution Timeouts

- Default: Configurable per request
- Maximum: Set by E2B sandbox limits
- Automatic termination on timeout

### Memory Limits

- Enforced by E2B sandbox configuration
- Prevents memory exhaustion
- Automatic cleanup on limit breach

### Disk I/O Limits

- Scoped to sandbox filesystem
- Limited disk space per sandbox
- Automatic cleanup after execution

### CPU Limits

- Managed by E2B infrastructure
- Fair resource allocation
- Prevention of CPU monopolization

## Network Restrictions

- **Default**: Network isolated
- **Optional**: Restricted outbound for package installation
- **Inbound**: Completely blocked
- **Internal**: No cross-sandbox communication

## Timeout Policies

### Execution Timeout

- Configurable per task
- Automatic code termination
- Error returned to user
- Resource cleanup guaranteed

### Sandbox Lifetime

- Created on-demand
- Destroyed after execution
- No persistent connections
- Automatic resource release

## Security Best Practices

### For Users

1. **Input Validation**: Validate uploaded files
2. **Data Sanitization**: Clean input data
3. **Error Handling**: Handle execution failures gracefully
4. **API Keys**: Keep API keys secure and rotate regularly

### For Developers

1. **Code Review**: Generated code is reviewed by LLM
2. **Retry Logic**: Failed executions are retried with improved code
3. **Logging**: All executions are logged for audit
4. **Isolation**: Each execution is completely isolated

### Data Privacy

- Files are scoped to individual sandbox
- No data sharing between executions
- Automatic cleanup after completion
- No data persistence unless explicitly saved

