import React, { useMemo, useState } from "react";
import { getTenant, getToken, setSession } from "../lib/auth.js";

const USER_TYPES = [
  { value: "", label: "Select your profile", placeholder: true },
  { value: "founder", label: "Founder" },
  { value: "investor", label: "Investor" },
  { value: "operator", label: "Operator" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

const INTENTS = [
  { value: "", label: "Select your primary goal", placeholder: true },
  { value: "explore", label: "Explore the platform" },
  { value: "meeting", label: "Schedule a conversation" },
  { value: "pilot", label: "Evaluate a pilot" },
  { value: "funding", label: "Discuss investment" },
  { value: "other", label: "Other" },
];

const COUNTRIES = [
  { value: "", label: "Select your country", placeholder: true },
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
  { value: "", label: "Select your language", placeholder: true },
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

const DIAL_CODE_BY_COUNTRY = {
  BR: "+55",
  US: "+1",
  ES: "+34",
  PT: "+351",
  AR: "+54",
  MX: "+52",
  CO: "+57",
  CL: "+56",
  UY: "+598",
};

const NOTES_MAX = 500;

function normalizeUserType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const aliases = {
    founder: "founder",
    investor: "investor",
    operator: "operator",
    enterprise: "operator",
    developer: "operator",
    partner: "partner",
    other: "other",
  };
  return aliases[raw] || "";
}

function normalizeIntent(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const aliases = {
    explore: "explore",
    exploring: "explore",
    curious: "explore",
    meeting: "meeting",
    partnership: "meeting",
    pilot: "pilot",
    company_eval: "pilot",
    funding: "funding",
    investment: "funding",
    other: "other",
  };
  return aliases[raw] || "";
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeWhatsapp(value, country = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const selectedCountry = String(country || "").trim().toUpperCase();
  const digits = digitsOnly(raw);

  if (!digits) return "";

  if (raw.startsWith("+")) {
    return `+${digits}`;
  }

  const dialCode = DIAL_CODE_BY_COUNTRY[selectedCountry] || "";
  const dialDigits = digitsOnly(dialCode);

  if (selectedCountry === "BR") {
    if (digits.startsWith("55")) {
      return `+${digits}`;
    }
    return `+55${digits}`;
  }

  if (dialDigits) {
    if (digits.startsWith(dialDigits)) {
      return `+${digits}`;
    }
    return `+${dialDigits}${digits}`;
  }

  return `+${digits}`;
}

function formatWhatsappForDisplay(value, country = "") {
  const normalized = normalizeWhatsapp(value, country);
  if (!normalized) return "";

  const selectedCountry = String(country || "").trim().toUpperCase();
  const digits = digitsOnly(normalized);

  if (selectedCountry === "BR") {
    let local = digits;
    if (local.startsWith("55")) local = local.slice(2);
    local = local.slice(0, 11);

    if (local.length <= 2) return `+55 ${local}`.trim();
    if (local.length <= 7) return `+55 (${local.slice(0, 2)}) ${local.slice(2)}`.trim();
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7, 11)}`.trim();
  }

  return normalized;
}

function validateWhatsapp(value, country = "") {
  const normalized = normalizeWhatsapp(value, country);
  if (!normalized) {
    return "WhatsApp is required.";
  }

  const digits = digitsOnly(normalized);
  const selectedCountry = String(country || "").trim().toUpperCase();

  if (selectedCountry === "BR") {
    if (!normalized.startsWith("+55")) {
      return "Brazilian WhatsApp must start with +55.";
    }
    const local = digits.startsWith("55") ? digits.slice(2) : digits;
    if (local.length < 10 || local.length > 11) {
      return "Brazilian WhatsApp must contain DDD + number.";
    }
    return "";
  }

  if (digits.length < 8 || digits.length > 15) {
    return "WhatsApp must be in international format.";
  }

  return "";
}

function suggestLanguage(country) {
  const code = String(country || "").trim().toUpperCase();
  return DEFAULT_LANGUAGE_BY_COUNTRY[code] || "";
}

function normalizeRole(value) {
  const rawRole = String(value || "").trim();
  if (!rawRole) return "";
  const technicalRoles = new Set(["user", "admin", "member", "guest"]);
  if (technicalRoles.has(rawRole.toLowerCase())) return "";
  return rawRole;
}

function sanitizeOnboardingPayload(payload) {
  const country = String(payload?.country || "").trim().toUpperCase();
  const language = String(payload?.language || "").trim();

  return {
    company: String(payload?.company || "").trim(),
    role: normalizeRole(payload?.profile_role || payload?.role || ""),
    user_type: normalizeUserType(payload?.user_type),
    intent: normalizeIntent(payload?.intent),
    country,
    language,
    whatsapp: normalizeWhatsapp(payload?.whatsapp || "", country),
    notes: String(payload?.notes || "").trim().slice(0, NOTES_MAX),
  };
}

const ORKIO_ENV =
  typeof window !== "undefined" && window.__ORKIO_ENV__ ? window.__ORKIO_ENV__ : {};

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function resolveApiBase() {
  const envBase = normalizeBase(
    ORKIO_ENV.VITE_API_BASE_URL ||
      ORKIO_ENV.VITE_API_URL ||
      ORKIO_ENV.API_BASE_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      import.meta.env.VITE_API_URL ||
      ""
  );

  if (envBase) return envBase;

  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeBase(window.location.origin);
  }
  return "";
}

function buildUrl(path) {
  const base = resolveApiBase();
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

function buildHeaders(token, org) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers["X-Org-Slug"] = org;
  return headers;
}

async function readErrorPayload(res) {
  try {
    const data = await res.json();
    return {
      message: data?.detail?.message || data?.detail || data?.message || `Onboarding failed (${res.status})`,
      detail: data?.detail || data || null,
    };
  } catch {
    try {
      const text = await res.text();
      return {
        message: text || `Onboarding failed (${res.status})`,
        detail: null,
      };
    } catch {
      return {
        message: `${res.status} ${res.statusText}`,
        detail: null,
      };
    }
  }
}

async function saveOnboarding(payload, token, org) {
  const url = buildUrl("/api/user/onboarding");
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token, org),
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!res.ok) {
    const errorPayload = await readErrorPayload(res);
    const error = new Error(errorPayload.message || `Onboarding failed (${res.status})`);
    error.status = res.status;
    error.detail = errorPayload.detail;
    throw error;
  }

  try {
    return await res.json();
  } catch {
    return { status: "ok" };
  }
}

const labelStyle = {
  display: "block",
  marginBottom: 8,
  color: "#0f172a",
  fontWeight: 800,
  fontSize: 14,
};

const fieldStyle = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  padding: "14px 16px",
  fontSize: 15,
  outline: "none",
  boxSizing: "border-box",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  WebkitTextFillColor: "#0f172a",
  boxShadow: "inset 0 1px 2px rgba(15,23,42,0.04)",
};

const optionStyle = {
  backgroundColor: "#ffffff",
  color: "#0f172a",
};

const requiredStarStyle = {
  color: "#dc2626",
  marginLeft: 4,
};

const helperTextStyle = {
  marginTop: 6,
  fontSize: 12,
  color: "#64748b",
};

const fieldErrorStyle = {
  marginTop: 6,
  fontSize: 12,
  color: "#dc2626",
  fontWeight: 700,
};

function withErrorStyle(hasError) {
  if (!hasError) return fieldStyle;
  return {
    ...fieldStyle,
    border: "1px solid #ef4444",
    boxShadow: "0 0 0 3px rgba(239,68,68,0.12)",
  };
}

function emptyFieldErrors() {
  return {
    company: "",
    role: "",
    user_type: "",
    intent: "",
    country: "",
    language: "",
    whatsapp: "",
    notes: "",
  };
}

function mapBackendMissingField(name) {
  const map = {
    company: "company",
    profile_role: "role",
    role: "role",
    user_type: "user_type",
    intent: "intent",
    country: "country",
    language: "language",
    whatsapp: "whatsapp",
    whatsapp_number: "whatsapp",
  };
  return map[String(name || "").trim()] || "";
}

export default function OnboardingModal({ user, onComplete }) {
  const [form, setForm] = useState(() => sanitizeOnboardingPayload(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState(() => emptyFieldErrors());

  const fullName = useMemo(() => (user?.name || "").trim(), [user]);

  function clearFieldError(key) {
    setFieldErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    clearFieldError(key);
    setError("");
  }

  function validateRequiredFields(payload) {
    const errors = emptyFieldErrors();

    if (!payload.company) errors.company = "Company is required.";
    if (!payload.role) errors.role = "Role / title is required.";
    if (!payload.user_type) errors.user_type = "Profile is required.";
    if (!payload.intent) errors.intent = "Primary goal is required.";
    if (!payload.country) errors.country = "Country is required.";
    if (!payload.language) errors.language = "Language is required.";
    if (!payload.whatsapp) errors.whatsapp = "WhatsApp is required.";

    const whatsappError = validateWhatsapp(payload.whatsapp, payload.country);
    if (whatsappError) errors.whatsapp = whatsappError;

    if (payload.notes && payload.notes.length > NOTES_MAX) {
      errors.notes = `Additional context must be at most ${NOTES_MAX} characters.`;
    }

    return errors;
  }

  function hasFieldErrors(errors) {
    return Object.values(errors).some(Boolean);
  }

  function applyBackendErrors(err) {
    const nextErrors = emptyFieldErrors();
    const detail = err?.detail;

    if (detail && typeof detail === "object") {
      const missingFields = Array.isArray(detail?.missing_fields) ? detail.missing_fields : [];
      missingFields.forEach((item) => {
        const key = mapBackendMissingField(item);
        if (!key) return;
        if (key === "company") nextErrors.company = "Company is required.";
        if (key === "role") nextErrors.role = "Role / title is required.";
        if (key === "user_type") nextErrors.user_type = "Profile is required.";
        if (key === "intent") nextErrors.intent = "Primary goal is required.";
        if (key === "country") nextErrors.country = "Country is required.";
        if (key === "language") nextErrors.language = "Language is required.";
        if (key === "whatsapp") nextErrors.whatsapp = "WhatsApp is required.";
      });
    }

    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();

    const payload = sanitizeOnboardingPayload({
      ...form,
      onboarding_completed: true,
    });

    const validationErrors = validateRequiredFields(payload);
    setFieldErrors(validationErrors);

    if (hasFieldErrors(validationErrors)) {
      setError("Please review the highlighted fields.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const token = getToken();
      const org = user?.org_slug || getTenant() || "public";

      const result = await saveOnboarding(payload, token, org);
      const nextUser = result?.user
        ? { ...user, ...result.user, onboarding_completed: true }
        : {
            ...user,
            company: payload.company,
            profile_role: payload.role,
            user_type: payload.user_type,
            intent: payload.intent,
            country: payload.country,
            language: payload.language,
            whatsapp: payload.whatsapp,
            notes: payload.notes,
            onboarding_completed: true,
          };

      const nextToken = result?.access_token || token;
      try {
        setSession({
          token: nextToken,
          user: nextUser,
          tenant: nextUser?.org_slug || org,
        });
      } catch {}

      onComplete?.({ user: nextUser, access_token: nextToken });
    } catch (err) {
      applyBackendErrors(err);
      setError(err?.message || "Could not save onboarding.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(5,8,18,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 760,
          maxHeight: "92vh",
          overflowY: "auto",
          borderRadius: 24,
          border: "1px solid rgba(15,23,42,0.08)",
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
          color: "#0f172a",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#475569",
              fontWeight: 800,
            }}
          >
            Orkio
          </div>
          <h2 style={{ margin: "8px 0 6px", fontSize: 30, lineHeight: 1.1 }}>
            Complete your onboarding
          </h2>
          <p style={{ margin: 0, color: "#475569", lineHeight: 1.55 }}>
            Tell us a bit about your context so we can personalize your console experience from the first session.
          </p>
        </div>

        <div
          style={{
            marginBottom: 18,
            borderRadius: 18,
            border: "1px solid #dbeafe",
            background: "linear-gradient(135deg, rgba(37,99,235,0.08), rgba(124,92,255,0.08))",
            padding: "14px 16px",
            color: "#334155",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          This step appears only once. Required fields must be completed before entering the console.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <div>
            <label style={labelStyle}>Full name</label>
            <input value={fullName} readOnly disabled style={{ ...fieldStyle, opacity: 0.85 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div>
              <label style={labelStyle}>
                Company
                <span style={requiredStarStyle}>*</span>
              </label>
              <input
                value={form.company}
                onChange={(e) => setField("company", e.target.value.slice(0, 120))}
                onBlur={() => {
                  const value = String(form.company || "").trim();
                  if (!value) {
                    setFieldErrors((prev) => ({ ...prev, company: "Company is required." }));
                  }
                }}
                placeholder="Your company"
                style={withErrorStyle(Boolean(fieldErrors.company))}
                disabled={busy}
                required
                maxLength={120}
              />
              {fieldErrors.company ? <div style={fieldErrorStyle}>{fieldErrors.company}</div> : null}
            </div>

            <div>
              <label style={labelStyle}>
                Role / title
                <span style={requiredStarStyle}>*</span>
              </label>
              <input
                value={form.role}
                onChange={(e) => setField("role", normalizeRole(e.target.value).slice(0, 120))}
                onBlur={() => {
                  const value = normalizeRole(form.role);
                  if (!value) {
                    setFieldErrors((prev) => ({ ...prev, role: "Role / title is required." }));
                  }
                }}
                placeholder="Founder, Partner, CTO..."
                style={withErrorStyle(Boolean(fieldErrors.role))}
                disabled={busy}
                required
                maxLength={120}
              />
              {fieldErrors.role ? <div style={fieldErrorStyle}>{fieldErrors.role}</div> : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div>
              <label style={labelStyle}>
                Profile
                <span style={requiredStarStyle}>*</span>
              </label>
              <select
                value={form.user_type}
                onChange={(e) => setField("user_type", e.target.value)}
                onBlur={() => {
                  if (!form.user_type) {
                    setFieldErrors((prev) => ({ ...prev, user_type: "Profile is required." }));
                  }
                }}
                style={withErrorStyle(Boolean(fieldErrors.user_type))}
                disabled={busy}
                required
              >
                {USER_TYPES.map((opt) => (
                  <option
                    key={opt.value || "empty-user-type"}
                    value={opt.value}
                    style={optionStyle}
                    disabled={Boolean(opt.placeholder)}
                    hidden={Boolean(opt.placeholder) && Boolean(form.user_type)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.user_type ? <div style={fieldErrorStyle}>{fieldErrors.user_type}</div> : null}
            </div>

            <div>
              <label style={labelStyle}>
                Primary goal
                <span style={requiredStarStyle}>*</span>
              </label>
              <select
                value={form.intent}
                onChange={(e) => setField("intent", e.target.value)}
                onBlur={() => {
                  if (!form.intent) {
                    setFieldErrors((prev) => ({ ...prev, intent: "Primary goal is required." }));
                  }
                }}
                style={withErrorStyle(Boolean(fieldErrors.intent))}
                disabled={busy}
                required
              >
                {INTENTS.map((opt) => (
                  <option
                    key={opt.value || "empty-intent"}
                    value={opt.value}
                    style={optionStyle}
                    disabled={Boolean(opt.placeholder)}
                    hidden={Boolean(opt.placeholder) && Boolean(form.intent)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.intent ? <div style={fieldErrorStyle}>{fieldErrors.intent}</div> : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div>
              <label style={labelStyle}>
                Country
                <span style={requiredStarStyle}>*</span>
              </label>
              <select
                value={form.country}
                onChange={(e) => {
                  const nextCountry = e.target.value || "";
                  setForm((prev) => ({
                    ...prev,
                    country: nextCountry,
                    language:
                      !prev.language || prev.language === suggestLanguage(prev.country)
                        ? suggestLanguage(nextCountry)
                        : prev.language,
                    whatsapp: prev.whatsapp ? normalizeWhatsapp(prev.whatsapp, nextCountry) : "",
                  }));
                  clearFieldError("country");
                  clearFieldError("language");
                  clearFieldError("whatsapp");
                  setError("");
                }}
                onBlur={() => {
                  if (!form.country) {
                    setFieldErrors((prev) => ({ ...prev, country: "Country is required." }));
                  }
                }}
                style={withErrorStyle(Boolean(fieldErrors.country))}
                disabled={busy}
                required
              >
                {COUNTRIES.map((opt) => (
                  <option
                    key={opt.value || "empty-country"}
                    value={opt.value}
                    style={optionStyle}
                    disabled={Boolean(opt.placeholder)}
                    hidden={Boolean(opt.placeholder) && Boolean(form.country)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.country ? <div style={fieldErrorStyle}>{fieldErrors.country}</div> : null}
            </div>

            <div>
              <label style={labelStyle}>
                Language
                <span style={requiredStarStyle}>*</span>
              </label>
              <select
                value={form.language}
                onChange={(e) => setField("language", e.target.value)}
                onBlur={() => {
                  if (!form.language) {
                    setFieldErrors((prev) => ({ ...prev, language: "Language is required." }));
                  }
                }}
                style={withErrorStyle(Boolean(fieldErrors.language))}
                disabled={busy}
                required
              >
                {LANGUAGES.map((opt) => (
                  <option
                    key={opt.value || "empty-language"}
                    value={opt.value}
                    style={optionStyle}
                    disabled={Boolean(opt.placeholder)}
                    hidden={Boolean(opt.placeholder) && Boolean(form.language)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.language ? <div style={fieldErrorStyle}>{fieldErrors.language}</div> : null}
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              WhatsApp
              <span style={requiredStarStyle}>*</span>
            </label>
            <input
              value={formatWhatsappForDisplay(form.whatsapp, form.country)}
              onChange={(e) => {
                const nextValue = normalizeWhatsapp(e.target.value, form.country).slice(0, 20);
                setField("whatsapp", nextValue);
                const nextError = validateWhatsapp(nextValue, form.country);
                setFieldErrors((prev) => ({ ...prev, whatsapp: nextError }));
              }}
              onBlur={(e) => {
                const nextValue = normalizeWhatsapp(e.target.value, form.country).slice(0, 20);
                setField("whatsapp", nextValue);
                const nextError = validateWhatsapp(nextValue, form.country);
                setFieldErrors((prev) => ({ ...prev, whatsapp: nextError }));
              }}
              placeholder={form.country === "BR" ? "+55 (11) 99999-9999" : "+1 555 000 0000"}
              style={withErrorStyle(Boolean(fieldErrors.whatsapp))}
              inputMode="tel"
              disabled={busy}
              required
              maxLength={20}
            />
            <div style={helperTextStyle}>
              {form.country === "BR"
                ? "Brazil requires WhatsApp in international format starting with +55."
                : "Use international format with country code."}
            </div>
            {fieldErrors.whatsapp ? <div style={fieldErrorStyle}>{fieldErrors.whatsapp}</div> : null}
          </div>

          <div>
            <label style={labelStyle}>Additional context</label>
            <textarea
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value.slice(0, NOTES_MAX))}
              onBlur={() => {
                if (form.notes.length > NOTES_MAX) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    notes: `Additional context must be at most ${NOTES_MAX} characters.`,
                  }));
                }
              }}
              placeholder="In one sentence, tell us what you want to solve or explore."
              style={{
                ...withErrorStyle(Boolean(fieldErrors.notes)),
                minHeight: 120,
                resize: "vertical",
              }}
              disabled={busy}
              maxLength={NOTES_MAX}
            />
            <div style={helperTextStyle}>{form.notes.length}/{NOTES_MAX}</div>
            {fieldErrors.notes ? <div style={fieldErrorStyle}>{fieldErrors.notes}</div> : null}
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginTop: 16,
              color: "#0f172a",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 14,
              padding: "12px 14px",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Your preferred language can be updated later inside the console settings.
          </div>

          <button
            type="submit"
            disabled={busy}
            style={{
              border: 0,
              borderRadius: 16,
              padding: "14px 18px",
              minWidth: 220,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(135deg, #2563eb, #7c3aed)",
              color: "#ffffff",
              fontWeight: 800,
              fontSize: 15,
              boxShadow: "0 14px 30px rgba(37,99,235,0.24)",
              opacity: busy ? 0.75 : 1,
            }}
          >
            {busy ? "Saving..." : "Continue to console"}
          </button>
        </div>
      </form>
    </div>
  );
}
