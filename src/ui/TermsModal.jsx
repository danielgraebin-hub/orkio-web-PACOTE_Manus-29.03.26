import React, { useState } from "react";
import { apiFetch } from "./api.js";
import { getToken } from "../lib/auth.js";

/**
 * Blocking modal for first-login Terms acceptance.
 * Props:
 *   onAccepted: () => void — called after successful acceptance
 */
export default function TermsModal({ onAccepted }) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
  setAccepting(true);
  setError("");
  try {
    const token = getToken();
    await apiFetch("/api/me/accept-terms", {
      method: "POST",
      token,
      body: { accepted: true, terms_version: "2026-03-01" },
    });
    onAccepted();
  } catch (e) {
    setError(e.message || "Failed to accept. Please try again.");
  } finally {
    setAccepting(false);
  }
};


  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-3xl border border-white/10 bg-[#0d1117] p-8 shadow-2xl">
        <h2 className="text-xl font-black text-white">Acceptance Required</h2>
        <p className="mt-3 text-sm leading-6 text-white/70">
          To continue using Orkio, you must accept our Terms of Use and Privacy Policy.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button
            onClick={accept}
            disabled={accepting}
            className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-6 py-3 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {accepting ? "Processing..." : "Accept and Continue"}
          </button>

          <div className="flex gap-3">
            <a
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-center text-sm font-semibold text-white/80 hover:bg-white/10"
            >
              View Terms
            </a>
            <a
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-center text-sm font-semibold text-white/80 hover:bg-white/10"
            >
              View Privacy Policy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
