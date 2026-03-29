
import React, { useEffect, useState } from "react";
import { getFounderEscalations, getFounderEscalation, setFounderEscalationAction } from "../ui/api.js";
import { getTenant, getToken } from "../lib/auth.js";

export default function AdminEscalations() {
  const token = getToken();
  const org = getTenant();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("");

  async function load() {
    setStatus("Loading escalations...");
    try {
      const { data } = await getFounderEscalations({ token, org });
      setItems(data?.items || []);
      setStatus("");
    } catch (e) {
      setStatus(e.message || "Failed to load escalations.");
    }
  }

  async function openItem(id) {
    setSelected(id);
    try {
      const { data } = await getFounderEscalation({ escalation_id: id, token, org });
      setDetail(data?.item || null);
    } catch (e) {
      setStatus(e.message || "Failed to load escalation detail.");
    }
  }

  async function applyAction(action_type) {
    if (!selected) return;
    try {
      await setFounderEscalationAction({ escalation_id: selected, action_type, token, org });
      await openItem(selected);
      await load();
    } catch (e) {
      setStatus(e.message || "Failed to update escalation.");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Founder escalations</h3>
        {status ? <p>{status}</p> : null}
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <button key={item.id} onClick={() => openItem(item.id)} style={{ textAlign: "left", padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: selected === item.id ? "#eff6ff" : "#fff" }}>
              <div style={{ fontWeight: 700 }}>{item.full_name || item.email || "Lead"}</div>
              <div style={{ fontSize: 13, color: "#555" }}>{item.interest_type} • score {item.score}</div>
              <div style={{ fontSize: 12, color: "#777" }}>{item.status}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 16 }}>
        {!detail ? <p>Select an escalation to review.</p> : (
          <>
            <h3 style={{ marginTop: 0 }}>{detail.full_name || detail.email}</h3>
            <p><b>Interest:</b> {detail.interest_type} • <b>Score:</b> {detail.score}</p>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{detail.summary}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => applyAction("warm_continue")}>Warm continue</button>
              <button onClick={() => applyAction("deepen_vertical")}>Deepen vertical</button>
              <button onClick={() => applyAction("offer_private_followup")}>Offer follow-up</button>
              <button onClick={() => applyAction("founder_join")}>Founder join</button>
              <button onClick={() => applyAction("close_politely")}>Close politely</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
