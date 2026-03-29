import React from "react";
import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">Privacy Policy – Orkio</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: March 12, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/75">
          <p>The data controller is <strong className="text-white/90">PATROAI CONSULTECH LTDA</strong>, Porto Alegre – RS – Brazil.</p>
          <p>We may collect account data, usage data, technical identifiers and interaction history to operate the platform, generate AI responses, maintain security and provide support.</p>
          <p>Processing may occur under contract execution, legitimate interest, legal obligations or user consent, in accordance with applicable data protection laws.</p>
          <p>User prompts may be processed by third-party AI providers solely for the purpose of generating outputs requested through the service.</p>
          <p>Marketing communications are sent only with explicit consent. Users may opt out at any time via account settings, unsubscribe links or support contact.</p>
          <p>Users may request access, correction, deletion or restriction of processing where applicable.</p>
        </div>
      </div>
    </div>
  );
}
