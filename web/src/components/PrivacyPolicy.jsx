import React from "react";

export default function PrivacyPolicy({ onClose }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", maxWidth: "520px", width: "100%", maxHeight: "80vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "17px", fontWeight: "800", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Privacy Policy</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "var(--text-secondary)", lineHeight: 1 }}>✕</button>
        </div>

        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>Last updated: July 2026 · Loci Focus (loci-flow.web.app)</p>

        {[
          {
            title: "What we store",
            body: "Your tasks, roadmap items, coach chat history, and app settings are stored in Firebase Realtime Database (Google), linked to your Google account UID. We store your first name (what you enter during setup) and nothing else personally identifiable."
          },
          {
            title: "Google Sign-In",
            body: "We use Google Sign-In for authentication. Google's own Privacy Policy governs what Google collects during sign-in. We receive your email address and display name from Google, and use them only to identify your account."
          },
          {
            title: "AI features (Coach, breakdown)",
            body: "When you use AI coaching or task breakdown, the text of your task or message — plus, if Coach Memory is enabled, any pinned facts and recent notes your coach has saved — is sent to one of our AI providers for processing: Groq (groq.com), Cerebras (cerebras.ai), Google Gemini, Z.ai, or NVIDIA, depending on which provider is active for your account. These services have their own privacy policies. We do not store your AI conversations on our servers beyond what Firebase RTDB syncs for your account. You can review, delete, or turn off Coach Memory anytime in Settings."
          },
          {
            title: "Analytics",
            body: "We use Firebase Analytics (Google) to understand basic usage patterns — which tabs are used, when tasks are completed. This is anonymous aggregated data. No task content is sent to Analytics."
          },
          {
            title: "Notifications",
            body: "If you enable notifications, we request browser notification permission. Notification tokens may be stored in Firebase RTDB to deliver reminders. You can revoke permission at any time in your browser settings."
          },
          {
            title: "Data sharing",
            body: "We do not sell, rent, or share your data with any third party beyond the services listed above (Firebase/Google, and whichever AI provider is active — Groq, Cerebras, Gemini, Z.ai, or NVIDIA). We have no advertising partners."
          },
          {
            title: "Deleting your data",
            body: "Sign out and contact us to delete your account data from Firebase. You can also delete tasks directly within the app."
          },
          {
            title: "Contact",
            body: "Questions? Email rohandas.iitkgp@gmail.com or open an issue on GitHub."
          }
        ].map(({ title, body }) => (
          <div key={title}>
            <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "4px" }}>{title}</h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.55" }}>{body}</p>
          </div>
        ))}

        <button
          className="btn"
          onClick={onClose}
          style={{ marginTop: "8px", width: "100%" }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
