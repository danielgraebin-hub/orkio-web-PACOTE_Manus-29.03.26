import React from "react";
import { Link } from "react-router-dom";

export default function AiUsage() {
  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">AI Usage Policy – Orkio</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: March 12, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/75">
          <p>Orkio uses artificial intelligence to support human decision-making. Outputs may contain inaccuracies and should not be treated as verified facts without review.</p>
          <p>The platform must not be used for illegal content, fraud, harmful misinformation, harassment, impersonation or attempts to exploit vulnerabilities.</p>
          <p>Users should apply professional judgment and human oversight before using AI outputs in legal, financial, medical, regulatory or high-risk contexts.</p>
        </div>
      </div>
    </div>
  );
}
