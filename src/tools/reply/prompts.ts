/**
 * Prompt templates for different file analysis scenarios
 */

export const PDF_ANALYSIS_PROMPT = `

IMPORTANT: A PDF document has been uploaded. Please analyze the document and provide a comprehensive summary with the following structure:

**ANALYSIS PROTOCOL FOR PDFs:**

1. **Document Overview**: Identify document type, purpose, main sections, key topics
2. **Key Information Extraction**: Extract critical data points, findings, conclusions, recommendations
3. **Deep Analysis**: Analyze methodology, evidence quality, logical flow, supporting data
4. **Context Research**: If needed, use web search to provide context, verify claims, find related information
5. **Critical Assessment**: Evaluate strengths, limitations, gaps, potential biases

**OUTPUT FORMAT:**

## Document Analysis

[Write 2-3 sentences summarizing: Document type, main purpose, scope, and key topics covered.]

### Key findings
- [List 5-8 most important points, findings, or conclusions from the document]

### Critical insights
- [Deeper analysis of methodology, evidence, implications]

### Recommendations
- [Actionable next steps based on the document content]

Use web search when helpful to provide context or verify information.`;

export const DATA_ANALYSIS_PROMPT = `

IMPORTANT: A data file has been uploaded. Perform comprehensive quantitative analysis using Python code execution:

**ANALYSIS PROTOCOL:**

1. **Data Inspection**: Load data, identify structure, display columns/types, detect grouping variables
2. **Group Detection**: Auto-detect experimental groups (look for columns like: Group, Treatment, Condition, ID, etc.)
3. **Variable Classification**: Separate categorical vs numeric variables, identify potential confounders
4. **Descriptive Statistics**: Calculate mean±SD, median[IQR], range, CV%, SEM for all numeric variables by group
5. **Statistical Testing**:
   - One-way ANOVA for overall group differences (F-statistic, p-value)
   - Pairwise comparisons vs control/reference group (t-test or appropriate test)
   - Effect sizes (Cohen's d, % change from control) - COMPUTE FOR ALL VARIABLES
   - Multiple comparison correction (Bonferroni)
   - CRITICAL: Always report top 5-8 largest changes with raw p-values and effect sizes, even if not significant after correction
6. **Data Quality**: Identify outliers (IQR method), missing values, distribution normality
7. **Relationships**: Correlation analysis between numeric variables (Pearson r, p-values)

**OUTPUT FORMAT:**

CRITICAL: Your response must START DIRECTLY with the markdown heading "## Analysis Complete".
DO NOT include any commentary, explanations, or narrative text before this heading.
Execute all Python code silently, then output ONLY the final formatted report below.

---

## Analysis Complete

[Write 2-3 sentences summarizing: I've performed comprehensive analysis of [data type/study name] examining [N] samples across [M] groups. Key variables measured: [list main variables]. Dataset characteristics: [sample size distribution, time period, data quality notes].]

### Key findings

**1. Most significant changes from control:**
- [Variable] increased/decreased X.X% in [Group] (p=X.XXXX, Cohen's d=X.XX, [interpretation])
- [Variable] increased/decreased X.X% in [Group] (p=X.XXXX, Cohen's d=X.XX, [interpretation])
[IMPORTANT: Always list top 5-8 changes with actual numbers, even if p>0.05 after correction. Show raw p-values and effect sizes. If truly nothing differs, state "All variables within ±5% of control"]

**2. Group patterns:**
- [Groups]: [Pattern description with key metrics]
- [Groups]: [Pattern description with key metrics]

**3. Statistical summary:**
- Significant variables (ANOVA): [list with F-stats, p-values]
- Strong correlations: [top 3 with r-values]
- Data quality notes: [outliers, missing data, confounders]

**4. Critical observations:**
- [Study design notes, confounders, data quality issues]

### Recommendations
- [2-3 actionable next steps]

---

**TECHNICAL CONSTRAINTS:**
- Libraries: pandas, numpy, scipy.stats ONLY
- Manual Bonferroni: p_adjusted = p_raw × n_comparisons
- Include ALL samples in calculations (report outliers separately)
- Use standard markdown formatting (no Unicode special characters)
- Control/reference = first/smallest group ID or most frequent baseline
- Report: p-values (4 decimals), effect sizes (% change, Cohen's d)
- DO NOT include any explanatory text before "## Analysis Complete"
- Execute code silently and output only the final report

Keep summary concise (<300 words) but include all critical numbers and statistics.`;

export const IMAGE_ANALYSIS_PROMPT = `

IMPORTANT: Image(s) have been uploaded. Please analyze the image(s) and provide a comprehensive analysis:

**ANALYSIS PROTOCOL FOR IMAGES:**

1. **Visual Overview**: Describe what you see - main subjects, objects, scenes, colors, composition
2. **Content Analysis**: Identify key elements, text (if any), symbols, patterns, relationships
3. **Context & Purpose**: Infer the image type (photo, diagram, chart, screenshot, etc.) and its purpose
4. **Technical Details**: Note quality, resolution indicators, image type, visual characteristics
5. **Deep Analysis**: Analyze meaning, implications, data patterns (if charts/graphs), or narrative elements
6. **Additional Context**: If helpful, use web search to identify locations, objects, or provide related information

**OUTPUT FORMAT:**

## Image Analysis

[Write 2-3 sentences summarizing: Image type, main subject/content, purpose, and key visual elements.]

### Visual Description
- [Detailed description of what's visible in the image]

### Key Elements
- [List important objects, text, patterns, or data points identified]

### Analysis & Insights
- [Deeper interpretation, meaning, or technical analysis]

### Recommendations
- [If applicable: Next steps, additional context needed, or related resources]

Use web search when helpful to identify objects, locations, or provide context.`;

/**
 * Gets the appropriate analysis prompt based on file type
 */
export function getFileAnalysisPrompt(
  hasPDF: boolean,
  hasDataFile: boolean,
  hasImage: boolean
): string {
  if (hasImage && !hasPDF && !hasDataFile) {
    return IMAGE_ANALYSIS_PROMPT;
  } else if (hasPDF && !hasDataFile && !hasImage) {
    return PDF_ANALYSIS_PROMPT;
  } else if (hasDataFile && !hasPDF && !hasImage) {
    return DATA_ANALYSIS_PROMPT;
  }
  return ''; // No special prompt if mixed or no recognized files
}
