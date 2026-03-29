import React from "react";
import { Link } from "react-router-dom";

/**
 * Global footer with legal links.
 * Must be present on all pages per LGPD compliance.
 */
export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black/10">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-white/60">
          <Link to="/legal/terms" className="hover:text-white/90">Terms of Use</Link>
          <span className="text-white/20">|</span>
          <Link to="/legal/privacy" className="hover:text-white/90">Privacy Policy</Link>
          <span className="text-white/20">|</span>
          <Link to="/legal/cookies" className="hover:text-white/90">Cookies</Link>
          <span className="text-white/20">|</span>
          <Link to="/legal/ai-policy" className="hover:text-white/90">AI Usage</Link>
          <span className="text-white/20">|</span>
          <Link to="/contact" className="hover:text-white/90">Contact</Link>
        </div>
        <div className="mt-3 text-center text-xs text-white/35">
          Operated by PATROAI CONSULTECH LTDA
        </div>
      </div>
    </footer>
  );
}
