import { Icon } from './icons/Icon';

export function WelcomeScreen({ onExampleClick }) {
  const examples = [
    {
      icon: 'dna',
      title: 'Gene Editing',
      text: 'What are the latest findings on CRISPR gene editing?'
    },
    {
      icon: 'microscope',
      title: 'Protein Biology',
      text: 'Explain protein folding mechanisms'
    },
    {
      icon: 'activity',
      title: 'Cancer Research',
      text: 'Search for papers on cancer immunotherapy'
    },
    {
      icon: 'syringe',
      title: 'Vaccine Technology',
      text: 'How does mRNA vaccine technology work?'
    },
    {
      icon: 'pill',
      title: 'Drug Discovery',
      text: 'Find recent breakthroughs in AI-driven drug discovery'
    },
    {
      icon: 'flask',
      title: 'Genomics',
      text: 'What are the applications of single-cell sequencing?'
    }
  ];

  return (
    <div className="welcome-screen">
      <div className="welcome-header">
        <div className="welcome-logo-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C12 2 8 4 8 8C8 10 9 11 10 12C9 13 8 14 8 16C8 20 12 22 12 22C12 22 16 20 16 16C16 14 15 13 14 12C15 11 16 10 16 8C16 4 12 2 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <h1 className="welcome-title">
          <span className="welcome-title-bio">BIO</span>
          <span className="welcome-title-agents">AGENTS</span>
        </h1>
        <p className="welcome-subtitle">
          AI-powered biological research assistant
        </p>
      </div>

      <div className="welcome-section">
        <h2 className="welcome-section-title">Popular Topics</h2>
        <div className="example-prompts">
          {examples.map((example, index) => (
            <div
              key={index}
              className="example-prompt"
              onClick={() => onExampleClick && onExampleClick(example.text)}
            >
              <div className="example-prompt-icon">
                <Icon name={example.icon} size={20} />
              </div>
              <div className="example-prompt-content">
                <div className="example-prompt-title">{example.title}</div>
                <div className="example-prompt-text">{example.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
