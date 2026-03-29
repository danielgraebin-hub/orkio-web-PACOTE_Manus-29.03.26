import React from "react";
import { Link } from "react-router-dom";

export default function AiGovernance() {
  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">AI Governance Charter – Orkio</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: March 12, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/75">
          <p>Orkio is operated by <strong className="text-white/90">PATROAI CONSULTECH LTDA</strong> and designed to assist human decision-making, not replace it.</p>
          <p>AI systems in Orkio are probabilistic and may produce incomplete or inaccurate outputs. Human review remains essential in critical contexts.</p>
          <p>Users and organizations are responsible for reviewing AI outputs before applying them in legal, financial, medical, regulatory or safety-critical settings.</p>
          <p>Orkio enforces safeguards against fraud, abuse, impersonation, harmful misinformation and attempts to bypass system protections.</p>
          <p>Users may not attempt to extract system prompts, infer hidden instructions, reconstruct platform architecture, or disable safety mechanisms.</p>
          <p>The platform may evolve over time. Features, models, safeguards and agent behaviors may be adjusted as the service matures.</p>
        </div>
      </div>
    </div>
  );
}
