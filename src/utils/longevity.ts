export const SENS_DAMAGE_CLASSES = [
  {
    name: "Cell loss, tissue atrophy",
    description:
      "User mentions lost/reduced cell numbers or organ atrophy and goals to restore function or regeneration. Keywords: stem cells, progenitors, satellite cells, neurogenesis, engraftment, tissue engineering, organoids, cell replacement, niche rejuvenation. Query papers on stem-cell therapies, delivery/scaffolds, safety/engraftment, and functional recovery endpoints.",
    index: 1,
  },
  {
    name: "Accumulation of senescent cells",
    description:
      "User mentions senescence, SASP-driven inflammation, fibrosis, or clearing 'zombie' cells to rejuvenate tissue. Keywords: senolytics (D+Q, fisetin, navitoclax), senomorphics, p16/p21, SA-β-gal, uPAR/DPP4, CAR-T/NK for senescence. Query senescent-cell burden, clearance strategies, SASP modulation, and effects on function.",
    index: 2,
  },
  {
    name: "Mitochondrial DNA mutations/dysfunction",
    description:
      "User focuses on mitochondrial defects, heteroplasmy, ETC failure, ROS, or mitophagy. Mentions allotopic expression, mtDNA editing/replacement, NAD+ boosters, urolithin A, PINK1–Parkin. Query mitochondrial gene therapy, allotopic expression of mtDNA-encoded proteins, mitophagy enhancers, and muscle/neuronal outcomes.",
    index: 3,
  },
  {
    name: "Nuclear DNA mutations / cancerous cells",
    description:
      "User discusses oncogenesis prevention/ablation, clonal expansions (CHIP), or tumor surveillance in aging. Mentions telomerase/ALT inhibition, targeted ablation, suicide genes, immune vaccines, CAR-T, checkpoint therapy. Query telomere maintenance blockers, minimal residual disease, aging immune context, and safety in older adults.",
    index: 4,
  },
  {
    name: "Intracellular aggregates (intracellular junk)",
    description:
      "User mentions build-up of undegraded material inside cells (lipofuscin, misfolded proteins) and boosting lysosomal/autophagic clearance. Keywords: lysosomal hydrolase/enzyme delivery, TFEB activation, chaperone-mediated autophagy, substrate reduction, LC3/p62 flux. Query strategies that restore intracellular proteostasis.",
    index: 5,
  },
  {
    name: "Extracellular aggregates (extracellular waste)",
    description:
      "User refers to amyloid/transthyretin/other extracellular deposits and antibody/vaccine approaches to clear them. Keywords: immunotherapy, monoclonal antibodies, catalytic antibodies, apheresis, PET amyloid, CSF biomarkers. Query trials of aggregate clearance and functional outcomes.",
    index: 6,
  },
  {
    name: "Extracellular matrix stiffening (cross-links)",
    description:
      "User targets tissue or vascular stiffness, AGEs, fibrosis, or cross-link breaking/repair. Keywords: AGE breakers, crosslink breakers (e.g., alagebrium-like), RAGE antagonists, MR elastography, pulse wave velocity, ECM remodeling, tissue engineering. Query interventions that reduce ECM stiffness and improve biomechanics.",
    index: 7,
  },
];

export const REFORMULATE_QUESTION_LONGEVITY_PROMPT = `
  You are a scientific triager using the SENS damage-class framework.
  
  Goal:
  - Read the user's question.
  - Map it to zero or more SENS damage classes.
  - Produce a reformulated question that is hallmark-aware:
    • Names the damage class (or its mechanism/countermeasure) explicitly.
    • Adds minimal context to aid retrieval (population/tissue/endpoints), without inventing details.
  
  Return JSON ONLY:
  {
    "hallmarks": [array of SENS class names or empty],
    "reformulatedQuestion": "≤ 24 words; explicitly ties to the chosen SENS class and measurable endpoints"
  }
  
  Available SENS classes (use names exactly as listed):
  ${SENS_DAMAGE_CLASSES.map((x) => `- ${x.name}`).join("\n")}
  
  Selection rules:
  - Pick a class only if the question plausibly targets that damage type or its countermeasure.
  - Prefer 0–2 classes. If multiple are plausible, include both.
  - If not aging-related, leave hallmarks empty but still produce a concise scientific question.
  
  Reformulation rules:
  - Name the damage or countermeasure (e.g., “senescent-cell clearance,” “mitochondrial dysfunction,” “ECM cross-links”).
  - Anchor to a population or tissue if implied (e.g., older adults, skeletal muscle).
  - Prefer measurable outcomes (e.g., autophagic flux, arterial stiffness, stem-cell engraftment).
  - Keep neutral and testable; avoid promises or conclusions.
  
  Examples:
  
  Input:
  "How does creatine affect muscle recovery in older adults?"
  Output:
  {
    "hallmarks": ["Cell loss, tissue atrophy"],
    "reformulatedQuestion": "Does creatine improve regeneration in aging skeletal muscle by enhancing satellite-cell function (cell loss) and strength recovery?"
  }
  
  Input:
  "Can nicotinamide riboside improve endurance by fixing mitochondria and clearing cellular junk in seniors?"
  Output:
  {
    "hallmarks": ["Mitochondrial DNA mutations/dysfunction", "Intracellular aggregates (intracellular junk)"],
    "reformulatedQuestion": "In older adults, does nicotinamide riboside improve endurance by correcting mitochondrial dysfunction and increasing autophagic clearance of intracellular aggregates in muscle?"
  }
  
  Input:
  "How does caffeine affect focus during study sessions?"
  Output:
  {
    "hallmarks": [],
    "reformulatedQuestion": "Does caffeine acutely enhance attention and working memory during study in healthy adults?"
  }
  
  Now process the next question and return only the JSON object.
  `;
