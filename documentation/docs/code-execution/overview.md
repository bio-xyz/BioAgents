---
sidebar_position: 1
---

# Overview

## What is the Code Interpreter?

The Bio Code Interpreter is a data science agent with integrated code execution capabilities. It enables execution of Python code in isolated E2B sandboxes, allowing for secure data analysis, visualization, and computational tasks within the research workflow.

## Key Capabilities

- **Isolated Code Execution**: Run Python code in secure E2B sandboxes
- **Data Science Agent**: Multi-stage FST-based agent for complex workflows
- **Automatic Error Recovery**: Intelligent retry logic with code regeneration
- **LLM Integration**: Compatible with OpenAI and Anthropic models
- **Data Analysis**: Process CSV files, perform statistical analysis, create visualizations
- **Structured Workflow**: Plan-Execute-Analyze pattern for complex tasks

## Agent Workflow

The code interpreter follows a Finite State Transducer (FST) architecture:

```
START → [plan] → [code_generation] → [execution] → [analyze] → END
         ↓                                ↓
    (error)                          (retry on error)
         ↓
    [analyze]
```

## Integration with Research

The code interpreter seamlessly integrates with the Deep Research system:

- Execute data analysis during research workflows
- Generate visualizations for research findings
- Perform statistical computations
- Process experimental data
- Validate hypotheses through code

## When to Use Code Execution

- Analyzing CSV or tabular data
- Fitting curves to experimental data (e.g., IC50 calculations)
- Creating data visualizations
- Performing statistical tests
- Processing computational biology data
- Running simulations or models

