
import React, { useEffect, useMemo, useState } from "react";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }, []);

  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem("orkio_pwa_dismissed") === "1") {
      setDismissed(true);
      return;
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed) return null;
  if (!deferredPrompt && !isIOS) return null;

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    localStorage.setItem("orkio_pwa_dismissed", "1");
    setDismissed(true);
  };

  return (
    <div style={{
      position: "fixed",
      left: 16,
      right: 16,
      bottom: 92,
      zIndex: 60,
      padding: 12,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(12,12,20,0.96)",
      color: "#fff",
      display: "flex",
      gap: 10,
      alignItems: "center",
      justifyContent: "space-between",
      boxShadow: "0 10px 24px rgba(0,0,0,.35)",
    }}>
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <img src="/orkio-logo-app.png" alt="Orkio" style={{width:28,height:28}} />
        <div style={{fontSize:12}}>
          <div style={{fontWeight:700}}>Install Orkio</div>
          <div style={{opacity:.8}}>
            {isIOS && !deferredPrompt
              ? "Tap Share → Add to Home Screen."
              : "Add Orkio to your device for the best Summit experience."}
          </div>
        </div>
      </div>
      <div style={{display:"flex", gap:8}}>
        <button type="button" onClick={dismiss} style={{padding:"8px 10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#fff"}}>Later</button>
        {!isIOS || deferredPrompt ? (
          <button type="button" onClick={install} style={{padding:"8px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.1)", background:"#fff", color:"#111"}}>Install</button>
        ) : null}
      </div>
    </div>
  );
}
