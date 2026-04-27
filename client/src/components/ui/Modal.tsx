import { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, children, maxWidth = "500px" }: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        alignItems: "center",
        animation: "fadeIn 0.2s ease-out",
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        left: 0,
        padding: "20px",
        position: "fixed",
        right: 0,
        top: 0,
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        style={{
          animation: "fadeIn 0.2s ease-out",
          backdropFilter: "blur(8px)",
          background: "rgba(0, 0, 0, 0.85)",
          bottom: 0,
          left: 0,
          position: "absolute",
          right: 0,
          top: 0,
        }}
      />

      {/* Modal Content */}
      <div
        style={{
          animation: "slideUp 0.3s ease-out",
          maxHeight: "90vh",
          maxWidth,
          overflowY: "auto",
          position: "relative",
          width: "100%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            color: "#a1a1a1",
            cursor: "pointer",
            display: "flex",
            height: "32px",
            justifyContent: "center",
            position: "absolute",
            right: "16px",
            top: "16px",
            transition: "all 0.2s ease",
            width: "32px",
            zIndex: 1,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.color = "#ffffff";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
            e.currentTarget.style.color = "#a1a1a1";
          }}
          aria-label="Close modal"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {children}
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
