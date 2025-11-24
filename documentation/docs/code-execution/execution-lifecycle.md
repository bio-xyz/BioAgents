---
sidebar_position: 6
---

# Execution Lifecycle

## FST Workflow

The complete execution follows a **Finite State Transducer (FST)** pattern:

```
START
  ↓
[plan] → Generate execution plan
  ↓
[code_generation] → Create Python code
  ↓
[execution] → Run in E2B sandbox
  ↓
[analyze] → Process results
  ↓
END
```

## Pre-execution Phase

### 1. Task Reception

```python
POST /api/task/run/sync
- task_description
- data_files (optional)
```

### 2. Planning State

The agent analyzes the task:

- Understand user intent
- Identify required steps
- Determine data requirements
- Create execution plan

**Output**: Structured plan with action steps

### 3. Code Generation State

Based on the plan, generate Python code:

- Import necessary libraries
- Load provided data files
- Implement analysis steps
- Save results/visualizations

**Output**: Executable Python script

### 4. Validation

Before execution:

- Syntax validation
- Security checks
- File path verification
- Import statement validation

## Runtime Phase

### 1. Sandbox Creation

E2B creates an isolated environment:

- Fresh Python 3.11+ environment
- Pre-installed data science libraries
- Isolated filesystem
- Resource limits enforced

### 2. File Upload

User-provided files are uploaded to sandbox:

```python
# Files available at sandbox root
/uploaded_file.csv
/data.json
```

### 3. Code Execution

Execute generated Python code:

- Run in isolated process
- Capture stdout/stderr
- Monitor resource usage
- Enforce timeout limits

### 4. Execution Monitoring

Track execution progress:

- Real-time logging
- Resource consumption
- Timeout checking
- Error detection

### 5. Output Capture

Collect all execution outputs:

- **stdout**: Print statements, logs
- **stderr**: Error messages
- **Files**: Generated plots, CSV outputs
- **Return values**: Final results

## Post-execution Phase

### 1. Result Collection

Gather all execution artifacts:

```python
{
    "logs": "execution output",
    "error": null | "error message",
    "files": ["plot.png", "results.csv"],
    "success": true | false
}
```

### 2. Analysis State

Process execution results:

- Interpret outputs
- Generate insights
- Format response for user
- Handle errors (if any)

### 3. Resource Cleanup

Automatic cleanup by E2B:

- Destroy sandbox instance
- Release compute resources
- Delete temporary files
- Close network connections

### 4. Response Delivery

Return formatted results:

```python
{
    "status": "success",
    "analysis": "LLM-generated insights",
    "outputs": {
        "plots": ["base64_encoded_image"],
        "data": "processed_results"
    }
}
```

## Error Handling in Lifecycle

### On Execution Error

```
[execution] → ERROR
    ↓
Retry Logic (max 3 times)
    ↓
[code_generation] with error context
    ↓
[execution] again
```

### On Maximum Retries

```
Max retries reached
    ↓
[analyze] state with error context
    ↓
Generate error explanation
    ↓
Return to user
```

## State Transitions

### Success Path

```
plan → code_generation → execution → analyze → END
```

### Error Path with Recovery

```
plan → code_generation → execution → ERROR
                              ↓
                    code_generation (retry)
                              ↓
                         execution → analyze → END
```

### Fatal Error Path

```
plan → code_generation → execution → ERROR
                              ↓
                    (max retries reached)
                              ↓
                         analyze (error mode) → END
```

