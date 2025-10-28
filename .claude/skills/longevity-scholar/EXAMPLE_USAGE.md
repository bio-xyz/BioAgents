# Longevity Scholar Skill - Example Usage

This document shows how the skill would be used in practice by Claude.

## Example 1: Latest Findings on Longevity Experiments in Mice

**User Query:**
> "What are the latest findings on longevity experiments ran on mice?"

**Claude's Process:**

1. **Skill triggers** because user explicitly requested research findings

2. **Query formulation** - Claude creates 3 queries:
   - Query 1: `longevity mice experiments lifespan`
   - Query 2: `aging interventions mouse model longevity`
   - Query 3: `life extension mice experimental studies`

3. **Execute search:**
```bash
python3 scripts/query_longevity_papers.py \
  --queries "longevity mice experiments lifespan" \
           "aging interventions mouse model longevity" \
           "life extension mice experimental studies" \
  --limit 10 \
  --sort recent
```

4. **Analyze results** - Extract key information from returned papers

5. **Synthesize natural language response:**

```
Recent longevity experiments in mice have shown significant progress across
multiple intervention strategies. The most promising findings include:

Caloric Restriction and Dietary Interventions:
Studies continue to demonstrate that caloric restriction (CR) extends both
lifespan and healthspan in mice, with recent work focusing on the optimal
timing and degree of restriction. Intermittent fasting protocols have shown
similar benefits with potentially better adherence.

Pharmacological Interventions:
Rapamycin (mTOR inhibitor) remains one of the most robust lifespan-extending
compounds, with recent studies showing 10-15% lifespan extension even when
started in middle age. NAD+ precursors (NMN, NR) have gained attention for
their ability to improve mitochondrial function and extend healthspan metrics.

Cellular Senescence:
Senolytic drugs that selectively eliminate senescent cells have shown
remarkable results, with studies demonstrating improved healthspan and,
in some cases, modest lifespan extension. Combinations of dasatinib and
quercetin are particularly promising.

Key trends:
- Increasing focus on combinatorial approaches
- More emphasis on healthspan vs pure lifespan
- Better understanding of sex-specific effects
- Translation of findings to higher organisms

Science papers:
1. Rapamycin extends lifespan in genetically heterogeneous mice - URL: https://www.semanticscholar.org/paper/abc123, Citations: 1247
2. Cellular senescence and aging in mice - URL: https://www.semanticscholar.org/paper/def456, Citations: 892
3. NAD+ metabolism and longevity in mice - URL: https://www.semanticscholar.org/paper/ghi789, Citations: 634
4. Intermittent fasting and metabolic health - URL: https://www.semanticscholar.org/paper/jkl012, Citations: 521
5. Senolytics improve healthspan in aged mice - URL: https://www.semanticscholar.org/paper/mno345, Citations: 445
```

## Example 2: Most Cited Research on Rapamycin

**User Query:**
> "What are the most cited research papers on longevity which tested rapamycin?"

**Claude's Process:**

1. **Query formulation:**
   - Query 1: `rapamycin longevity lifespan extension`
   - Query 2: `mTOR inhibition aging rapamycin`
   - Query 3: `rapamycin anti-aging effects`

2. **Execute search with citation sorting:**
```bash
python3 scripts/query_longevity_papers.py \
  --queries "rapamycin longevity lifespan extension" \
           "mTOR inhibition aging rapamycin" \
           "rapamycin anti-aging effects" \
  --limit 15 \
  --sort citations
```

3. **Natural language response:**

```
Rapamycin is one of the most extensively studied longevity interventions,
with several landmark papers establishing its effects:

Foundational Studies:
The 2009 Nature paper by Harrison et al. was groundbreaking, demonstrating
that rapamycin extends lifespan in both male and female mice even when
treatment begins late in life. This was the first pharmacological intervention
shown to extend lifespan in both sexes across multiple genetic backgrounds.

Mechanism of Action:
Research has established that rapamycin works primarily through inhibition
of mTOR (mechanistic Target of Rapamycin), a key nutrient-sensing pathway.
This inhibition mimics some effects of caloric restriction and improves
various age-related pathologies including cancer, cardiovascular disease,
and neurodegeneration.

Dose and Timing Studies:
Subsequent research has explored optimal dosing strategies, with intermittent
dosing showing promise for reducing side effects while maintaining benefits.
Studies starting rapamycin at different ages have shown that benefits persist
even when treatment begins in middle age.

Clinical Translation:
While rapamycin shows promise in animal models, human trials face challenges
due to immunosuppressive effects. Research is ongoing with rapalogs (rapamycin
analogs) that may have better safety profiles.

Science papers:
1. Rapamycin fed late in life extends lifespan in genetically heterogeneous mice - URL: https://www.semanticscholar.org/paper/pqr678, Citations: 1850
2. mTOR as a central regulator of lifespan and aging - URL: https://www.semanticscholar.org/paper/stu901, Citations: 1456
3. The hallmarks of aging and rapamycin - URL: https://www.semanticscholar.org/paper/vwx234, Citations: 1203
4. Intermittent rapamycin extends lifespan in mice - URL: https://www.semanticscholar.org/paper/yza567, Citations: 387
5. Rapamycin improves cognitive function in aging mice - URL: https://www.semanticscholar.org/paper/bcd890, Citations: 294
```

## Example 3: Papers by Specific Researcher

**User Query:**
> "What are the most recent research papers on longevity by Aubrey De Grey?"

**Claude's Process:**

1. **Query formulation:**
   - Query 1: `Aubrey de Grey longevity aging`
   - Query 2: `SENS longevity de Grey`
   - Query 3: `Aubrey de Grey healthspan research`

2. **Execute search:**
```bash
python3 scripts/query_longevity_papers.py \
  --queries "Aubrey de Grey longevity aging" \
           "SENS longevity de Grey" \
           "Aubrey de Grey healthspan research" \
  --limit 20 \
  --sort recent
```

## Example 4: Longevity Research in Flies

**User Query:**
> "What are the most relevant research papers on longevity which tested on flies?"

**Claude's Process:**

1. **Query formulation:**
   - Query 1: `drosophila longevity lifespan experiments`
   - Query 2: `fruit fly aging interventions`
   - Query 3: `fly lifespan extension genetic`

2. **Execute search:**
```bash
python3 scripts/query_longevity_papers.py \
  --queries "drosophila longevity lifespan experiments" \
           "fruit fly aging interventions" \
           "fly lifespan extension genetic" \
  --limit 10 \
  --sort citations
```

3. **Natural language response:**

```
Drosophila (fruit flies) are a crucial model organism for longevity research
due to their short lifespan, genetic tractability, and conservation of aging
pathways with mammals.

Key Findings:

Dietary Restriction:
Like mammals, flies show robust lifespan extension with dietary restriction,
with studies demonstrating 30-40% increases. The mechanisms involve similar
nutrient-sensing pathways (insulin/IGF-1, TOR).

Genetic Interventions:
Mutations in insulin signaling pathway genes, particularly insulin receptor
substrate (chico) and insulin receptor (InR), extend fly lifespan by up to
100%. These findings helped establish the evolutionary conservation of
longevity pathways.

Mitochondrial Function:
Research has shown that mitochondrial efficiency, not just overall function,
is key to longevity in flies. Mild mitochondrial stress can activate
protective responses that extend lifespan.

Circadian Rhythms:
Disruption of circadian clocks accelerates aging in flies, while maintaining
robust rhythms promotes longevity. This has implications for human aging
and shift work.

Science papers:
1. Extension of lifespan in Drosophila by mutation in insulin signaling - URL: https://www.semanticscholar.org/paper/efg123, Citations: 2834
2. Dietary restriction and lifespan in flies - URL: https://www.semanticscholar.org/paper/hij456, Citations: 1567
3. Mitochondrial efficiency and aging in Drosophila - URL: https://www.semanticscholar.org/paper/klm789, Citations: 892
4. Circadian clocks and aging in Drosophila - URL: https://www.semanticscholar.org/paper/nop012, Citations: 445
```

## Key Features Demonstrated

1. ✅ **Explicit trigger**: Skill only activates when user explicitly requests research papers
2. ✅ **Multiple queries**: Always tries 3 different query formulations
3. ✅ **Natural language synthesis**: Provides comprehensive answers, not just lists
4. ✅ **Proper citations**: Always ends with "Science papers:" followed by formatted list
5. ✅ **Context-aware**: Adapts sorting (recent vs citations) based on user request
6. ✅ **Domain expertise**: Uses appropriate scientific terminology and organism names
