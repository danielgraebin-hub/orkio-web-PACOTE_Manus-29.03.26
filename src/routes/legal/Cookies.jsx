import React from "react";
import { Link } from "react-router-dom";

export default function Cookies() {
  return (
    <div className="min-h-screen bg-[#070910] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link to="/" className="text-sm text-white/50 hover:text-white/80">&larr; Back to home</Link>
        <h1 className="mt-6 text-3xl font-black tracking-tight">Cookies Policy – Orkio</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: March 12, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/75">
          <p>Orkio uses technical cookies and similar identifiers for authentication, session management, security monitoring and essential platform functionality.</p>
          <p>These cookies are necessary for platform operation. Users may control optional browser-level cookies through their browser settings.</p>
        </div>
      </div>
    </div>
  );
}
