import React from "react";
import { Outlet } from "react-router-dom";
import Footer from "./Footer.jsx";
import PWAInstallPrompt from "../components/PWAInstallPrompt.jsx";

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#070910] text-white flex flex-col">
      <div className="flex-1">
        <Outlet />
      </div>

      <PWAInstallPrompt />
      <Footer />
    </div>
  );
}
