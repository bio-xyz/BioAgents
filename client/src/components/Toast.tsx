import type { Toast as ToastType } from "../hooks/useToast";

interface ToastProps {
  toast: ToastType;
  onClose: (id: string) => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const { id, message, type } = toast;

  const colors = {
    error: {
      bg: "rgba(239, 68, 68, 0.95)",
      border: "#dc2626",
      icon: "✕",
    },
    info: {
      bg: "rgba(59, 130, 246, 0.95)",
      border: "#2563eb",
      icon: "ℹ",
    },
    success: {
      bg: "rgba(34, 197, 94, 0.95)",
      border: "#16a34a",
      icon: "✓",
    },
    warning: {
      bg: "rgba(251, 146, 60, 0.95)",
      border: "#ea580c",
      icon: "⚠",
    },
  };

  const style = colors[type] || colors.info;

  return (
    <div
      style={{
        alignItems: "center",
        animation: "slideIn 0.3s ease-out",
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: "0.5rem",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        color: "#fff",
        display: "flex",
        fontSize: "0.9rem",
        gap: "0.75rem",
        maxWidth: "500px",
        minWidth: "300px",
        padding: "1rem 1.25rem",
        wordBreak: "break-word",
      }}
    >
      <span style={{ flexShrink: 0, fontSize: "1.2rem", fontWeight: "bold" }}>{style.icon}</span>
      <span style={{ flex: 1, whiteSpace: "pre-line" }}>{message}</span>
      <button
        onClick={() => onClose(id)}
        style={{
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          flexShrink: 0,
          fontSize: "1.2rem",
          lineHeight: 1,
          opacity: 0.8,
          padding: "0",
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.opacity = "0.8";
        }}
      >
        ×
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastType[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>
        {`
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          pointerEvents: "none",
          position: "fixed",
          right: "1rem",
          top: "1rem",
          zIndex: 9999,
        }}
      >
        {toasts.map((toast) => (
          <div key={toast.id} style={{ pointerEvents: "auto" }}>
            <Toast toast={toast} onClose={onClose} />
          </div>
        ))}
      </div>
    </>
  );
}
