---
sidebar_position: 7
---

# Result Processing

## Output Capture

The code interpreter captures multiple types of outputs from code execution.

### Standard Output (stdout)

```python
# Python print statements
print("Processing data...")
print(f"IC50: {ic50_value}")

# Captured as:
"logs": "Processing data...\nIC50: 0.0045"
```

### Standard Error (stderr)

```python
# Warnings and errors
warnings.warn("Low data points")

# Captured as:
"error": "UserWarning: Low data points"
```

### Generated Files

```python
# Plots and visualizations
plt.savefig('dose_response_curve.png')

# Data outputs
results.to_csv('analysis_results.csv')

# Captured as:
"files": [
    "dose_response_curve.png",
    "analysis_results.csv"
]
```

## Data Transformation

### File Encoding

Generated files are processed for delivery:

1. **Images**: Base64 encoded for embedding
2. **CSV/JSON**: Parsed and structured
3. **Text Files**: UTF-8 encoded strings

### Example Transformation

```python
# Generated plot
"plot.png" →
    base64_encode(image_bytes) →
        "data:image/png;base64,iVBORw0KG..."
```

## Result Formatting

### JSON Response Format

```json
{
    "status": "success",
    "task_id": "uuid-here",
    "analysis": {
        "summary": "LLM-generated explanation",
        "insights": ["Key finding 1", "Key finding 2"],
        "recommendations": "Next steps"
    },
    "outputs": {
        "logs": "Execution logs",
        "plots": [
            {
                "filename": "curve.png",
                "data": "base64_encoded_image"
            }
        ],
        "data_files": [
            {
                "filename": "results.csv",
                "content": "col1,col2\n1,2"
            }
        ]
    },
    "execution_time": 2.5,
    "retry_count": 0
}
```

### Analysis State Processing

The LLM analyzes execution results to generate:

#### Success Response

```python
{
    "type": "success",
    "analysis": """
    The 4-parameter logistic curve was successfully fit to the 
    dose-response data. The estimated IC50 is 4.5 nM with an 
    R² of 0.98, indicating excellent fit quality.
    
    The Hill slope of -1.2 suggests cooperative binding...
    """
}
```

#### Error Response

```python
{
    "type": "error",
    "analysis": """
    The code execution failed due to a missing 'concentration' 
    column in the provided CSV file. The file contains columns: 
    ['dose', 'response'].
    
    Please rename the 'dose' column to 'concentration' or modify 
    your request to use the correct column name.
    """
}
```

## Integration with Research Flow

### Deep Research Integration

Results are integrated into the research workflow:

1. **Hypothesis Testing**: Execute code to validate hypotheses
2. **Data Analysis**: Process experimental results
3. **Visualization**: Generate figures for papers
4. **Statistical Tests**: Run significance tests

### Example Flow

```
User Query: "Analyze this dose-response data"
    ↓
Deep Research Agent
    ↓
Code Interpreter: Execute analysis
    ↓
Return: IC50 value, curve plot
    ↓
Deep Research: Integrate into response
    ↓
User: Comprehensive answer with analysis
```

## Result Storage

### Temporary Storage

- Results stored in-memory during request
- Sandbox files available during execution
- Automatic cleanup after response

### Persistent Storage (Optional)

For research workflows:

```python
# Store in database
{
    "task_id": "uuid",
    "user_id": "user_id",
    "results": {...},
    "timestamp": "2024-11-24T..."
}
```

### File Management

- **Input files**: Uploaded to sandbox, deleted after execution
- **Output files**: Captured, encoded, returned, then deleted
- **Temporary files**: Cleaned up automatically by E2B

## Error Result Processing

### Execution Failures

```json
{
    "status": "error",
    "error_type": "ExecutionError",
    "message": "KeyError: 'concentration'",
    "analysis": "LLM-generated error explanation",
    "suggestion": "Check column names in your CSV file",
    "retry_count": 3,
    "max_retries_reached": true
}
```

### Timeout Results

```json
{
    "status": "timeout",
    "message": "Execution exceeded 60 second timeout",
    "partial_logs": "Output before timeout...",
    "analysis": "The computation may be too complex or data too large"
}
```

