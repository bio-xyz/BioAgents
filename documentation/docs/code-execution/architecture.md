---
sidebar_position: 2
---

# Architecture

## System Design

The code interpreter uses a **Finite State Transducer (FST)** architecture implemented with LangGraph, providing a structured workflow for code execution tasks.

### FST States

1. **Plan**: Analyzes the task and creates an execution plan
2. **Code Generation**: Generates Python code based on the plan
3. **Execution**: Runs the code in an E2B sandbox
4. **Analyze**: Processes results and generates final response

### State Transitions

State transitions are determined by **action signals** and **execution feedback**:

- Success signals advance to the next state
- Error signals trigger retry logic or error handling
- Missing data routes to analysis with error response

## Runtime Environment

### E2B Sandboxes

Code executes in isolated **E2B (Execute to Build) sandboxes**:

- Fully isolated Python environments
- Pre-configured with common data science libraries
- Automatic cleanup after execution
- Secure file system access
- Network isolation

### Supported Libraries

- pandas, numpy for data manipulation
- matplotlib, seaborn for visualization
- scipy, scikit-learn for analysis
- Standard Python libraries

## Process Isolation

Each code execution runs in a **separate sandbox instance**:

- No shared state between executions
- Clean environment for each task
- Automatic resource cleanup
- Timeout protection
- Memory limits enforced by E2B

## Component Interaction

```
FastAPI Router
    ↓
Agent Service (LangGraph FST)
    ↓
LLM Service (OpenAI/Anthropic)
    ↓
Executor Service (E2B)
    ↓
Sandbox Execution
```

### Key Components

- **LangGraph**: Manages FST workflow and state transitions
- **LLM Service**: Abstracts OpenAI/Anthropic API calls
- **Executor Service**: Handles E2B sandbox communication
- **State Manager**: Tracks agent state through workflow

