import { getToken, getTenant } from "./auth.js";
import { heartbeat } from "../ui/api.js";

export function startSessionHeartbeat({
  intervalMs = 20000,
  onUnauthorized = null,
} = {}) {
  let alive = true;
  let timer = null;

  async function tick() {
    const token = getToken();
    const org = getTenant();

    if (!token) return;

    try {
      await heartbeat({ token, org });
    } catch (err) {
      if (err?.status === 401) {
        alive = false;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (typeof onUnauthorized === "function") {
          try {
            onUnauthorized(err);
          } catch {}
        }
      }
    }
  }

  tick();
  timer = setInterval(() => {
    if (alive) tick();
  }, intervalMs);

  return () => {
    alive = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
