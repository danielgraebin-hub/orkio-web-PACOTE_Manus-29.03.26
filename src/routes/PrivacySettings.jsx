import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../ui/api.js";
import { getToken } from "../lib/auth.js";

export default function PrivacySettings() {
  const nav = useNavigate();
  const token = getToken();
  const [marketing, setMarketing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) { nav("/auth"); return; }
    apiFetch("/api/me/privacy", { token })
      .then((d) => { setMarketing(d.marketing_consent || false); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await apiFetch("/api/me/privacy", { method: "PUT", token, body: { marketing_consent: marketing } });
      setMsg("Preferences saved successfully.");
    } catch (e) {
      setMsg("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070910] text-white flex items-center justify-center">
        <div className="text-white/50">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Link to="/app" className="text-sm text-white/50 hover:text-white/80">&larr; Back to console</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">Privacy Settings</h1>
        <p className="mt-2 text-sm text-white/60">Manage your data and consent preferences.</p>

        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-bold">Marketing Communications</h2>
            <p className="mt-2 text-sm text-white/60">
              Control whether you receive institutional communications from Orkio via email and WhatsApp.
            </p>
            <label className="mt-4 flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                className="h-5 w-5 rounded border-white/20 bg-white/5 accent-violet-500"
              />
              <span className="text-sm text-white/80">
                I authorize Orkio to send institutional communications via email and WhatsApp.
              </span>
            </label>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-bold">Your Data Rights</h2>
            <p className="mt-2 text-sm text-white/60">
              Under LGPD and applicable data protection laws, you have the right to:
            </p>
            <ul className="mt-3 space-y-1 text-sm text-white/70">
              <li>&#8226; Access your personal data</li>
              <li>&#8226; Correct inaccurate data</li>
              <li>&#8226; Request deletion of your data</li>
              <li>&#8226; Withdraw consent at any time</li>
              <li>&#8226; Request information about data processing</li>
            </ul>
            <Link
              to="/contact"
              className="mt-4 inline-block rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              Submit a Data Request
            </Link>
          </div>

          {msg && (
            <div className={`rounded-xl p-3 text-sm ${msg.includes("success") ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border border-red-500/30 bg-red-500/10 text-red-300"}`}>
              {msg}
            </div>
          )}

          <button
            onClick={save} disabled={saving}
            className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-6 py-3 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-white/40">
          Operated by PATROAI CONSULTECH LTDA
        </div>
      </div>
    </div>
  );
}
