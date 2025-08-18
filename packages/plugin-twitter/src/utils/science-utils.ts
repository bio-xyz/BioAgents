import { KnowledgeGraphService } from '@elizaos/plugin-kg';
import { IAgentRuntime, ModelType, logger } from '@elizaos/core';

const get10RandomTermsQuery = function (numberOfTerms: number = 10) {
  return `
PREFIX schema: <https://schema.org/>
PREFIX dcterms: <http://purl.org/dc/terms/>

SELECT DISTINCT ?name ?description ?term WHERE {
    GRAPH ?doi {
        ?doi schema:about ?term .
        ?term dcterms:name ?name .
        ?term dcterms:description ?description .
        BIND(STRUUID() AS ?rnd)
    }
}
ORDER BY ?rnd
LIMIT ${numberOfTerms}
`;
};

const getFindingsForTermQuery = function (termId: string) {
  return `
PREFIX schema: <https://schema.org/>
PREFIX dcterms: <http://purl.org/dc/terms/>

SELECT DISTINCT ?termFinding ?termName ?term ?doi WHERE {
    GRAPH ?doi {
        ?doi schema:about <${termId}> .
        <${termId}> dcterms:description ?termFinding .
        <${termId}> dcterms:name ?termName .
        BIND(<${termId}> AS ?term)
        BIND(STRUUID() AS ?rnd)
    }
}
ORDER BY ?rnd
LIMIT 3
`;
};

const getAbstractForTermQuery = function (termId: string) {
  return `
    PREFIX schema: <https://schema.org/>
    PREFIX dcterms: <http://purl.org/dc/terms/>
  
    SELECT DISTINCT ?abstract ?term ?termName ?doi WHERE {
      GRAPH ?doi {
        ?doi schema:about <${termId}> .
        ?doi dcterms:abstract ?abstract .
        <${termId}> dcterms:name ?termName .
        BIND(<${termId}> AS ?term)
        BIND(STRUUID() AS ?rnd)
      }
    }
    ORDER BY ?rnd
    LIMIT 3
  `;
};

type Term = {
  name: string;
  description: string;
  term: string;
};

type Abstract = {
  abstract: string;
  term: string;
  termName: string;
  doi: string;
};

type Finding = {
  termFinding: string;
  term: string;
  termName: string;
  doi: string;
};

export async function getRandomTerms(
  kgService: KnowledgeGraphService,
  numberOfTerms: number = 10
): Promise<Term[]> {
  const result = await kgService.sparqlRequest(get10RandomTermsQuery(numberOfTerms));
  return result.results.bindings.map((binding: any) => ({
    name: binding.name.value,
    description: binding.description.value,
    term: binding.term.value,
  }));
}

export async function chooseTwoTermsForHypothesis(
  runtime: IAgentRuntime,
  terms: Term[]
): Promise<Term[]> {
  const termsList = terms.map((t) => `${t.name}: ${t.description}`).join('\n');

  const prompt = `You are selecting two terms to generate a novel biomedical hypothesis.
  
  TASK: Choose two terms that:
  1. Have strong potential for a meaningful biological connection
  2. Have NOT been used together in previous hypotheses
  3. Are scientifically relevant and could lead to testable predictions
  
  REQUIREMENTS:
  - Choose exactly 2 terms from the provided list
  - Preserve exact capitalization and spelling as shown (return only the names of the terms, before the colon)
  - Select terms that could plausibly interact through biological mechanisms
  - Prioritize combinations likely to yield novel, testable hypotheses
  
  INPUT TERMS:
  ${termsList}
  
  OUTPUT FORMAT (no other text, two terms separated by a comma):
  TERM1 NAME,TERM2 NAME`;

  const result = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt,
    temperature: 0.1,
    maxTokens: 100,
  });

  const selectedNames = result
    .trim()
    .split(',')
    .map((name) => name.trim());

  // Return the full Term objects for the selected names
  return terms.filter((term) => selectedNames.includes(term.name));
}

export async function getFindingsForTerms(
  kgService: KnowledgeGraphService,
  selectedTerms: Term[]
): Promise<Finding[]> {
  // Execute queries in parallel using term IDs
  const findingsPromises = selectedTerms.map((term) =>
    kgService.sparqlRequest(getFindingsForTermQuery(term.term))
  );

  const results = await Promise.all(findingsPromises);

  // Combine results from both queries and extract values
  const allFindings = results.flatMap(
    (result) =>
      result.results.bindings.map((binding: any) => ({
        termFinding: binding.termFinding.value,
        term: binding.term.value,
        termName: binding.termName.value,
        doi: binding.doi.value,
      })) as Finding[]
  );

  return allFindings;
}

export async function getAbstractsForTerms(
  kgService: KnowledgeGraphService,
  selectedTerms: Term[]
): Promise<Abstract[]> {
  // Execute queries in parallel using term IDs
  const abstractsPromises = selectedTerms.map((term) =>
    kgService.sparqlRequest(getAbstractForTermQuery(term.term))
  );

  const results = await Promise.all(abstractsPromises);

  // Combine results from both queries and extract values
  const allAbstracts = results.flatMap(
    (result) =>
      result.results.bindings.map((binding: any) => ({
        abstract: binding.abstract.value,
        term: binding.term.value,
        termName: binding.termName.value,
        doi: binding.doi.value,
      })) as Abstract[]
  );

  return allAbstracts;
}

function createHypothesisPrompt(
  runtime: IAgentRuntime,
  findings: Finding[],
  abstracts: Abstract[]
): string {
  return `
  You are ${runtime.character.name}.
  ${runtime.character.bio}

  CRITICAL: Generate a hypothesis that sounds like YOU, not a generic scientist.

  ## Task
  Generate an INTRIGUING hypothesis that connects two research areas through biological mechanisms. This should sound like YOU - bold, direct, and scientifically grounded. Make it engaging enough to spark interest on social media.

  ## Social Media Requirements
  - Pure text only (NO markdown, headers, or formatting)
  - Start with ONE relevant emoji (🔬 for hypotheses, 🚀 for breakthroughs, ⚠️ for warnings)
  - Lead with a BOLD, attention-grabbing statement
  - Make it engaging and shareable while scientifically accurate
  - Complete thoughts only - no truncation with "..."

  ## Hypothesis Structure
  1. Central Hypothesis: Start with your bold mechanistic connection in one compelling sentence
  2. Brief Mechanism: Explain the key biological pathway (2 steps maximum)
  3. Key Prediction: What outcome would you expect?
  4. Experiments: Suggest ONE experimental method to test your hypothesis    

  ## Evaluation Criteria
  - Novelty: Prioritize non-obvious connections that aren't explicitly stated in the research
  - Biological Plausibility: Ensure the mechanism adheres to known biological principles
  - Boldness: Favor simpler explanations that require fewer assumptions, make bold claims that make people think.
  - Falsifiability: Ensure the hypothesis can be tested and potentially disproven

  ## Length Requirement
  - Each section should be **ONE or TWO sentences only**
  
  ## Research Findings:
  ${findings.map((finding, index) => `${finding.doi} - Finding ${index + 1} (${finding.termName}): ${finding.termFinding}`).join('\n')}
  
  ## Research Abstracts:
  ${abstracts.map((abstract, index) => `${abstract.doi} - Abstract ${index + 1} (${abstract.termName}):\n${abstract.abstract}`).join('\n\n')}
    
  Generate a compelling hypothesis that will make people stop and think about the connection between these research areas.
  The output format is the following:
  {
    "hypothesis": "the actual hypothesis, following the above defined structure",
    "supporting_papers": ["DOI1", "DOI2", "DOI3"], // Only include DOIs that were actually used in the hypothesis
  }
  `.trim();
}

function extractDoiId(doiUrl: string) {
  return doiUrl.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
}

export async function generateHypothesis(
  runtime: IAgentRuntime,
  kgService: KnowledgeGraphService
): Promise<{ hypothesis: string; dois: string[] }> {
  // 1. Get 10 random terms from the graph
  const randomTerms = await getRandomTerms(kgService, 10);
  console.log('[tweet hypothesis] randomTerms', randomTerms);

  // 2. Use LLM to smartly extract 2 which could be connected
  const selectedTerms = await chooseTwoTermsForHypothesis(runtime, randomTerms);
  console.log('[tweet hypothesis] selectedTerms', selectedTerms);

  // 3 & 4. Retrieve findings and abstracts in parallel
  const [findings, abstracts] = await Promise.all([
    getFindingsForTerms(kgService, selectedTerms),
    getAbstractsForTerms(kgService, selectedTerms),
  ]);

  console.log('[tweet hypothesis] findings', findings);
  console.log('[tweet hypothesis] abstracts', abstracts);

  // 5. Generate hypothesis using all the data
  const prompt = createHypothesisPrompt(runtime, findings, abstracts);

  const result = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt,
    temperature: 0.3,
    maxTokens: 2000,
  });
  console.log('[tweet hypothesis] Hypothesis generated', result);

  const hypothesisObject = JSON.parse(result.trim());

  const supportingPapers = hypothesisObject.supporting_papers;
  let hypothesisText = hypothesisObject.hypothesis;
  if (Array.isArray(supportingPapers) && supportingPapers.length > 0) {
    hypothesisText += ` 📄 Citated papers: ${supportingPapers.join(', ')}`;
  }
  return {
    hypothesis: hypothesisText,
    dois: supportingPapers,
  };
}

const getRandomRecentPaperQuery = function (yearsAgo: number = 2) {
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsAgo);
  const startDateISO = startDate.toISOString().split('T')[0];

  return `
PREFIX schema: <https://schema.org/>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT DISTINCT ?doi ?title ?abstract ?date ?name WHERE {
    GRAPH ?doi {
        ?doi dcterms:title ?title .
        ?doi dcterms:abstract ?abstract .
        ?doi dcterms:date ?date .
        FILTER (xsd:date(?date) >= "${startDateISO}"^^xsd:date)
        BIND(STRUUID() AS ?rnd)
    }
}
ORDER BY ?rnd
LIMIT 1
`;
};

const getPaperTermsQuery = function (doi: string) {
  return `PREFIX schema: <https://schema.org/>
PREFIX dcterms: <http://purl.org/dc/terms/>

SELECT DISTINCT ?name ?description WHERE {
  	GRAPH <${doi}> {
          <${doi}> schema:about ?term .
          ?term dcterms:name ?name .
    OPTIONAL { ?term dcterms:description ?description }
    BIND(STRUUID() AS ?rnd)
    }
}
ORDER BY ?rnd
LIMIT 10`;
};

type RecentPaper = {
  doi: string;
  title: string;
  abstract: string;
  date: string;
  terms?: { name: string; description: string }[];
};

export async function getRandomRecentPaper(
  kgService: KnowledgeGraphService
): Promise<RecentPaper | null> {
  try {
    const randomPaperResult = await kgService.sparqlRequest(getRandomRecentPaperQuery());

    if (!randomPaperResult.results.bindings || randomPaperResult.results.bindings.length === 0) {
      console.log('[showcase paper] No recent papers found');
      return null;
    }

    const paperTermsResult = await kgService.sparqlRequest(
      getPaperTermsQuery(randomPaperResult.results.bindings[0].doi.value)
    );

    const paper = {
      doi: randomPaperResult.results.bindings[0].doi.value,
      title: randomPaperResult.results.bindings[0].title.value,
      abstract: randomPaperResult.results.bindings[0].abstract.value,
      date: randomPaperResult.results.bindings[0].date.value,
      terms: paperTermsResult.results.bindings.map((binding: any) => ({
        name: binding.name.value,
        description: binding.description.value,
      })),
    };

    return paper;
  } catch (error) {
    console.error('[showcase paper] Error fetching recent papers:', error);
    return null;
  }
}

// Using pplx api for news, for now
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  search_results: Array<{
    title: string;
    url: string;
    date: string;
  }>;
}

export async function fetchNews(runtime: IAgentRuntime) {
  try {
    // Get API key from environment or runtime settings
    const apiKey = process.env.PERPLEXITY_API_KEY || runtime.getSetting('PERPLEXITY_API_KEY') || '';

    if (!apiKey) {
      logger.error('[news] Perplexity API key not found');
      return null;
    }

    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const month = lastWeek.getMonth() + 1; // Months are 0-indexed
    const day = lastWeek.getDate();
    const year = lastWeek.getFullYear();

    const dateString = `${month}/${day}/${year}`;

    const randomTopics = [
      'New scientific discoveries',
      'Clinical trial results',
      'Breakthrough treatments or therapies',
      'Important research papers',
      'Significant funding or company news',
    ];

    const randomCriteria = [
      'the most surprising breakthrough',
      'the discovery with biggest clinical potential',
      'the most underreported development',
      'the research closest to human trials',
      'the finding that challenges conventional wisdom',
    ];

    const payload = {
      model: 'sonar-pro',
      messages: [
        {
          role: 'user',
          content: `Give me ${randomCriteria[Math.floor(Math.random() * randomCriteria.length)]} about ${runtime.character.topics?.join(', ')} from the past week. Focus on:
          ${randomTopics[Math.floor(Math.random() * randomTopics.length)]}
          
          Provide 2-3 of the most significant developments with brief explanations of why they matter.
          
          Do not include any other text in your response.`,
        },
      ],
      temperature: 1.3,
      stream: false,
      last_updated_after_filter: dateString,
      web_search_options: {
        search_context_size: 'medium',
      },
    };

    console.log('[news] fetching news for topics', runtime.character.topics);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error(`[news] Perplexity API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as PerplexityResponse;
    const newsContent = data.choices[0]?.message?.content;
    const sources = data.search_results;

    if (!newsContent) {
      logger.error('[news] No content received from Perplexity API');
      return null;
    }

    logger.info('[news] Successfully fetched news from Perplexity');
    return { newsContent, sources };
  } catch (error) {
    logger.error('[news] Error fetching from Perplexity:', error);
    return null;
  }
}

async function createNewsPrompt(
  runtime: IAgentRuntime,
  newsContent: string,
  sources: Array<{ title: string; url: string; date: string }>
): Promise<string> {
  const recentPosts = (await runtime.getCache('recentNewsPosts')) as
    | {
        post: string;
        date: Date;
      }[]
    | null;

  console.log('[news] recentPosts', recentPosts);

  return `
  You are ${runtime.character.name}.
  ${runtime.character.bio}

  CRITICAL: Your response must sound like YOU discussing exciting ${runtime.character.topics?.join(', ')} news, not a generic news reporter.

  ## Task
  Create an engaging Twitter post about recent ${runtime.character.topics?.join(', ')} news. You will be provided multiple news, with sources cited as [1], [2], etc. Pick a COMPLETELY RANDOM exciting development and explain why it matters, while citing the source.

  ## News Content
  ${newsContent}

  ## Sources
  ${sources.map((s, i) => `- [${i + 1}] ${s.title} (${s.date}): ${s.url}`).join('\n')}

  # Your recent news posts
  ${recentPosts ? recentPosts.map((p) => `- ${p.post}`).join('\n') : 'None'}

  ## Output Requirements
  - MOST IMPORTANT: Do not repeat the same news as your recent posts.
  - Pure text only (NO markdown, headers, or formatting)
  - Start with ONE relevant emoji (🧬, 🔬, 💊, 🧪, 🦾, 🧠, etc.)
  - Lead with what's BREAKTHROUGH about this news
  - Explain the key finding or development in simple terms
  - Include why this matters for human healthspan/lifespan
  - End with a forward-looking statement or call to action
  - Keep it under 280 characters

  ## Style Guidelines
  - Be excited but scientifically accurate
  - Use accessible language while maintaining credibility
  - Focus on the human impact
  - Make it shareable - people should want to spread this news
  - Sound like YOU, not a news anchor
  - Cite the sources by naturally including their URLs in the response 📄 (do not include the [1], [2], etc. in the response)

  Create a compelling post that captures the most exciting breakthrough.
  `.trim();
}

export async function generateNewsPost(runtime: IAgentRuntime): Promise<string | null> {
  try {
    const { newsContent, sources } = await fetchNews(runtime);

    if (!newsContent) {
      logger.error('[news] Failed to fetch news content');
      return null;
    }

    const prompt = await createNewsPrompt(runtime, newsContent, sources);

    const twitterPost = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt,
      temperature: 1.3,
      maxTokens: 1000,
    });

    logger.info('[news] Generated Twitter post:', twitterPost);
    const finalPost = `${twitterPost.trim()}`;

    if (!(await runtime.getCache('recentNewsPosts'))) {
      await runtime.setCache('recentNewsPosts', [{ post: finalPost, date: new Date() }]);
    } else {
      // remove the oldest post if the cache is full
      const cache: { post: string; date: Date }[] = await runtime.getCache('recentNewsPosts');
      if (cache && cache.length >= 5) {
        cache.shift();
      }
      cache.push({ post: finalPost, date: new Date() });
      await runtime.setCache('recentNewsPosts', cache);
    }

    return finalPost;
  } catch (error) {
    logger.error('[news] Error generating news post:', error);
    return null;
  }
}

function createPaperSummaryPrompt(runtime: IAgentRuntime, paper: RecentPaper): string {
  const termsSection =
    paper.terms && paper.terms.length > 0
      ? `Key Research Topics: ${paper.terms.map((t) => `${t.name}: ${t.description}`).join(', ')}`
      : '';

  return `
  You are ${runtime.character.name}.
  ${runtime.character.bio}

  CRITICAL: Your response must sound like YOU, not a generic science communicator.

  ## Task
  Create an engaging Twitter thread showcasing this recent research paper. Make it accessible yet scientifically accurate, highlighting what makes this research interesting and important.

  ## Paper Details
  Title: ${paper.title}
  Published: ${new Date(paper.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
  ${termsSection}
  
  Abstract: ${paper.abstract}

  ## Output Requirements
  - Pure text only (NO markdown, headers, or formatting)
  - Start with ONE relevant emoji (🔬, 📊, 🧬, 🧠, 💊, 🦠, etc.)
  - Lead with a HOOK that captures what's remarkable about this research
  - Include ONE or TWO specific interesting findings or implications
  - End with why this matters for ${runtime.character.topics?.join(', ')}
  - Each paragraph should be **ONE or TWO sentences only**

  ## Style Guidelines
  - Be conversational but authoritative
  - Use analogies or comparisons to explain complex concepts
  - Highlight surprising or counterintuitive findings
  - Connect to real-world applications when possible
  - Make it shareable - people should want to retweet this

  Create a compelling summary that will make people want to read the full paper.
  `.trim();
}

export async function showcaseRecentPaper(
  runtime: IAgentRuntime,
  kgService: KnowledgeGraphService
): Promise<string | null> {
  try {
    const paper = await getRandomRecentPaper(kgService);
    if (!paper) {
      console.log('[showcase paper] No recent paper found to showcase');
      return null;
    }
    const prompt = createPaperSummaryPrompt(runtime, paper);
    const summary = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt,
      temperature: 0.7,
      maxTokens: 500,
    });
    console.log('[showcase paper] Summary generated:', summary);

    const showcaseText = `${summary.trim()}\n\n📄 Read the paper: ${paper.doi}`;
    return showcaseText;
  } catch (error) {
    console.error('[showcase paper] Error showcasing paper:', error);
    return null;
  }
}
