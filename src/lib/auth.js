// src/lib/auth.js

const TOKEN_KEY = "orkio_token";
const USER_KEY = "orkio_user";
const TENANT_KEY = "orkio_tenant";
const OTP_CTX_KEY = "orkio_pending_otp_context";

/**
 * =========================
 * TOKEN
 * =========================
 */

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * =========================
 * TENANT
 * =========================
 */

export function getTenant() {
  return localStorage.getItem(TENANT_KEY);
}

export function setTenant(tenant) {
  if (!tenant) return;
  localStorage.setItem(TENANT_KEY, tenant);
}

export function clearTenant() {
  localStorage.removeItem(TENANT_KEY);
}

/**
 * =========================
 * USER STORAGE
 * =========================
 */

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUser(user) {
  if (!user) return;
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeUser(stripTransientAuthFlags(user))));
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}

/**
 * =========================
 * TRANSIENT AUTH FLAGS
 * =========================
 */

export function stripTransientAuthFlags(user) {
  if (!user) return user;

  const cleaned = { ...user };

  delete cleaned.pending_approval;
  delete cleaned.auth_status;
  delete cleaned.status;
  delete cleaned.approved;

  return cleaned;
}

/**
 * =========================
 * NORMALIZE USER
 * =========================
 */

function normalizeUser(user) {
  if (!user) return null;

  const normalizedRole = String(
    user.role ||
      (user.is_admin === true ? "admin" : "") ||
      (user.admin === true ? "admin" : "") ||
      "user"
  )
    .trim()
    .toLowerCase() || "user";

  const adminAccess =
    normalizedRole === "admin" ||
    normalizedRole === "owner" ||
    normalizedRole === "superadmin" ||
    user.is_admin === true ||
    user.admin === true;

  return {
    ...user,
    role: normalizedRole,
    is_admin: adminAccess,
    admin: adminAccess,
  };
}

/**
 * =========================
 * OTP CONTEXT
 * =========================
 */

export function savePendingOtpContext(ctx) {
  if (!ctx) return;
  localStorage.setItem(OTP_CTX_KEY, JSON.stringify(ctx));
}

export function getPendingOtpContext() {
  try {
    const raw = localStorage.getItem(OTP_CTX_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPendingOtpContext() {
  localStorage.removeItem(OTP_CTX_KEY);
}

/**
 * =========================
 * SESSION STORAGE
 * =========================
 */

export function setSession({ token, user, tenant }) {
  if (token) setToken(token);

  const existingUser = stripTransientAuthFlags(getUser());
  const incomingUser = stripTransientAuthFlags(user);

  const mergedUser = incomingUser
    ? normalizeUser({
        ...(existingUser || {}),
        ...incomingUser,
        role:
          incomingUser?.role ||
          existingUser?.role ||
          (incomingUser?.is_admin === true ? "admin" : null) ||
          (incomingUser?.admin === true ? "admin" : null) ||
          "user",
        is_admin:
          incomingUser?.is_admin === true ||
          incomingUser?.admin === true ||
          existingUser?.is_admin === true ||
          existingUser?.admin === true ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "admin" ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "owner" ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "superadmin",
        admin:
          incomingUser?.admin === true ||
          incomingUser?.is_admin === true ||
          existingUser?.admin === true ||
          existingUser?.is_admin === true ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "admin" ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "owner" ||
          String(incomingUser?.role || existingUser?.role || "").trim().toLowerCase() === "superadmin",
      })
    : existingUser;

  const resolvedTenant =
    tenant ||
    incomingUser?.org_slug ||
    incomingUser?.tenant ||
    existingUser?.org_slug ||
    existingUser?.tenant ||
    getTenant() ||
    "public";

  if (resolvedTenant) {
    setTenant(resolvedTenant);
  }

  if (mergedUser) {
    setUser(mergedUser);
  }
}

export const storeSession = setSession;

/**
 * =========================
 * COMPLETE OTP LOGIN
 * =========================
 */

export function completeOtpLogin(data) {
  if (!data?.access_token || !data?.user) {
    throw new Error("Invalid OTP login response");
  }

  const pending = getPendingOtpContext();
  const cleanUser = stripTransientAuthFlags(data.user);

  const tenant =
    cleanUser?.org_slug ||
    cleanUser?.tenant ||
    data.tenant ||
    pending?.tenant ||
    pending?.org_slug ||
    getTenant() ||
    "public";

  setSession({
    token: data.access_token,
    user: cleanUser,
    tenant,
  });

  clearPendingOtpContext();
}

/**
 * =========================
 * AUTH STATE
 * =========================
 */

export function isAuthenticated() {
  return Boolean(getToken());
}

/**
 * =========================
 * APPROVAL CHECKS
 * =========================
 */

export function isPendingApproval(user) {
  if (!user) return false;

  if (user?.approved_at) return false;
  if (user?.onboarding_completed === true) return false;

  return Boolean(
    user?.approved === false ||
      user?.pending_approval === true ||
      String(user?.status || "").trim().toLowerCase() === "pending" ||
      String(user?.auth_status || "").trim().toLowerCase() === "pending_approval"
  );
}

export function isApproved(user) {
  if (!user) return false;

  if (isPendingApproval(user)) return false;

  return Boolean(
    user?.onboarding_completed === true ||
      user?.approved_at ||
      (typeof user?.usage_tier === "string" &&
        user.usage_tier.toLowerCase().startsWith("summit")) ||
      user?.signup_source === "investor" ||
      user?.signup_code_label === "efata777"
  );
}

/**
 * =========================
 * ADMIN ACCESS CHECK
 * =========================
 */

export function isAdmin(user) {
  if (!user) return false;

  const role = String(user?.role || "").trim().toLowerCase();

  return Boolean(
    role === "admin" ||
      role === "owner" ||
      role === "superadmin" ||
      user?.is_admin === true ||
      user?.admin === true
  );
}

export const hasAdminAccess = isAdmin;

/**
 * =========================
 * MERGE USER FROM /api/me
 * =========================
 */

export function mergeUserFromApiMe(apiUser) {
  if (!apiUser) return;

  const existing = stripTransientAuthFlags(getUser());
  const incoming = stripTransientAuthFlags(apiUser);

  const merged = normalizeUser({
    ...(existing || {}),
    ...(incoming || {}),
  });

  setUser(merged);

  const tenant =
    merged?.org_slug ||
    merged?.tenant ||
    getTenant() ||
    "public";

  if (tenant) {
    setTenant(tenant);
  }
}

/**
 * =========================
 * CLEAR SESSION
 * =========================
 */

export function clearSession() {
  clearToken();
  clearUser();
  clearTenant();
  clearPendingOtpContext();
}

/**
 * =========================
 * LOGOUT
 * =========================
 */

export function logout() {
  clearSession();
  window.location.href = "/auth";
}
