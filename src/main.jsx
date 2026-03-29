import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken, getUser, isAdmin, isApproved } from "./lib/auth.js";

import Layout from "./ui/Layout.jsx";

import Landing from "./routes/Landing.jsx";
import AuthPage from "./routes/AuthPage.jsx";
import AppConsole from "./routes/AppConsole.jsx";
import AdminConsole from "./routes/AdminConsole.jsx";
import Contact from "./routes/Contact.jsx";
import PrivacySettings from "./routes/PrivacySettings.jsx";
import AdminEscalations from "./routes/AdminEscalations.jsx";
import Terms from "./routes/legal/Terms.jsx";
import Privacy from "./routes/legal/Privacy.jsx";
import Cookies from "./routes/legal/Cookies.jsx";
import AiUsage from "./routes/legal/AiUsage.jsx";
import AiGovernance from "./routes/legal/AiGovernance.jsx";


function RequireApproved({ children }) {
  const token = getToken();
  const user = getUser();
  if (!token) return <Navigate to="/auth" replace />;
  if (!isApproved(user)) return <Navigate to="/auth" replace />;
  return children;
}

function RequireGuest({ children }) {
  const token = getToken();
  const user = getUser();
  if (token && isApproved(user)) {
    return <Navigate to={isAdmin(user) ? "/admin" : "/app"} replace />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const token = getToken();
  const user = getUser();
  if (!token) return <Navigate to="/auth" replace />;
  if (!isAdmin(user)) return <Navigate to="/auth" replace />;
  return children;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<RequireGuest><AuthPage /></RequireGuest>} />
          <Route path="/signup" element={<Navigate to="/auth" replace />} />
          <Route path="/app" element={<RequireApproved><AppConsole /></RequireApproved>} />
          <Route path="/admin" element={<RequireAdmin><AdminConsole /></RequireAdmin>} />
          <Route path="/admin/escalations" element={<RequireAdmin><AdminEscalations /></RequireAdmin>} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/settings/privacy" element={<PrivacySettings />} />
          <Route path="/legal/terms" element={<Terms />} />
          <Route path="/legal/privacy" element={<Privacy />} />
          <Route path="/legal/cookies" element={<Cookies />} />
          <Route path="/legal/ai" element={<AiUsage />} />
          <Route path="/legal/ai-policy" element={<AiUsage />} />
          <Route path="/legal/ai-governance" element={<AiGovernance />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
