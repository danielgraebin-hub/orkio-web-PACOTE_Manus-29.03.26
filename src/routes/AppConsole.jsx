import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, uploadFile, chat, chatStream, transcribeAudio, requestFounderHandoff, getRealtimeClientSecret, startRealtimeSession, startSummitSession, postRealtimeEventsBatch, endRealtimeSession, getRealtimeSession, getSummitSessionScore, submitSummitSessionReview, downloadRealtimeAta as downloadRealtimeAtaFile, guardRealtimeTranscript } from "../ui/api.js";
import { clearSession, getTenant, getToken, getUser, isAdmin, isApproved, hasAdminAccess, setSession, logout } from "../lib/auth.js";
import { ORKIO_VOICES, coerceVoiceId } from "../lib/voices.js";
import TermsModal from "../ui/TermsModal.jsx";
import PWAInstallPrompt from "../components/PWAInstallPrompt.jsx";
import OnboardingModal from "../components/OnboardingModal.jsx";
import { startSessionHeartbeat } from "../lib/sessionHeartbeat.js";

const ORKIO_ENV = (typeof window !== "undefined" && window.__ORKIO_ENV__) ? window.__ORKIO_ENV__ : {};
const SUMMIT_VOICE_MODE = ((ORKIO_ENV.VITE_SUMMIT_VOICE_MODE || import.meta.env.VITE_SUMMIT_VOICE_MODE || "realtime").trim().toLowerCase() === "stt_tts")
  ? "stt_tts"
  : "realtime";
const ENABLE_REALTIME = ((ORKIO_ENV.VITE_ENABLE_REALTIME || import.meta.env.VITE_ENABLE_REALTIME || "true").toString().trim().toLowerCase() !== "false");
const ENABLE_VOICE = ((ORKIO_ENV.VITE_ENABLE_VOICE || import.meta.env.VITE_ENABLE_VOICE || "true").toString().trim().toLowerCase() !== "false");
const SPEECH_RECOGNITION_LANG = ((ORKIO_ENV.VITE_SPEECH_RECOGNITION_LANG || import.meta.env.VITE_SPEECH_RECOGNITION_LANG || "pt-BR").trim() || "pt-BR");
const ORKIO_SIDEBAR_LOGO = "/Logo Orkio_V2_Transparente.png";



const REALTIME_IDLE_FOLLOWUP_ENABLED = ((ORKIO_ENV.VITE_REALTIME_IDLE_FOLLOWUP_ENABLED || import.meta.env.VITE_REALTIME_IDLE_FOLLOWUP_ENABLED || "true").toString().trim().toLowerCase() !== "false");
const REALTIME_IDLE_FOLLOWUP_MS = Math.max(5000, Number(ORKIO_ENV.VITE_REALTIME_IDLE_FOLLOWUP_MS || import.meta.env.VITE_REALTIME_IDLE_FOLLOWUP_MS || 10000) || 10000);
const REALTIME_REARM_AFTER_ASSISTANT_MS = Math.max(800, Number(ORKIO_ENV.VITE_REALTIME_RESTART_AFTER_TTS_MS || import.meta.env.VITE_REALTIME_RESTART_AFTER_TTS_MS || 1800) || 1800);

const REALTIME_AUTO_RESPONSE_ENABLED = ((ORKIO_ENV.VITE_REALTIME_AUTO_RESPONSE_ENABLED || import.meta.env.VITE_REALTIME_AUTO_RESPONSE_ENABLED || "true").toString().trim().toLowerCase() !== "false");
const REALTIME_INSTITUTIONAL_MODE = (((ORKIO_ENV.VITE_REALTIME_INSTITUTIONAL_MODE || import.meta.env.VITE_REALTIME_INSTITUTIONAL_MODE || ORKIO_ENV.VITE_ORKIO_RUNTIME_MODE || import.meta.env.VITE_ORKIO_RUNTIME_MODE || "summit")).toString().trim().toLowerCase() === "summit");
const REALTIME_SERVER_VAD_THRESHOLD = Math.min(0.99, Math.max(0.1, Number(ORKIO_ENV.VITE_REALTIME_VAD_THRESHOLD || import.meta.env.VITE_REALTIME_VAD_THRESHOLD || 0.78) || 0.78));
const REALTIME_SERVER_VAD_SILENCE_MS = Math.max(250, Number(ORKIO_ENV.VITE_REALTIME_VAD_SILENCE_MS || import.meta.env.VITE_REALTIME_VAD_SILENCE_MS || 1100) || 1100);
const REALTIME_SERVER_VAD_PREFIX_MS = Math.max(0, Number(ORKIO_ENV.VITE_REALTIME_VAD_HOLD_MS || import.meta.env.VITE_REALTIME_VAD_HOLD_MS || 220) || 220);
const REALTIME_ENABLE_OUTPUT_PICKER = ((ORKIO_ENV.VITE_REALTIME_ENABLE_OUTPUT_PICKER || import.meta.env.VITE_REALTIME_ENABLE_OUTPUT_PICKER || "true").toString().trim().toLowerCase() !== "false");


function resolveRealtimeIdleDisplayName(userObj) {
  const raw = (userObj?.name || userObj?.full_name || "").toString().trim();
  if (!raw) return "";
  const first = raw.split(/\s+/).filter(Boolean)[0] || raw;
  return first.replace(/[^\p{L}\p{N}]/gu, "") || "";
}

function logRealtimeStep(step, payload = undefined) {
  try {
    const stamp = new Date().toISOString();
    if (payload === undefined) {
      console.log(`[Realtime][${stamp}] ${step}`);
    } else {
      console.log(`[Realtime][${stamp}] ${step}`, payload);
    }
  } catch {}
}


function isIOSLike() {
  try {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
    return /iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(platform) && maxTouchPoints > 1);
  } catch {
    return false;
  }
}

function buildPreferredMicConstraints() {
  const ios = isIOSLike();

  if (ios) {
    return {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    };
  }

  return {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      sampleRate: 16000,
      sampleSize: 16,
      latency: 0.02,
    },
    video: false,
  };
}

async function applyBestEffortMicTrackConstraints(track) {
  try {
    if (!track || typeof track.applyConstraints !== "function") return;

    const ios = isIOSLike();
    const next = ios
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          latency: 0.02,
        };

    await track.applyConstraints(next).catch(() => {});
  } catch {}
}

async function createProcessedMicPath(stream, options = {}) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx({ sampleRate: 16000, latencyHint: "interactive" });
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }

    const source = ctx.createMediaStreamSource(stream);

    const inputGain = ctx.createGain();
    inputGain.gain.value = options.inputGain ?? 0.58;

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = options.highpassHz ?? 120;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = options.lowpassHz ?? 4200;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = options.threshold ?? -28;
    compressor.knee.value = options.knee ?? 18;
    compressor.ratio.value = options.ratio ?? 8;
    compressor.attack.value = options.attack ?? 0.003;
    compressor.release.value = options.release ?? 0.2;

    const makeupGain = ctx.createGain();
    makeupGain.gain.value = options.makeupGain ?? 0.92;

    const destination = ctx.createMediaStreamDestination();

    source.connect(inputGain);
    inputGain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(destination);

    const processedTrack = destination.stream.getAudioTracks?.()[0] || null;
    if (!processedTrack) {
      try { ctx.close?.(); } catch {}
      return null;
    }

    return {
      ctx,
      source,
      inputGain,
      highpass,
      lowpass,
      compressor,
      makeupGain,
      destination,
      rawStream: stream,
      track: processedTrack,
      stream: destination.stream,
    };
  } catch (err) {
    console.warn("[Mic] processing chain unavailable", err);
    return null;
  }
}


async function maybeApplyPreferredAudioSink(audioEl) {
  try {
    if (!audioEl || typeof audioEl.setSinkId !== "function") {
      logRealtimeStep("audio:sink_unsupported");
      return;
    }

    let sinkId = (localStorage.getItem("orkio_audio_sink_id") || "").trim();

    if (!sinkId && REALTIME_ENABLE_OUTPUT_PICKER && navigator.mediaDevices?.selectAudioOutput) {
      try {
        const device = await navigator.mediaDevices.selectAudioOutput();
        if (device?.deviceId) {
          sinkId = String(device.deviceId);
          localStorage.setItem("orkio_audio_sink_id", sinkId);
          localStorage.setItem("orkio_audio_sink_label", String(device.label || ""));
          logRealtimeStep("audio:sink_selected", { sinkId, label: device.label || null });
        }
      } catch (err) {
        logRealtimeStep("audio:sink_select_skipped", { message: err?.message || null });
      }
    }

    if (sinkId) {
      await audioEl.setSinkId(sinkId);
      logRealtimeStep("audio:sink_applied", { sinkId });
    }
  } catch (err) {
    console.warn("[Realtime] sink apply failed", err);
    logRealtimeStep("audio:sink_apply_failed", { message: err?.message || null });
  }
}





// Icons (inline SVG)
const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconSend = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const IconPaperclip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
  </svg>
);

const IconEdit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconMessage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
  </svg>
);

const IconTrash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);


function tryParseEvent(content) {
  try {
    if (!content || typeof content !== "string") return null;
    const idx = content.indexOf("ORKIO_EVENT:");
    if (idx < 0) return null;
    const jsonStr = content.slice(idx + "ORKIO_EVENT:".length);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function stripEventMarker(content) {
  if (!content || typeof content !== "string") return content;
  const idx = content.indexOf("ORKIO_EVENT:");
  if (idx < 0) return content;
  return content.slice(0, idx).trim();
}

function formatTs(ts) {
  try {
    if (!ts) return "";
    return formatDateTime(ts);
  } catch {
    return "";
  }
}

function formatDateTime(ts) {
  if (ts === null || ts === undefined || ts === "") return "";
  try {
    let ms;
    if (typeof ts === "number") {
      // If value looks like milliseconds (13 digits), keep; if seconds (10 digits), convert.
      ms = ts > 10_000_000_000 ? ts : ts * 1000;
    } else {
      // ISO string or numeric string
      const n = Number(ts);
      if (!Number.isNaN(n) && Number.isFinite(n)) {
        ms = n > 10_000_000_000 ? n : n * 1000;
      } else {
        ms = new Date(ts).getTime();
      }
    }
    const d = new Date(ms);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}


function resolveRealtimeTranscriptionLanguage(languageProfile) {
  const raw = (languageProfile || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "auto") return "";
  if (raw === "pt-BR") return "pt";
  return raw;
}



const ONBOARDING_USER_TYPES = [
  { value: "founder", label: "Founder" },
  { value: "investor", label: "Investor" },
  { value: "operator", label: "Operator" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

const ONBOARDING_INTENTS = [
  { value: "explore", label: "Explorar a plataforma" },
  { value: "meeting", label: "Agendar conversa" },
  { value: "pilot", label: "Avaliar piloto" },
  { value: "funding", label: "Discutir investimento" },
  { value: "other", label: "Outro" },
];

const ONBOARDING_COUNTRIES = [
  { value: "BR", label: "Brasil" },
  { value: "US", label: "Estados Unidos" },
  { value: "ES", label: "Espanha" },
  { value: "PT", label: "Portugal" },
  { value: "AR", label: "Argentina" },
  { value: "MX", label: "México" },
  { value: "CO", label: "Colômbia" },
  { value: "CL", label: "Chile" },
  { value: "UY", label: "Uruguai" },
  { value: "OTHER", label: "Outro" },
];

const ONBOARDING_LANGUAGES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
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

function normalizeOnboardingUserType(value) {
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

function normalizeOnboardingIntent(value) {
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

function suggestOnboardingLanguage(country) {
  const code = String(country || "").trim().toUpperCase();
  return DEFAULT_LANGUAGE_BY_COUNTRY[code] || "en-US";
}

function normalizeWhatsapp(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function sanitizeOnboardingForm(data) {
  const country = String(data?.country || "").trim().toUpperCase();
  const language = String(data?.language || "").trim();

  return {
    company: String(data?.company || "").trim(),
    role: String(data?.profile_role || "").trim(),
    user_type: normalizeOnboardingUserType(data?.user_type),
    intent: normalizeOnboardingIntent(data?.intent),
    country,
    language,
    whatsapp: normalizeWhatsapp(data?.whatsapp || ""),
    notes: String(data?.notes || "").trim(),
  };
}

export default function AppConsole() {

  const SHOW_REALTIME_AUDIT = false;

  const nav = useNavigate();


// Summit presence heartbeat (keeps online status accurate)
// P0 HOTFIX: não enviar heartbeat sem token válido e parar em 401.
React.useEffect(() => {
  return startSessionHeartbeat({
    intervalMs: 20000,
  });
}, []);
  const [tenant, setTenant] = useState(getTenant() || "public");
  const [token, setToken] = useState(getToken());
  const [user, setUser] = useState(getUser());
  const canAccessAdmin = hasAdminAccess(user || getUser());

  useEffect(() => {
    try {
      console.log("ADMIN_RUNTIME_USER", user);
      console.log("ADMIN_RUNTIME_CAN_ACCESS", canAccessAdmin);
    } catch {}
  }, [user, canAccessAdmin]);

const [onboardingChecked, setOnboardingChecked] = useState(false);
const [onboardingOpen, setOnboardingOpen] = useState(false);
const [onboardingBusy, setOnboardingBusy] = useState(false);
const [onboardingStatus, setOnboardingStatus] = useState("");
const [onboardingForm, setOnboardingForm] = useState(() => sanitizeOnboardingForm(user));
  const [health, setHealth] = useState("checking");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth <= 820 : false);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);

  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState([]);
  const [agents, setAgents] = useState([]);
  const agentsByNameRef = useRef(new Map());

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Destination selector (Team / single / multi)
  const [destMode, setDestMode] = useState("single"); // team|single|multi
  const [destSingle, setDestSingle] = useState(""); // agent id
  const [destMulti, setDestMulti] = useState([]);   // agent ids

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFileObj, setUploadFileObj] = useState(null);
  const [uploadScope, setUploadScope] = useState("thread"); // thread|agents|institutional
  const [uploadAgentIds, setUploadAgentIds] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState("");
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [handoffDraft, setHandoffDraft] = useState("");
  const [handoffInterestType, setHandoffInterestType] = useState("general");
  const [uploadProgress, setUploadProgress] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showNewPasswordConfirm, setShowNewPasswordConfirm] = useState(false);
  const fileInputRef = useRef(null);

  const messagesEndRef = useRef(null);
  const messagesRef = useRef([]); // PATCH0100_20B: keep latest messages for voice-to-voice sequencing

  // Voice-to-text (manual toggle)
  const [speechSupported] = useState(typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const speechRef = useRef(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const micEnabledRef = useRef(false);
  const micRetryRef = useRef({ tries: 0, lastTry: 0 });

  // PATCH AO-01.1: Voice mode must depend on voice capability, not legacy stt_tts mode
  const [voiceMode, setVoiceMode] = useState(ENABLE_VOICE);
  const voiceModeRef = useRef(ENABLE_VOICE);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef(null);
  const [ttsVoice, setTtsVoice] = useState(localStorage.getItem('orkio_tts_voice') || 'cedar');
  const lastSpokenMsgRef = useRef('');
  // PATCH0100_14: agent info from last chat response (for voice/avatar)
  const [lastAgentInfo, setLastAgentInfo] = useState(null);

  // PATCH0100_28: Terms acceptance modal
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [composerViewportOffset, setComposerViewportOffset] = useState(0);

  
  // Realtime/WebRTC voice mode (ultra low latency)
  const [realtimeMode, setRealtimeMode] = useState(false);
  const realtimeModeRef = useRef(false);
  const rtcPcRef = useRef(null);
  const rtcDcRef = useRef(null);
  const rtcAudioElRef = useRef(null);
  const rtcAudioProcessingRef = useRef(null);
  const rtcTextBufRef = useRef("");
  const rtcLastMagicRef = useRef("");
  const [rtcReadyToRespond, setRtcReadyToRespond] = useState(false);
  const rtcLastFinalTranscriptRef = useRef("");
  const rtcMagicEnabledRef = useRef(true);
  const rtcVoiceRef = useRef("cedar");
  const rtcAudioTranscriptBufRef = useRef("");
  const rtcLastAssistantFinalRef = useRef("");
  const rtcAssistantFinalCommittedRef = useRef(false);
  const rtcResponseTimeoutRef = useRef(null);
  const rtcFallbackActiveRef = useRef(false);
  const rtcResponseInFlightRef = useRef(false);
  const rtcInstitutionalTurnInFlightRef = useRef(false);
  const rtcLastSubmittedTranscriptRef = useRef("");
  const rtcLastSubmittedTranscriptTsRef = useRef(0);

const rtcIdleFollowupTimerRef = useRef(null);
const rtcIdleFollowupSentRef = useRef(false);
const rtcLastUserActivityAtRef = useRef(0);

  // PATCH0100_27A: Realtime persistence (audit)
  const rtcSessionIdRef = useRef(null);
  const rtcThreadIdRef = useRef(null);
  const rtcEventQueueRef = useRef([]);
  const rtcFlushTimerRef = useRef(null);
  const rtcFlushInFlightRef = useRef(false);
  const rtcQueuedEventIdsRef = useRef(new Set());
  const rtcConnectingRef = useRef(false);
  // PATCH0100_27_2B: UI log + punct status
  const [rtcAuditEvents, setRtcAuditEvents] = useState([]);
  const [rtcPunctStatus, setRtcPunctStatus] = useState(null); // null | 'pending' | 'done' | 'timeout'
  const [lastRealtimeSessionId, setLastRealtimeSessionId] = useState(null);
  const [summitSessionScore, setSummitSessionScore] = useState(null);
  const [summitReviewPending, setSummitReviewPending] = useState(false);
  const summitRuntimeModeRef = useRef((((window.__ORKIO_ENV__?.VITE_ORKIO_RUNTIME_MODE || import.meta.env.VITE_ORKIO_RUNTIME_MODE || "summit")).trim().toLowerCase() === "summit") ? "summit" : "platform");
  const summitLanguageProfileRef = useRef((((window.__ORKIO_ENV__?.VITE_SUMMIT_LANGUAGE_PROFILE || import.meta.env.VITE_SUMMIT_LANGUAGE_PROFILE || "auto")).trim() || "auto"));



// V2V-PATCH: trace_id por tentativa + status de fase + MediaRecorder
  const v2vTraceRef = useRef(null);

  // STREAM-STAB: anti-zombie (AbortController + runId)

// PATCH0113: Summit capacity modal (STREAM_LIMIT)
const [capacityOpen, setCapacityOpen] = React.useState(false);
const [capacitySeconds, setCapacitySeconds] = React.useState(30);
const capacityTimerRef = React.useRef(null);
const capacityPendingRef = React.useRef(null); // { msg }

const openCapacityModal = (msg) => {
  setCapacityOpen(true);
  setCapacitySeconds(30);
  capacityPendingRef.current = { msg: msg || "" };
  try { if (capacityTimerRef.current) clearInterval(capacityTimerRef.current); } catch {}
  capacityTimerRef.current = setInterval(() => {
    setCapacitySeconds((s) => {
      const next = Math.max(0, (s || 0) - 1);
      if (next === 0) {
        try { if (capacityTimerRef.current) clearInterval(capacityTimerRef.current); } catch {}
        capacityTimerRef.current = null;
        // auto retry (Summit)
        const pending = capacityPendingRef.current;
        if (pending?.msg) {
          try { sendMessage(pending.msg, { isRetry: true }); } catch {}
        }
      }
      return next;
    });
  }, 1000);
};

const closeCapacityModal = () => {
  setCapacityOpen(false);
  try { if (capacityTimerRef.current) clearInterval(capacityTimerRef.current); } catch {}
  capacityTimerRef.current = null;
};
  const streamCtlRef = useRef(null);
  const streamRunRef = useRef(0);

  const [v2vPhase, setV2vPhase] = useState(null); // null | 'recording' | 'stt' | 'chat' | 'tts' | 'playing' | 'error'
  const [v2vError, setV2vError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // BUG-02 FIX: flag para distinguir stop intencional (stopMicMediaRecorder)
  // de stop por VAD — evita processar áudio residual quando V2V é desligado
  const stopIntentionalRef = useRef(false);
  const [mediaRecorderSupported] = useState(!!(
    typeof window !== 'undefined' &&
    window.MediaRecorder &&
    navigator.mediaDevices?.getUserMedia
  ));

  
useEffect(() => {
  let alive = true;

  async function bootstrapUser() {
    const t = getToken();
    const u = getUser();
    const org = getTenant() || "public";
    setToken(t);
    setTenant(org);
    setUser(u);

    if (!t) {
      nav("/auth", { replace: true });
      return;
    }

    try {
      const { data } = await apiFetch("/api/me", { method: "GET", token: t, org });
      if (!alive) return;

      if (data) {
        const mergedUser = {
          ...(u || {}),
          ...data,
          org_slug: data?.org_slug || u?.org_slug || org,
          role: data?.role || u?.role || "user",
          signup_source: data?.signup_source ?? u?.signup_source ?? null,
          signup_code_label: data?.signup_code_label ?? u?.signup_code_label ?? null,
          product_scope: data?.product_scope ?? u?.product_scope ?? null,
          country: data?.country ?? u?.country ?? null,
          language: data?.language ?? u?.language ?? null,
          whatsapp: data?.whatsapp ?? u?.whatsapp ?? null,
          is_admin: hasAdminAccess({
            ...(u || {}),
            ...data,
            role: data?.role || u?.role || "user",
            is_admin: data?.is_admin === true || u?.is_admin === true,
            admin: data?.admin === true || u?.admin === true,
          }),
        };
        mergedUser.admin = mergedUser.is_admin === true;

        setUser(mergedUser);
        try { setSession({ token: t, user: mergedUser, tenant: mergedUser.org_slug || org }); } catch {}

        const explicitlyPending =
          mergedUser?.approved === false ||
          mergedUser?.status === "pending" ||
          mergedUser?.auth_status === "pending_approval" ||
          mergedUser?.pending_approval === true;

        if (explicitlyPending) {
          clearSession();
          nav("/auth?pending_approval=1", { replace: true });
          return;
        }

        if (!mergedUser?.onboarding_completed) {
          setOnboardingForm(sanitizeOnboardingForm(mergedUser));
          setOnboardingOpen(true);
        }

        if (mergedUser?.onboarding_completed) {
          try {
            const alreadyWelcomed = localStorage.getItem("orkio_welcome_shown");
            if (!alreadyWelcomed) {
              const welcomeMsg = {
                id: `welcome-${Date.now()}`,
                role: "assistant",
                content: "Hi — I’m Orkio. You can type your message here, or tap Realtime and speak with me if you're in a quieter environment. I’m ready when you are.",
                agent_name: "Orkio",
                created_at: Math.floor(Date.now() / 1000),
              };
              setMessages((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const hasWelcome = list.some((m) => String(m?.id || "").startsWith("welcome-"));
                return hasWelcome ? list : [...list, welcomeMsg];
              });
              localStorage.setItem("orkio_welcome_shown", "1");
            }
          } catch {}
        }

        if (!mergedUser?.terms_accepted_at) {
          setShowTermsModal(true);
        }

        return;
      }

      if (u) {
        setUser(u);
        setTenant(u?.org_slug || org);
        if (!u?.onboarding_completed) {
          setOnboardingForm(sanitizeOnboardingForm(u));
          setOnboardingOpen(true);
        }
        if (!u?.terms_accepted_at) {
          setShowTermsModal(true);
        }
        return;
      }

      try { clearSession(); } catch {}
      nav("/auth", { replace: true });
    } catch (err) {
      console.warn("bootstrapUser failed", err);

      // Se /api/me falhar na primeira carga, mas já existe token + user local,
      // preserva a sessão local e evita retorno indevido para /auth.
      if (u && t) {
        try {
          setUser(u);
          setTenant(u?.org_slug || org);

          const explicitlyPending =
            u?.approved === false ||
            u?.status === "pending" ||
            u?.auth_status === "pending_approval" ||
            u?.pending_approval === true;

          if (explicitlyPending) {
            clearSession();
            nav("/auth?pending_approval=1", { replace: true });
            return;
          }

          if (!u?.onboarding_completed) {
            setOnboardingForm(sanitizeOnboardingForm(u));
            setOnboardingOpen(true);
          }

          if (u?.onboarding_completed) {
            try {
              const alreadyWelcomed = localStorage.getItem("orkio_welcome_shown");
              if (!alreadyWelcomed) {
                const welcomeMsg = {
                  id: `welcome-${Date.now()}`,
                  role: "assistant",
                  content: "Hi — I’m Orkio. You can type your message here, or tap Realtime and speak with me if you're in a quieter environment. I’m ready when you are.",
                  agent_name: "Orkio",
                  created_at: Math.floor(Date.now() / 1000),
                };
                setMessages((prev) => {
                  const list = Array.isArray(prev) ? prev : [];
                  const hasWelcome = list.some((m) => String(m?.id || "").startsWith("welcome-"));
                  return hasWelcome ? list : [...list, welcomeMsg];
                });
                localStorage.setItem("orkio_welcome_shown", "1");
              }
            } catch {}
          }

          if (!u?.terms_accepted_at) {
            setShowTermsModal(true);
          }
        } catch {}
      } else {
        try { clearSession(); } catch {}
        if (alive) {
          setOnboardingOpen(false);
          setOnboardingChecked(true);
        }
        nav("/auth", { replace: true });
        return;
      }
    } finally {
      if (alive) setOnboardingChecked(true);
    }
  }

  bootstrapUser();
  return () => { alive = false; };
}, []);



  useEffect(() => {
    const onResize = () => {
      try { setIsMobile(window.innerWidth <= 820); } catch {}
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileThreadsOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!ENABLE_VOICE) {
      setVoiceMode(false);
      voiceModeRef.current = false;
      return;
    }
    setVoiceMode(true);
    voiceModeRef.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        await apiFetch("/api/health", { token, org: tenant });
        if (!cancelled) setHealth("ok");
      } catch {
        if (!cancelled) setHealth("down");
      }
    }

    if (token) checkHealth();

    return () => {
      cancelled = true;
    };
  }, [token, tenant]);

  function scrollToBottom() {
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {}
  }

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    function onKeyDown(e) {
      if (!realtimeModeRef.current) return;
      if (!rtcReadyToRespond) return;
      // Don't hijack typing in inputs/textarea/contenteditable
      const el = document.activeElement;
      const tag = el?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || el?.isContentEditable;
      if (isTyping) return;

      if (e.code === "Space" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        triggerRealtimeResponse("hotkey");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rtcReadyToRespond]);
  useEffect(() => { messagesRef.current = (messages || []); }, [messages]);

useEffect(() => {
  if (typeof window === "undefined" || !window.visualViewport) return undefined;
  const vv = window.visualViewport;
  const updateViewportOffset = () => {
    try {
      const keyboardOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setComposerViewportOffset(keyboardOffset);
    } catch {
      setComposerViewportOffset(0);
    }
  };
  updateViewportOffset();
  vv.addEventListener("resize", updateViewportOffset);
  vv.addEventListener("scroll", updateViewportOffset);
  window.addEventListener("orientationchange", updateViewportOffset);
  return () => {
    vv.removeEventListener("resize", updateViewportOffset);
    vv.removeEventListener("scroll", updateViewportOffset);
    window.removeEventListener("orientationchange", updateViewportOffset);
  };
}, []);


  async function loadThreads() {
    try {
      const { data } = await apiFetch("/api/threads", { token, org: tenant });
      setThreads(data || []);
      if (!threadId && data?.[0]?.id) setThreadId(data[0].id);
    } catch (e) {
      console.warn("loadThreads non-fatal error:", e?.message || e);

      const status = Number(e?.status || e?.response?.status || 0);
      if (status === 401) {
        clearSession();
        nav("/auth", { replace: true });
        return;
      }

      setThreads([]);
    }
  }

  async function loadMessages(tid) {
    if (!tid) return [];
    try {
      const { data } = await apiFetch(`/api/messages?thread_id=${encodeURIComponent(tid)}&include_welcome=0`, { token, org: tenant });
      setMessages(data || []);
      return (data || []);
    } catch (e) {
      console.error("loadMessages error:", e);
      return [];
    }
  }

  async function loadAgents() {
    try {
      const { data } = await apiFetch("/api/agents", { token, org: tenant });
      setAgents(data || []);
      try {
        const m = new Map();
        (data || []).forEach(a => { if (a?.name) m.set(String(a.name).trim(), a.id); });
        agentsByNameRef.current = m;
      } catch {}

      // Default destination (single) to Orkio if exists
      if (!destSingle && Array.isArray(data)) {
        const orkio = data.find(a => (a.name || "").toLowerCase() === "orkio") || data.find(a => a.is_default);
        if (orkio) setDestSingle(orkio.id);
      }
    } catch (e) {
      console.error("loadAgents error:", e);
    }
  }

  useEffect(() => {
    if (!token || !onboardingChecked || onboardingOpen) return;
    loadThreads();
    loadAgents();
  }, [token, tenant, onboardingChecked, onboardingOpen]);

  useEffect(() => { if (threadId) loadMessages(threadId); }, [threadId]);






  async function createThread() {
    try {
      const { data } = await apiFetch("/api/threads", {
        method: "POST",
        token,
        org: tenant,
        body: { title: "Nova conversa" },
      });
      if (data?.id) {
        await loadThreads();
        setThreadId(data.id);
        if (isMobile) setMobileThreadsOpen(false);
      }
    } catch (e) {
      alert(e?.message || "Falha ao criar conversa");
    }
  }

  async function deleteThread(threadId) {
    if (!threadId) return;
    if (!confirm('Deletar esta conversa?')) return;
    try {
      await apiFetch(`/api/threads/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
        token,
        org: tenant,
      });
      // Reload threads and pick a safe next one
      const { data } = await apiFetch("/api/threads", { token, org: tenant });
      const list = data || [];
      setThreads(list);
      const nextId = list?.[0]?.id || "";
      setThreadId(nextId);
      if (nextId) await loadMessages(nextId);
      else setMessages([]);
    } catch (e) {
      console.error("deleteThread error:", e);
      alert(e?.message || "Falha ao deletar conversa");
    }
  }

  async function renameThread(tid) {
    const t = threads.find((x) => x.id === tid);
    const current = t?.title || "Nova conversa";
    const next = prompt("Renomear conversa:", current);
    if (!next) return;
    try {
      await apiFetch(`/api/threads/${encodeURIComponent(tid)}`, {
        method: "PATCH",
        token,
        org: tenant,
        body: { title: next },
      });
      await loadThreads();
    } catch (e) {
      alert(e?.message || "Falha ao renomear");
    }
  }

  function goToAdminConsole() {
    nav("/admin");
  }

  async function doLogout() {
    try {
      await logout({ org: tenant, token });
    } finally {
      clearSession();
      nav("/auth");
    }
  }

  function openSettings() {
    setSettingsStatus("");
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowNewPasswordConfirm(false);
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (settingsBusy) return;
    setSettingsOpen(false);
    setSettingsStatus("");
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowNewPasswordConfirm(false);
  }

  async function submitPasswordChange() {
    if (settingsBusy) return;

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setSettingsStatus("Please fill in all password fields.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setSettingsStatus("New password confirmation does not match.");
      return;
    }

    setSettingsBusy(true);
    setSettingsStatus("Updating password...");

    try {
      const resp = await apiFetch("/api/auth/change-password", {
        method: "POST",
        token,
        org: tenant,
        body: {
          current_password: currentPassword,
          new_password: newPassword,
          new_password_confirm: newPasswordConfirm,
        },
      });

      setSettingsStatus(resp?.data?.message || "Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowNewPasswordConfirm(false);
    } catch (e) {
      setSettingsStatus(e?.message || e?.detail || "Unable to update password.");
    } finally {
      setSettingsBusy(false);
    }
  }

  function buildMessagePrefix() {
    if (destMode === "team") return "@Team ";
    if (destMode === "single") {
      const ag = agents.find(a => a.id === destSingle);
      return ag ? `@${ag.name} ` : "";
    }
    if (destMode === "multi") {
      const names = agents.filter(a => destMulti.includes(a.id)).map(a => a.name);
      if (!names.length) return "@Team ";
      // backend parser supports @Name tokens; join them
      return names.map(n => `@${n}`).join(" ") + " ";
    }
    return "";
  }


  function appendToPlaceholder(delta) {
    if (!delta) return;

    setMessages((prev) => {
      const messages = Array.isArray(prev) ? [...prev] : [];

      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];

        if (
          m?.role === "assistant" &&
          String(m?.id || "").startsWith("tmp-ass-")
        ) {
          const oldContent =
            m.content === "⌛ Preparando resposta..."
              ? ""
              : (m.content || "");

          messages[i] = {
            ...m,
            content: oldContent + delta,
          };

          return messages;
        }
      }

      messages.push({
        id: `tmp-ass-${Date.now()}`,
        role: "assistant",
        content: delta,
        agent_name: "Orkio",
        created_at: Math.floor(Date.now() / 1000),
      });

      return messages;
    });
  }

  async function sendMessage(presetMsg = null, opts = {}) {
    const isRetry = !!opts?.isRetry;
    clearRealtimeIdleFollowup();
    const msg = ((presetMsg ?? text) || "").trim();
    if (!msg || sending) return;
    setSending(true);

    // STREAM-STAB: start new run and abort any previous stream
    streamRunRef.current += 1;
    const myRun = streamRunRef.current;
    try { streamCtlRef.current?.abort(); } catch {}
    const ctl = new AbortController();
    streamCtlRef.current = ctl;
    const isStale = () => (myRun !== streamRunRef.current || ctl.signal.aborted);

    // UX: show progress while waiting
    try { setUploadStatus('⌛ Gerando resposta...'); } catch {}

    try {
      const pref = buildMessagePrefix();
      const finalMsg = pref + msg;

      const runtimeIsSummit = summitRuntimeModeRef.current === "summit";
      const isInstitutionalTurn = destMode === "team" || !!opts?.realtimeTurn || runtimeIsSummit;
      const agentIdToSend = isInstitutionalTurn ? null : (destSingle || null);

      // optimistic message
      if (!isRetry) {
      setMessages((prev) => [...prev, {
              id: `tmp-${Date.now()}`,
              role: "user",
              content: msg,
              user_name: user?.name || user?.email,
              created_at: Math.floor(Date.now() / 1000),
            }]);
      
            // optimistic assistant placeholder (improves UX in slow voice/audio)
            setMessages((prev) => [...prev, {
              id: `tmp-ass-${Date.now()}`,
              role: 'assistant',
              content: '⌛ Preparando resposta...',
              agent_name: 'Orkio',
              created_at: Math.floor(Date.now() / 1000),
            }]);
            setText("");
    }

      // V2V-PATCH: gerar trace_id por tentativa de V2V (correlaciona logs backend)
      const traceId = `v2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const clientMessageId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (`cm-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
      v2vTraceRef.current = traceId;
      setV2vPhase('chat');
      setV2vError(null);

      const shouldUseStream = !!opts?.useStream || !!opts?.realtimeTurn;
      let resp = null;
      let newThreadId = threadId;
      let freshMessages = null;
      let streamLastAgentInfo = null;

      if (shouldUseStream) {
        const streamResp = await chatStream({
          token,
          org: tenant,
          thread_id: threadId,
          message: finalMsg,
          agent_id: agentIdToSend,
          trace_id: traceId,
          client_message_id: clientMessageId,
          signal: ctl.signal,
        });

        const reader = streamResp?.body?.getReader?.();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        const streamDraftByAgent = new Map();

        const applyStreamDraft = (agentId, agentName, content) => {
          const safeAgentId = String(agentId || "orkio");
          const safeAgentName = agentName || "Orkio";
          setMessages((prev) => {
            const list = Array.isArray(prev) ? [...prev] : [];
            const idx = list.findIndex((m) => m?.id === `tmp-stream-${safeAgentId}`);
            const draft = {
              id: `tmp-stream-${safeAgentId}`,
              role: "assistant",
              content: content || "⌛ Preparando resposta...",
              agent_id: agentId || null,
              agent_name: safeAgentName,
              created_at: Math.floor(Date.now() / 1000),
            };
            if (idx >= 0) list[idx] = draft;
            else list.push(draft);
            return list;
          });
        };

        const processSseBlock = (block) => {
          const lines = String(block || "").split(/\r?\n/);
          let eventName = "message";
          let dataText = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) dataText += line.slice(5).trim();
          }
          if (!dataText) return false;
          let payload = null;
          try { payload = JSON.parse(dataText); } catch { return false; }

          if (payload?.thread_id) newThreadId = payload.thread_id;
          if (payload?.agent_id || payload?.agent_name) {
            streamLastAgentInfo = {
              agent_id: payload?.agent_id || null,
              agent_name: payload?.agent_name || "Orkio",
              voice_id: payload?.voice_id || null,
              avatar_url: payload?.avatar_url || null,
            };
          }

          if (eventName === "status") {
            const who = payload?.agent_name || payload?.label || "agente";
            try { setUploadStatus(`🤖 ${who} pensando...`); } catch {}
            return false;
          }

          if (eventName === "chunk") {
            const aid = String(payload?.agent_id || "orkio");
            const current = streamDraftByAgent.get(aid) || "";
            const next = current + String(payload?.delta || payload?.content || "");
            streamDraftByAgent.set(aid, next);
            applyStreamDraft(payload?.agent_id || null, payload?.agent_name || "Orkio", next);
            return false;
          }

          if (eventName === "agent_done") {
            return false;
          }

          if (eventName === "done") {
            rtcInstitutionalTurnInFlightRef.current = false;
            return true;
          }

          if (eventName === "error") {
            rtcInstitutionalTurnInFlightRef.current = false;
            const err = new Error(payload?.message || payload?.error || "stream error");
            err.status = payload?.status || 500;
            throw err;
          }

          return false;
        };

        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const blocks = sseBuffer.split(/\r?\n\r?\n/);
            sseBuffer = blocks.pop() || "";
            for (const block of blocks) {
              if (isStale()) return;
              const reachedDone = processSseBlock(block);
              if (reachedDone) break;
            }
          }
        }

        if (sseBuffer.trim()) {
          try { processSseBlock(sseBuffer); } catch (streamErr) { throw streamErr; }
        }

        const effectiveTidForLoad = newThreadId || threadId;
        if (effectiveTidForLoad && effectiveTidForLoad !== threadId) {
          setThreadId(effectiveTidForLoad);
        }
        freshMessages = await loadMessages(effectiveTidForLoad);
        if (streamLastAgentInfo) {
          setLastAgentInfo(streamLastAgentInfo);
        }
      } else {
        resp = await chat({
          token,
          org: tenant,
          thread_id: threadId,
          message: finalMsg,
          agent_id: agentIdToSend,
          trace_id: traceId,
          client_message_id: clientMessageId,
          signal: ctl.signal,
        });

        if (resp?.status === 429) {
          closeCapacityModal();
          openCapacityModal(msg);
          return;
        }

         // V2V-PATCH: se fallback /api/chat criou thread, capturar thread_id do resp
         if (resp?.data?.thread_id) newThreadId = resp.data.thread_id;
        const effectiveTidForLoad = newThreadId || threadId;
        if (effectiveTidForLoad && effectiveTidForLoad !== threadId) {
          setThreadId(effectiveTidForLoad);
        }
        freshMessages = await loadMessages(effectiveTidForLoad);

        // PATCH0100_14: store agent info from response
        if (resp?.data) {
          const ai = { agent_id: resp.data.agent_id, agent_name: resp.data.agent_name, voice_id: resp.data.voice_id, avatar_url: resp.data.avatar_url };
          setLastAgentInfo(ai);
        }
      }
      // V2V-PATCH: Auto-play TTS — fase TTS + fase playing com trace_id
      if (voiceModeRef.current || !!opts?.explicitVoiceRequested || !!opts?.voiceRequested || !!opts?.realtimeTurn) {
        if (micEnabledRef.current) stopMic();
        const prevLast = messagesRef.current?.slice?.().reverse?.().find?.(m => m.role === "assistant" && !String(m?.id||"").startsWith("tmp-ass-"))?.created_at || null;
        const fresh = (freshMessages || []);
        const assistants = (fresh || []).filter(m => m.role === "assistant" && !String(m.id || "").startsWith("tmp-ass-"));
        let toSpeak = assistants;
        if (prevLast) {
          // F-04: epoch Unix (segundos) → ms para JS
          const prevT = new Date((prevLast || 0) * 1000).getTime();
          toSpeak = assistants.filter(m => {
            const t = new Date((m.created_at || 0) * 1000).getTime();
            // BUG-03 FIX: filtro estrito (>) — não incluir a msg anterior (prevT)
            return isFinite(t) && t >= (prevT - 1000);
          });
        } else {
          toSpeak = assistants.slice(-1);
        }

        // Team: fala cada mensagem sequencialmente com voz correta por agente
        // Single: só a última
        if (destMode !== "team" && toSpeak.length > 1) toSpeak = toSpeak.slice(-1);

        const currentTrace = v2vTraceRef.current || traceId;
        const shouldAutoSpeakThisTurn =
          !!opts?.explicitVoiceRequested ||
          !!opts?.voiceRequested ||
          !!opts?.realtimeTurn;

        for (const m of toSpeak) {
          const content = (m.content || "").trim();
          if (!content) continue;
          if (!shouldAutoSpeakThisTurn) continue;
          const agentIdFallback = m.agent_id || null;
          // preferir message_id (backend resolve voz); agent_id só como fallback
          setV2vPhase('tts');
          try { setUploadStatus(`🔊 Gerando voz (${m.agent_name || 'agente'})...`); } catch {}
          await playTts(content, agentIdFallback, {
            forceAuto: true,
            messageId: m.id || null,
            traceId: currentTrace,
          });
        }
        setV2vPhase(null);
        setV2vError(null);
        // BUG-01 FIX: fallback — se playTts não reiniciou o mic (ex: autoplay bloqueado)
        // garantir que o ciclo V2V continua ouvindo
        if (voiceModeRef.current && !micEnabledRef.current) {
          setTimeout(() => startMic(), 300);
        }
      }

    } catch (e) {
      rtcInstitutionalTurnInFlightRef.current = false;
      console.error("[V2V] sendMessage error:", e);
      setV2vPhase('error');
      // BUG-04 FIX: trocar alert() por setV2vError — alert() bloqueia JS thread
      // e impede o V2V de reiniciar o microfone
      setV2vError(e?.message || "Falha ao enviar mensagem");
    } finally {
      rtcInstitutionalTurnInFlightRef.current = false;
      setSending(false);
      try { if (!ttsPlaying) setUploadStatus(''); } catch {}
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Voice recognition helpers
  function ensureSpeech() {
    if (!speechSupported) return null;
    if (speechRef.current) return speechRef.current;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = SPEECH_RECOGNITION_LANG;
    rec.interimResults = true;
    rec.continuous = true;
    speechRef.current = rec;
    return rec;
  }

  function stopMic() {
    micEnabledRef.current = false;
    setMicEnabled(false);
    // V2V-PATCH: parar MediaRecorder se ativo
    stopMicMediaRecorder();
    // parar SpeechRecognition se ativo
    const rec = speechRef.current;
    if (rec) {
      try { rec.onend = null; rec.stop(); } catch {}
    }
  }

  // V2V-PATCH: startMic usa MediaRecorder (webm/opus) quando disponível.
  // MediaRecorder → /api/stt (Whisper) → texto → sendMessage()
  // Fallback: SpeechRecognition (Chrome-only) → texto → sendMessage()
  function startMic() {
    micEnabledRef.current = true;
    setMicEnabled(true);
    setV2vError(null);

    // ── Caminho 1: MediaRecorder (todos os browsers modernos, qualidade superior) ──
    if (mediaRecorderSupported) {
      navigator.mediaDevices.getUserMedia(buildPreferredMicConstraints())
        .then(async (stream) => {
          if (!micEnabledRef.current) {
            try { recordStream?.getTracks?.().forEach((t) => t.stop()); } catch {}
            try { if (processed?.rawStream) processed.rawStream.getTracks?.().forEach((t) => t.stop()); } catch {}
            try { processed?.ctx?.close?.(); } catch {}
            return;
          }

          const rawTrack = stream.getAudioTracks?.()[0] || stream.getTracks?.()[0] || null;
          await applyBestEffortMicTrackConstraints(rawTrack);

          let recordStream = stream;
          const processed = await createProcessedMicPath(stream, {
            inputGain: 0.58,
            highpassHz: 120,
            lowpassHz: 4200,
            threshold: -28,
            knee: 18,
            ratio: 8,
            attack: 0.003,
            release: 0.2,
            makeupGain: 0.92,
          });
          if (processed?.stream) {
            recordStream = processed.stream;
          }

          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

          const mr = new MediaRecorder(recordStream, { mimeType });
          mediaRecorderRef.current = mr;
          audioChunksRef.current = [];

          mr.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
          };

          mr.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            // BUG-02 FIX: stop intencional (stopMicMediaRecorder) → descartar chunks
            if (stopIntentionalRef.current) {
              stopIntentionalRef.current = false;
              audioChunksRef.current = [];
              return;
            }
            if (!micEnabledRef.current && !voiceModeRef.current) return;

            const chunks = audioChunksRef.current;
            audioChunksRef.current = [];
            if (!chunks.length) return;

            const blob = new Blob(chunks, { type: mimeType });
            if (blob.size < 500) {
              console.warn('[V2V] áudio muito curto, ignorando');
              return;
            }

            const trace = `v2v-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
            v2vTraceRef.current = trace;
            setV2vPhase('stt');
            setUploadStatus('🎙️ Transcrevendo fala...');

            console.info('[V2V] v2v_record_received trace_id=%s size=%d', trace, blob.size);

            try {
              const sttLang = (window.__ORKIO_ENV__?.VITE_STT_LANGUAGE || window.__ORKIO_ENV__?.VITE_REALTIME_TRANSCRIBE_LANGUAGE || import.meta.env.VITE_STT_LANGUAGE || import.meta.env.VITE_REALTIME_TRANSCRIBE_LANGUAGE || "pt").trim();
              const result = await transcribeAudio(blob, { token, org: tenant, trace_id: trace, language: sttLang || null });
              const text = (result?.text || '').trim();
              console.info('[V2V] v2v_stt_ok trace_id=%s chars=%d preview=%s', trace, text.length, text.slice(0, 60));

              if (!text) {
                console.warn('[V2V] v2v_stt_fail trace_id=%s reason=empty_transcript', trace);
                setV2vPhase('error');
                setV2vError('Nenhum texto reconhecido. Fale novamente.');
                setUploadStatus('⚠️ Fala não reconhecida. Tente novamente.');
                setTimeout(() => setUploadStatus(''), 2500);
                // Reiniciar escuta
                if (micEnabledRef.current && voiceModeRef.current) {
                  setTimeout(() => startMic(), 800);
                }
                return;
              }

              const finalTranscript = text;
              setText(finalTranscript);
              setV2vPhase('chat');

              if (micEnabledRef.current) {
                micEnabledRef.current = false;
                setMicEnabled(false);
              }

              setUploadStatus(`🎙️ "${finalTranscript.slice(0, 50)}${finalTranscript.length > 50 ? '…' : ''}" — enviando...`);
              sendMessage(finalTranscript);
              setTimeout(() => setUploadStatus(""), 2800);
            } catch (e) {
              console.error('[V2V] v2v_stt_fail trace_id=%s error:', trace, e);
              setV2vPhase('error');
              setV2vError(`STT falhou: ${e?.message || 'erro desconhecido'}`);
              setUploadStatus(`❌ STT: ${e?.message || 'Erro de transcrição'}`);
              setTimeout(() => setUploadStatus(''), 3000);
            }
          };

          // Gravar em segmentos de 4s — silêncio detectado por VAD simples (tamanho do chunk)
          mr.start(100); // PATCH0100_24D: smaller chunks for better VAD // coleta chunks a cada 4s

          // Auto-stop após 30s máximo ou quando detectar silêncio
          let silenceTimer = null;
          let lastSize = 0;

          // PATCH0100_24D: VAD menos agressivo (1.5s de silêncio consecutivo)
          let consecutiveSilences = 0;

          const checkSilence = setInterval(() => {
            const currentSize = audioChunksRef.current.reduce((s, c) => s + c.size, 0);
            const delta = currentSize - lastSize;
            lastSize = currentSize;

            // Espera acumular um mínimo de áudio e só encerra após 3 janelas silenciosas (~1.5s)
            if (currentSize > 3000 && delta < 500) {
              consecutiveSilences += 1;
            } else {
              consecutiveSilences = 0;
            }

            if (consecutiveSilences >= 3) {
              clearInterval(checkSilence);
              if (silenceTimer) clearTimeout(silenceTimer);
              try { mr.stop(); } catch {}
            }
          }, 500);

          silenceTimer = setTimeout(() => {
            clearInterval(checkSilence);
            if (mr.state === 'recording') {
              try { mr.stop(); } catch {}
            }
          }, 30000);

          mr.onerror = (e) => {
            clearInterval(checkSilence);
            clearTimeout(silenceTimer);
            try { recordStream?.getTracks?.().forEach((t) => t.stop()); } catch {}
            try { if (processed?.rawStream) processed.rawStream.getTracks?.().forEach((t) => t.stop()); } catch {}
            try { processed?.ctx?.close?.(); } catch {}
            console.error('[V2V] MediaRecorder error:', e);
            micEnabledRef.current = false;
            setMicEnabled(false);
            setV2vPhase('error');
            setV2vError('Erro no microfone. Verifique permissões.');
          };
        })
        .catch(err => {
          console.warn('[V2V] getUserMedia falhou, fallback SpeechRecognition:', err?.message);
          micEnabledRef.current = false;
          setMicEnabled(false);
          // fallback para SpeechRecognition
          _startSpeechRecognition();
        });
      return;
    }

    // ── Caminho 2: SpeechRecognition (fallback Chrome/Edge) ──
    _startSpeechRecognition();
  }

  function stopMicMediaRecorder() {
    // PATCH0100_24D: não zerar chunks antes do onstop (race condition)
    // BUG-02 FIX: sinalizar stop intencional para que onstop descarte os chunks
    stopIntentionalRef.current = true;
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    // NÃO limpar audioChunksRef aqui: o handler onstop consome os chunks.
    if (mr && mr.state === 'recording') {
      try { mr.stop(); } catch {}
    }
  }

  function _startSpeechRecognition() {
    const rec = ensureSpeech();
    if (!rec) {
      setV2vError('Microfone não disponível neste browser. Use Chrome ou ative permissões.');
      micEnabledRef.current = false;
      setMicEnabled(false);
      return;
    }

    let finalText = "";
    let autoSendTimer = null;
    rec.onresult = (evt) => {
      let interim = "";
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const transcript = evt.results[i][0].transcript;
        if (evt.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      const merged = (finalText || interim || "").trim();
      if (merged) setText(merged);

      if (voiceModeRef.current && finalText.trim()) {
        if (autoSendTimer) clearTimeout(autoSendTimer);
        autoSendTimer = setTimeout(() => {
          const toSend = finalText.trim();
          if (toSend && voiceModeRef.current) {
            finalText = "";
            try { rec.stop(); } catch {}
            micEnabledRef.current = false;
            setMicEnabled(false);
            sendMessage(toSend);
          }
        }, 1500);
      }
    };

    rec.onerror = () => { /* keep enabled; onend will handle retry */ };

    rec.onend = () => {
      if (!micEnabledRef.current) return;
      const now = Date.now();
      const st = micRetryRef.current;
      if (now - st.lastTry > 20000) { st.tries = 0; }
      st.lastTry = now;
      st.tries += 1;
      if (st.tries > 3) {
        micEnabledRef.current = false;
        setMicEnabled(false);
        setUploadStatus("Microfone pausou. Clique no 🎙️ para retomar.");
        setTimeout(() => setUploadStatus(""), 2500);
        return;
      }
      setTimeout(() => {
        if (micEnabledRef.current) { try { rec.start(); } catch {} }
      }, 300);
    };

    try { rec.start(); } catch {}
  }

  function toggleMic() {
    if (!ENABLE_VOICE) return;
    if (!mediaRecorderSupported && !speechSupported) return;
    if (micEnabled) {
      stopMic();
      return;
    }
    if (realtimeModeRef.current) {
      void stopRealtime("voice_manual_selected");
      setRealtimeMode(false);
      realtimeModeRef.current = false;
    }
    setVoiceMode(true);
    voiceModeRef.current = true;
    startMic();
  }

  // PATCH0100_13: Voice Mode helpers
  function toggleVoiceMode() {
    if (!ENABLE_VOICE) return;
    const next = !voiceMode;
    if (next && realtimeModeRef.current) {
      void stopRealtime('voice_mode_selected');
      setRealtimeMode(false);
      realtimeModeRef.current = false;
    }
    setVoiceMode(next);
    voiceModeRef.current = next;
    if (next) {
      setV2vPhase(null);
      setV2vError(null);
      const canRecord = mediaRecorderSupported;
      if (canRecord && !micEnabled) startMic();
      const modeLabel = 'MediaRecorder + STT';
      setUploadStatus(`Voice mode active (${modeLabel}) — speak naturally and Orkio will answer out loud.`);
      setTimeout(() => setUploadStatus(''), 4000);
    } else {
      if (micEnabled) stopMic();
      stopTts();
      setV2vPhase(null);
      setV2vError(null);
      setUploadStatus('');
    }
  }



function inferInterestType(raw) {
  const s = (raw || "").toLowerCase();
  if (/(invest|aportar|aporte|funding|investor)/i.test(s)) return "investor";
  if (/(comprar|contratar|adquirir|saas|demo|pricing|plan|plano)/i.test(s)) return "sales";
  if (/(parceria|partner|partnership)/i.test(s)) return "partnership";
  return "general";
}

function buildFounderHandoffMessage() {
  const draft = (text || "").trim();
  if (draft) return draft;
  const lastUser = [...(messagesRef.current || [])].reverse().find((m) => m?.role === "user" && (m?.content || "").trim());
  return (lastUser?.content || "The user would like to speak with Daniel about a strategic opportunity.").trim();
}

function handleFounderHandoff() {
  const message = buildFounderHandoffMessage();
  if (!message || handoffBusy) return;
  setHandoffDraft(message);
  setHandoffInterestType(inferInterestType(message));
  setShowHandoffModal(true);
}

async function confirmFounderHandoff() {
  const message = (handoffDraft || buildFounderHandoffMessage()).trim();
  if (!message || handoffBusy) return;
  setHandoffBusy(true);
  setHandoffNotice("");
  try {
    await requestFounderHandoff({
      token,
      org: tenant,
      thread_id: threadId || null,
      interest_type: handoffInterestType || inferInterestType(message),
      message,
      source: "app_console",
      consent_contact: true,
    });
    setShowHandoffModal(false);
    setHandoffDraft("");
    setHandoffNotice("Founder follow-up requested. Daniel will review the context and continue with the right next step.");
    setTimeout(() => setHandoffNotice(""), 6000);
  } catch (e) {
    const detail = typeof e?.message === "string" ? e.message : "Could not request founder follow-up.";
    setHandoffNotice(detail);
    setTimeout(() => setHandoffNotice(""), 6000);
  } finally {
    setHandoffBusy(false);
  }
}



  function clearRealtimeResponseTimeout() {
    if (rtcResponseTimeoutRef.current) {
      try { clearTimeout(rtcResponseTimeoutRef.current); } catch {}
      rtcResponseTimeoutRef.current = null;
    }
  }


function clearRealtimeIdleFollowup() {
  if (rtcIdleFollowupTimerRef.current) {
    try { clearTimeout(rtcIdleFollowupTimerRef.current); } catch {}
    rtcIdleFollowupTimerRef.current = null;
  }
}

function markRealtimeUserActivity() {
  rtcLastUserActivityAtRef.current = Date.now();
  rtcIdleFollowupSentRef.current = false;
  clearRealtimeIdleFollowup();
}

function scheduleRealtimeIdleFollowup() {
  clearRealtimeIdleFollowup();
  if (REALTIME_INSTITUTIONAL_MODE) return;
  if (!REALTIME_IDLE_FOLLOWUP_ENABLED) return;
  if (!realtimeModeRef.current) return;

  const assistantAgentId = destSingle || null;
  const displayName = resolveRealtimeIdleDisplayName(user);
  rtcIdleFollowupTimerRef.current = setTimeout(async () => {
    try {
      if (!realtimeModeRef.current) return;
      if (rtcIdleFollowupSentRef.current) return;
      const idleFor = Date.now() - (rtcLastUserActivityAtRef.current || 0);
      if (idleFor < REALTIME_IDLE_FOLLOWUP_MS) return;

      rtcIdleFollowupSentRef.current = true;
      const prompt = displayName
        ? `${displayName}, você ainda está online? Estou aqui caso queira continuar.`
        : "Você ainda está comigo? Estou aqui caso queira continuar.";

      const mid = `rtc_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      setMessages((prev) => prev.concat([{
        id: mid,
        role: "assistant",
        content: prompt,
        agent_id: assistantAgentId ? String(assistantAgentId) : null,
        agent_name: "Orkio",
        created_at: Math.floor(Date.now()/1000),
      }]));
      queueRealtimeEvent({ event_type: 'response.final', role: 'assistant', content: prompt, is_final: true, meta: { source: 'idle_followup', message_id: mid } });

      try {
        await playTts(prompt, assistantAgentId, { forceAuto: true });
      } catch (err) {
        console.warn("[Realtime] idle follow-up tts failed", err);
      }
    } catch (err) {
      console.warn("[Realtime] idle follow-up failed", err);
    }
  }, REALTIME_IDLE_FOLLOWUP_MS);
}


  async function activateSilentRealtimeFallback(reason = "realtime_fallback", options = {}) {
    const shouldDisarm = options?.disarm !== false;
    if (rtcFallbackActiveRef.current && shouldDisarm) return;
    rtcFallbackActiveRef.current = true;
    clearRealtimeResponseTimeout();
    clearRealtimeIdleFollowup();
    logRealtimeStep("fallback:activate", { reason, shouldDisarm });
    try { await stopRealtime(reason); } catch {}
    if (shouldDisarm) {
      setRealtimeMode(false);
      realtimeModeRef.current = false;
      setV2vPhase("fallback");
      setUploadStatus("Realtime fallback active.");
      setTimeout(() => setUploadStatus(""), 1200);
      try {
        setVoiceMode(true);
        voiceModeRef.current = true;
        if (!micEnabledRef.current) startMic();
      } catch {}
    } else {
      setV2vPhase("error");
      setUploadStatus(`❌ Realtime diagnostic: ${reason}`);
      setTimeout(() => setUploadStatus(""), 2500);
    }
  }

  async function guardAndMaybeBlockRealtimeTranscript(raw) {
    const message = (raw || "").toString().trim();
    if (!message) return false;
    try {
      const res = await guardRealtimeTranscript({ thread_id: rtcThreadIdRef.current || threadId || null, message });
      const payload = res?.data || {};
      if (!payload?.blocked) return false;
      setRtcReadyToRespond(false);
      rtcLastFinalTranscriptRef.current = "";
      queueRealtimeEvent({ event_type: "response.final", role: "assistant", content: payload.reply || "", is_final: true, meta: { source: "server_guard" } });
      commitRealtimeAssistantFinal(payload.reply || "", { source: "server_guard" });
      return true;
    } catch (err) {
      console.warn("[Realtime] guard check failed", err);
      return false;
    }
  }

  async function startRealtime() {
    if (rtcConnectingRef.current) {
      console.warn("[Realtime] start skipped: already connecting");
      logRealtimeStep("start:skip_connecting");
      return;
    }

    if (rtcSessionIdRef.current && rtcPcRef.current && rtcDcRef.current) {
      console.warn("[Realtime] start skipped: active session already present", { sessionId: rtcSessionIdRef.current });
      logRealtimeStep("start:skip_active_session", { sessionId: rtcSessionIdRef.current });
      return;
    }

    rtcConnectingRef.current = true;

    try {
      try { console.log("REALTIME_START_BEGIN", { threadId, destSingle, sessionId: rtcSessionIdRef.current || null }); } catch {}
      logRealtimeStep('start:begin', { threadId, destSingle, summitRuntimeMode: summitRuntimeModeRef.current, summitLanguageProfile: summitLanguageProfileRef.current });
      setV2vError(null);
      setV2vPhase('connecting');
      setUploadStatus('⚡ Conectando Realtime (WebRTC)...');

      if (rtcSessionIdRef.current) {
        await stopRealtime('restart_existing_session');
      } else if (rtcPcRef.current || rtcDcRef.current || rtcAudioElRef.current) {
        try { rtcDcRef.current?.close?.(); } catch {}
        rtcDcRef.current = null;
        try { rtcPcRef.current?.close?.(); } catch {}
        rtcPcRef.current = null;
        try {
          const staleAudio = rtcAudioElRef.current;
          if (staleAudio) {
            try { staleAudio.pause?.(); } catch {}
            try { staleAudio.srcObject = null; } catch {}
            try { staleAudio.remove?.(); } catch {}
          }
        } catch {}
        rtcAudioElRef.current = null;
      }

      try { setRtcAuditEvents([]); } catch {}
      try { setRtcPunctStatus(null); } catch {}
      try { setSummitSessionScore(null); } catch {}


      const ORKIO_ENV = (typeof window !== "undefined" && window.__ORKIO_ENV__) ? window.__ORKIO_ENV__ : {};
      const envVoice = (ORKIO_ENV.VITE_REALTIME_VOICE || import.meta.env.VITE_REALTIME_VOICE || "").trim();
      const rtModel = (ORKIO_ENV.VITE_REALTIME_MODEL || import.meta.env.VITE_REALTIME_MODEL || "gpt-realtime-mini").trim();
      const magicEnabled = (ORKIO_ENV.VITE_REALTIME_MAGICWORDS || import.meta.env.VITE_REALTIME_MAGICWORDS || "true").toString().trim().toLowerCase() !== "false";
      rtcMagicEnabledRef.current = magicEnabled;

      // PATCH realtime bootstrap: define routing before using agentIdToSend
      const runtimeMode = summitRuntimeModeRef.current === "summit" ? "summit" : "platform";
      const isInstitutionalSession = destMode === "team" || runtimeMode === "summit";
      const agentIdToSend = isInstitutionalSession ? null : (destSingle || null);

      // Voice priority: agent.voice_id (Admin) > env default > fallback ("cedar")
      const selectedAgentObj = (agents || []).find(a => String(a.id) === String(agentIdToSend));
      const agentVoice = ((selectedAgentObj?.voice_id || selectedAgentObj?.voice || selectedAgentObj?.tts_voice || selectedAgentObj?.voiceId || "")).toString().trim();
      const rtVoice = coerceVoiceId(agentVoice || envVoice || "cedar");
      rtcVoiceRef.current = rtVoice;

      const languageProfile = (summitLanguageProfileRef.current || "auto").trim() || "auto";
      const start = runtimeMode === "summit"
        ? await startSummitSession({
            agent_id: agentIdToSend,
            thread_id: threadId || null,
            voice: rtVoice,
            model: rtModel,
            ttl_seconds: 600,
            mode: "summit",
            response_profile: "stage",
            language_profile: languageProfile,
          })
        : await startRealtimeSession({ agent_id: agentIdToSend, thread_id: threadId || null, voice: rtVoice, model: rtModel, ttl_seconds: 600 });
      logRealtimeStep('start:session_ok', start);
      const EPHEMERAL_KEY = start?.client_secret?.value || start?.client_secret_value || start?.value || null;
      if (!EPHEMERAL_KEY) {
        logRealtimeStep('start:ephemeral_missing', start);
        throw new Error('Realtime token vazio');
      }
      logRealtimeStep('start:ephemeral_ok', { session_id: start?.session_id || null, thread_id: start?.thread_id || null });

      rtcSessionIdRef.current = start?.session_id || null;
      try { console.log("REALTIME_SESSION_STARTED", { sessionId: start?.session_id || null, threadId: start?.thread_id || threadId || null }); } catch {}
      setLastRealtimeSessionId(start?.session_id || null);
      rtcThreadIdRef.current = start?.thread_id || threadId || null;
      if (start?.thread_id && start.thread_id !== threadId) {
        try { setThreadId(start.thread_id); } catch {}
      }

      rtcEventQueueRef.current = [];
      rtcQueuedEventIdsRef.current = new Set();
      rtcFlushInFlightRef.current = false;
      rtcLastAssistantFinalRef.current = '';
      rtcAssistantFinalCommittedRef.current = false;
      rtcLastFinalTranscriptRef.current = '';
      lastSpokenMsgRef.current = '';
      if (rtcFlushTimerRef.current) { try { clearInterval(rtcFlushTimerRef.current); } catch {} }
      rtcFlushTimerRef.current = setInterval(() => { try { flushRealtimeEvents(); } catch {} }, 400);


      const pc = new RTCPeerConnection();
      rtcPcRef.current = pc;

      // Remote audio output
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      rtcAudioElRef.current = audioEl;
      pc.ontrack = async (e) => {
        try {
          audioEl.srcObject = e.streams[0];
          audioEl.autoplay = true;
          audioEl.muted = false;
          audioEl.setAttribute("playsinline", "true");

          if (!audioEl.isConnected) {
            audioEl.style.display = "none";
            document.body.appendChild(audioEl);
          }

          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const preferred = devices.find((d) =>
              d.kind === "audiooutput" &&
              (
                String(d.label || "").toLowerCase().includes("bluetooth") ||
                String(d.label || "").toLowerCase().includes("buds") ||
                String(d.label || "").toLowerCase().includes("airpods")
              )
            );

            if (preferred && typeof audioEl.setSinkId === "function") {
              await audioEl.setSinkId(preferred.deviceId);
              logRealtimeStep("audio:sink_preferred_applied", {
                sinkId: preferred.deviceId,
                label: preferred.label || null,
              });
            } else {
              await maybeApplyPreferredAudioSink(audioEl);
            }
          } catch (err) {
            console.warn("[Realtime] sink routing fallback", err);
            logRealtimeStep("audio:sink_preferred_failed", { message: err?.message || null });
            await maybeApplyPreferredAudioSink(audioEl);
          }

          const p = audioEl.play?.();
          if (p && typeof p.catch === "function") {
            p.catch((err) => {
              console.warn("[Realtime] remote audio play blocked", err);
              logRealtimeStep("audio:play_blocked", { message: err?.message || null });
            });
          }
        } catch (err) {
          console.warn("[Realtime] ontrack routing error", err);
          logRealtimeStep("audio:ontrack_routing_failed", { message: err?.message || null });
        }
      };

      // Mic input
      logRealtimeStep('start:request_mic');
      const micConstraints = buildPreferredMicConstraints();
      const ms = await navigator.mediaDevices.getUserMedia(micConstraints);
      const rawTrack = ms.getAudioTracks?.()[0] || ms.getTracks?.()[0] || null;
      if (!rawTrack) throw new Error("Microfone indisponível");

      await applyBestEffortMicTrackConstraints(rawTrack);

      let outboundStream = ms;
      let outboundTrack = rawTrack;

      const preferRawMic = ((window.__ORKIO_ENV__?.VITE_REALTIME_PREFER_RAW_MIC || import.meta.env.VITE_REALTIME_PREFER_RAW_MIC || "false").toString().trim().toLowerCase() === "true");

      if (preferRawMic) {
        logRealtimeStep("start:mic_raw_preferred", { label: rawTrack?.label || null, readyState: rawTrack?.readyState || null });
      } else {
        const processed = await createProcessedMicPath(ms, {
          inputGain: 0.58,
          highpassHz: 120,
          lowpassHz: 4200,
          threshold: -28,
          knee: 18,
          ratio: 8,
          attack: 0.003,
          release: 0.2,
          makeupGain: 0.92,
        });

        if (processed?.track) {
          outboundStream = processed.stream;
          outboundTrack = processed.track;
          rtcAudioProcessingRef.current = processed;
          logRealtimeStep("start:mic_processing_ok", { label: processed.track?.label || null, readyState: processed.track?.readyState || null });
        } else {
          logRealtimeStep("start:mic_raw_fallback", { label: rawTrack?.label || null, readyState: rawTrack?.readyState || null });
        }
      }

      logRealtimeStep('start:mic_ok', { label: outboundTrack?.label || null, readyState: outboundTrack?.readyState || null });
      outboundTrack.onended = () => {
        try {
          logRealtimeStep("mic:ended");
          if (realtimeModeRef.current) {
            void activateSilentRealtimeFallback("mic_ended");
          }
        } catch {}
      };
      pc.addTrack(outboundTrack, outboundStream);
      logRealtimeStep('start:add_track', { label: outboundTrack?.label || null, readyState: outboundTrack?.readyState || null });

      // Events channel
      const dc = pc.createDataChannel('oai-events');
      rtcDcRef.current = dc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState || "unknown";
        logRealtimeStep("pc:connection_state", { state });
        if (state === "failed" || state === "disconnected" || state === "closed") {
          setV2vError(`Realtime connection ${state}`);
          if (realtimeModeRef.current) void activateSilentRealtimeFallback(`pc_${state}`);
        }
      };

      dc.addEventListener("close", () => {
        logRealtimeStep("dc:close");
        rtcResponseInFlightRef.current = false;
        if (realtimeModeRef.current) {
          setV2vPhase("error");
          setV2vError("Realtime channel closed");
          setUploadStatus("⚠️ Realtime channel closed.");
          setTimeout(() => setUploadStatus(""), 1800);
          const state = rtcPcRef.current?.connectionState || "unknown";
          const shouldDisarm = state !== "connected";
          void activateSilentRealtimeFallback("dc_closed", { disarm: shouldDisarm });
        }
      });

      dc.addEventListener("error", (err) => {
        console.warn("[Realtime] datachannel error", err);
        logRealtimeStep("dc:error", { message: err?.message || null });
      });

            dc.addEventListener('open', () => {
        setV2vPhase('listening');
        setUploadStatus('⚡ Realtime ativo — fale normalmente.');
        setTimeout(() => setUploadStatus(''), 1500);

        try {
          dc.send(JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              modalities: ["audio"],
              audio: {
                input: {
                  turn_detection: {
                    type: "server_vad",
                    threshold: REALTIME_SERVER_VAD_THRESHOLD,
                    silence_duration_ms: REALTIME_SERVER_VAD_SILENCE_MS,
                    prefix_padding_ms: REALTIME_SERVER_VAD_PREFIX_MS,
                    create_response: false
                  }
                }
              }
            }
          }));
          logRealtimeStep("dc:session_update_sent", {
            modalities: ["audio"],
            threshold: REALTIME_SERVER_VAD_THRESHOLD,
            silence_ms: REALTIME_SERVER_VAD_SILENCE_MS,
            prefix_ms: REALTIME_SERVER_VAD_PREFIX_MS,
          });
        } catch (err) {
          console.warn("[Realtime] session.update failed", err);
          logRealtimeStep("dc:session_update_failed", { message: err?.message || null });
        }
      });

      dc.addEventListener('message', (e) => {
        try {
          const ev = JSON.parse(e.data);

                    // Turn arming + optional Magic Words (B3)
          // We DO NOT auto-respond (create_response=false). We arm the turn on final transcript and
          // only create a response when the user clicks, presses a hotkey, or speaks a magic word.
          if (ev?.type === 'conversation.item.input_audio_transcription.completed') {
            const raw = (ev?.transcript || ev?.text || ev?.result?.transcript || '').toString();
            queueRealtimeEvent({ event_type: 'transcript.final', role: 'user', content: raw, is_final: true });
            try {} catch {}
            rtcLastFinalTranscriptRef.current = raw;
            markRealtimeUserActivity();

            Promise.resolve(guardAndMaybeBlockRealtimeTranscript(raw)).then((blocked) => {
              if (blocked) return;
              const normalized = raw.trim();
              setRtcReadyToRespond(!!normalized);
              if (!normalized) return;

              const nowMs = Date.now();
              const norm = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
              const endsWithCmd = (s, cmd) => s === cmd || s.endsWith(' ' + cmd);
              const isMagic = endsWithCmd(norm, 'continue') || endsWithCmd(norm, 'please') || endsWithCmd(norm, 'prossiga') || endsWithCmd(norm, 'por favor');

              if (REALTIME_INSTITUTIONAL_MODE) {
                const sameTranscript = rtcLastSubmittedTranscriptRef.current === normalized;
                const tooSoon = (nowMs - (rtcLastSubmittedTranscriptTsRef.current || 0)) < 1200;
                if (rtcInstitutionalTurnInFlightRef.current || sameTranscript || tooSoon) {
                  return;
                }
                rtcInstitutionalTurnInFlightRef.current = true;
                rtcLastSubmittedTranscriptRef.current = normalized;
                rtcLastSubmittedTranscriptTsRef.current = nowMs;
                sendMessage(normalized, {
                  realtimeTurn: true,
                  explicitVoiceRequested: true,
                  useStream: true,
                });
                return;
              }

              if (rtcMagicEnabledRef.current && isMagic) {
                try {
                  if (rtcLastMagicRef.current !== norm) {
                    rtcLastMagicRef.current = norm;
                    triggerRealtimeResponse("magic");
                  }
                } catch (err) {
                  console.warn('[Realtime] magic trigger failed', err);
                }
              } else if (REALTIME_AUTO_RESPONSE_ENABLED) {
                triggerRealtimeResponse("auto_vad");
              } else {
                setUploadStatus('Ready to respond — click ▶️ or press Space/Enter.');
                setTimeout(() => setUploadStatus(''), 1800);
              }
            });
          }
// Basic telemetry + optional live captions
          if (ev?.type === 'response.text.delta' && ev?.delta) {
            clearRealtimeResponseTimeout();
            if (!REALTIME_INSTITUTIONAL_MODE) {
              rtcTextBufRef.current += ev.delta;
            }
          }
          if (ev?.type === 'response.created') {
            clearRealtimeResponseTimeout();
            rtcResponseInFlightRef.current = true;
            setV2vPhase('responding');
            rtcTextBufRef.current = '';
            rtcAudioTranscriptBufRef.current = '';
            rtcLastAssistantFinalRef.current = '';
            rtcAssistantFinalCommittedRef.current = false;
          }
          if (ev?.type === 'response.output_item.added') {
            clearRealtimeResponseTimeout();
          }
          if (ev?.type === 'response.content_part.added') {
            clearRealtimeResponseTimeout();
          }
          if (ev?.type === 'response.text.done') {
            clearRealtimeResponseTimeout();
            rtcResponseInFlightRef.current = false;
            const t = (rtcTextBufRef.current || '').trim();
            rtcTextBufRef.current = '';
            rtcAudioTranscriptBufRef.current = '';
            if (!REALTIME_INSTITUTIONAL_MODE) {
              commitRealtimeAssistantFinal(t, { source: 'response.text.done' });
            }
          }
          // Audio transcript (when model outputs audio without text)
          if (ev?.type === 'response.audio.delta') {
            clearRealtimeResponseTimeout();
          }
          if (ev?.type === 'response.audio_transcript.delta' && ev?.delta) {
            clearRealtimeResponseTimeout();
            if (!REALTIME_INSTITUTIONAL_MODE) {
              rtcAudioTranscriptBufRef.current = (rtcAudioTranscriptBufRef.current || '') + ev.delta;
            }
          }
          if (ev?.type === 'response.audio_transcript.done' || ev?.type === 'response.audio_transcript.final') {
            clearRealtimeResponseTimeout();
            rtcResponseInFlightRef.current = false;
            const at = ((rtcAudioTranscriptBufRef.current || '') + (ev?.transcript || '')).trim();
            rtcAudioTranscriptBufRef.current = '';
            if (!REALTIME_INSTITUTIONAL_MODE && !rtcAssistantFinalCommittedRef.current) {
              commitRealtimeAssistantFinal(at, { source: 'response.audio_transcript' });
            }
          }
          if (ev?.type === "error") {
            const errObj = ev?.error || {};
            const errCode = String(errObj?.code || errObj?.type || ev?.code || "").toLowerCase();
            const errMessage = String(errObj?.message || ev?.message || "Realtime runtime error");
            const isFatal =
              errCode.includes("invalid_api_key") ||
              errCode.includes("insufficient_quota") ||
              errCode.includes("session_expired") ||
              errCode.includes("authentication") ||
              errCode.includes("authorization") ||
              errCode.includes("token") ||
              errCode.includes("forbidden");

            console.warn("[Realtime] runtime error event", ev);
            logRealtimeStep("runtime:error_event", {
              type: ev?.type || null,
              event_id: ev?.event_id || null,
              code: errCode || null,
              message: errMessage,
              fatal: isFatal,
            });

            setV2vError(errMessage);
            setUploadStatus(`⚠️ ${errMessage}`);
            setTimeout(() => setUploadStatus(""), 2200);

            if (isFatal) {
              void activateSilentRealtimeFallback("realtime_error_fatal", { disarm: true });
            }
            return;
          }
        } catch {}
      });

      // SDP handshake
      logRealtimeStep('start:create_offer');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logRealtimeStep('start:local_description_set', { sdpLength: offer?.sdp?.length || 0 });

      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          'Content-Type': 'application/sdp',
        },
      });

      const sdpText = await sdpResponse.text().catch(() => '');
      if (!sdpResponse.ok) {
        logRealtimeStep('start:sdp_error', { status: sdpResponse.status, body: sdpText || sdpResponse.statusText });
        throw new Error(`SDP handshake falhou (${sdpResponse.status}): ${sdpText || sdpResponse.statusText}`);
      }

      logRealtimeStep('start:sdp_ok', { answerLength: sdpText.length });
      const answer = { type: 'answer', sdp: sdpText };
      await pc.setRemoteDescription(answer);
      logRealtimeStep('start:ready', { sessionId: start?.session_id || null, threadId: start?.thread_id || threadId || null });

    } catch (e) {
      console.error('[Realtime] startRealtime error', e);
      logRealtimeStep('start:catch', {
        message: e?.message || 'Falha ao iniciar Realtime',
        stack: e?.stack || null,
        sessionId: rtcSessionIdRef.current || null,
        threadId: rtcThreadIdRef.current || threadId || null,
      });
      setV2vPhase('error');
      setV2vError(e?.message || 'Falha ao iniciar Realtime');
      setUploadStatus('❌ Realtime: ' + (e?.message || 'falha'));
      setTimeout(() => setUploadStatus(''), 4000);
      await stopRealtime('start_error_diagnostic_cleanup');
    } finally {
      rtcConnectingRef.current = false;
    }
  }

  
  function triggerRealtimeResponse(reason = "manual") {
    try {
      if (REALTIME_INSTITUTIONAL_MODE) {
        logRealtimeStep("response:blocked_institutional_mode", { reason });
        return;
      }
      const dc = rtcDcRef.current;
      if (!dc || dc.readyState !== "open") {
        throw new Error("DataChannel não está aberto");
      }
      if (rtcResponseInFlightRef.current) {
        logRealtimeStep("response:skip_inflight", { reason });
        return;
      }
      const lastTranscript = (rtcLastFinalTranscriptRef.current || "").trim();
      if (!lastTranscript) {
        logRealtimeStep("response:skip_empty", { reason });
        return;
      }
      rtcResponseInFlightRef.current = true;
      clearRealtimeResponseTimeout();
      clearRealtimeIdleFollowup();
      rtcResponseTimeoutRef.current = setTimeout(() => {
        setUploadStatus("⌛ Realtime ainda processando...");
        setTimeout(() => setUploadStatus(""), 1200);
      }, 7000);
      dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio", "text"], audio: { output: { voice: rtcVoiceRef.current } } } }));
      setRtcReadyToRespond(false);
      setV2vPhase("responding");
      setUploadStatus(reason === "magic" ? "✨ Command received — responding..." : reason === "auto_vad" ? "🎙️ Speech detected — responding..." : "▶️ Responding...");
      setTimeout(() => setUploadStatus(""), 1500);
    } catch (e) {
      rtcResponseInFlightRef.current = false;
      console.warn("[Realtime] triggerRealtimeResponse failed", e);
      setUploadStatus("❌ Failed to trigger realtime response.");
      setTimeout(() => setUploadStatus(""), 2000);
      void activateSilentRealtimeFallback("trigger_failed");
    }
  }


  // PATCH0100_27A: Realtime event logging (batched, non-blocking)
  function queueRealtimeEvent({ event_type, role, content = null, is_final = false, meta = null } = {}) {
    const sid = rtcSessionIdRef.current;
    if (!sid) return;
    const eventId = (meta && typeof meta.client_event_id === 'string' && meta.client_event_id.trim())
      ? meta.client_event_id.trim()
      : ((globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (`ce-${Date.now()}-${Math.random().toString(36).slice(2,10)}`));
    if (rtcQueuedEventIdsRef.current.has(eventId)) return;
    rtcQueuedEventIdsRef.current.add(eventId);
    rtcEventQueueRef.current.push({
      session_id: sid,
      client_event_id: eventId,
      event_type,
      role,
      content,
      created_at: Math.floor(Date.now()/1000),
      is_final,
      meta,
    });
    try {
      if (is_final && (content || '').toString().trim()) {
        const item = {
          session_id: sid,
          event_type,
          role,
          content: (content || '').toString(),
          transcript_punct: null,
          created_at: Math.floor(Date.now()/1000),
        };
        setRtcAuditEvents(prev => prev.concat([item]));
      }
    } catch {}
  }

  async function flushRealtimeEvents() {
    const sid = rtcSessionIdRef.current;
    if (!sid) return;
    if (rtcFlushInFlightRef.current) return;
    const q = rtcEventQueueRef.current || [];
    if (!q.length) return;
    rtcFlushInFlightRef.current = true;
    rtcEventQueueRef.current = [];
    try {
      await postRealtimeEventsBatch({ session_id: sid, events: q });
      q.forEach((item) => {
        try { rtcQueuedEventIdsRef.current.delete(item?.client_event_id); } catch {}
      });
    } catch (err) {
      if (rtcSessionIdRef.current === sid) {
        rtcEventQueueRef.current = q.concat(rtcEventQueueRef.current || []);
      }
      console.warn('[Realtime] events batch failed', err);
    } finally {
      rtcFlushInFlightRef.current = false;
    }
  }


  // PATCH0100_27_2B: finalize session on server + poll punctuated finals (best-effort)
  async function finalizeRealtimeSession(reason = 'client_stop') {
    const sid = rtcSessionIdRef.current;
    if (!sid) return;
    // stop timer
    if (rtcFlushTimerRef.current) { try { clearInterval(rtcFlushTimerRef.current); } catch {} rtcFlushTimerRef.current = null; }
    // flush pending events
    try { await flushRealtimeEvents(); } catch {}
    // end session (best-effort)
    try { await endRealtimeSession({ session_id: sid, ended_at: Date.now(), meta: { reason } }); } catch {}

    // poll for punct updates (best-effort, bounded)
    try {
      setRtcPunctStatus('pending');
      const started = Date.now();
      const deadlineMs = 15000;
      let last = null;
      while (Date.now() - started < deadlineMs) {
        try {
          const data = await getRealtimeSession({ session_id: sid, finals_only: true });
          last = data;
          if (data?.events) {
            setRtcAuditEvents(data.events);
          }
          if (data?.punct?.done) {
            setRtcPunctStatus('done');
            return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 900));
      }
      // timeout but still set last snapshot
      if (last?.events) setRtcAuditEvents(last.events);
      setRtcPunctStatus('timeout');
    } catch {
      setRtcPunctStatus('timeout');
    }
  }

  function commitRealtimeAssistantFinal(rawText, { source = 'unknown' } = {}) {
    const finalText = (rawText || '').toString().trim();
    if (!finalText) return;
    const dedupeKey = finalText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (rtcLastAssistantFinalRef.current === dedupeKey) return;
    if (rtcAssistantFinalCommittedRef.current && source !== 'response.text.done') return;
    rtcLastAssistantFinalRef.current = dedupeKey;
    rtcAssistantFinalCommittedRef.current = true;

    try {
      const selectedAgentObj2 = (agents || []).find(a => String(a.id) === String(destSingle || ""));
      const agentName2 = selectedAgentObj2?.name || "Orkio";
      const agentId2 = selectedAgentObj2?.id || (destSingle || null);
      const mid = `rtc_ass_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      queueRealtimeEvent({ event_type: 'response.final', role: 'assistant', content: finalText, is_final: true, meta: { source, message_id: mid } });
      setMessages((prev) => prev.concat([{
        id: mid,
        role: "assistant",
        content: finalText,
        agent_id: agentId2 ? String(agentId2) : null,
        agent_name: agentName2,
        created_at: Math.floor(Date.now()/1000),
      }]));
    } catch {}

    setUploadStatus('📝 ' + finalText.slice(0, 80) + (finalText.length > 80 ? '…' : ''));
    setTimeout(() => setUploadStatus(''), 2500);
    setTimeout(() => { try { scheduleRealtimeIdleFollowup(); } catch {} }, REALTIME_REARM_AFTER_ASSISTANT_MS);
  }


  async function downloadRealtimeAta() {
    try {
      const sid = rtcSessionIdRef.current;
      if (!sid) {
        setUploadStatus('ℹ️ Nenhuma sessão Realtime disponível para exportar relatório.');
        setTimeout(() => setUploadStatus(''), 2000);
        return;
      }
      const blob = await downloadRealtimeAtaFile({ session_id: sid });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orkio-ata-${sid}.txt`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      try { URL.revokeObjectURL(url); } catch {}
      setUploadStatus('⬇️ Baixando relatório executivo da sessão...');
      setTimeout(() => setUploadStatus(''), 1800);
    } catch (e) {
      console.error('[Realtime] download report failed', e);
      setUploadStatus('❌ Falha ao baixar ata.');
      setTimeout(() => setUploadStatus(''), 2000);
    }
  }

async function stopRealtime(reason = 'client_stop') {
    const sid = rtcSessionIdRef.current;
    try {
      console.log("REALTIME_STOP_REASON", reason, { sessionId: sid });
    } catch {}
    rtcConnectingRef.current = false;
    try {
      clearRealtimeResponseTimeout();
      clearRealtimeIdleFollowup();
      rtcFallbackActiveRef.current = false;
      if (rtcFlushTimerRef.current) { try { clearInterval(rtcFlushTimerRef.current); } catch {} rtcFlushTimerRef.current = null; }

      try {
        if (sid) {
          await flushRealtimeEvents();
          await endRealtimeSession({ session_id: sid, ended_at: Date.now(), meta: { reason, mode: summitRuntimeModeRef.current } });
          try {
            const data = await getRealtimeSession({ session_id: sid, finals_only: true });
            if (data?.events) setRtcAuditEvents(data.events);
          } catch {}
          try {
            if (summitRuntimeModeRef.current === "summit") {
              const scoreRes = await getSummitSessionScore({ session_id: sid });
              setSummitSessionScore(scoreRes?.data?.score || null);
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[Realtime] stop finalize failed', err);
      }

      const dc = rtcDcRef.current;
      rtcDcRef.current = null;
      if (dc) { try { dc.close(); } catch {} }

      const pc = rtcPcRef.current;
      rtcPcRef.current = null;
      if (pc) {
        try { pc.getSenders?.().forEach((sender) => { try { sender.track?.stop?.(); } catch {} }); } catch {}
        try { pc.getReceivers?.().forEach((receiver) => { try { receiver.track?.stop?.(); } catch {} }); } catch {}
        try { pc.close(); } catch {}
      }

      const a = rtcAudioElRef.current;
      rtcAudioElRef.current = null;
      if (a) {
        try { a.pause(); } catch {}
        try { a.srcObject = null; } catch {}
        try { if (a.isConnected) a.remove(); } catch {}
      }

      rtcTextBufRef.current = '';
      rtcAudioTranscriptBufRef.current = '';
      rtcAssistantFinalCommittedRef.current = false;
      rtcLastAssistantFinalRef.current = '';
      rtcResponseInFlightRef.current = false;
      rtcSessionIdRef.current = null;
      rtcThreadIdRef.current = null;
      rtcEventQueueRef.current = [];
      rtcQueuedEventIdsRef.current = new Set();
      rtcFlushInFlightRef.current = false;
      rtcLastFinalTranscriptRef.current = '';
      lastSpokenMsgRef.current = '';
      setRtcReadyToRespond(false);
      setRtcPunctStatus(null);

      const processing = rtcAudioProcessingRef.current;
      rtcAudioProcessingRef.current = null;
      if (processing) {
        try { processing.destination?.stream?.getTracks?.().forEach((t) => { try { t.stop?.(); } catch {} }); } catch {}
        try { processing.rawStream?.getTracks?.().forEach((t) => { try { t.stop?.(); } catch {} }); } catch {}
        try { processing.ctx?.close?.(); } catch {}
      }
    } catch {}
  }


  async function submitStageReview(clarity, naturalness, institutionalFit) {
    const sid = rtcSessionIdRef.current || lastRealtimeSessionId || null;
    const targetSid = sid || lastRealtimeSessionId;
    if (!targetSid) return;
    try {
      setSummitReviewPending(true);
      const res = await submitSummitSessionReview({
        session_id: targetSid,
        clarity,
        naturalness,
        institutional_fit: institutionalFit,
      });
      try {
        const scoreRes = await getSummitSessionScore({ session_id: targetSid });
        setSummitSessionScore(scoreRes?.data?.score || { human_review: res?.data?.review || null });
      } catch {
        setSummitSessionScore((prev) => ({ ...(prev || {}), human_review: res?.data?.review || null }));
      }
      setUploadStatus("✅ Avaliação do Summit registrada.");
      setTimeout(() => setUploadStatus(""), 1800);
    } catch (err) {
      console.warn("[Summit] review failed", err);
    } finally {
      setSummitReviewPending(false);
    }
  }

  function toggleRealtimeMode() {
    if (!ENABLE_REALTIME) return;
    const next = !realtimeMode;
    setRealtimeMode(next);
    realtimeModeRef.current = next;

    if (next) {
      // Disable classic voice mode to avoid mic contention
      if (voiceModeRef.current) {
        setVoiceMode(false);
        voiceModeRef.current = false;
      }
      try { stopMic(); } catch {}
      try { stopTts(); } catch {}
      startRealtime();
    } else {
      void stopRealtime('toggle_off');
      setV2vPhase(null);
      setV2vError(null);
      setUploadStatus('');
    }
  }

  function stopTts() {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setTtsPlaying(false);
  }

  async function playTts(textToSpeak, agentId, opts = {}) {
    // F-01 FIX: desestruturar opts no início da função
    const { forceAuto = false, messageId = null, traceId = null } = opts || {};
    if (!textToSpeak || textToSpeak.length < 2) return;
    // Evitar reler a mesma mensagem (idempotência)
    if (textToSpeak === lastSpokenMsgRef.current) return;
    lastSpokenMsgRef.current = textToSpeak;

    // Limpar markdown para fala mais natural
    let clean = textToSpeak
      .replace(/```[\s\S]*?```/g, ' código omitido ')
      .replace(/`[^`]+`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_~>|]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
    if (voiceModeRef.current) {
      if (clean.length > 1200) clean = clean.slice(0, 1200);
    } else {
      if (clean.length > 4096) clean = clean.slice(0, 4096);
    }
    if (clean.length < 2) return;

    stopTts();
    setTtsPlaying(true);
    setV2vPhase('playing');

    const effectiveTrace = traceId || v2vTraceRef.current || null;
    console.info('[V2V] v2v_play_start trace_id=%s message_id=%s agent_id=%s', effectiveTrace, messageId, agentId);

    try {
      const base = (window.__ORKIO_ENV__?.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
      const apiUrl = base.endsWith('/api') ? base.slice(0, -4) : base;

      const ttsHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Org-Slug': tenant,
      };
      if (effectiveTrace) ttsHeaders['X-Trace-Id'] = effectiveTrace;

      const res = await fetch(`${apiUrl}/api/tts`, {
        method: 'POST',
        headers: ttsHeaders,
        // V2V-PATCH: preferir message_id (backend resolve voz correta por agente)
        // agent_id só como fallback se message_id não disponível
        body: JSON.stringify({
          text: clean,
          voice: (forceAuto || messageId) ? null : (ttsVoice === "auto" ? null : ttsVoice),
          speed: 1.0,
          agent_id: messageId ? null : (agentId || null),
          message_id: messageId || null,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[V2V] v2v_tts_fail trace_id=%s status=%d body=%s', effectiveTrace, res.status, errText.slice(0, 200));
        setTtsPlaying(false);
        setV2vPhase('error');
        setV2vError(`TTS falhou (HTTP ${res.status})`);
        if (res.status === 401) {
          alert("Sessão expirada. Faça login novamente.");
          try { localStorage.removeItem("orkio_token"); } catch (_) {}
          window.location.href = "/auth";
        }
        return;
      }

      const blob = await res.blob();
      if (!blob || blob.size < 50) {
        console.warn('[V2V] v2v_tts_fail trace_id=%s reason=empty_blob size=%d', effectiveTrace, blob?.size);
        setTtsPlaying(false);
        setV2vPhase('error');
        setV2vError('TTS retornou áudio vazio');
        return;
      }

      console.info('[V2V] v2v_tts_ok trace_id=%s bytes=%d', effectiveTrace, blob.size);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;

      await new Promise((resolve, reject) => {
        audio.onended = () => {
          console.info('[V2V] v2v_play_end trace_id=%s', effectiveTrace);
          setTtsPlaying(false);
          setV2vPhase(null);
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          // Reiniciar microfone após fala (ciclo V2V)
          if (voiceModeRef.current && (speechSupported || mediaRecorderSupported) && !micEnabledRef.current) {
            startMic();
          }
          resolve();
        };
        audio.onerror = (err) => {
          console.error('[V2V] audio.onerror trace_id=%s', effectiveTrace, err);
          setTtsPlaying(false);
          setV2vPhase('error');
          setV2vError('Erro ao reproduzir áudio');
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          reject(new Error('Audio playback error'));
        };
        audio.play().catch(err => {
          // autoplay bloqueado pelo browser — fallback silencioso
          console.warn('[V2V] autoplay blocked trace_id=%s:', effectiveTrace, err?.message);
          setTtsPlaying(false);
          setV2vPhase(null);
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          // BUG-01 FIX: reiniciar mic mesmo sem áudio — ciclo V2V não pode morrer aqui
          if (voiceModeRef.current && !micEnabledRef.current) {
            setTimeout(() => startMic(), 300);
          }
          resolve(); // não rejeitar — V2V deve continuar mesmo sem áudio
        });
      });
    } catch (e) {
      console.error('[V2V] v2v_tts_fail trace_id=%s error:', effectiveTrace, e);
      setTtsPlaying(false);
      setV2vPhase('error');
      setV2vError(e?.message || 'Erro desconhecido no TTS');
    }
  }

  function changeTtsVoice(v) {
    setTtsVoice(v);
    localStorage.setItem('orkio_tts_voice', v);
  }

  // Upload flow
  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    setUploadFileObj(f);
    setUploadScope("thread");
    setUploadAgentIds([]);
    setUploadOpen(true);
  }

  async function confirmUpload() {
    const f = uploadFileObj;
    if (!f) return;
    // PATCH0100_17_ENSURE_THREAD_BEFORE_UPLOAD: uploads need a thread to be visible in chat
    let effectiveThreadId = threadId;
    if (!effectiveThreadId && (uploadScope === "thread" || uploadScope === "institutional")) {
      try {
        const created = await apiFetch("/api/threads", { method: "POST", token, org: tenant, body: { title: "Nova conversa" }});
        effectiveThreadId = created?.data?.id;
        if (effectiveThreadId) setThreadId(effectiveThreadId);
      } catch (e) {
        console.warn("could not create thread before upload", e);
      }
    }

    try {
      setUploadProgress(true);
      setUploadStatus("Enviando arquivo...");

      if (uploadScope === "thread") {
        await uploadFile(f, { token, org: tenant, threadId: effectiveThreadId, intent: "chat" });
        setUploadStatus("Arquivo anexado à conversa ✅");
        try { await loadMessages(effectiveThreadId); } catch {}
      } else if (uploadScope === "agents") {
        if (!uploadAgentIds.length) {
          alert("Selecione ao menos um agente.");
          return;
        }
        await uploadFile(f, { token, org: tenant, agentIds: uploadAgentIds, intent: "agent" });
        setUploadStatus("Arquivo vinculado aos agentes ✅");
      } else if (uploadScope === "institutional") {
        const admin = isAdmin(user);
        if (admin) {
          await uploadFile(f, { token, org: tenant, threadId: effectiveThreadId, intent: "institutional", linkAllAgents: true });
          setUploadStatus("Arquivo institucional (global) ✅");
          // STAB: reload com effectiveThreadId para garantir que mensagem system aparece
          try {
            if (effectiveThreadId) await loadMessages(effectiveThreadId);
          } catch (e) { console.warn("loadMessages after institutional upload failed:", e); }
        } else {
          // B2: request institutionalization; keep accessible in this thread
          await uploadFile(f, { token, org: tenant, threadId: effectiveThreadId, intent: "chat", institutionalRequest: true });
          setUploadStatus("Solicitação enviada ao admin (institucional) ✅");
          try { await loadMessages(effectiveThreadId); } catch {}
        }
      }

      setUploadOpen(false);
      setUploadFileObj(null);
      setTimeout(() => setUploadStatus(""), 2200);
    } catch (e) {
      console.error("upload error", e);
      setUploadStatus(e?.message || "Falha no upload");
      setTimeout(() => setUploadStatus(""), 2500);
    } finally {
      setUploadProgress(false);
    }
  }

  const styles = {
    layout: {
      display: "flex",
      minHeight: "100dvh",
      background:
        "radial-gradient(1200px 700px at 30% -10%, rgba(124,92,255,0.25), transparent 60%), linear-gradient(180deg, #05060a, #03030a)",
      color: "#fff",
      fontFamily: "system-ui",
    },
    sidebar: {
      width: "330px",
      borderRight: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      flexDirection: "column",
      padding: "16px",
      gap: "12px",
    },
    brand: { fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em" },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "6px 10px",
      borderRadius: "999px",
      fontSize: "12px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.8)",
    },
    topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
    newThreadBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "10px 12px",
      borderRadius: "14px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
    },
    threads: { flex: 1, overflowY: "auto", padding: "0 8px" },
    emptyThreads: { padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px" },
    threadItem: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      padding: "12px",
      background: "transparent",
      border: "none",
      borderRadius: "10px",
      color: "rgba(255,255,255,0.7)",
      fontSize: "13px",
      cursor: "pointer",
      textAlign: "left",
      marginBottom: "4px",
    },
    threadItemActive: { background: "rgba(255,255,255,0.1)", color: "#fff" },
    threadTitle: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    threadEditBtn: {
      border: "none",
      background: "transparent",
      color: "rgba(255,255,255,0.55)",
      padding: "4px",
      borderRadius: "8px",
      cursor: "pointer",
    },
    userSection: {
      padding: "16px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
    },
    userInfo: { display: "flex", alignItems: "center", gap: "10px" },
    userAvatar: {
      width: "36px",
      height: "36px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #7c5cff 0%, #35d0ff 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
    },
    userDetails: { display: "flex", flexDirection: "column" },
    userName: { fontSize: "13px", fontWeight: 700 },
    userEmail: { fontSize: "12px", color: "rgba(255,255,255,0.55)" },
    userActions: { display: "flex", alignItems: "center", gap: "8px" },
    iconBtn: {
      width: "36px",
      height: "36px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    },

    main: { flex: 1, display: "flex", flexDirection: "column" },
    topbar: {
      padding: "16px 18px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
    },
    title: { fontSize: "16px", fontWeight: 900 },
    health: { fontSize: "12px", color: "rgba(255,255,255,0.6)" },
    chatArea: { flex: 1, overflowY: "auto", padding: "16px 18px" },
    messageRow: { display: "flex", marginBottom: "12px" },
    messageBubble: {
      maxWidth: "820px",
      padding: "12px 12px",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.04)",
    },
    userBubble: { background: "rgba(124,92,255,0.12)", border: "1px solid rgba(124,92,255,0.25)" },
    agentBubble: { background: "rgba(53,208,255,0.10)", border: "1px solid rgba(53,208,255,0.22)" },
    systemBubble: { background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.18)" },
    bubbleHeaderRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", marginBottom: "6px" },
    bubbleHeaderName: { fontSize: "12px", color: "rgba(255,255,255,0.70)", fontWeight: 900 },
    bubbleHeaderTime: { fontSize: "12px", color: "rgba(255,255,255,0.55)", fontWeight: 700 },
    nameUser: { color: "rgba(196,176,255,0.95)" },
    nameAgent: { color: "rgba(160,240,255,0.95)" },
    nameSystem: { color: "rgba(255,255,255,0.82)" },
    messageContent: { whiteSpace: "pre-wrap", lineHeight: 1.45, fontSize: "14px" },
    messageTime: { marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.55)" },

    uploadStatus: {
      padding: "10px 18px",
      fontSize: "13px",
      color: "rgba(255,255,255,0.85)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
    },

    realtimeAudit: {
      padding: "10px 18px",
      fontSize: "12px",
      color: "rgba(255,255,255,0.82)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(80,160,255,0.06)",
      maxHeight: "220px",
      overflowY: "auto",
    },
    realtimeAuditHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" },
    realtimeAuditTitle: { fontWeight: 900, letterSpacing: "0.2px" },
    realtimeAuditPill: { padding: "2px 8px", borderRadius: "999px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.05)", fontSize: "11px" },
    realtimeAuditItem: { padding: "8px 10px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", marginBottom: "8px" },
    realtimeAuditMeta: { display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "6px", opacity: 0.8 },
    realtimeAuditWho: { fontWeight: 900 },
    realtimeAuditText: { whiteSpace: "pre-wrap", lineHeight: 1.45 },


    composerContainer: { position: "sticky", bottom: composerViewportOffset, zIndex: 8, padding: "14px 18px calc(14px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,9,16,0.96)", backdropFilter: "blur(10px)" },
    composer: {
      display: "flex",
      alignItems: "flex-end",
      gap: "10px",
      padding: "10px",
      borderRadius: "18px",
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.04)",
    },
    attachBtn: {
      width: "42px",
      height: "42px",
      borderRadius: "14px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: uploadProgress ? 0.6 : 1,
    },
    textarea: {
      flex: 1,
      minHeight: "42px",
      maxHeight: "180px",
      resize: "none",
      background: "transparent",
      border: "none",
      outline: "none",
      color: "#fff",
      fontSize: "14px",
      lineHeight: 1.4,
      padding: "10px 8px",
    },
    micBtn: {
      width: "42px",
      height: "42px",
      borderRadius: "14px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: micEnabled ? "rgba(53,208,255,0.15)" : "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: speechSupported ? "pointer" : "not-allowed",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: speechSupported ? 1 : 0.6,
    },
    sendBtn: {
      width: "42px",
      height: "42px",
      borderRadius: "14px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: sending ? 0.6 : 1,
    },
    select: {
      padding: "8px 10px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: "12px",
    },
    modalBack: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      padding: "16px",
    },
    modal: {
      width: "min(720px, 96vw)",
      borderRadius: "18px",
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(12,12,20,0.96)",
      padding: "16px",
    },
    modalTitle: { fontSize: "14px", fontWeight: 900 },
    radioRow: { display: "flex", gap: "10px", alignItems: "center", marginTop: "10px", color: "rgba(255,255,255,0.85)" },
    modalActions: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px" },
    btn: { border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 12px", borderRadius: "14px", cursor: "pointer" },
    btnPrimary: { background: "rgba(124,92,255,0.22)", border: "1px solid rgba(124,92,255,0.35)", fontWeight: 800 },
    checkGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px", marginTop: "10px" },
    checkItem: { display: "flex", gap: "8px", alignItems: "center", padding: "8px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" },
    hint: { fontSize: "12px", color: "rgba(255,255,255,0.6)", marginTop: "6px" },
  };

  const meName = user?.name || user?.email || "Você";

  if (!onboardingChecked) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f1115", color: "#fff", fontFamily: "system-ui" }}>Carregando sua experiência...</div>;
  }

  return (
    <>
    <PWAInstallPrompt />
    {showTermsModal && (
      <TermsModal onAccepted={() => {
        setShowTermsModal(false);
        // Update local user object
        const u = getUser();
        if (u) { u.terms_accepted_at = Math.floor(Date.now()/1000); u.terms_version = "2026-03-01"; localStorage.setItem("orkio_user", JSON.stringify(u)); }
      }} />
    )}

{onboardingOpen && (
      <OnboardingModal
        user={user}
        onComplete={async (result) => {
          const payloadUser =
            result && result.user
              ? result.user
              : (result && !result.access_token ? result : null);

          const mergedUser = {
            ...(user || {}),
            ...(payloadUser || {}),
            onboarding_completed: true,
          };

          const nextToken =
            (result && result.access_token) ||
            token;

          const nextTenant = mergedUser?.org_slug || tenant;

          setUser(mergedUser);
          setTenant(nextTenant);
          try {
            setSession({
              token: nextToken,
              user: mergedUser,
              tenant: nextTenant,
            });
          } catch {}

          if (nextToken && nextToken !== token) {
            setToken(nextToken);
          }

          setOnboardingOpen(false);
          setOnboardingStatus("");
          setUploadStatus("✅ Onboarding concluído.");
          setTimeout(() => setUploadStatus(""), 1800);

          try {
            const alreadyWelcomed = localStorage.getItem("orkio_welcome_shown");
            if (!alreadyWelcomed) {
              const welcomeMsg = {
                id: `welcome-${Date.now()}`,
                role: "assistant",
                content: "Hi — I’m Orkio. You can type your message here, or tap Realtime and speak with me if you're in a quieter environment. I’m ready when you are.",
                agent_name: "Orkio",
                created_at: Math.floor(Date.now() / 1000),
              };
              setMessages((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const hasWelcome = list.some((m) => String(m?.id || "").startsWith("welcome-"));
                return hasWelcome ? list : [...list, welcomeMsg];
              });
              localStorage.setItem("orkio_welcome_shown", "1");
            }
          } catch {}

          try {
            await loadThreads();
            await loadAgents();
          } catch {}
        }}
      />
    )}
    <div style={styles.layout}>
      {/* Mobile threads drawer */}
      {isMobile && mobileThreadsOpen ? (
        <div style={styles.mobileDrawerOverlay} onClick={() => setMobileThreadsOpen(false)}>
          <div style={styles.mobileDrawer} onClick={(e) => e.stopPropagation()}>
            <div style={styles.mobileDrawerHeader}>
              <div>
                <div style={styles.brand}>Conversas</div>
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={styles.badge}>org: {tenant}</span>
                  <span style={styles.badge}>{health === "ok" ? "ready" : health}</span>
                </div>
              </div>
              <button
                type="button"
                style={styles.mobileDrawerCloseBtn}
                onClick={() => setMobileThreadsOpen(false)}
                title="Fechar"
              >
                ✕
              </button>
            </div>

            <button style={{ ...styles.newThreadBtn, width: "100%", justifyContent: "center" }} onClick={createThread} title="Nova conversa">
              <IconPlus /> Nova conversa
            </button>

            <div style={styles.threads}>
              {threads.length === 0 ? (
                <div style={styles.emptyThreads}>Nenhuma conversa ainda.</div>
              ) : (
                threads.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setThreadId(t.id); setMobileThreadsOpen(false); }}
                    style={{
                      ...styles.threadItem,
                      ...(t.id === threadId ? styles.threadItemActive : {}),
                    }}
                  >
                    <IconMessage />
                    <span style={styles.threadTitle}>{t.title}</span>
                    <button
                      style={styles.threadEditBtn}
                      onClick={(e) => { e.stopPropagation(); renameThread(t.id); }}
                      title="Renomear conversa"
                    >
                      <IconEdit />
                    </button>
                    <button
                      style={styles.threadEditBtn}
                      onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                      title="Deletar conversa"
                    >
                      <IconTrash />
                    </button>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Sidebar */}
      <div style={{ ...styles.sidebar, display: isMobile ? "none" : "flex" }}>
        <div style={styles.topRow}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src={ORKIO_SIDEBAR_LOGO}
                alt="Orkio"
                style={{ width: 36, height: 36, objectFit: "contain", display: "block" }}
              />
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={styles.badge}>org: {tenant}</span>
              <span style={styles.badge}>{health === "ok" ? "ready" : health}</span>
            </div>
          </div>

          <button style={styles.newThreadBtn} onClick={createThread} title="Nova conversa">
            <IconPlus /> Novo
          </button>
        </div>

        <div style={styles.threads}>
          {threads.length === 0 ? (
            <div style={styles.emptyThreads}>Nenhuma conversa ainda.</div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                onClick={() => { setThreadId(t.id); if (isMobile) setMobileThreadsOpen(false); }}
                style={{
                  ...styles.threadItem,
                  ...(t.id === threadId ? styles.threadItemActive : {}),
                }}
              >
                <IconMessage />
                <span style={styles.threadTitle}>{t.title}</span>
                <button
                  style={styles.threadEditBtn}
                  onClick={(e) => { e.stopPropagation(); renameThread(t.id); }}
                  title="Renomear conversa"
                >
                  <IconEdit />
                </button>
                <button
                  style={styles.threadEditBtn}
                  onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                  title="Deletar conversa"
                >
                  <IconTrash />
                </button>
              </button>
            ))
          )}
        </div>

        <div style={styles.userSection}>
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>{meName.charAt(0).toUpperCase()}</div>
            <div style={styles.userDetails}>
              <div style={styles.userName}>{user?.name || "Usuário"}</div>
              <div style={styles.userEmail}>{user?.email || ""}</div>
            </div>
          </div>

          <div style={styles.userActions}>
            <button style={styles.iconBtn} onClick={openSettings} title="Settings">
              <IconSettings />
            </button>
            {canAccessAdmin && (
              <button style={styles.iconBtn} onClick={() => nav("/admin")} title="Admin Console">
                <IconShield />
              </button>
            )}
            <button style={styles.iconBtn} onClick={doLogout} title="Sair">
              <IconLogout />
            </button>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={styles.main}>
        <div style={{ ...styles.topbar, padding: isMobile ? "12px 14px" : styles.topbar.padding }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileThreadsOpen(true)}
                style={styles.mobileThreadsBtn}
                title="Conversas"
              >
                ☰
              </button>
            ) : null}
            <div>
            <div style={styles.title}>{threads.find((t) => t.id === threadId)?.title || "Conversa"}</div>
            <div style={styles.health}>Destino: {destMode === "team" ? "Team" : destMode === "single" ? "Agente" : "Multi"} • @Team / @Orkio / @Chris / @Orion</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: isMobile ? "wrap" : "nowrap", justifyContent: "flex-end" }}>
            {isMobile ? (
              <button
                type="button"
                onClick={doLogout}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  minHeight: 40,
                  padding: "8px 12px",
                  borderRadius: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                title="Sair"
              >
                Sair
              </button>
            ) : null}
            <select style={styles.select} value={destMode} onChange={(e) => setDestMode(e.target.value)}>
              <option value="team">Team</option>
              <option value="single">1 agente</option>
              <option value="multi">multi</option>
            </select>

            {destMode === "single" ? (
              <select style={styles.select} value={destSingle} onChange={(e) => setDestSingle(e.target.value)}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_default ? " (default)" : ""}</option>)}
              </select>
            ) : null}

            {destMode === "multi" && !isMobile ? (
              <select style={styles.select} value="choose" onChange={() => {}}>
                <option value="choose">Selecionar no envio...</option>
              </select>
            ) : null}
          </div>
        </div>

        {/* Messages */}
        <div style={{ ...styles.chatArea, padding: isMobile ? "12px 12px 18px" : styles.chatArea.padding }}>
          {messages.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "14px", padding: "8px" }}>
              Nenhuma mensagem ainda. Você pode chamar múltiplos agentes com <b>@Team</b> ou usar o seletor acima.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                style={{
                  ...styles.messageRow,
                  justifyContent: m.role === "user" ? "flex-end" : (m.role === "system" ? "center" : "flex-start"),
                }}
              >
                {/* PATCH0100_14: Agent avatar */}
                {m.role === "assistant" && lastAgentInfo?.avatar_url && (
                  <div style={{ marginRight: 8, flexShrink: 0, alignSelf: "flex-start", marginTop: 4 }}>
                    <img
                      src={lastAgentInfo.avatar_url}
                      alt={m.agent_name || m.agent?.name || agents.find((a) => String(a?.id) === String(m.agent_id))?.name || "Agent"}
                      style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.15)" }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
                <div
                  style={{
                    ...styles.messageBubble,
                    ...(m.role === "user"
                      ? styles.userBubble
                      : m.role === "system"
                      ? styles.systemBubble
                      : styles.agentBubble),
                  }}
                >
                  {(() => {
                    const evt = tryParseEvent(m.content);
                    const isUser = m.role === "user";
                    const isSystem = m.role === "system";
                    const resolvedAgentName = (m.agent_name || m.agent?.name || agents.find((a) => String(a?.id) === String(m.agent_id))?.name || "").trim();
                    const name = isUser
                      ? (m.user_name || meName)
                      : (resolvedAgentName || (isSystem ? "Sistema" : "Agente"));
                    const nameTone = isUser ? styles.nameUser : isSystem ? styles.nameSystem : styles.nameAgent;
                    const created = formatDateTime(m.created_at);
                    const visible = stripEventMarker(m.content);

                    return (
                      <>
                        <div style={styles.bubbleHeaderRow}>
                          <div style={{ ...styles.bubbleHeaderName, ...nameTone }}>{name}</div>
                          <div style={styles.bubbleHeaderTime}>{created}</div>
                        </div>

                        {evt && evt.type === "file_upload" ? (
                          <div style={styles.messageContent}>
                            <div style={{ fontWeight: 900 }}>📎 Upload registrado</div>
                            <div style={{ marginTop: 6 }}>{evt.filename || "arquivo"}</div>
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78 }}>
                              {evt.text || `por ${evt.uploader_name || evt.uploader_email || "Usuário"} • ${formatTs(evt.ts || evt.created_at)}`}
                            </div>
                          </div>
                        ) : (
                          <div style={styles.messageContent}>
                            {visible || m.content}
                            {!isUser && !isSystem && (visible || m.content) && (
                              <button
                                onClick={() => playTts((visible || m.content), (m.agent_id || null), { messageId: m.id || null })}
                                style={{ marginLeft: "8px", background: "none", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "14px", padding: "2px" }}
                                title="Ouvir esta mensagem"
                              >
                                🔊
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* V2V-PATCH: status panel por fase */}
        {v2vPhase && (
          <div style={{
            padding: "6px 14px", margin: "4px 0",
            borderRadius: "6px", fontSize: "12px", fontWeight: 500,
            background: v2vPhase === 'error' ? "rgba(192,57,43,0.15)" : "rgba(10,126,140,0.12)",
            color: v2vPhase === 'error' ? "#e74c3c" : "#0A7E8C",
            border: `1px solid ${v2vPhase === 'error' ? "rgba(192,57,43,0.3)" : "rgba(10,126,140,0.25)"}`,
            display: "flex", alignItems: "center", gap: "8px",
          }}>
            <span>{
              v2vPhase === 'recording' ? "🔴 Gravando..." :
              v2vPhase === 'stt'       ? "⚙️ Transcrevendo fala..." :
              v2vPhase === 'chat'      ? "🤖 Gerando resposta..." :
              v2vPhase === 'tts'       ? "🔊 Sintetizando voz..." :
              v2vPhase === 'playing'   ? "🔈 Reproduzindo..." :
              v2vPhase === 'error'     ? `❌ ${v2vError || "Erro no V2V"}` :
              "⏳ Aguardando..."
            }</span>
            {v2vPhase === 'error' && (
              <button type="button" onClick={() => { setV2vPhase(null); setV2vError(null); }}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#e74c3c", fontSize: "14px" }}>
                ✕
              </button>
            )}
          </div>
        )}
        {uploadStatus ? <div style={styles.uploadStatus}>{uploadStatus}</div> : null}

        {/* Composer */}
        <div style={{ ...styles.composerContainer, padding: isMobile ? "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))" : styles.composerContainer.padding }}>
          <div style={{ ...styles.composer, gap: isMobile ? "8px" : styles.composer.gap }}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={onPickFile}
              accept=".pdf,.docx,.doc,.txt,.md"
              style={{ display: "none" }}
            />

            {!isMobile ? (
              <button
                type="button"
                style={styles.attachBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress}
                title="Attach file (PDF, DOCX, TXT)"
              >
                <IconPaperclip />
              </button>
            ) : null}

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              style={styles.textarea}
              rows={1}
              disabled={sending}
            />

            {ENABLE_VOICE ? (
              <button
                type="button"
                style={{ ...styles.micBtn, opacity: (mediaRecorderSupported || speechSupported) ? 1 : 0.55 }}
                onClick={toggleMic}
                title={micEnabled ? "Parar gravação" : "Falar para transcrever"}
              >
                🎙️
              </button>
            ) : null}

            {ENABLE_REALTIME ? (
              <button
                type="button"
                style={{
                  ...styles.micBtn,
                  background: realtimeMode ? "rgba(80,160,255,0.25)" : "rgba(255,255,255,0.05)",
                  border: realtimeMode ? "1px solid rgba(80,160,255,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  position: "relative",
                  opacity: 1,
                  cursor: "pointer",
                }}
                onClick={toggleRealtimeMode}
                title={realtimeMode ? "Disable realtime voice" : "Enable realtime voice"}
              >
                <span style={{ fontSize: "16px" }}>⚡</span>
                {realtimeMode && <span style={{ position: "absolute", top: "-2px", right: "-2px", width: "8px", height: "8px", borderRadius: "50%", background: "#50a0ff", animation: "pulse 1.5s infinite" }} />}
              </button>
            ) : null}

            {!isMobile && realtimeMode && SUMMIT_VOICE_MODE === "realtime" ? (
              <button
                type="button"
                style={{
                  ...styles.sendBtn,
                  opacity: rtcReadyToRespond ? 1 : 0.5,
                  cursor: rtcReadyToRespond ? "pointer" : "not-allowed",
                }}
                onClick={() => rtcReadyToRespond && triggerRealtimeResponse("manual")}
                disabled={!rtcReadyToRespond}
                title={rtcReadyToRespond ? "Respond now (realtime)" : "Waiting for speech to finish"}
              >
                ▶️
              </button>
            ) : null}

            <button
              type="button"
              style={{ ...styles.micBtn, opacity: handoffBusy ? 0.7 : 1 }}
              onClick={handleFounderHandoff}
              disabled={handoffBusy}
              title="Talk to founder"
            >
              🤝
            </button>

            <button type="button" style={styles.sendBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => sendMessage()} disabled={sending} title="Enviar">
              <IconSend />
            </button>
          </div>
          {handoffNotice ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.78)" }}>{handoffNotice}</div>
          ) : null}
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
              AI-generated responses may contain inaccuracies. Always verify important information before relying on them.
            </div>
            <div style={{ display: isMobile ? "none" : "flex", gap: 8 }}>
              <button
                onClick={downloadRealtimeAta}
                style={{ ...styles.btn, padding: "6px 10px", fontSize: "12px", opacity: rtcSessionIdRef.current ? 1 : 0.6 }}
                title="Baixar relatório executivo da sessão"
                disabled={!rtcSessionIdRef.current}
              >
                ⬇️ Relatório
              </button>
            </div>
          </div>

          {/* Voice Mode controls — PATCH0100_14 enhanced */}
          {voiceMode && ENABLE_VOICE && !isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 8px", fontSize: "12px", color: "rgba(255,255,255,0.7)", flexWrap: "wrap" }}>
              {lastAgentInfo?.avatar_url && (
                <img src={lastAgentInfo.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} onError={(e) => { e.target.style.display = 'none'; }} />
              )}
              {lastAgentInfo?.agent_name && <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{lastAgentInfo.agent_name}</span>}
              <span>🔊 Voz:</span>
              <select
                value={ttsVoice}
                onChange={(e) => changeTtsVoice(e.target.value)}
                style={{ ...styles.select, padding: "4px 8px", fontSize: "11px" }}
              >
                <option value="auto">Auto (voz do agente)</option>
                {ORKIO_VOICES.map(v => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
</select>
              {ttsPlaying && (
                <button
                  onClick={stopTts}
                  style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}
                >
                  ⏹ Parar
                </button>
              )}
              <span style={{ opacity: 0.6 }}>
                {micEnabled ? "🔴 Ouvindo..." : ttsPlaying ? "🔊 Falando..." : "⏸ Aguardando"}
              </span>
              {!!(rtcSessionIdRef.current || rtcAuditEvents?.length) && (
                <button
                  onClick={downloadRealtimeAta}
                  style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}
                  title="Baixar relatório executivo da sessão"
                >
                  ⬇️ Relatório
                </button>
              )}
            </div>
          )}

          {/* PATCH0100_27_2B: Realtime Audit (finals + punctuação assíncrona) */}
          {SHOW_REALTIME_AUDIT && !isMobile && (rtcAuditEvents?.length > 0 || rtcPunctStatus) && (
            <div style={styles.realtimeAudit}>
              <div style={styles.realtimeAuditHeader}>
                <div style={styles.realtimeAuditTitle}>🧾 Realtime (auditável)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={styles.realtimeAuditPill}>
                    {rtcPunctStatus === 'pending' ? 'Pontuando…' : rtcPunctStatus === 'done' ? 'Pontuação OK' : rtcPunctStatus === 'timeout' ? 'Pontuação pendente' : 'Registro local'}
                  </div>
                  <button
                    onClick={downloadRealtimeAta}
                    style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}
                    title="Baixar ata da sessão"
                  >
                    ⬇️ Baixar ata
                  </button>
                </div>
              </div>
              {rtcAuditEvents.map((ev, idx) => {
                const who = ev?.role === 'user' ? 'Você' : (ev?.agent_name || 'Assistente');
                const when = ev?.created_at ? new Date(ev.created_at).toLocaleTimeString() : '';
                const text = (ev?.transcript_punct || ev?.content || '').toString();
                return (
                  <div key={(ev?.id || idx) + ''} style={styles.realtimeAuditItem}>
                    <div style={styles.realtimeAuditMeta}>
                      <div style={styles.realtimeAuditWho}>{who}</div>
                      <div style={{ opacity: 0.7 }}>{when}</div>
                    </div>
                    <div style={styles.realtimeAuditText}>{text}</div>
                  </div>
                );
              })}
              {summitSessionScore && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>🎯 Summit score</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.9 }}>
                    <span>Naturalidade: {summitSessionScore?.naturalness_score ?? "-"}</span>
                    <span>Persona: {summitSessionScore?.persona_score ?? "-"}</span>
                    <span>Duplicação: {summitSessionScore?.duplicate_count ?? 0}</span>
                    <span>Truncamento: {summitSessionScore?.truncation_count ?? 0}</span>
                  </div>
                  {!summitSessionScore?.human_review && summitRuntimeModeRef.current === "summit" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button disabled={summitReviewPending} onClick={() => submitStageReview(5, 5, 5)} style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}>✅ Forte</button>
                      <button disabled={summitReviewPending} onClick={() => submitStageReview(4, 4, 4)} style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}>🟨 Bom</button>
                      <button disabled={summitReviewPending} onClick={() => submitStageReview(2, 2, 2)} style={{ ...styles.btn, padding: "4px 8px", fontSize: "11px" }}>🛠 Ajustar</button>
                    </div>
                  )}
                </div>
              )}
              {rtcAuditEvents.length === 0 && <div style={{ opacity: 0.8 }}>Sem eventos finais ainda.</div>}
            </div>
          )}


          {destMode === "multi" ? (
            <div style={{...styles.hint, display: isMobile ? "none" : styles.hint.display}}>
              Multi: selecione os agentes abaixo (será usado no próximo envio).
              <div style={styles.checkGrid}>
                {agents.map(a => (
                  <label key={a.id} style={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={destMulti.includes(a.id)}
                      onChange={(e) => {
                        setDestMulti(prev => e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id));
                      }}
                    />
                    <span>{a.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>


      {showHandoffModal ? (
        <div style={styles.modalBack} onClick={() => { if (!handoffBusy) setShowHandoffModal(false); }}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Talk to founder</div>
            <div style={styles.hint}>
              You are about to share this conversation with the Orkio founder for follow-up.
            </div>
            <div style={{ ...styles.hint, marginTop: 8 }}>
              Orkio will share a concise summary of your context so the next step can be strategic, not repetitive.
            </div>
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", fontSize: 13, lineHeight: 1.45 }}>
              {handoffDraft || "Your latest strategic context will be shared with the founder."}
            </div>
            <div style={{ ...styles.hint, marginTop: 10 }}>
              By continuing, you explicitly authorize Orkio to share this conversation summary with the founder for direct follow-up.
            </div>
            <div style={styles.modalActions}>
              <button style={styles.btn} onClick={() => setShowHandoffModal(false)} disabled={handoffBusy}>Cancel</button>
              <button type="button" style={{ ...styles.btn, ...styles.btnPrimary, opacity: handoffBusy ? 0.7 : 1 }} onClick={confirmFounderHandoff} disabled={handoffBusy}>
                {handoffBusy ? "Sending..." : "Confirm and share"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upload Modal */}
      {uploadOpen ? (
        <div style={styles.modalBack} onClick={() => { if (!uploadProgress) setUploadOpen(false); }}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Upload: {uploadFileObj?.name || "arquivo"}</div>
            <div style={styles.hint}>Escolha como este documento será usado.</div>

            <div style={styles.radioRow}>
              <input type="radio" checked={uploadScope === "thread"} onChange={() => setUploadScope("thread")} />
              <span>Somente nesta conversa (contexto do thread)</span>
            </div>

            <div style={styles.radioRow}>
              <input type="radio" checked={uploadScope === "agents"} onChange={() => setUploadScope("agents")} />
              <span>Vincular a agente(s) específico(s)</span>
            </div>

            {uploadScope === "agents" ? (
              <div style={styles.checkGrid}>
                {agents.map(a => (
                  <label key={a.id} style={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={uploadAgentIds.includes(a.id)}
                      onChange={(e) => {
                        setUploadAgentIds(prev => e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id));
                      }}
                    />
                    <span>{a.name}</span>
                  </label>
                ))}
              </div>
            ) : null}

            <div style={styles.radioRow}>
              <input type="radio" checked={uploadScope === "institutional"} onChange={() => setUploadScope("institutional")} />
              <span>Institucional (global do tenant → todos os agentes)</span>
            </div>
            <div style={styles.hint}>
              {canAccessAdmin
                ? "Como admin, o documento vira institucional imediatamente."
                : "Como usuário, isso vira uma SOLICITAÇÃO para o admin aprovar/reprovar. Enquanto isso, ele fica disponível nesta conversa."}
            </div>

            <div style={styles.modalActions}>
              <button style={styles.btn} onClick={() => { if (!uploadProgress) setUploadOpen(false); }}>Cancelar</button>
              <button type="button" style={{ ...styles.btn, ...styles.btnPrimary, opacity: uploadProgress ? 0.7 : 1 }} onClick={confirmUpload} disabled={uploadProgress}>
                {uploadProgress ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    

{settingsOpen ? (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.65)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9998,
      padding: 16,
    }}
  >
    <div
      style={{
        width: "100%",
        maxWidth: 520,
        borderRadius: 18,
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
        color: "#fff",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Settings</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>Change your password safely inside the console.</div>
        </div>
        <button
          type="button"
          onClick={closeSettings}
          disabled={settingsBusy}
          style={{
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            borderRadius: 10,
            minWidth: 40,
            height: 40,
            cursor: settingsBusy ? "not-allowed" : "pointer",
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 700, opacity: 0.9 }}>Current password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showCurrentPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setSettingsStatus(""); }}
              style={{
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                padding: "12px 68px 12px 14px",
                boxSizing: "border-box",
              }}
              placeholder="Enter your current password"
              disabled={settingsBusy}
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword((v) => !v)}
              disabled={settingsBusy}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                border: 0,
                background: "transparent",
                color: "#cbd5e1",
                cursor: settingsBusy ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {showCurrentPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 700, opacity: 0.9 }}>New password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setSettingsStatus(""); }}
              style={{
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                padding: "12px 68px 12px 14px",
                boxSizing: "border-box",
              }}
              placeholder="Enter your new password"
              disabled={settingsBusy}
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((v) => !v)}
              disabled={settingsBusy}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                border: 0,
                background: "transparent",
                color: "#cbd5e1",
                cursor: settingsBusy ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {showNewPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 700, opacity: 0.9 }}>Confirm new password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showNewPasswordConfirm ? "text" : "password"}
              value={newPasswordConfirm}
              onChange={(e) => { setNewPasswordConfirm(e.target.value); setSettingsStatus(""); }}
              style={{
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                padding: "12px 68px 12px 14px",
                boxSizing: "border-box",
              }}
              placeholder="Repeat your new password"
              disabled={settingsBusy}
            />
            <button
              type="button"
              onClick={() => setShowNewPasswordConfirm((v) => !v)}
              disabled={settingsBusy}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                border: 0,
                background: "transparent",
                color: "#cbd5e1",
                cursor: settingsBusy ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {showNewPasswordConfirm ? "Hide" : "Show"}
            </button>
          </div>
        </div>
      </div>

      {settingsStatus ? (
        <div
          style={{
            marginTop: 16,
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 14,
            background:
              String(settingsStatus).toLowerCase().includes("success")
                ? "rgba(16,185,129,0.12)"
                : String(settingsStatus).toLowerCase().includes("updating")
                ? "rgba(37,99,235,0.12)"
                : "rgba(239,68,68,0.12)",
            border:
              String(settingsStatus).toLowerCase().includes("success")
                ? "1px solid rgba(16,185,129,0.24)"
                : String(settingsStatus).toLowerCase().includes("updating")
                ? "1px solid rgba(37,99,235,0.24)"
                : "1px solid rgba(239,68,68,0.24)",
            color: "#fff",
          }}
        >
          {settingsStatus}
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button
          type="button"
          onClick={closeSettings}
          disabled={settingsBusy}
          style={{
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            borderRadius: 12,
            minHeight: 44,
            padding: "0 16px",
            cursor: settingsBusy ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submitPasswordChange}
          disabled={settingsBusy}
          style={{
            border: 0,
            background: "linear-gradient(135deg, #2563eb, #0f172a)",
            color: "#fff",
            borderRadius: 12,
            minHeight: 44,
            padding: "0 16px",
            fontWeight: 800,
            cursor: settingsBusy ? "not-allowed" : "pointer",
            opacity: settingsBusy ? 0.75 : 1,
          }}
        >
          {settingsBusy ? "Saving..." : "Update password"}
        </button>
      </div>
    </div>
  </div>
) : null}


{capacityOpen ? (
  <div style={{
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
  }}>
    <div style={{
      background: "#0f0f10", color: "#fff", padding: 24, borderRadius: 12,
      maxWidth: 520, width: "92%", boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
        Estamos operando no limite seguro da plataforma
      </div>
      <div style={{ opacity: 0.9, lineHeight: 1.4, marginBottom: 14 }}>
        Muitas pessoas estão acessando ao mesmo tempo. Para manter a estabilidade durante o evento,
        alguns acessos estão temporariamente limitados.
      </div>
      <div style={{ opacity: 0.9, marginBottom: 16 }}>
        Tentaremos novamente em <b>{capacitySeconds}s</b>.
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={{ padding: "10px 14px", borderRadius: 10 }} onClick={() => {
          const pending = capacityPendingRef.current;
          closeCapacityModal();
          if (pending?.msg) sendMessage(pending.msg, { isRetry: true });
        }}>
          Tentar agora
        </button>
        <button style={{ padding: "10px 14px", borderRadius: 10, opacity: 0.9 }} onClick={closeCapacityModal}>
          Voltar
        </button>
      </div>
    </div>
  </div>
) : null}

</div>
    </>
  );
}

