export interface ContactResidue {
  position: number;
  residueName: string;
  oneLetterCode: string;
  chain: string;
  minDistance: number;
  contactCount: number;
}

export interface UniProtFeature {
  type: string;
  description: string;
  start: number;
  end: number;
}

export interface AlphaFoldEntry {
  entryId: string;
  structureUrl: string;
  pdbUrl: string;
  paeImageUrl: string;
}

export interface GpcrdbEntry {
  entryName: string;
  family: string;
  numberingScheme: string;
}

export interface GpcrPocketResidue {
  position: number;
  residue: string;
  segment: string;
  genericNumber: string;
  source: string;
}

export interface GpcrSegment {
  position: number;
  segment: string;
  genericNumber: string;
}

export interface LiteratureHotspot {
  position: number;
  residue: string;
  source: string;
}

export interface MutagenesisHotspot {
  position: number;
  residue: string;
  source: string;
  description: string;
}

export interface HomologContact extends ContactResidue {
  homologPdbId: string;
  identity: number;
}

export interface RankedResidue {
  position: number;
  score: number;
  sources: string[];
}

export interface TargetData {
  target: {
    uniprotId: string;
    geneName: string | null;
    proteinName: string;
    organism: string | null;
    sequenceLength: number;
  };
  sequence: string;
  features: UniProtFeature[];
  domains: UniProtFeature[];
  pdbIds: string[];
  alphafold: AlphaFoldEntry | null;
  bindingSites: UniProtFeature[];
  literatureHotspots: LiteratureHotspot[];
  mutagenesisHotspots: MutagenesisHotspot[];
  cocrystalContacts: ContactResidue[];
  contactPdbId: string | null;
  contactChain: string | null;
  gpcrdbEntry: GpcrdbEntry | null;
  gpcrPocketResidues: GpcrPocketResidue[];
  gpcrSegments: GpcrSegment[];
  homologContacts: HomologContact[];
  rankedResidues: RankedResidue[];
  annotationSources: string[];
}
