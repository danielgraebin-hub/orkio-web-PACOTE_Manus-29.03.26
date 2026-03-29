// Central voice registry for Orkio (Admin + App must stay consistent)
// id: the value sent to the realtime API

// Realtime voices supported in current Orkio environment:
// alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
export const ORKIO_VOICES = [
  { id: "cedar", label: "Cedar (masculina, grave)" },
  { id: "echo", label: "Echo (masculina)" },
  { id: "alloy", label: "Alloy (neutra)" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "verse", label: "Verse" },
  { id: "marin", label: "Marin" },
];

// Backward-compatible aliases (legacy -> supported)
const VOICE_ALIASES = {
  nova: "cedar",
  onyx: "echo",
  fable: "sage",
};

export const ORKIO_VOICE_IDS = new Set(ORKIO_VOICES.map(v => v.id));

export function coerceVoiceId(value, fallback = "cedar") {
  const v0 = (value || "").toString().trim().toLowerCase();
  const v = VOICE_ALIASES[v0] || v0;
  return ORKIO_VOICE_IDS.has(v) ? v : fallback;
}
