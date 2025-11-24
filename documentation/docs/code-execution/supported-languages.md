---
sidebar_position: 3
---

# Supported Languages

## Python

The code interpreter currently supports **Python 3.11+** as the primary execution language, optimized for data science and computational biology tasks.

### Features

- **Data Science Libraries**: pandas, numpy, scipy, scikit-learn
- **Visualization**: matplotlib, seaborn
- **Statistical Analysis**: statsmodels, scipy.stats
- **File I/O**: CSV, JSON, Excel support
- **Math & Computation**: numpy, sympy

### Data Science Capabilities

#### Dose-Response Analysis
```python
# Fit 4-parameter logistic curve
# Estimate IC50 values
# Generate curve plots
```

#### Statistical Analysis
```python
# T-tests, ANOVA
# Correlation analysis
# Regression modeling
```

#### Data Visualization
```python
# Line plots, scatter plots
# Heatmaps
# Box plots, histograms
```

### Configuration

Python environment is pre-configured in E2B sandboxes with:

- Python 3.11+
- Common data science packages
- Jupyter-compatible execution
- matplotlib for inline plots

### Example Usage

```python
import pandas as pd
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

# Load and analyze data
df = pd.read_csv('dose_response.csv')

# Fit logistic curve
def logistic_4pl(x, a, b, c, d):
    return d + (a - d) / (1 + (x / c) ** b)

# Generate visualization
plt.scatter(df['concentration'], df['viability'])
plt.plot(x_fit, y_fit)
plt.savefig('curve.png')
```

## Future Language Support

Additional languages may be supported in future releases:

- **R**: Statistical computing and bioinformatics
- **Julia**: High-performance scientific computing
- **Bash**: Data processing scripts

