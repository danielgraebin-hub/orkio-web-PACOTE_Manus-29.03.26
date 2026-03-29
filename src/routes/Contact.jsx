import React, { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../ui/api.js";

const SUBJECTS = [
  "General Inquiry",
  "Technical Support",
  "Partnerships",
  "Data Privacy Request",
  "Other",
];

const PRIVACY_TYPES = [
  "Access my data",
  "Correct my data",
  "Delete my data",
  "Withdraw consent",
  "Information about processing",
  "Other",
];

export default function Contact() {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    whatsapp: "",
    subject: "General Inquiry",
    message: "",
    privacy_request_type: "",
    consent_terms: false,
    consent_marketing: false,
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const isPrivacy = form.subject === "Data Privacy Request";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.consent_terms) {
      setError("You must accept the Terms of Use and Privacy Policy.");
      return;
    }
    if (isPrivacy && !form.privacy_request_type) {
      setError("Please select a privacy request type.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const payload = { ...form };
      if (!isPrivacy) delete payload.privacy_request_type;
      await apiFetch("/api/public/contact", { method: "POST", body: payload });
      setSent(true);
    } catch (err) {
      setError(err.message || "Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const whatsappLink = `https://wa.me/555189697605?text=${encodeURIComponent("Hello, I came from Orkio and would like assistance.")}`;

  if (sent) {
    return (
      <div className="min-h-screen bg-[#070910] text-white flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="text-5xl mb-4">&#10003;</div>
          <h2 className="text-2xl font-bold">Message Sent</h2>
          <p className="mt-3 text-white/70">
            Your request has been received. We will respond within 3 business days.
            {isPrivacy && " For data privacy requests, the legal response timeframe may be up to 15 days."}
          </p>
          <Link to="/" className="mt-6 inline-block rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-6 py-3 text-sm font-bold text-black hover:brightness-110">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">Contact Us</h1>
        <p className="mt-2 text-sm text-white/60">
          Have a question, need support, or want to exercise your data rights? Fill out the form below.
        </p>

        {/* WhatsApp Button */}
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 hover:bg-emerald-500/15 transition-colors"
        >
          <svg className="h-8 w-8 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          <div>
            <div className="text-sm font-bold text-emerald-400">Talk on WhatsApp</div>
            <div className="text-xs text-white/50">Customer support via WhatsApp</div>
          </div>
        </a>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
          )}

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">Full Name *</label>
            <input
              type="text" required value={form.full_name} onChange={(e) => set("full_name", e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">Email *</label>
            <input
              type="email" required value={form.email} onChange={(e) => set("email", e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">WhatsApp <span className="text-white/40">(optional, with country code)</span></label>
            <input
              type="tel" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none"
              placeholder="+55 51 99999-9999"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">Subject *</label>
            <select
              value={form.subject} onChange={(e) => set("subject", e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-violet-400/50 focus:outline-none"
            >
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {isPrivacy && (
            <div>
              <label className="block text-sm font-semibold text-white/80 mb-1">Request Type *</label>
              <select
                value={form.privacy_request_type} onChange={(e) => set("privacy_request_type", e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-violet-400/50 focus:outline-none"
              >
                <option value="">Select a request type...</option>
                {PRIVACY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">Message *</label>
            <textarea
              required value={form.message} onChange={(e) => set("message", e.target.value)}
              rows={5}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none resize-none"
              placeholder="How can we help you?"
            />
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox" checked={form.consent_terms} onChange={(e) => set("consent_terms", e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 accent-violet-500"
              />
              <span className="text-sm text-white/70">
                I have read and agree to the{" "}
                <Link to="/legal/terms" className="text-violet-400 hover:underline" target="_blank">Terms of Use</Link>{" "}
                and{" "}
                <Link to="/legal/privacy" className="text-violet-400 hover:underline" target="_blank">Privacy Policy</Link>. *
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox" checked={form.consent_marketing} onChange={(e) => set("consent_marketing", e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 accent-violet-500"
              />
              <span className="text-sm text-white/70">
                I authorize Orkio to send institutional communications via email and WhatsApp.
              </span>
            </label>
          </div>

          <p className="text-xs text-white/40 leading-5">
            The information submitted through this form will be used exclusively to respond to your request,
            in accordance with our Privacy Policy.
          </p>

          <button
            type="submit" disabled={sending}
            className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-6 py-3 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send Message"}
          </button>
        </form>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-white/40">
          Operated by PATROAI CONSULTECH LTDA
        </div>
      </div>
    </div>
  );
}
