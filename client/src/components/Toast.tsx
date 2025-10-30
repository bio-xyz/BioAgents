import type { Toast as ToastType } from "../hooks/useToast";

interface ToastProps {
  toast: ToastType;
  onClose: (id: string) => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const { id, message, type } = toast;

  const colors = {
    success: {
      bg: "rgba(34, 197, 94, 0.95)",
      border: "#16a34a",
      icon: "✓",
    },
    error: {
      bg: "rgba(239, 68, 68, 0.95)",
      border: "#dc2626",
      icon: "✕",
    },
    warning: {
      bg: "rgba(251, 146, 60, 0.95)",
      border: "#ea580c",
      icon: "⚠",
    },
    info: {
      bg: "rgba(59, 130, 246, 0.95)",
      border: "#2563eb",
      icon: "ℹ",
    },
  };

  const style = colors[type] || colors.info;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "1rem 1.25rem",
        borderRadius: "0.5rem",
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: "#fff",
        fontSize: "0.9rem",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        minWidth: "300px",
        maxWidth: "500px",
        wordBreak: "break-word",
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <span style={{ fontSize: "1.2rem", fontWeight: "bold", flexShrink: 0 }}>
        {style.icon}
      </span>
      <span style={{ flex: 1, whiteSpace: "pre-line" }}>{message}</span>
      <button
        onClick={() => onClose(id)}
        style={{
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          fontSize: "1.2rem",
          padding: "0",
          lineHeight: 1,
          opacity: 0.8,
          flexShrink: 0,
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
          position: "fixed",
          top: "1rem",
          right: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          zIndex: 9999,
          pointerEvents: "none",
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

