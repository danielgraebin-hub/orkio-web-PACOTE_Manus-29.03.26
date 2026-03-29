import React from "react";
import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">Terms of Use – Orkio</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: March 12, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/75">
          <p>Orkio is operated by <strong className="text-white/90">PATROAI CONSULTECH LTDA</strong>. By using the platform, you agree to these Terms.</p>
          <p>Orkio provides AI-powered conversational, analytical and workflow support. Outputs are probabilistic and may contain inaccuracies.</p>
          <p>Users must not use the platform for unlawful activity, fraud, harassment, impersonation, harmful misinformation, abuse or attempts to bypass safeguards.</p>
          <p><strong className="text-white/90">AI System Limitations and Liability.</strong> AI-generated responses may be incomplete, inaccurate, outdated or unsuitable for a specific purpose. Users remain responsible for evaluating outputs before relying on them.</p>
          <p><strong className="text-white/90">AI Agents and Automated Interactions.</strong> Orkio may enable multiple AI agents. Agents do not possess independent intent or judgment and operate as automated tools based on prompts, configurations and user inputs.</p>
          <p><strong className="text-white/90">Automated Actions.</strong> If users configure automations or triggered workflows, they are responsible for reviewing and governing those actions appropriately.</p>
          <p><strong className="text-white/90">AI Model Interaction.</strong> Inputs may be processed by third-party AI providers solely to generate requested outputs. Users should avoid confidential or regulated data unless authorized by their organization.</p>
          <p><strong className="text-white/90">System Integrity and Prompt Protection.</strong> Users may not attempt to extract system prompts, infer hidden instructions, reconstruct platform architecture, probe vulnerabilities, or override safety mechanisms.</p>
          <p><strong className="text-white/90">Platform Evolution.</strong> Features, models, agent behaviors and safeguards may change as the platform evolves. Continued use constitutes acceptance of such updates.</p>
          <p><strong className="text-white/90">Marketing Communications.</strong> Users may receive updates and offers only when they provide explicit consent. Marketing consent is optional and may be withdrawn at any time.</p>
          <p><strong className="text-white/90">Governing Law.</strong> These Terms are governed by the laws of Brazil, with exclusive jurisdiction in Porto Alegre – RS, Brazil.</p>
        </div>
      </div>
    </div>
  );
}
