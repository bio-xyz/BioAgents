# AGENTS.md

Guidance for AI coding agents working on this repository. Read these **before** making changes.

---

## Core Principles

### 1. Think before coding

Don't assume. Don't hide confusion. State ambiguity explicitly. Present multiple interpretations rather than silently picking one. Push back if a simpler approach exists. Stop and ask rather than guess.

### 2. Simplicity first

No features beyond what was asked. No abstractions for single-use code. No "flexibility" that wasn't requested. No error handling for impossible scenarios. The test: would a senior engineer say this is overcomplicated? If yes, rewrite it.

### 3. Surgical changes

Don't "improve" adjacent code. Don't refactor things that aren't broken. Match the existing style even if you'd do it differently. If you notice unrelated dead code, mention it, don't delete it. Every changed line should trace directly to the request.

### 4. Goal-driven execution

Transform "fix the bug" into "write a test that reproduces it, then make it pass." Transform "add validation" into "write tests for invalid inputs, then make them pass." Give it success criteria and watch it loop until done.

---

## Project-Specific Guidance

For codebase architecture, tech stack, commands, and project structure, see [CLAUDE.md](./CLAUDE.md).
