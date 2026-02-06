// Main App component with routing
import { useState } from "preact/hooks";
import { DemoPage } from "./pages/DemoPage";
import { ArchivePage } from "./pages/ArchivePage";

type View = "demo" | "archive";

export function App() {
  const [view, setView] = useState<View>("demo");
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRestart = async () => {
    if (!confirm("This will stop all current research and start fresh with new topics. Continue?")) {
      return;
    }

    try {
      const response = await fetch("/api/restart", { method: "POST" });
      if (response.ok) {
        setRefreshKey((k) => k + 1);
      } else {
        alert("Failed to restart");
      }
    } catch (error) {
      console.error("Restart failed:", error);
      alert("Failed to restart");
    }
  };

  return (
    <>
      <header class="header">
        <h1>Autonomous Research Demo</h1>
        <div class="header-actions">
          <button
            class={`btn ${view === "demo" ? "btn-primary" : ""}`}
            onClick={() => setView("demo")}
          >
            Live Research
          </button>
          <button
            class={`btn ${view === "archive" ? "btn-primary" : ""}`}
            onClick={() => setView("archive")}
          >
            Archive
          </button>
          {view === "demo" && (
            <button class="btn" onClick={handleRestart}>
              Restart
            </button>
          )}
        </div>
      </header>

      {view === "demo" ? (
        <DemoPage key={refreshKey} />
      ) : (
        <ArchivePage />
      )}
    </>
  );
}
