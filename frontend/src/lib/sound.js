/**
 * Web-Audio synthesised notification sounds (no external audio files).
 *
 * Two layers:
 *   1) `SOUND_PROFILES` — 6 distinct pleasant signatures (chime, doorbell,
 *      two-tone, marimba, soft pop, alert). The user picks any of these per
 *      event type via /admin/settings.
 *   2) Event → profile mapping. `playEventSound(event)` looks up the
 *      configured profile, falls back to a sensible default.
 */

let _ctx = null;
function ctx() {
    if (typeof window === "undefined") return null;
    if (!_ctx) {
        const Cls = window.AudioContext || window.webkitAudioContext;
        if (!Cls) return null;
        _ctx = new Cls();
    }
    if (_ctx.state === "suspended") {
        _ctx.resume().catch(() => {});
    }
    return _ctx;
}

function envOsc(ac, t0, { f, dur, type = "sine", peak = 0.4, attack = 0.01, release = 0.08 }) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.linearRampToValueAtTime(peak * 0.6, t0 + dur - release);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
}

// Each profile is a function that schedules a multi-note sequence on the AudioContext.
const SOUND_PROFILES = {
    chime: (ac) => {
        const t = ac.currentTime;
        envOsc(ac, t,        { f: 880,  dur: 0.18, type: "sine", peak: 0.35 });
        envOsc(ac, t + 0.10, { f: 1175, dur: 0.20, type: "sine", peak: 0.35 });
        envOsc(ac, t + 0.22, { f: 1568, dur: 0.30, type: "sine", peak: 0.35 });
    },
    doorbell: (ac) => {
        const t = ac.currentTime;
        envOsc(ac, t,        { f: 784,  dur: 0.32, type: "triangle", peak: 0.4 });
        envOsc(ac, t + 0.36, { f: 622,  dur: 0.45, type: "triangle", peak: 0.4 });
    },
    two_tone: (ac) => {
        const t = ac.currentTime;
        envOsc(ac, t,        { f: 988,  dur: 0.15, type: "sine", peak: 0.4 });
        envOsc(ac, t + 0.18, { f: 1318, dur: 0.22, type: "sine", peak: 0.4 });
    },
    marimba: (ac) => {
        const t = ac.currentTime;
        // C5 - E5 - G5 - C6 mallet-ish using triangle + short release
        envOsc(ac, t,        { f: 523,  dur: 0.16, type: "triangle", peak: 0.35, release: 0.12 });
        envOsc(ac, t + 0.09, { f: 659,  dur: 0.16, type: "triangle", peak: 0.35, release: 0.12 });
        envOsc(ac, t + 0.18, { f: 784,  dur: 0.16, type: "triangle", peak: 0.35, release: 0.12 });
        envOsc(ac, t + 0.27, { f: 1046, dur: 0.30, type: "triangle", peak: 0.35, release: 0.18 });
    },
    soft_pop: (ac) => {
        const t = ac.currentTime;
        envOsc(ac, t,        { f: 660,  dur: 0.10, type: "sine", peak: 0.30 });
        envOsc(ac, t + 0.12, { f: 990,  dur: 0.18, type: "sine", peak: 0.32 });
    },
    alert: (ac) => {
        const t = ac.currentTime;
        // urgent square-wave sweep
        envOsc(ac, t,        { f: 880,  dur: 0.12, type: "square", peak: 0.35 });
        envOsc(ac, t + 0.16, { f: 660,  dur: 0.14, type: "square", peak: 0.35 });
        envOsc(ac, t + 0.34, { f: 880,  dur: 0.20, type: "square", peak: 0.35 });
    },
};

export const SOUND_OPTIONS = [
    { key: "chime",     label: "Chime (bright, friendly)" },
    { key: "doorbell",  label: "Doorbell (classic ding-dong)" },
    { key: "two_tone",  label: "Two-tone (short notification)" },
    { key: "marimba",   label: "Marimba (warm, layered)" },
    { key: "soft_pop",  label: "Soft pop (subtle)" },
    { key: "alert",     label: "Alert (urgent)" },
];

// Default event → sound mapping. Overridden by the global settings doc.
const DEFAULT_EVENT_SOUND = {
    new_request: "chime",
    new_order:   "marimba",
    accepted:    "soft_pop",
    started:     "two_tone",
    ready:       "doorbell",
    escalated:   "alert",
    visitor:     "soft_pop",
};

let _eventConfig = { ...DEFAULT_EVENT_SOUND };

/** Update the global event → profile mapping (call after fetching /api/settings). */
export function setSoundConfig(map) {
    if (!map || typeof map !== "object") return;
    _eventConfig = { ...DEFAULT_EVENT_SOUND, ...map };
}

export function getEventSoundKey(event) {
    return _eventConfig[event] || DEFAULT_EVENT_SOUND[event] || "chime";
}

/** Play a specific sound profile by key (used by the settings preview button). */
export function playSoundByKey(key) {
    try {
        const ac = ctx();
        if (!ac) return;
        const profile = SOUND_PROFILES[key] || SOUND_PROFILES.chime;
        profile(ac);
    } catch {}
}

/** Play the sound configured for an event. */
export function playEventSound(event) {
    try {
        const key = getEventSoundKey(event);
        playSoundByKey(key);
    } catch {}
}

/** Prime the audio context on first user interaction (browser policy). */
export function primeAudio() {
    const ac = ctx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});
}
