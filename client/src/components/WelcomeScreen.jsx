export function WelcomeScreen({ onExampleClick }) {
  const examples = [
    {
      title: 'Gene Editing',
      text: 'What are the latest findings on CRISPR gene editing?'
    },
    {
      title: 'Protein Biology',
      text: 'Explain protein folding mechanisms'
    },
    {
      title: 'Cancer Research',
      text: 'Search for papers on cancer immunotherapy'
    },
    {
      title: 'Vaccine Technology',
      text: 'How does mRNA vaccine technology work?'
    },
    {
      title: 'Drug Discovery',
      text: 'Find recent breakthroughs in AI-driven drug discovery'
    },
    {
      title: 'Genomics',
      text: 'What are the applications of single-cell sequencing?'
    }
  ];

  return (
    <div className="welcome-screen">
      <h1 className="welcome-title">BioAgents</h1>
      <p className="welcome-subtitle">
        AI-powered biological research assistant
      </p>
      <div className="example-prompts">
        {examples.map((example, index) => (
          <div
            key={index}
            className="example-prompt"
            onClick={() => onExampleClick && onExampleClick(example.text)}
          >
            <div className="example-prompt-title">{example.title}</div>
            <div className="example-prompt-text">{example.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
