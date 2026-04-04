
import React, { useEffect, useMemo, useState } from "react";

// PATCH_PWA: Premium install prompt with clear messaging and animation
export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }, []);

  const isStandalone = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator?.standalone === true
    );
  }, []);

  useEffect(() => {
    if (isStandalone) return;
    if (localStorage.getItem("orkio_pwa_dismissed") === "1") {
      setDismissed(true);
      return;
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Delay showing the prompt for 3 seconds so user settles in first
    const timer = setTimeout(() => setVisible(true), 3000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(timer);
    };
  }, [isStandalone]);

  if (isStandalone) return null;
  if (dismissed) return null;
  if (!visible) return null;
  if (!deferredPrompt && !isIOS) return null;

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setDismissed(true);
  };

  const dismiss = () => {
    localStorage.setItem("orkio_pwa_dismissed", "1");
    setDismissed(true);
  };

  return (
    <>
      <style>{`
        @keyframes orkioPwaSlideUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 24,
        zIndex: 9999,
        padding: "16px 18px",
        borderRadius: 20,
        border: "1px solid rgba(55,197,255,0.20)",
        background: "linear-gradient(135deg, rgba(12,12,20,0.97), rgba(20,18,35,0.97))",
        color: "#fff",
        display: "flex",
        gap: 14,
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 16px 48px rgba(0,0,0,0.50), 0 0 20px rgba(55,197,255,0.08)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        animation: "orkioPwaSlideUp 0.5s ease-out",
        maxWidth: 480,
        margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(55,197,255,0.15), rgba(125,107,255,0.15))",
            border: "1px solid rgba(55,197,255,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <img
              src="/icons/orkio-192.png"
              alt="Orkio"
              style={{ width: 28, height: 28, borderRadius: 6 }}
              onError={(e) => { e.target.style.display = "none"; }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em" }}>
              Install Orkio on your device
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2, lineHeight: 1.4 }}>
              {isIOS && !deferredPrompt
                ? "Tap the Share button below, then \"Add to Home Screen\" for the full app experience."
                : "Get instant access, voice conversations and offline support. Feels like a native app."}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "transparent",
              color: "rgba(255,255,255,0.6)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Later
          </button>
          {!isIOS || deferredPrompt ? (
            <button
              type="button"
              onClick={install}
              style={{
                padding: "10px 18px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #37C5FF, #7D6BFF)",
                color: "#0B0F14",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 6px 20px rgba(55,197,255,0.25)",
              }}
            >
              Install
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
