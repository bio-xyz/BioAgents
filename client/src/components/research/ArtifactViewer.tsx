import { useEffect, useState } from "preact/hooks";
import { useConversation } from "../../providers/ConversationProvider";
import { Icon } from "../icons";

interface Artifact {
  id?: string;
  filename: string;
  content: string;
  description?: string;
  mimeType?: string;
  path?: string;
}

interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts?: Artifact[];
  executionTime?: number;
}

interface Props {
  results: CodeExecutionResult[];
  defaultExpanded?: boolean;
}

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
];

const isImageFile = (filename: string): boolean =>
  IMAGE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));

const getMimeType = (filename: string, providedMimeType?: string): string => {
  if (providedMimeType) return providedMimeType;
  const ext = filename.split(".").pop()?.toLowerCase() || "png";
  return `image/${ext === "svg" ? "svg+xml" : ext}`;
};

async function fetchPresignedUrl(
  userId: string,
  conversationStateId: string,
  path: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ userId, conversationStateId, path });
    const response = await fetch(`/api/artifacts/download?${params}`);
    if (!response.ok) return null;
    const { url } = await response.json();
    return url;
  } catch {
    return null;
  }
}

export function ArtifactViewer({ results, defaultExpanded = true }: Props) {
  const { userId, conversationStateId } = useConversation();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const allArtifacts = results.flatMap((r) => r.artifacts || []);
  const hasArtifacts = allArtifacts.length > 0;
  const hasOutput = results.some((r) => r.output);
  const hasErrors = results.some((r) => r.error);

  // Preload image URLs
  useEffect(() => {
    if (!userId || !conversationStateId) return;

    const imagesToLoad = allArtifacts.filter(
      (a) => isImageFile(a.filename) && a.path && !imageUrls[a.path],
    );
    if (imagesToLoad.length === 0) return;

    const loadImages = async () => {
      const entries = await Promise.all(
        imagesToLoad.map(async (artifact) => {
          if (!artifact.path) return null;
          const url = await fetchPresignedUrl(
            userId,
            conversationStateId,
            artifact.path,
          );
          return url ? ([artifact.path, url] as const) : null;
        }),
      );

      const newUrls = Object.fromEntries(
        entries.filter(Boolean) as [string, string][],
      );
      if (Object.keys(newUrls).length > 0) {
        setImageUrls((prev) => ({ ...prev, ...newUrls }));
      }
    };

    loadImages();
  }, [allArtifacts, userId, conversationStateId]);

  if (!hasArtifacts && !hasOutput && !hasErrors) return null;

  const getImageSrc = (artifact: Artifact): string => {
    if (artifact.path && imageUrls[artifact.path]) {
      return imageUrls[artifact.path];
    }
    if (artifact.content) {
      return `data:${getMimeType(artifact.filename, artifact.mimeType)};base64,${artifact.content}`;
    }
    return "";
  };

  const handleDownload = async (artifact: Artifact) => {
    const artifactKey = artifact.id || artifact.filename;
    setIsDownloading(artifactKey);

    try {
      if (artifact.path && userId && conversationStateId) {
        const url = await fetchPresignedUrl(
          userId,
          conversationStateId,
          artifact.path,
        );
        if (url) {
          window.open(url, "_blank");
          return;
        }
      }

      if (artifact.content) {
        const bytes = Uint8Array.from(atob(artifact.content), (c) =>
          c.charCodeAt(0),
        );
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = artifact.filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      throw new Error("No download method available");
    } catch (err) {
      console.error("Failed to download artifact:", err);
    } finally {
      setIsDownloading(null);
    }
  };

  const totalExecutionTime = results.reduce(
    (acc, r) => acc + (r.executionTime || 0),
    0,
  );

  return (
    <div className="artifact-viewer">
      <button
        className="artifact-viewer-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="artifact-viewer-header-left">
          <span className="artifact-viewer-icon">💻</span>
          <span className="artifact-viewer-title">Code Execution Results</span>
          <div className="artifact-viewer-badges">
            {hasArtifacts && (
              <span className="artifact-badge artifact-badge-files">
                {allArtifacts.length} file{allArtifacts.length !== 1 ? "s" : ""}
              </span>
            )}
            {hasErrors && (
              <span className="artifact-badge artifact-badge-error">
                {results.filter((r) => r.error).length} error
                {results.filter((r) => r.error).length !== 1 ? "s" : ""}
              </span>
            )}
            {totalExecutionTime > 0 && (
              <span className="artifact-badge artifact-badge-time">
                {(totalExecutionTime / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
        <Icon
          name="chevronDown"
          size={16}
          className={`artifact-viewer-chevron ${isExpanded ? "expanded" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="artifact-viewer-content">
          {/* Console Output */}
          {results.map((result, resultIndex) => (
            <div key={resultIndex} className="artifact-execution-block">
              {result.output && (
                <div className="artifact-output">
                  <div className="artifact-output-header">
                    <Icon name="terminal" size={14} />
                    <span>Console Output</span>
                    {result.success && (
                      <span className="artifact-status-success">✓ Success</span>
                    )}
                  </div>
                  <pre className="artifact-output-content">{result.output}</pre>
                </div>
              )}

              {result.error && (
                <div className="artifact-error">
                  <div className="artifact-error-header">
                    <Icon name="alertTriangle" size={14} />
                    <span>Error</span>
                  </div>
                  <pre className="artifact-error-content">{result.error}</pre>
                </div>
              )}
            </div>
          ))}

          {/* Generated Files Grid */}
          {hasArtifacts && (
            <div className="artifact-files-section">
              <div className="artifact-files-header">
                <Icon name="file" size={14} />
                <span>Generated Files</span>
              </div>
              <div className="artifact-files-grid">
                {allArtifacts.map((artifact, index) => {
                  const isImage = isImageFile(artifact.filename);
                  return (
                    <div
                      key={artifact.id || index}
                      className={`artifact-file-card ${isImage ? "artifact-file-image" : ""}`}
                      onClick={() => isImage && setSelectedArtifact(artifact)}
                    >
                      {isImage ? (
                        <div className="artifact-file-preview">
                          <img
                            src={getImageSrc(artifact)}
                            alt={artifact.description || artifact.filename}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        </div>
                      ) : (
                        <div className="artifact-file-icon">
                          <Icon name="file" size={24} />
                        </div>
                      )}
                      <div className="artifact-file-info">
                        <span className="artifact-file-name">
                          {artifact.filename}
                        </span>
                        {artifact.description && (
                          <span className="artifact-file-desc">
                            {artifact.description}
                          </span>
                        )}
                      </div>
                      <button
                        className="artifact-file-download"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(artifact);
                        }}
                        title="Download"
                      >
                        <Icon name="download" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox for image preview */}
      {selectedArtifact && isImageFile(selectedArtifact.filename) && (
        <div
          className="artifact-lightbox"
          onClick={() => setSelectedArtifact(null)}
        >
          <div
            className="artifact-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="artifact-lightbox-close"
              onClick={() => setSelectedArtifact(null)}
            >
              <Icon name="close" size={20} />
            </button>
            <img
              src={getImageSrc(selectedArtifact)}
              alt={selectedArtifact.description || selectedArtifact.filename}
            />
            <div className="artifact-lightbox-info">
              <span className="artifact-lightbox-filename">
                {selectedArtifact.filename}
              </span>
              {selectedArtifact.description && (
                <span className="artifact-lightbox-desc">
                  {selectedArtifact.description}
                </span>
              )}
              <button
                className="artifact-lightbox-download"
                onClick={() => handleDownload(selectedArtifact)}
              >
                <Icon name="download" size={14} />
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
