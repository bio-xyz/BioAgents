# Coding Guidelines

## General Responsibility

Each developer is responsible for getting their pull request (PR) merged. This means proactively seeking QA and code reviews, addressing feedback, and ensuring the code is in a mergeable state. Ownership of code extends through the entire process — from writing to deployment.

## Guiding Principles

These guidelines serve as principles rather than strict rules. They are meant to help maintain a clean and maintainable codebase while allowing flexibility where necessary.

### Code Clarity First

- Readability is more important than premature performance optimizations.
- Clever code that is hard to understand leads to unnecessary complexity and maintenance burdens.
- Write code that is easy to follow without excessive comments.

### Self-Documenting Code

- Structure code in a way that its purpose is evident from its function names, variable names, and module structure.
- Use functions and modules to provide clarity instead of relying on comments to explain complex logic.

### Expressive Naming

- Use clear, descriptive names for variables, functions, and modules.
- Names should convey intent without needing additional context.
- Avoid abbreviations unless widely recognized.

### Keep It Simple, Stupid (KISS)

- Simplicity leads to maintainability.
- Avoid unnecessary complexity and abstractions unless they provide a clear benefit.

### Don't Repeat Yourself (DRY)

- If a piece of code is used multiple times, consider extracting it into a shared function or module.
- Helps keep code compact, reduces duplication, and makes changes easier to manage.
- DRY should be applied pragmatically — avoid excessive abstraction that reduces clarity.

### You Aren't Gonna Need It (YAGNI)

- Implement only what is necessary now, not what you think might be needed in the future.
- Premature abstractions or unnecessary features increase maintenance overhead.

### Be Pragmatic / Don't Let Perfect Be the Enemy of Good

- Strive for high-quality code, but do not over-engineer or aim for unattainable perfection.
- Good, working, and maintainable code is better than a perfect but never-shipped solution.

### Principle of Least Surprise

- Code should behave in a way that is expected by other developers.
- Avoid hidden side effects and unexpected behavior.
- Follow established coding conventions to ensure predictability.

## Code Practices

### Modularization

- Break code into logical, manageable pieces.
- Use functions and files to naturally document code through its structure.
- Don't hesitate to use functions for clarity — modern compilers, including JavaScript's JIT compiler, optimize efficiently.

### Performance Considerations

- Optimize when necessary, but don't prioritize performance over clarity.
- The biggest performance gains usually come from using appropriate data structures rather than complicated algorithms.

### Code Smells

- Avoid unnecessary abstractions.
- Keep an eye out for redundant, unclear, or overly complex code.
- Follow best practices but be flexible when needed.

## Additional Resources

- **JavaScript:** [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)
- **TypeScript:** [TypeScript Deep Dive](https://basarat.gitbook.io/typescript)
