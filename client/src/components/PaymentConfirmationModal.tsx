import { Modal } from "./ui/Modal";

interface PaymentConfirmationModalProps {
  isOpen: boolean;
  amount: string;
  currency: string;
  network: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PaymentConfirmationModal({
  isOpen,
  amount,
  currency,
  network,
  onConfirm,
  onCancel,
}: PaymentConfirmationModalProps) {
  const isTestnet = network.includes("sepolia");

  return (
    <Modal isOpen={isOpen} onClose={onCancel} maxWidth="450px">
      <div style={{
        padding: "24px",
        background: "#0a0a0a",
        borderRadius: "12px",
      }}>
        {/* Header */}
        <div style={{ marginBottom: "24px", textAlign: "center" }}>
          <div style={{
            width: "64px",
            height: "64px",
            margin: "0 auto 16px",
            borderRadius: "50%",
            background: "rgba(16, 185, 129, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 6v6l4 2"></path>
            </svg>
          </div>
          <h2 style={{
            margin: "0 0 8px 0",
            fontSize: "20px",
            fontWeight: 600,
            color: "#ffffff",
          }}>
            Confirm Payment
          </h2>
          <p style={{
            margin: 0,
            fontSize: "14px",
            color: "#a1a1a1",
          }}>
            Please review the transaction details before proceeding
          </p>
        </div>

        {/* Payment Details */}
        <div style={{
          background: "#262626",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "24px",
        }}>
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "12px", color: "#a1a1a1", marginBottom: "4px" }}>
              Amount
            </div>
            <div style={{ fontSize: "24px", fontWeight: 600, color: "#10b981" }}>
              ${amount} {currency}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #404040", paddingTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", color: "#a1a1a1" }}>Network</span>
              <span style={{ fontSize: "13px", color: "#ffffff", fontFamily: "monospace" }}>
                {network === "base-sepolia" ? "Base Sepolia" : "Base"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "13px", color: "#a1a1a1" }}>Type</span>
              <span style={{ fontSize: "13px", color: "#ffffff" }}>
                Gasless Transfer (EIP-3009)
              </span>
            </div>
          </div>

          {isTestnet && (
            <div style={{
              marginTop: "12px",
              padding: "8px 12px",
              background: "rgba(251, 146, 60, 0.1)",
              borderRadius: "6px",
              border: "1px solid rgba(251, 146, 60, 0.2)",
            }}>
              <div style={{ fontSize: "12px", color: "#fb923c" }}>
                ⚠️ Testnet Transaction - No real funds will be used
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px",
              background: "#262626",
              border: "1px solid #404040",
              borderRadius: "8px",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "#404040";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "#262626";
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "12px",
              background: "#10b981",
              border: "none",
              borderRadius: "8px",
              color: "#000000",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(16, 185, 129, 0.4)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
            }}
          >
            Confirm Payment
          </button>
        </div>
      </div>
    </Modal>
  );
}
