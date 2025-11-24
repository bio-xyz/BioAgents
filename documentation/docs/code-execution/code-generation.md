---
sidebar_position: 5
---

# Code Generation

## Dynamic Code Generation

The code interpreter uses **LLM-powered code generation** to create Python scripts based on user tasks and data context.

### Generation Process

1. **Task Analysis**: LLM analyzes the user's request
2. **Plan Creation**: Generates execution plan with steps
3. **Code Generation**: Creates Python code to implement plan
4. **Validation**: Reviews code for safety and correctness
5. **Execution**: Runs code in E2B sandbox

### LLM Providers

- **Anthropic**: Claude models (default)
- **OpenAI**: GPT-4 and GPT-3.5 models

## Context Injection

### Available Context

The LLM receives context including:

```python
{
    "task_description": "User's analysis request",
    "data_files": ["uploaded_file.csv"],
    "previous_execution": {
        "code": "previous_attempt",
        "error": "error_message"
    },
    "retry_count": 2
}
```

### Data Context

- File names and formats
- Column names (if CSV)
- Data preview (first few rows)
- File sizes and metadata

### Error Context (on retry)

- Previous code attempt
- Error messages
- Execution logs
- Suggested fixes

## Template System

### Prompt Templates

Located in `app/prompts/`:

- **Plan Template**: Task analysis and planning
- **Code Generation Template**: Python code creation
- **Analysis Template**: Result interpretation
- **Error Recovery Template**: Debugging and fixes

### Code Structure Template

```python
# Import necessary libraries
import pandas as pd
import matplotlib.pyplot as plt

# Load data
df = pd.read_csv('uploaded_file.csv')

# Perform analysis
# ... (LLM-generated code)

# Save results
# plt.savefig('output.png')
# results.to_csv('output.csv')
```

## Validation & Sanitization

### Pre-execution Validation

1. **Syntax Check**: Validate Python syntax
2. **Security Scan**: Check for dangerous operations
3. **Import Validation**: Ensure only allowed libraries
4. **File Access**: Verify file paths are within sandbox

### Code Sanitization

- Remove system-level operations
- Restrict file system access
- Prevent network calls (unless allowed)
- Limit execution time

## Automatic Retry Logic

### Retry Strategy

```
Attempt 1: Initial code generation
    ↓ (if error)
Attempt 2: Regenerate with error context
    ↓ (if error)
Attempt 3: Final attempt with all context
    ↓ (if still error)
Return error analysis to user
```

### Retry Configuration

- **Max Retries**: 3 (configurable via `CODE_GENERATION_MAX_RETRIES`)
- **Context Accumulation**: Each retry includes previous errors
- **Code Improvement**: LLM learns from previous failures

### Error-Driven Regeneration

On execution error, the LLM receives:

```python
{
    "error_type": "ValueError",
    "error_message": "column 'dose' not found",
    "previous_code": "df['dose']",
    "suggestion": "Check available columns in dataframe"
}
```

## Code Quality Checks

### LLM Review

Before execution, the LLM performs:

1. **Logic Verification**: Code implements the plan
2. **Safety Check**: No dangerous operations
3. **Best Practices**: Follows Python conventions
4. **Error Handling**: Includes try-except where needed

### Post-Generation

- Code is logged for audit
- Execution results are validated
- Errors trigger automatic improvement

