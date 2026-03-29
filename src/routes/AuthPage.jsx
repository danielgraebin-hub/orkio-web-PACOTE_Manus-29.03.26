import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../ui/api.js";
import {
  setTenant,
  savePendingOtpContext,
  getPendingOtpContext,
  clearPendingOtpContext,
  completeOtpLogin,
  getToken,
  getUser,
  isApproved,
  isAdmin,
  setSession,
  stripTransientAuthFlags,
} from "../lib/auth.js";

const COUNTRIES = [
  { value: "BR", label: "Brazil" },
  { value: "US", label: "United States" },
  { value: "ES", label: "Spain" },
  { value: "PT", label: "Portugal" },
  { value: "AR", label: "Argentina" },
  { value: "MX", label: "Mexico" },
  { value: "CO", label: "Colombia" },
  { value: "CL", label: "Chile" },
  { value: "UY", label: "Uruguay" },
  { value: "OTHER", label: "Other" },
];

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "es-ES", label: "Español" },
  { value: "pt-PT", label: "Português (Portugal)" },
];

const DEFAULT_LANGUAGE_BY_COUNTRY = {
  BR: "pt-BR",
  PT: "pt-PT",
  ES: "es-ES",
  AR: "es-ES",
  MX: "es-ES",
  CO: "es-ES",
  CL: "es-ES",
  UY: "es-ES",
  US: "en-US",
  OTHER: "en-US",
};

const shell = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "radial-gradient(circle at top, #0f172a 0%, #020617 52%, #020617 100%)",
};

const card = {
  width: "100%",
  maxWidth: 560,
  borderRadius: 28,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.96)",
  color: "#0f172a",
  boxShadow: "0 30px 90px rgba(2,6,23,0.45)",
  padding: 24,
  boxSizing: "border-box",
};

const label = {
  display: "block",
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 700,
  color: "#334155",
};

const input = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  outline: "none",
  fontSize: 15,
  boxSizing: "border-box",
  minHeight: 56,
};

const btn = {
  width: "100%",
  border: 0,
  borderRadius: 18,
  padding: "15px 18px",
  fontWeight: 800,
  fontSize: 15,
  cursor: "pointer",
  background: "linear-gradient(135deg, #2563eb, #0f172a)",
  color: "#fff",
};

const secondaryBtn = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 18,
  padding: "15px 18px",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  background: "#ffffff",
  color: "#0f172a",
};

const subtleLink = {
  border: 0,
  background: "transparent",
  color: "#2563eb",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
  textAlign: "left",
};

const muted = { color: "#64748b", fontSize: 14, lineHeight: 1.5 };

const adminChip = {
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.75)",
  color: "#475569",
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 999,
  cursor: "pointer",
};

const passwordWrap = {
  position: "relative",
};

const passwordToggle = {
  position: "absolute",
  right: 12,
  top: "50%",
  transform: "translateY(-50%)",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  color: "#475569",
  fontSize: 12,
  fontWeight: 700,
};

const inputError = {
  border: "1px solid #ef4444",
  boxShadow: "0 0 0 3px rgba(239,68,68,0.12)",
};

const errorText = {
  marginTop: 6,
  color: "#b91c1c",
  fontSize: 12,
  fontWeight: 600,
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 640 : false
  );

  useEffect(() => {
    const onResize = () => {
      try {
        setIsMobile(window.innerWidth <= 640);
      } catch {}
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isMobile;
}

function suggestLanguage(country) {
  const code = String(country || "").trim().toUpperCase();
  return DEFAULT_LANGUAGE_BY_COUNTRY[code] || "en-US";
}

function isExplicitlyPendingApproval(user) {
  return (
    user?.approved === false ||
    user?.status === "pending" ||
    user?.auth_status === "pending_approval" ||
    user?.pending_approval === true
  );
}

function parseApiFormError(err) {
  const detail =
    err?.response?.data?.detail ??
    err?.data?.detail ??
    err?.detail ??
    err?.message ??
    null;

  const fieldErrors = {};
  const fallbackMessages = [];

  const mapFieldName = (raw) => {
    const key = String(raw || "").trim().toLowerCase();
    const aliases = {
      email: "email",
      password: "password",
      access_code: "accessCode",
      accesscode: "accessCode",
      name: "name",
      full_name: "name",
      country: "country",
      language: "language",
      code: "otpCode",
      otp: "otpCode",
      otp_code: "otpCode",
      token: "token",
      current_password: "currentPassword",
      new_password: "password",
      tenant: "tenant",
      accept_terms: "acceptTerms",
    };
    return aliases[key] || key;
  };

  const humanizeField = (field) => {
    const labels = {
      name: "full name",
      email: "email",
      password: "password",
      accessCode: "access code",
      country: "country",
      language: "preferred language",
      otpCode: "OTP code",
      token: "reset token",
      currentPassword: "current password",
      acceptTerms: "terms acceptance",
      tenant: "tenant",
    };
    return labels[field] || field;
  };

  const normalizeMessage = (field, msg) => {
    const lower = String(msg || "").trim().toLowerCase();
    const label = humanizeField(field);
    if (!lower) return `Please review the ${label} field.`;
    if (lower.includes("field required")) return `Please enter your ${label}.`;
    if (lower.includes("value is not a valid email")) return "Please enter a valid email.";
    if (lower.includes("string too short")) return `${label.charAt(0).toUpperCase() + label.slice(1)} is too short.`;
    if (lower.includes("string too long")) return `${label.charAt(0).toUpperCase() + label.slice(1)} is too long.`;
    if (lower.includes("not permitted")) return `${label.charAt(0).toUpperCase() + label.slice(1)} is not allowed.`;
    return msg;
  };

  if (Array.isArray(detail)) {
    for (const item of detail) {
      const loc = Array.isArray(item?.loc) ? item.loc : [];
      const rawField = loc.length ? loc[loc.length - 1] : "";
      const field = mapFieldName(rawField);
      const msg = normalizeMessage(field, item?.msg || "Invalid field.");

      if (field && !fieldErrors[field]) {
        fieldErrors[field] = msg;
      } else {
        fallbackMessages.push(msg);
      }
    }
  } else if (typeof detail === "string") {
    fallbackMessages.push(detail);
  } else if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") fallbackMessages.push(detail.message);
    if (Array.isArray(detail.errors)) {
      for (const item of detail.errors) {
        const field = mapFieldName(item?.field || "");
        const msg = normalizeMessage(field, item?.message || "Invalid field.");
        if (field && !fieldErrors[field]) fieldErrors[field] = msg;
        else fallbackMessages.push(msg);
      }
    }
  }

  const message =
    fallbackMessages[0] ||
    Object.values(fieldErrors)[0] ||
    "Please review the required fields and try again.";

  return { message, fieldErrors };
}

export default function AuthPage() {
  const nav = useNavigate();
  const [tenant] = useState("public");
  const isMobile = useIsMobile();

  const [mode, setMode] = useState("register");
  const [otpMode, setOtpMode] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [country, setCountry] = useState("BR");
  const [language, setLanguage] = useState(suggestLanguage("BR"));

  const [acceptTerms, setAcceptTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);

  const [otpCode, setOtpCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [resetToken, setResetToken] = useState("");

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const token = getToken();
  const currentUser = getUser();
  const hasActiveSession = !!token && !!currentUser && !isExplicitlyPendingApproval(currentUser);
  const showAdminShortcut = hasActiveSession && isAdmin(currentUser);

  useEffect(() => {
    const tokenNow = getToken();
    const userNow = getUser();

    if (!tokenNow || !userNow) return;
    if (isExplicitlyPendingApproval(userNow)) return;

    const redirect = sessionStorage.getItem("post_auth_redirect");
    const next = isAdmin(userNow) ? "/admin" : (redirect || "/app");
    sessionStorage.removeItem("post_auth_redirect");
    nav(next, { replace: true });
  }, [nav]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = (params.get("mode") || "").toLowerCase();
    const tokenFromUrl = String(params.get("token") || "").trim();
    const isResetFlow = requestedMode === "reset" && !!tokenFromUrl;

    if (requestedMode === "login" || requestedMode === "signin") {
      setMode("login");
    } else if (requestedMode === "forgot") {
      setMode("forgot");
    } else if (requestedMode === "reset") {
      setMode("reset");
    }

    if (tokenFromUrl) {
      setResetToken(tokenFromUrl);
    }

    if (isResetFlow) {
      try {
        clearPendingOtpContext();
      } catch {}
      setOtpMode(false);
      setPendingEmail("");
      return;
    }

    const ctx = getPendingOtpContext();
    if (ctx?.email) {
      setOtpMode(true);
      setPendingEmail(ctx.email);
      setEmail(ctx.email);
      if (ctx.country) setCountry(ctx.country);
      if (ctx.language) setLanguage(ctx.language);
    }
  }, []);

  const title = useMemo(() => {
    if (otpMode) return "Verify your access code";
    if (mode === "forgot") return "Recover your password";
    if (mode === "reset") return "Create your new password";
    return mode === "login" ? "Sign in to your account" : "Create your account";
  }, [otpMode, mode]);

  const subtitle = useMemo(() => {
    if (otpMode) {
      return "Use the one-time code sent to your email to enter the console.";
    }
    if (mode === "forgot") {
      return "Enter your email and we will send password reset instructions if the account exists.";
    }
    if (mode === "reset") {
      return "Choose a new password to finish the password reset flow.";
    }
    if (mode === "login") {
      return "Sign in with your email and password. If required, we will send a one-time code to complete access.";
    }
    return "Create your account and continue directly into the console.";
  }, [otpMode, mode]);

  function normalizeEmail(v) {
    return String(v || "").trim().toLowerCase();
  }

  function normalizeAccessCode(v) {
    return String(v || "").trim().toUpperCase();
  }

  function setAuthMode(nextMode) {
    setMode(nextMode);
    setOtpMode(false);
    setOtpCode("");
    setStatus("");
    setFieldErrors({});
    if (nextMode !== "reset") {
      setResetToken("");
      setPassword("");
      setPasswordConfirm("");
    }
    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMode);
    if (nextMode !== "reset") url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function goToAdminDirect() {
    nav("/admin");
  }

  async function finalizeSession(data, resolvedTenant) {
    const nextTenant = resolvedTenant || tenant || "public";
    setTenant(nextTenant);

    if (!data?.access_token || !data?.user) {
      throw new Error("Invalid session payload.");
    }

    completeOtpLogin({
      access_token: data.access_token,
      user: data.user,
      tenant: nextTenant,
    });

    try {
      stripTransientAuthFlags();
    } catch {}

    if (isExplicitlyPendingApproval(data.user) || !isApproved(data.user)) {
      nav("/waiting-approval", { replace: true });
      return;
    }

    const redirect = sessionStorage.getItem("post_auth_redirect");
    const next = isAdmin(data.user) ? "/admin" : redirect || "/app";
    sessionStorage.removeItem("post_auth_redirect");
    nav(next, { replace: true });
  }

  async function tryImmediateSessionAfterRegister(emailNormalized, plainPassword, extras = {}) {
    try {
      const { data } = await apiFetch("/api/auth/login", {
        method: "POST",
        org: tenant,
        body: {
          tenant,
          email: emailNormalized,
          password: plainPassword,
        },
      });

      if (data?.pending_otp) {
        return false;
      }

      if (data?.access_token && data?.user) {
        await finalizeSession(data, tenant);
        return true;
      }
    } catch {}
    return false;
  }

  async function doRegister() {
    if (busy) return;

    setFieldErrors({});

    if (password !== passwordConfirm) {
      setFieldErrors({ passwordConfirm: "Passwords do not match." });
      setStatus("Passwords do not match.");
      return;
    }
    if (!acceptTerms) {
      setFieldErrors({ acceptTerms: "You must accept the terms to continue." });
      setStatus("You must accept the terms to continue.");
      return;
    }

    const nameNormalized = String(name || "").trim();
    const emailNormalized = normalizeEmail(email);
    const normalizedAccessCode = normalizeAccessCode(accessCode);

    if (!nameNormalized) {
      setFieldErrors({ name: "Please enter your full name." });
      setStatus("Please enter your full name.");
      return;
    }

    if (!emailNormalized || !password || !normalizedAccessCode) {
      const nextErrors = {};
      if (!emailNormalized) nextErrors.email = "Please enter your email.";
      if (!password) nextErrors.password = "Please enter your password.";
      if (!normalizedAccessCode) nextErrors.accessCode = "Please enter your access code.";
      setFieldErrors(nextErrors);
      setStatus("Please complete the required fields.");
      return;
    }

    setBusy(true);
    setStatus("Creating your account...");

    try {
      const { data: registerData } = await apiFetch("/api/auth/register", {
        method: "POST",
        org: tenant,
        body: {
          tenant,
          email: emailNormalized,
          name: nameNormalized,
          password,
          access_code: normalizedAccessCode,
          accept_terms: acceptTerms,
          marketing_consent: false,
          country,
          language,
        },
      });

      if (registerData?.access_token && registerData?.user) {
        await finalizeSession(registerData, tenant);
        return;
      }

      const extras = {
        name: nameNormalized,
        accessCode: normalizedAccessCode,
        country,
        language,
      };

      const bootstrapped = await tryImmediateSessionAfterRegister(
        emailNormalized,
        password,
        extras
      );

      if (bootstrapped) return;

      setOtpMode(false);
      setPendingEmail("");
      setOtpCode("");
      setPassword("");
      setPasswordConfirm("");
      setStatus("Account created successfully. Sign in with your password.");
      setAuthMode("login");
    } catch (err) {
      const parsed = parseApiFormError(err);
      setFieldErrors(parsed.fieldErrors || {});
      setStatus(parsed.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doLogin() {
    if (busy) return;

    setFieldErrors({});

    const emailNormalized = normalizeEmail(email);

    if (!emailNormalized || !password) {
      const nextErrors = {};
      if (!emailNormalized) nextErrors.email = "Please enter your email.";
      if (!password) nextErrors.password = "Please enter your password.";
      setFieldErrors(nextErrors);
      setStatus("Please enter your email and password.");
      return;
    }

    setBusy(true);
    setStatus("Signing you in...");

    try {
      const { data } = await apiFetch("/api/auth/login", {
        method: "POST",
        org: tenant,
        body: {
          tenant,
          email: emailNormalized,
          password,
        },
      });

      if (data?.pending_otp) {
        setOtpMode(true);
        setPendingEmail(emailNormalized);
        setOtpCode("");
        setStatus("We sent a verification code to your email. Enter it to continue.");
        return;
      }

      if (data?.access_token && data?.user) {
        await finalizeSession(data, tenant);
        return;
      }

      setStatus(data?.message || "Unable to complete sign in.");
    } catch (err) {
      const parsed = parseApiFormError(err);
      setFieldErrors(parsed.fieldErrors || {});
      setStatus(parsed.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doForgotPassword() {
    if (busy) return;

    setFieldErrors({});
    const emailNormalized = normalizeEmail(email);

    if (!emailNormalized) {
      setFieldErrors({ email: "Please enter your email." });
      setStatus("Please enter your email.");
      return;
    }

    setBusy(true);
    setStatus("Sending reset instructions...");

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        org: tenant,
        body: {
          tenant,
          email: emailNormalized,
        },
      });

      setStatus("If this e-mail is registered, a reset link has been sent.");
    } catch (err) {
      const parsed = parseApiFormError(err);
      setFieldErrors(parsed.fieldErrors || {});
      setStatus(parsed.message || "Could not process password recovery.");
    } finally {
      setBusy(false);
    }
  }

  async function doResetPassword() {
    if (busy) return;

    setFieldErrors({});

    if (!resetToken) {
      setFieldErrors({ token: "Reset token not found." });
      setStatus("Reset link is invalid or incomplete.");
      return;
    }

    if (!password || !passwordConfirm) {
      const nextErrors = {};
      if (!password) nextErrors.password = "Please enter your new password.";
      if (!passwordConfirm) nextErrors.passwordConfirm = "Please confirm your new password.";
      setFieldErrors(nextErrors);
      setStatus("Please complete the required fields.");
      return;
    }

    if (password !== passwordConfirm) {
      setFieldErrors({ passwordConfirm: "Passwords do not match." });
      setStatus("Passwords do not match.");
      return;
    }

    setBusy(true);
    setStatus("Updating your password...");

    try {
      const { data } = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        org: tenant,
        body: {
          tenant,
          token: resetToken,
          password: password,
          password_confirm: passwordConfirm,
        },
      });

      if (data?.access_token && data?.user) {
        setStatus("Password updated. Entering the platform...");
        await finalizeSession(data, tenant);
        return;
      }

      setStatus("Your password has been updated. You can sign in now.");
      setPassword("");
      setPasswordConfirm("");
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "login");
      url.searchParams.delete("token");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      setMode("login");
      setResetToken("");
    } catch (err) {
      const parsed = parseApiFormError(err);
      setFieldErrors(parsed.fieldErrors || {});
      setStatus(parsed.message || "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  async function doVerifyOtp() {
    if (busy) return;

    setFieldErrors({});

    const ctx = getPendingOtpContext();
    const resolvedTenant = ctx?.tenant || tenant;
    const emailNormalized = normalizeEmail(ctx?.email || pendingEmail || email);
    const code = String(otpCode || "").trim();

    if (!emailNormalized || !code) {
      const nextErrors = {};
      if (!emailNormalized) nextErrors.email = "Please enter your email.";
      if (!code) nextErrors.otpCode = "Please enter the OTP code.";
      setFieldErrors(nextErrors);
      setStatus("Please enter the OTP sent by email.");
      return;
    }

    setBusy(true);
    setStatus("Verifying code...");

    try {
      const { data } = await apiFetch("/api/auth/login/verify-otp", {
        method: "POST",
        org: resolvedTenant,
        body: {
          tenant: resolvedTenant,
          email: emailNormalized,
          code,
        },
      });

      if (!data?.access_token || !data?.user) {
        setStatus(data?.message || "Invalid code or session not finalized.");
        return;
      }

      await finalizeSession(data, resolvedTenant);
    } catch (err) {
      const parsed = parseApiFormError(err);
      setFieldErrors(parsed.fieldErrors || {});
      setStatus(parsed.message || "OTP validation failed.");
    } finally {
      setBusy(false);
    }
  }

  const registerPasswordGridStyle = isMobile
    ? { display: "grid", gridTemplateColumns: "1fr", gap: 14 }
    : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };

  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.14em", color: "#64748b", fontWeight: 800 }}>
            <img src="/Logo Orkio_V2_Transparente.png" alt="Orkio" style={{ height: 30 }} />
          </div>
          {showAdminShortcut ? (
            <button type="button" onClick={goToAdminDirect} style={adminChip} title="Admin Console">
              admin
            </button>
          ) : null}
        </div>

        <h1 style={{ margin: "10px 0 8px", fontSize: isMobile ? 28 : 32, lineHeight: 1.05 }}>{title}</h1>
        <p style={{ ...muted, marginTop: 0 }}>{subtitle}</p>

        {!otpMode ? (
          <>
            {(mode === "login" || mode === "register") ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
                <button
                  type="button"
                  style={mode === "register" ? btn : secondaryBtn}
                  onClick={() => setAuthMode("register")}
                  disabled={busy}
                >
                  Create account
                </button>
                <button
                  type="button"
                  style={mode === "login" ? btn : secondaryBtn}
                  onClick={() => setAuthMode("login")}
                  disabled={busy}
                >
                  Sign in
                </button>
              </div>
            ) : null}

            {mode === "register" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={label}>Full name</label>
                  <input
                    style={{ ...input, ...(fieldErrors.name ? inputError : null) }}
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, name: "" }));
                    }}
                  />
                  {fieldErrors.name ? <div style={errorText}>{fieldErrors.name}</div> : null}
                </div>

                <div>
                  <label style={label}>Email</label>
                  <input
                    style={{ ...input, ...(fieldErrors.email ? inputError : null) }}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }}
                  />
                  {fieldErrors.email ? <div style={errorText}>{fieldErrors.email}</div> : null}
                </div>

                <div style={registerPasswordGridStyle}>
                  <div>
                    <label style={label}>Password</label>
                    <div style={passwordWrap}>
                      <input
                        style={{ ...input, paddingRight: 72, ...(fieldErrors.password ? inputError : null) }}
                        type={showPassword ? "text" : "password"}
                        placeholder="Your password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setFieldErrors((prev) => ({ ...prev, password: "" }));
                        }}
                      />
                      <button type="button" style={passwordToggle} onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    {fieldErrors.password ? <div style={errorText}>{fieldErrors.password}</div> : null}
                  </div>

                  <div>
                    <label style={label}>Confirm password</label>
                    <div style={passwordWrap}>
                      <input
                        style={{ ...input, paddingRight: 72, ...(fieldErrors.passwordConfirm ? inputError : null) }}
                        type={showPasswordConfirm ? "text" : "password"}
                        placeholder="Repeat your password"
                        value={passwordConfirm}
                        onChange={(e) => {
                          setPasswordConfirm(e.target.value);
                          setFieldErrors((prev) => ({ ...prev, passwordConfirm: "" }));
                        }}
                      />
                      <button type="button" style={passwordToggle} onClick={() => setShowPasswordConfirm((v) => !v)}>
                        {showPasswordConfirm ? "Hide" : "Show"}
                      </button>
                    </div>
                    {fieldErrors.passwordConfirm ? <div style={errorText}>{fieldErrors.passwordConfirm}</div> : null}
                  </div>
                </div>

                <div>
                  <label style={label}>Access code</label>
                  <input
                    style={{ ...input, ...(fieldErrors.accessCode ? inputError : null) }}
                    placeholder="Enter your access code"
                    value={accessCode}
                    onChange={(e) => {
                      setAccessCode(e.target.value.toUpperCase());
                      setFieldErrors((prev) => ({ ...prev, accessCode: "" }));
                    }}
                  />
                  {fieldErrors.accessCode ? <div style={errorText}>{fieldErrors.accessCode}</div> : null}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                  <div>
                    <label style={label}>Country</label>
                    <select
                      style={{ ...input, ...(fieldErrors.country ? inputError : null) }}
                      value={country}
                      onChange={(e) => {
                        setFieldErrors((prev) => ({ ...prev, country: "" }));
                        const nextCountry = e.target.value || "BR";
                        setCountry(nextCountry);
                        setLanguage((prev) => {
                          if (!prev || prev === suggestLanguage(country)) {
                            return suggestLanguage(nextCountry);
                          }
                          return prev;
                        });
                      }}
                    >
                      {COUNTRIES.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.country ? <div style={errorText}>{fieldErrors.country}</div> : null}
                  </div>

                  <div>
                    <label style={label}>Preferred language</label>
                    <select
                      style={{ ...input, ...(fieldErrors.language ? inputError : null) }}
                      value={language}
                      onChange={(e) => {
                        setLanguage(e.target.value || suggestLanguage(country));
                        setFieldErrors((prev) => ({ ...prev, language: "" }));
                      }}
                    >
                      {LANGUAGES.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.language ? <div style={errorText}>{fieldErrors.language}</div> : null}
                  </div>
                </div>

                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#334155", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => {
                      setAcceptTerms(e.target.checked);
                      setFieldErrors((prev) => ({ ...prev, acceptTerms: "" }));
                    }}
                  />
                  <span>I agree to the terms and privacy policy.</span>
                </label>
                {fieldErrors.acceptTerms ? <div style={errorText}>{fieldErrors.acceptTerms}</div> : null}

                <button style={btn} disabled={busy} onClick={doRegister}>
                  {busy ? "Processing..." : "Create account and continue"}
                </button>
              </div>
            ) : null}

            {mode === "login" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={label}>Email</label>
                  <input
                    style={{ ...input, ...(fieldErrors.email ? inputError : null) }}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }}
                  />
                  {fieldErrors.email ? <div style={errorText}>{fieldErrors.email}</div> : null}
                </div>

                <div>
                  <label style={label}>Password</label>
                  <div style={passwordWrap}>
                    <input
                      style={{ ...input, paddingRight: 72, ...(fieldErrors.password ? inputError : null) }}
                      type={showLoginPassword ? "text" : "password"}
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                      }}
                    />
                    <button type="button" style={passwordToggle} onClick={() => setShowLoginPassword((v) => !v)}>
                      {showLoginPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors.password ? <div style={errorText}>{fieldErrors.password}</div> : null}
                </div>

                <button style={btn} disabled={busy} onClick={doLogin}>
                  {busy ? "Processing..." : "Sign in"}
                </button>

                <button
                  type="button"
                  style={subtleLink}
                  disabled={busy}
                  onClick={() => setAuthMode("forgot")}
                >
                  Forgot password?
                </button>
              </div>
            ) : null}

            {mode === "forgot" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={label}>Email</label>
                  <input
                    style={{ ...input, ...(fieldErrors.email ? inputError : null) }}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }}
                  />
                  {fieldErrors.email ? <div style={errorText}>{fieldErrors.email}</div> : null}
                </div>

                <button style={btn} disabled={busy} onClick={doForgotPassword}>
                  {busy ? "Processing..." : "Send reset instructions"}
                </button>

                <button
                  type="button"
                  style={subtleLink}
                  disabled={busy}
                  onClick={() => setAuthMode("login")}
                >
                  Back to sign in
                </button>
              </div>
            ) : null}

            {mode === "reset" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={label}>Reset token</label>
                  <input
                    style={{ ...input, opacity: 0.88, ...(fieldErrors.token ? inputError : null) }}
                    value={resetToken}
                    readOnly
                  />
                  {fieldErrors.token ? <div style={errorText}>{fieldErrors.token}</div> : null}
                </div>

                <div style={registerPasswordGridStyle}>
                  <div>
                    <label style={label}>New password</label>
                    <div style={passwordWrap}>
                      <input
                        style={{ ...input, paddingRight: 72, ...(fieldErrors.password ? inputError : null) }}
                        type={showResetPassword ? "text" : "password"}
                        placeholder="New password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setFieldErrors((prev) => ({ ...prev, password: "" }));
                        }}
                      />
                      <button type="button" style={passwordToggle} onClick={() => setShowResetPassword((v) => !v)}>
                        {showResetPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    {fieldErrors.password ? <div style={errorText}>{fieldErrors.password}</div> : null}
                  </div>

                  <div>
                    <label style={label}>Confirm new password</label>
                    <div style={passwordWrap}>
                      <input
                        style={{ ...input, paddingRight: 72, ...(fieldErrors.passwordConfirm ? inputError : null) }}
                        type={showResetPasswordConfirm ? "text" : "password"}
                        placeholder="Repeat your new password"
                        value={passwordConfirm}
                        onChange={(e) => {
                          setPasswordConfirm(e.target.value);
                          setFieldErrors((prev) => ({ ...prev, passwordConfirm: "" }));
                        }}
                      />
                      <button type="button" style={passwordToggle} onClick={() => setShowResetPasswordConfirm((v) => !v)}>
                        {showResetPasswordConfirm ? "Hide" : "Show"}
                      </button>
                    </div>
                    {fieldErrors.passwordConfirm ? <div style={errorText}>{fieldErrors.passwordConfirm}</div> : null}
                  </div>
                </div>

                <button style={btn} disabled={busy} onClick={doResetPassword}>
                  {busy ? "Processing..." : "Update password"}
                </button>

                <button
                  type="button"
                  style={subtleLink}
                  disabled={busy}
                  onClick={() => setAuthMode("login")}
                >
                  Back to sign in
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>Email</label>
              <input style={{ ...input, opacity: 0.85, ...(fieldErrors.email ? inputError : null) }} readOnly value={pendingEmail || email} />
              {fieldErrors.email ? <div style={errorText}>{fieldErrors.email}</div> : null}
            </div>

            <div>
              <label style={label}>OTP code</label>
              <input
                style={{ ...input, ...(fieldErrors.otpCode ? inputError : null) }}
                placeholder="Enter the code you received"
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, otpCode: "" }));
                }}
              />
              {fieldErrors.otpCode ? <div style={errorText}>{fieldErrors.otpCode}</div> : null}
            </div>

            <button style={btn} disabled={busy} onClick={doVerifyOtp}>
              {busy ? "Verifying..." : "Enter console"}
            </button>

            <button
              type="button"
              style={secondaryBtn}
              disabled={busy}
              onClick={() => {
                setOtpMode(false);
                setOtpCode("");
                setStatus("");
              }}
            >
              Back
            </button>
          </div>
        )}

        {!!status && (
          <div
            style={{
              marginTop: 16,
              borderRadius: 16,
              padding: "12px 14px",
              fontSize: 14,
              background:
                status.toLowerCase().includes("failed") ||
                status.toLowerCase().includes("invalid") ||
                status.toLowerCase().includes("do not match")
                  ? "rgba(239,68,68,0.10)"
                  : "rgba(37,99,235,0.08)",
              color:
                status.toLowerCase().includes("failed") ||
                status.toLowerCase().includes("invalid") ||
                status.toLowerCase().includes("do not match")
                  ? "#991b1b"
                  : "#1e3a8a",
              border:
                status.toLowerCase().includes("failed") ||
                status.toLowerCase().includes("invalid") ||
                status.toLowerCase().includes("do not match")
                  ? "1px solid rgba(239,68,68,0.25)"
                  : "1px solid rgba(37,99,235,0.18)",
            }}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
