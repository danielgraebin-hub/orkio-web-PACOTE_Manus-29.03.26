import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, uploadFile, joinApi, headers } from "../ui/api.js";
import { getTenant, getToken, getUser, isAdmin } from "../lib/auth.js";
import { ORKIO_VOICES } from "../lib/voices.js";

function Badge({ children }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
      {children}
    </span>
  );
}

function Pill({ children, tone = "muted" }) {
  const cls =
    tone === "good"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "bad"
      ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
      : "border-white/10 bg-white/5 text-white/70";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

function fmt(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

// Modal component
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-900 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AdminConsole() {
  const nav = useNavigate();


// Summit presence heartbeat (keeps online status accurate)
React.useEffect(() => {
  let alive = true;
  const tick = async () => {
    try { await apiFetch("/api/auth/heartbeat", { method: "POST" }); } catch (_e) {}
  };
  tick();
  const id = setInterval(() => { if (alive) tick(); }, 20000);
  return () => { alive = false; clearInterval(id); };
}, []);
  const tenant = getTenant() || "public";
  const token = getToken();
  const user = getUser();

  const adminUploadRef = useRef(null);
  const institutionalUploadRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleAdminUpload(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    ev.target.value = "";
    try {
      setUploading(true);
      await uploadFile(f, { token, org: tenant, agentId: selectedAgentForKnowledge?.id || null, intent: "agent" });
      try { await refreshAll(); } catch (e) { console.warn('refresh after upload failed', e); }
    } catch (e) {
      console.error(e);
      alert("Falha no upload. Veja o console para detalhes.");
    } finally {
      setUploading(false);
    }
  }

  async function handleInstitutionalUpload(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    ev.target.value = "";
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(joinApi("/api/admin/files/upload"), {
        method: "POST",
        headers: headers({ token, org: tenant, json: false }),
        body: fd,
      });
      const ct = res.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const payload = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
      if (!res.ok) {
        const msg = (isJson ? (payload?.detail || payload?.message) : payload) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      try { await refreshAll(); } catch (e) { console.warn('refresh after upload failed', e); }
    } catch (e) {
      console.error(e);
      alert("Falha no upload institucional. Veja o console para detalhes.");
    } finally {
      setUploading(false);
    }
  }


  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [audit, setAudit] = useState([]);

  const [pendingUsers, setPendingUsers] = useState([]);
  const [fileRequests, setFileRequests] = useState([]);
  const [costs, setCosts] = useState(null);
  const [costDays, setCostDays] = useState(7);

  async function refreshAll() {
    // Refresh core admin data; safe to call after uploads/edits
    await Promise.allSettled([
      load("overview"),
      load("users"),
      load("files"),
      load("agents"),
      load("audit"),
      load("approvals"),
      load("fileRequests"),
      load("costs"),
    ]);
  }

  const [agents, setAgents] = useState([]);
  
  // Agent form state
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [agentForm, setAgentForm] = useState({
    name: "",
    description: "",
    system_prompt: "",
    model: "",
    embedding_model: "",
    temperature: "",
    rag_enabled: true,
    rag_top_k: 6,
    is_default: false,
    voice_id: "nova",
    avatar_url: ""
  });
  
  // Knowledge linking
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [linksModalOpen, setLinksModalOpen] = useState(false);
  const [delegateModalOpen, setDelegateModalOpen] = useState(false);
  const [selectedAgentForDelegate, setSelectedAgentForDelegate] = useState(null);
  const [delegateTargetAgentId, setDelegateTargetAgentId] = useState("");
  const [delegateInstruction, setDelegateInstruction] = useState("");
  const [selectedAgentForLinks, setSelectedAgentForLinks] = useState(null);
  const [agentLinks, setAgentLinks] = useState([]);
  const [linkMode, setLinkMode] = useState('consult');
  const [selectedAgentForKnowledge, setSelectedAgentForKnowledge] = useState(null);
  const [agentKnowledge, setAgentKnowledge] = useState([]);
  const [allFiles, setAllFiles] = useState([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) nav("/auth");
    if (!isAdmin(user)) nav("/app");
  }, [token]);

  async function approveUser(userId) {
    await apiFetch(`/api/admin/users/${userId}/approve`, { method: "POST", org: tenant, token });
    await refreshAll();
  }

  async function rejectUser(userId) {
    if (!confirm("Rejeitar e remover este usuário?")) return;
    await apiFetch(`/api/admin/users/${userId}/reject`, { method: "POST", org: tenant, token });
    await refreshAll();
  }

  async function deleteUser(userId, email) {
    if (!confirm(`Remover permanentemente ${email || "este usuário"}?`)) return;
    await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE", org: tenant, token });
    await refreshAll();
  }

  async function load(which) {
    setLoading(true);
    setErr("");
    try {
      if (which === "overview") {
        const res = await apiFetch("/api/admin/overview", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setOverview(data);
      } else if (which === "users") {
        const res = await apiFetch("/api/admin/users", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setUsers(Array.isArray(data) ? data : []);
      } else if (which === "files") {
        const res = await apiFetch("/api/admin/files", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setFiles(Array.isArray(data) ? data : []);
      } else if (which === "agents") {
        const res = await apiFetch("/api/admin/agents", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setAgents(Array.isArray(data) ? data : []);
      } else if (which === "audit") {
        const res = await apiFetch("/api/admin/audit", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setAudit(Array.isArray(data) ? data : []);
      } else if (which === "approvals") {
        const res = await apiFetch("/api/admin/users?status=pending", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setPendingUsers(Array.isArray(data) ? data : []);
      } else if (which === "fileRequests") {
        const res = await apiFetch("/api/admin/file-requests?status=pending", { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setFileRequests(Array.isArray(data) ? data : []);
      } else if (which === "costs") {
        const res = await apiFetch(`/api/admin/costs?days=${encodeURIComponent(costDays)}`, { org: tenant, token });
        const data = res && typeof res === "object" && "data" in res ? res.data : res;
        setCosts(data || null);
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("overview");
  }, []);

  useEffect(() => {
    if (tab === "overview") load("overview");
    if (tab === "users") load("users");
    if (tab === "files") { load("files"); load("fileRequests"); }
    if (tab === "agents") load("agents");
    if (tab === "audit") load("audit");
    if (tab === "approvals") load("approvals");
    if (tab === "costs") load("costs");
  }, [tab, costDays]);

  const stats = overview || { tenants: "-", users: "-", threads: "-", messages: "-", files: "-" };

  // Agent CRUD functions
  function openCreateAgent() {
    setEditingAgent(null);
    setAgentForm({
      name: "",
      description: "",
      system_prompt: "Você é um assistente útil e objetivo.",
      model: "gpt-4o-mini",
      embedding_model: "",
      temperature: "0.7",
      rag_enabled: true,
      rag_top_k: 6,
      is_default: false,
      voice_id: "nova",
      avatar_url: ""
    });
    setAgentModalOpen(true);
  }

  function openEditAgent(agent) {
    setEditingAgent(agent);
    setAgentForm({
      name: agent.name || "",
      description: agent.description || "",
      system_prompt: agent.system_prompt || "",
      model: agent.model || "",
      embedding_model: agent.embedding_model || "",
      temperature: agent.temperature || "",
      rag_enabled: agent.rag_enabled !== false,
      rag_top_k: agent.rag_top_k || 6,
      is_default: agent.is_default || false,
      voice_id: agent.voice_id || "nova",
      avatar_url: agent.avatar_url || ""
    });
    setAgentModalOpen(true);
  }

  async function saveAgent() {
    setLoading(true);
    setErr("");
    try {
      const payload = {
        name: agentForm.name,
        description: agentForm.description || null,
        system_prompt: agentForm.system_prompt,
        model: agentForm.model || null,
        embedding_model: agentForm.embedding_model || null,
        temperature: agentForm.temperature ? parseFloat(agentForm.temperature) : null,
        rag_enabled: agentForm.rag_enabled,
        rag_top_k: parseInt(agentForm.rag_top_k) || 6,
        is_default: agentForm.is_default,
        voice_id: agentForm.voice_id || "nova",
        avatar_url: agentForm.avatar_url || null
      };

      if (editingAgent) {
        await apiFetch(`/api/admin/agents/${editingAgent.id}`, {
          method: "PUT",
          org: tenant,
          token,
          body: payload
        });
      } else {
        await apiFetch("/api/admin/agents", {
          method: "POST",
          org: tenant,
          token,
          body: payload
        });
      }
      setAgentModalOpen(false);
      load("agents");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteAgent(agentId) {
    if (!confirm("Tem certeza que deseja excluir este agente?")) return;
    setLoading(true);
    try {
      await apiFetch(`/api/admin/agents/${agentId}`, {
        method: "DELETE",
        org: tenant,
        token
      });
      load("agents");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Knowledge management
  
  async function openLinksModal(agent) {
    setSelectedAgentForLinks(agent);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/agents/${agent.id}/links`, { org: tenant, token });
      const data = res && typeof res === "object" && "data" in res ? res.data : res;
      const items = Array.isArray(data) ? data : (data?.items || []);
      setAgentLinks(items.map(i => i.target_agent_id));
      setLinkMode(items?.[0]?.mode || "consult");
      setLinksModalOpen(true);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function saveLinks() {
    if (!selectedAgentForLinks?.id) return;
    setLoading(true);
    try {
      await apiFetch(`/api/admin/agents/${selectedAgentForLinks.id}/links`, {
        method: "PUT",
        org: tenant,
        token,
        body: { target_agent_ids: agentLinks, mode: linkMode }
      });
      setLinksModalOpen(false);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }


  function openDelegateModal(sourceAgent) {
    setSelectedAgentForDelegate(sourceAgent);
    setDelegateTargetAgentId("");
    setDelegateInstruction("");
    setDelegateModalOpen(true);
  }

  async function sendDelegate() {
    if (!selectedAgentForDelegate?.id) return;
    if (!delegateTargetAgentId) return alert("Selecione o agente destino.");
    if (!delegateInstruction.trim()) return alert("Escreva a instrução.");
    setLoading(true);
    setErr("");
    try {
      await apiFetch("/api/agents/delegate", {
        method: "POST",
        org: tenant,
        token,
        body: {
          source_agent_id: selectedAgentForDelegate.id,
          target_agent_id: delegateTargetAgentId,
          instruction: delegateInstruction,
          create_thread: true,
          thread_title: `Instrução de ${selectedAgentForDelegate.name || selectedAgentForDelegate.id}`,
        },
      });
      setDelegateModalOpen(false);
      alert("Instrução enviada. Veja a conversa criada no destino.");
    } catch (e) {
      setErr(String(e?.message || e));
      alert("Falha ao enviar instrução. Veja o console/erro.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }


async function openKnowledgeModal(agent) {
    setSelectedAgentForKnowledge(agent);
    setLoading(true);
    try {
      // Load agent's current knowledge links
      const kRes = await apiFetch(`/api/admin/agents/${agent.id}/knowledge`, { org: tenant, token });
      const kData = kRes && typeof kRes === "object" && "data" in kRes ? kRes.data : kRes;
      setAgentKnowledge(Array.isArray(kData) ? kData : []);
      
      // Load all files for selection
      const fRes = await apiFetch("/api/admin/files?institutional_only=true", { org: tenant, token });
      const fData = fRes && typeof fRes === "object" && "data" in fRes ? fRes.data : fRes;
      setAllFiles(Array.isArray(fData) ? fData : []);
      
      setKnowledgeModalOpen(true);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function linkFile(fileId) {
    setLoading(true);
    try {
      await apiFetch(`/api/admin/agents/${selectedAgentForKnowledge.id}/knowledge`, {
        method: "POST",
        org: tenant,
        token,
        body: { file_id: fileId, enabled: true }
      });
      // Refresh knowledge list
      const kRes = await apiFetch(`/api/admin/agents/${selectedAgentForKnowledge.id}/knowledge`, { org: tenant, token });
      const kData = kRes && typeof kRes === "object" && "data" in kRes ? kRes.data : kRes;
      setAgentKnowledge(Array.isArray(kData) ? kData : []);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function unlinkFile(linkId) {
    setLoading(true);
    try {
      await apiFetch(`/api/admin/agents/${selectedAgentForKnowledge.id}/knowledge/${linkId}`, {
        method: "DELETE",
        org: tenant,
        token
      });
      // Refresh knowledge list
      const kRes = await apiFetch(`/api/admin/agents/${selectedAgentForKnowledge.id}/knowledge`, { org: tenant, token });
      const kData = kRes && typeof kRes === "object" && "data" in kRes ? kRes.data : kRes;
      setAgentKnowledge(Array.isArray(kData) ? kData : []);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Get linked file IDs for filtering
  const linkedFileIds = new Set(agentKnowledge.map(k => k.file_id));

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight">Admin</h1>
            <Badge>org: {tenant}</Badge>
            <Badge>{loading ? "loading" : "ready"}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              onClick={() => nav("/app")}
            >
              Back to Console
            </button>
            <button
              className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              onClick={() => load(tab)}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["overview", "Overview"],
            ["users", "Users & Approvals"],
            ["files", "Files"],
            ["agents", "Agents"],
            ["audit", "Audit"],
            ["approvals", "Approvals"],
            ["costs", "Costs"],
            ["summit", "Summit"],
          ].map(([k, label]) => (
            <button
              key={k}
              className={
                tab === k
                  ? "rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold"
                  : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              }
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
            ⚠️ {err}
          </div>
        ) : null}

        {/* Overview Tab */}
        {tab === "overview" && (
          <>
            <p className="mt-6 text-sm text-white/70">
              Operational metrics for the last window (lightweight by design). Audit is the source of truth.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-5">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="text-xs text-white/60">{k}</div>
                  <div className="mt-2 text-2xl font-extrabold">{String(v)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Users Tab */}
        {tab === "users" && (
          <>
            <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-black tracking-tight">Users, approvals and onboarding</h2>
                <p className="mt-1 text-sm text-white/70">One operational view for approval, onboarding context and access cleanup.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="good">{users.filter((u) => !!u.approved_at).length} approved</Pill>
                <Pill tone="bad">{users.filter((u) => !u.approved_at).length} pending</Pill>
                <Badge>{users.length} rows</Badge>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {users.map((u) => {
                const approved = !!u.approved_at;
                return (
                  <div key={u.id} className="rounded-3xl border border-white/10 bg-white/5 p-4 md:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold">{u.name || "Sem nome"}</div>
                          <Pill tone={approved ? "good" : "bad"}>{approved ? "approved" : "pending"}</Pill>
                          <Pill tone={u.onboarding_completed ? "good" : "muted"}>{u.onboarding_completed ? "onboarding ok" : "onboarding pending"}</Pill>
                          <Pill tone={u.role === "admin" ? "good" : "muted"}>{u.role}</Pill>
                        </div>
                        <div className="mt-1 break-all text-sm text-white/70">{u.email}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
                          <span>Tenant: {u.org_slug}</span>
                          <span>Created: {fmt(u.created_at)}</span>
                          <span>Approved: {u.approved_at ? fmt(u.approved_at) : "-"}</span>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">Company</div>
                            <div className="mt-1 text-sm text-white/85">{u.company || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">Role</div>
                            <div className="mt-1 text-sm text-white/85">{u.profile_role || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">User type</div>
                            <div className="mt-1 text-sm text-white/85">{u.user_type || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">Intent</div>
                            <div className="mt-1 text-sm text-white/85">{u.intent || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">Country</div>
                            <div className="mt-1 text-sm text-white/85">{u.country || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-white/45">Language</div>
                            <div className="mt-1 text-sm text-white/85">{u.language || "-"}</div>
                          </div>
                        </div>
                        <div className="mt-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-white/45">WhatsApp</div>
                          <div className="mt-1 text-sm text-white/85">{u.whatsapp || "-"}</div>
                        </div>
                        {u.notes ? (
                          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/80">
                            <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">Notes</div>
                            {u.notes}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2 lg:w-[260px] lg:justify-end">
                        {!approved ? (
                          <button
                            className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/15"
                            onClick={() => approveUser(u.id)}
                          >
                            Approve
                          </button>
                        ) : null}
                        {!approved ? (
                          <button
                            className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/15"
                            onClick={() => rejectUser(u.id)}
                          >
                            Reject
                          </button>
                        ) : null}
                        <button
                          className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/15"
                          onClick={() => deleteUser(u.id, u.email)}
                        >
                          Delete user
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!users.length && !loading ? (
                <div className="rounded-3xl border border-dashed border-white/20 p-8 text-center text-white/60">
                  No users found.
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Files Tab */}
        {tab === "files" && (
          <>
            <div className="mt-8 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-tight">Files (last 200)</h2>
                <p className="mt-1 text-sm text-white/70">Ingestion & extraction status.</p>
              </div>
              <div className="flex items-center gap-3">
  <input ref={adminUploadRef} type="file" className="hidden" onChange={handleAdminUpload} />
  <button
    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
    onClick={() => adminUploadRef.current?.click()}
    disabled={uploading}
    title="Enviar documento para a base de conhecimento (tenant atual)"
  >
    {uploading ? "Uploading..." : "Upload"}
  </button>
  <Badge>{files.length} rows</Badge>
</div>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-black/20">
                    <tr className="text-xs text-white/70">
                      <th className="px-4 py-3 font-semibold">when</th>
                      <th className="px-4 py-3 font-semibold">org</th>
                      <th className="px-4 py-3 font-semibold">filename</th>
                      <th className="px-4 py-3 font-semibold">uploader</th>
                      <th className="px-4 py-3 font-semibold">size</th>
                      <th className="px-4 py-3 font-semibold">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 text-white/70">{fmt(f.created_at)}</td>
                        <td className="px-4 py-3">{f.org_slug}</td>
                        <td className="px-4 py-3">{f.filename}</td>
                        <td className="px-4 py-3 text-white/80">{f.uploader_name || f.uploader_email || "-"}</td>
                        <td className="px-4 py-3 text-white/80">{(f.size_bytes / 1024).toFixed(1)} KB</td>
                        <td className="px-4 py-3">
                          {f.extraction_failed ? <Pill tone="bad">failed</Pill> : <Pill tone="good">ok</Pill>}
                        </td>
                      </tr>
                    ))}
                    {!files.length && !loading ? (
                      <tr>
                        <td className="px-4 py-6 text-sm text-white/60" colSpan={6}>
                          No files found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Agents Tab */}
        {tab === "agents" && (
          <>
            <div className="mt-8 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-tight">Agent Studio</h2>
                <p className="mt-1 text-sm text-white/70">Create and manage AI agents with custom prompts and knowledge.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{agents.length} agents</Badge>
                <button
                  className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
                  onClick={openCreateAgent}
                >
                  + New Agent
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((a) => (
                <div key={a.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {a.avatar_url ? (
                        <img src={a.avatar_url} alt={a.name} className="w-10 h-10 rounded-full object-cover border border-white/20 flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 font-bold text-sm flex-shrink-0">{(a.name || '?')[0].toUpperCase()}</div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg">{a.name}</h3>
                          {a.is_default && <Pill tone="good">default</Pill>}
                        </div>
                        <p className="mt-1 text-sm text-white/60 line-clamp-2">{a.description || "Sem descrição"}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <Pill>{a.model || "gpt-4o-mini"}</Pill>
                    <Pill tone={a.rag_enabled ? "good" : "muted"}>RAG {a.rag_enabled ? "ON" : "OFF"}</Pill>
                    {a.temperature && <Pill>temp: {a.temperature}</Pill>}
                    <Pill>🔊 {a.voice_id || "nova"}</Pill>
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    <button
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                      onClick={() => openEditAgent(a)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                      onClick={() => openKnowledgeModal(a)}
                    >
                      Knowledge
                    </button>
                    <button
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                      onClick={() => openLinksModal(a)}
                    >
                      Links
                    </button>
                    <button
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                      onClick={() => openDelegateModal(a)}
                    >
                      Send
                    </button>
                    <button
                      className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/20"
                      onClick={() => deleteAgent(a.id)}
                    >
                      Delete
                    </button>
                  </div>
                  
                  <div className="mt-3 text-xs text-white/40">
                    Updated: {fmt(a.updated_at)}
                  </div>
                </div>
              ))}
              
              {!agents.length && !loading ? (
                <div className="col-span-full rounded-3xl border border-dashed border-white/20 p-8 text-center">
                  <p className="text-white/60">No agents yet. Create your first agent to get started.</p>
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Audit Tab */}
        {tab === "audit" && (
          <>
            <div className="mt-8 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-tight">Audit (last 200)</h2>
                <p className="mt-1 text-sm text-white/70">Every request that matters should leave a trace here.</p>
              </div>
              <Badge>{audit.length} rows</Badge>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-black/20">
                    <tr className="text-xs text-white/70">
                      <th className="px-4 py-3 font-semibold">when</th>
                      <th className="px-4 py-3 font-semibold">org</th>
                      <th className="px-4 py-3 font-semibold">action</th>
                      <th className="px-4 py-3 font-semibold">path</th>
                      <th className="px-4 py-3 font-semibold">status</th>
                      <th className="px-4 py-3 font-semibold">ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 text-white/70">{fmt(a.created_at)}</td>
                        <td className="px-4 py-3">{a.org_slug}</td>
                        <td className="px-4 py-3">{a.action}</td>
                        <td className="px-4 py-3 text-white/70">{a.path}</td>
                        <td className="px-4 py-3">{a.status_code}</td>
                        <td className="px-4 py-3">{a.latency_ms}</td>
                      </tr>
                    ))}
                    {!audit.length && !loading ? (
                      <tr>
                        <td className="px-4 py-6 text-sm text-white/60" colSpan={6}>
                          No audit entries found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Approvals Tab */}
        {tab === "approvals" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-lg font-bold">Approvals were unified into Users</div>
            <p className="mt-2 text-sm text-white/70">
              Use the Users & Approvals tab to approve, reject, inspect onboarding data and remove users in one place.
            </p>
            <button
              className="mt-4 rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              onClick={() => setTab("users")}
            >
              Open Users & Approvals
            </button>
          </div>
        )}

        {/* Costs Tab */}
        {tab === "costs" && (
          <>
            <p className="mt-6 text-sm text-white/70">
              Painel de tokens (proxy de custos). Valores monetários dependem do seu contrato/modelo; aqui focamos em auditabilidade.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-white/70">Janela:</span>
              {[1, 7, 30].map((d) => (
                <button
                  key={d}
                  className={
                    costDays === d
                      ? "rounded-2xl bg-white/10 px-3 py-2 text-sm font-semibold"
                      : "rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                  }
                  onClick={() => setCostDays(d)}
                >
                  {d}d
                </button>
              ))}
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                onClick={() => load("costs")}
              >
                Atualizar
              </button>
            </div>

            {/* PATCH0100_14: Enterprise-grade USD cost dashboard */}
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs text-white/60">Total Tokens</div>
                <div className="mt-1 text-xs text-white/50">Eventos: {costs?.events ?? 0} • Missing: {costs?.usage_missing_events ?? 0}</div>
                <div className="mt-2 text-2xl font-extrabold">{String(costs?.total?.total_tokens ?? "-")}</div>
              </div>
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="text-xs text-emerald-300/80">Input Cost (USD)</div>
                <div className="mt-1 text-xs text-white/50">Prompt: {String(costs?.total?.prompt_tokens ?? "-")} tokens</div>
                <div className="mt-2 text-2xl font-extrabold text-emerald-300">${(costs?.total?.input_cost_usd ?? 0).toFixed(4)}</div>
              </div>
              <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5">
                <div className="text-xs text-amber-300/80">Output Cost (USD)</div>
                <div className="mt-1 text-xs text-white/50">Completion: {String(costs?.total?.completion_tokens ?? "-")} tokens</div>
                <div className="mt-2 text-2xl font-extrabold text-amber-300">${(costs?.total?.output_cost_usd ?? 0).toFixed(4)}</div>
              </div>
              <div className="rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                <div className="text-xs text-indigo-300/80">Total Cost (USD)</div>
                <div className="mt-1 text-xs text-white/50">Pricing v{costs?.pricing_version || "?"}</div>
                <div className="mt-2 text-2xl font-extrabold text-indigo-300">${(costs?.total?.total_cost_usd ?? 0).toFixed(4)}</div>
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold">Por agente</div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/60">
                      <th className="pb-2">Agente</th>
                      <th className="pb-2">Tokens</th>
                      <th className="pb-2">Input USD</th>
                      <th className="pb-2">Output USD</th>
                      <th className="pb-2">Total USD</th>
                      <th className="pb-2">Eventos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(costs?.per_agent || []).map((r) => (
                      <tr key={r.agent_id || r.agent_name} className="border-t border-white/10">
                        <td className="py-2 font-medium">{r.agent_name}</td>
                        <td className="py-2">{r.total_tokens}</td>
                        <td className="py-2 text-emerald-300">${(r.input_cost_usd ?? 0).toFixed(4)}</td>
                        <td className="py-2 text-amber-300">${(r.output_cost_usd ?? 0).toFixed(4)}</td>
                        <td className="py-2 text-indigo-300 font-semibold">${(r.total_cost_usd ?? 0).toFixed(4)}</td>
                        <td className="py-2 text-white/50">{r.events}</td>
                      </tr>
                    ))}
                    {(!costs?.per_agent || costs.per_agent.length === 0) ? (
                      <tr className="border-t border-white/10">
                        <td className="py-3 text-white/60" colSpan={6}>Sem dados (ainda). Faça algumas conversas e volte aqui.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ===== SUMMIT TAB (PATCH0100_28) ===== */}
        {tab === "summit" && (
          <SummitTab token={token} tenant={tenant} />
        )}
      </div>

      {/* Agent Create/Edit Modal */}
      <Modal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        title={editingAgent ? "Edit Agent" : "Create Agent"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/70 mb-1">Name *</label>
            <input
              type="text"
              value={agentForm.name}
              onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
              placeholder="e.g., Customer Support Agent"
            />
          </div>
          
          <div>
            <label className="block text-sm text-white/70 mb-1">Description</label>
            <input
              type="text"
              value={agentForm.description}
              onChange={e => setAgentForm({ ...agentForm, description: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
              placeholder="Brief description of the agent's purpose"
            />
          </div>
          
          <div>
            <label className="block text-sm text-white/70 mb-1">System Prompt *</label>
            <textarea
              value={agentForm.system_prompt}
              onChange={e => setAgentForm({ ...agentForm, system_prompt: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none h-32 resize-none"
              placeholder="Instructions for the AI agent..."
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-1">Model</label>
              <select
                value={agentForm.model}
                onChange={e => setAgentForm({ ...agentForm, model: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="">Default (gpt-4o-mini)</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm text-white/70 mb-1">Temperature (0-2)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={agentForm.temperature}
                onChange={e => setAgentForm({ ...agentForm, temperature: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
                placeholder="0.7"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-1">RAG Top K</label>
              <input
                type="number"
                min="1"
                max="20"
                value={agentForm.rag_top_k}
                onChange={e => setAgentForm({ ...agentForm, rag_top_k: parseInt(e.target.value) || 6 })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            
            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentForm.rag_enabled}
                  onChange={e => setAgentForm({ ...agentForm, rag_enabled: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">RAG Enabled</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentForm.is_default}
                  onChange={e => setAgentForm({ ...agentForm, is_default: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Default Agent</span>
              </label>
            </div>
          </div>

          {/* PATCH0100_14: Voice & Avatar */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-1">🔊 Voz do Agente</label>
              <select
                value={agentForm.voice_id}
                onChange={e => setAgentForm({ ...agentForm, voice_id: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              >
                {ORKIO_VOICES.map(v => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
</select>
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-1">🖼️ Avatar URL</label>
              <input
                type="text"
                value={agentForm.avatar_url}
                onChange={e => setAgentForm({ ...agentForm, avatar_url: e.target.value })}
                placeholder="https://... (URL da imagem do agente)"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white placeholder:text-white/30"
              />
              {agentForm.avatar_url && (
                <div className="mt-2 flex items-center gap-2">
                  <img src={agentForm.avatar_url} alt="preview" className="w-10 h-10 rounded-full object-cover border border-white/20" onError={(e) => { e.target.style.display = 'none'; }} />
                  <span className="text-xs text-white/50">Preview</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex justify-end gap-3 pt-4">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              onClick={() => setAgentModalOpen(false)}
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400 disabled:opacity-50"
              onClick={saveAgent}
              disabled={!agentForm.name || loading}
            >
              {loading ? "Saving..." : (editingAgent ? "Update" : "Create")}
            </button>
          </div>
        </div>
      </Modal>

      
        {/* Agent Links Modal */}
        <Modal open={linksModalOpen} onClose={() => setLinksModalOpen(false)} title={`Links: ${selectedAgentForLinks?.name || ""}`}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/70 mb-1">Modo</label>
              <select value={linkMode} onChange={(e) => setLinkMode(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white">
                <option value="consult">consult (somar KB no RAG)</option>
                <option value="delegate">delegate (reservado)</option>
              </select>
            </div>

            <div>
              <div className="text-sm text-white/70 mb-2">Vincular a outros agentes:</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {agents.filter(x => x.id !== selectedAgentForLinks?.id).map(x => {
                  const checked = agentLinks.includes(x.id);
                  return (
                    <label key={x.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-sm">{x.name}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setAgentLinks([...agentLinks, x.id]);
                          else setAgentLinks(agentLinks.filter(id => id !== x.id));
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10" onClick={() => setLinksModalOpen(false)}>
                Cancelar
              </button>
              <button className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400" onClick={saveLinks}>
                Salvar
              </button>
            </div>
          </div>
        </Modal>


        {/* Knowledge Management Modal */}
      
      {/* Delegate Modal */}
      <Modal
        open={delegateModalOpen}
        onClose={() => setDelegateModalOpen(false)}
        title={`Send Instruction: ${selectedAgentForDelegate?.name || ""}`}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-white/70">Destino</label>
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={delegateTargetAgentId}
              onChange={(e) => setDelegateTargetAgentId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {agents
                .filter(a => a.id !== selectedAgentForDelegate?.id)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id})
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-white/50">
              Requer um Agent Link com modo <b>delegate</b> do agente origem para o destino.
            </p>
          </div>

          <div>
            <label className="text-sm text-white/70">Instrução</label>
            <textarea
              className="mt-1 w-full min-h-[120px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={delegateInstruction}
              onChange={(e) => setDelegateInstruction(e.target.value)}
              placeholder="Escreva a orientação que o agente destino deve seguir..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              onClick={() => setDelegateModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-400/20"
              onClick={sendDelegate}
              disabled={loading}
            >
              Enviar
            </button>
          </div>
        </div>
      </Modal>

<Modal
        open={knowledgeModalOpen}
        onClose={() => setKnowledgeModalOpen(false)}
        title={`Knowledge: ${selectedAgentForKnowledge?.name || ""}`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input ref={adminUploadRef} type="file" className="hidden" onChange={handleAdminUpload} />
            <input ref={institutionalUploadRef} type="file" className="hidden" onChange={handleInstitutionalUpload} />
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => adminUploadRef.current && adminUploadRef.current.click()}
              disabled={uploading}
              title="Faz upload e vincula direto a este agente"
            >
              {uploading ? "Enviando..." : "Upload para este agente"}
            </button>
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => institutionalUploadRef.current && institutionalUploadRef.current.click()}
              disabled={uploading}
              title="Faz upload institucional (global) para depois vincular a múltiplos agentes"
            >
              {uploading ? "Enviando..." : "Upload institucional"}
            </button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white/70 mb-2">Linked Documents</h4>
            {agentKnowledge.length === 0 ? (
              <p className="text-sm text-white/50">No documents linked yet.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {agentKnowledge.map(k => {
                  const file = allFiles.find(f => f.id === k.file_id);
                  return (
                    <div key={k.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-sm">{file?.filename || k.file_id}</span>
                      <button
                        className="text-rose-400 hover:text-rose-300 text-xs"
                        onClick={() => unlinkFile(k.id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          <div>
            <h4 className="text-sm font-semibold text-white/70 mb-2">Institutional Documents</h4>
            {allFiles.filter(f => !linkedFileIds.has(f.id)).length === 0 ? (
              <p className="text-sm text-white/50">No more documents available.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {allFiles.filter(f => !linkedFileIds.has(f.id)).map(f => (
                  <div key={f.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <span className="text-sm">{f.filename}</span>
                    <button
                      className="text-emerald-400 hover:text-emerald-300 text-xs"
                      onClick={() => linkFile(f.id)}
                    >
                      + Link
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex justify-end pt-4">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              onClick={() => setKnowledgeModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ===== PATCH0100_28: Summit Tab Component =====
function SummitTab({ token, tenant }) {
  const [codes, setCodes] = React.useState([]);
  const [flags, setFlags] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [newCode, setNewCode] = React.useState({ label: "", usage_tier: "standard", max_uses: 50, expires_days: 30 });
  const [newFlag, setNewFlag] = React.useState({ key: "", value: "", scope: "global" });
  const [msg, setMsg] = React.useState("");

  const headers = { Authorization: `Bearer ${token}` };

  async function loadAll() {
    setLoading(true);
    try {
      const [c, f, s] = await Promise.all([
        apiFetch("/api/admin/summit/codes", { headers }).catch(() => []),
        apiFetch("/api/admin/summit/flags", { headers }).catch(() => []),
        apiFetch("/api/admin/summit/sessions", { headers }).catch(() => []),
      ]);
      setCodes(Array.isArray(c) ? c : c?.codes || []);
      setFlags(Array.isArray(f) ? f : f?.flags || []);
      setSessions(Array.isArray(s) ? s : s?.sessions || []);
    } catch {}
    setLoading(false);
  }

  React.useEffect(() => { loadAll(); }, []);

  async function createCode() {
    setMsg("");
    try {
      await apiFetch("/api/admin/summit/codes", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(newCode),
      });
      setMsg("Access code created.");
      setNewCode({ label: "", usage_tier: "standard", max_uses: 50, expires_days: 30 });
      loadAll();
    } catch (e) {
      setMsg("Error: " + (e.message || "Failed"));
    }
  }

  async function revokeCode(id) {
    try {
      await apiFetch(`/api/admin/summit/codes/${id}`, { method: "DELETE", headers });
      loadAll();
    } catch {}
  }

  async function setFlag() {
    setMsg("");
    try {
      await apiFetch("/api/admin/summit/flags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(newFlag),
      });
      setMsg("Feature flag saved.");
      setNewFlag({ key: "", value: "", scope: "global" });
      loadAll();
    } catch (e) {
      setMsg("Error: " + (e.message || "Failed"));
    }
  }

  if (loading) return <div className="mt-6 text-sm text-white/50">Loading Summit data...</div>;

  return (
    <div className="mt-6 space-y-8">
      <p className="text-sm text-white/60">
        Summit Mode controls: access codes, feature flags, and active sessions.
      </p>

      {msg && (
        <div className={`rounded-xl p-3 text-sm ${msg.startsWith("Error") ? "border border-red-500/30 bg-red-500/10 text-red-300" : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
          {msg}
        </div>
      )}

      {/* Access Codes */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-bold">Access Codes</h3>
        <p className="mt-1 text-xs text-white/50">Create invite codes for controlled signup.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            placeholder="Label (e.g., Summit 2026)"
            value={newCode.label}
            onChange={(e) => setNewCode({ ...newCode, label: e.target.value })}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <select
            value={newCode.usage_tier}
            onChange={(e) => setNewCode({ ...newCode, usage_tier: e.target.value })}
            className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-sm outline-none"
          >
            <option value="free">Free</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
          <input
            type="number" placeholder="Max uses" min="1"
            value={newCode.max_uses}
            onChange={(e) => setNewCode({ ...newCode, max_uses: parseInt(e.target.value) || 50 })}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <button onClick={createCode}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-2 text-sm font-bold text-black hover:brightness-110">
            Generate Code
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/60">
                <th className="pb-2">Code</th>
                <th className="pb-2">Label</th>
                <th className="pb-2">Tier</th>
                <th className="pb-2">Uses</th>
                <th className="pb-2">Expires</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-white/10">
                  <td className="py-2 font-mono text-xs">{c.code}</td>
                  <td className="py-2">{c.label || "-"}</td>
                  <td className="py-2">{c.usage_tier}</td>
                  <td className="py-2">{c.used_count}/{c.max_uses}</td>
                  <td className="py-2 text-xs text-white/50">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}</td>
                  <td className="py-2">
                    <button onClick={() => revokeCode(c.id)} className="text-xs text-red-400 hover:text-red-300">Revoke</button>
                  </td>
                </tr>
              ))}
              {codes.length === 0 && (
                <tr className="border-t border-white/10">
                  <td className="py-3 text-white/50" colSpan={6}>No access codes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-bold">Feature Flags</h3>
        <p className="mt-1 text-xs text-white/50">Toggle features without deploy.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            placeholder="Key (e.g., enable_voice)"
            value={newFlag.key}
            onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value })}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <input
            placeholder="Value (true/false/string)"
            value={newFlag.value}
            onChange={(e) => setNewFlag({ ...newFlag, value: e.target.value })}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <select
            value={newFlag.scope}
            onChange={(e) => setNewFlag({ ...newFlag, scope: e.target.value })}
            className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-sm outline-none"
          >
            <option value="global">Global</option>
            <option value="tenant">Tenant</option>
          </select>
          <button onClick={setFlag}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-2 text-sm font-bold text-black hover:brightness-110">
            Save Flag
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/60">
                <th className="pb-2">Key</th>
                <th className="pb-2">Value</th>
                <th className="pb-2">Scope</th>
                <th className="pb-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id || f.key} className="border-t border-white/10">
                  <td className="py-2 font-mono text-xs">{f.key}</td>
                  <td className="py-2">{f.value}</td>
                  <td className="py-2">{f.scope}</td>
                  <td className="py-2 text-xs text-white/50">{f.updated_at ? new Date(f.updated_at).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {flags.length === 0 && (
                <tr className="border-t border-white/10">
                  <td className="py-3 text-white/50" colSpan={4}>No feature flags set.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-bold">Active Sessions</h3>
        <p className="mt-1 text-xs text-white/50">Currently active user sessions.</p>
        <button onClick={loadAll} className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
          Refresh
        </button>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/60">
                <th className="pb-2">User</th>
                <th className="pb-2">IP</th>
                <th className="pb-2">Device</th>
                <th className="pb-2">Started</th>
                <th className="pb-2">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="py-2">{s.user_email || s.user_id}</td>
                  <td className="py-2 font-mono text-xs">{s.ip_address || "-"}</td>
                  <td className="py-2 text-xs">{(s.user_agent || "").slice(0, 40)}</td>
                  <td className="py-2 text-xs text-white/50">{s.created_at ? new Date(s.created_at).toLocaleString() : "-"}</td>
                  <td className="py-2 text-xs text-white/50">{s.last_active_at ? new Date(s.last_active_at).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr className="border-t border-white/10">
                  <td className="py-3 text-white/50" colSpan={5}>No active sessions.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
