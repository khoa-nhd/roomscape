/**
 * Game sounds, made with the Web Audio API. Browser only.
 * Every sound is synthesised here, so there are no audio files to load or license.
 */

export type Sfx = "look" | "denied" | "pickup" | "unlock" | "wrong" | "win" | "tick";
export type Mood = "detective" | "horror" | "scifi";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: { stop: () => void } | null = null;
let muted = false;

const MUTE_KEY = "roomscape:muted";

/** Call from a click or key press: browsers only allow sound after the player does something. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {}
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  master!.gain.value = muted ? 0 : 0.5;
  ctx.resume().catch(() => {});
}

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {}
  if (ctx && master) master.gain.setTargetAtTime(next ? 0 : 0.5, ctx.currentTime, 0.05);
}

/** One note with a quick attack and a fade. */
function tone(freq: number, at: number, length: number, type: OscillatorType, volume: number, slideTo?: number) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + at + length);
  gain.gain.setValueAtTime(0, ctx.currentTime + at);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length);
  osc.connect(gain).connect(master);
  osc.start(ctx.currentTime + at);
  osc.stop(ctx.currentTime + at + length + 0.05);
}

function noiseBuffer(seconds: number): AudioBuffer {
  const buffer = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * seconds), ctx!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A short burst of filtered noise: clicks, thuds, static. */
function noise(at: number, length: number, freq: number, volume: number) {
  if (!ctx || !master) return;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(length);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length);
  source.connect(filter).connect(gain).connect(master);
  source.start(ctx.currentTime + at);
}

export function play(sfx: Sfx) {
  if (!ctx || muted) return;
  if (sfx === "look") tone(520, 0, 0.07, "sine", 0.12);
  else if (sfx === "tick") tone(880, 0, 0.04, "square", 0.05);
  else if (sfx === "denied") {
    tone(150, 0, 0.16, "sawtooth", 0.14, 110);
    noise(0, 0.08, 400, 0.2);
  } else if (sfx === "wrong") {
    tone(190, 0, 0.14, "square", 0.12);
    tone(140, 0.13, 0.22, "square", 0.12);
  } else if (sfx === "pickup") {
    [660, 880, 1320].forEach((f, i) => tone(f, i * 0.08, 0.28, "triangle", 0.2));
  } else if (sfx === "unlock") {
    noise(0, 0.05, 2400, 0.5);
    noise(0.09, 0.07, 900, 0.5);
    [392, 523, 659].forEach((f) => tone(f, 0.18, 0.6, "sine", 0.13));
  } else if (sfx === "win") {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.7, "triangle", 0.18));
    [262, 392].forEach((f) => tone(f, 0.55, 1.4, "sine", 0.14));
  }
}

/** Note frequency, counted in semitones from A3 (220 Hz). */
const hz = (semitones: number) => 220 * 2 ** (semitones / 12);

type Score = {
  /** Seconds per beat. */
  beat: number;
  /** Chords, one per bar of eight beats, as semitones from A3. */
  chords: number[][];
  /** Notes the tune may use, low to high. */
  scale: number[];
  /** Chance that a beat carries a tune note. */
  density: number;
  lead: OscillatorType;
  leadVolume: number;
  padVolume: number;
  /** How bright the whole mix is, in Hz. */
  tone: number;
};

const SCORES: Record<Mood, Score> = {
  // Slow, smoky minor: a late-night piano over held chords.
  detective: {
    beat: 0.62,
    chords: [[-12, 0, 3, 7], [-16, -4, 0, 5], [-19, -7, 2, 5], [-17, -5, -1, 2]],
    scale: [0, 3, 5, 7, 10, 12, 15, 17],
    density: 0.55,
    lead: "triangle",
    leadVolume: 0.07,
    padVolume: 0.028,
    tone: 2200,
  },
  // A music box that has been left running: sparse, high, slightly wrong.
  horror: {
    beat: 0.95,
    chords: [[-19, -7, -4, 0], [-20, -8, -4, -1], [-19, -7, -4, 0], [-23, -11, -5, -2]],
    scale: [5, 8, 11, 12, 15, 17, 20],
    density: 0.4,
    lead: "sine",
    leadVolume: 0.06,
    padVolume: 0.032,
    tone: 1500,
  },
  // A steady, bright arpeggio over wide chords.
  scifi: {
    beat: 0.31,
    chords: [[-12, 0, 7, 12], [-16, -4, 3, 8], [-9, 3, 7, 10], [-14, -2, 5, 10]],
    scale: [0, 3, 7, 10, 12, 15, 19, 22],
    density: 0.8,
    lead: "triangle",
    leadVolume: 0.045,
    padVolume: 0.024,
    tone: 3200,
  },
};

/** Background music for the room's theme, composed as it plays. Replaces whatever was playing. */
export function startAmbience(mood: Mood) {
  stopAmbience();
  if (!ctx || !master) return;
  const audio = ctx;
  const score = SCORES[mood];

  const out = audio.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(1, audio.currentTime + 3);
  const soften = audio.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = score.tone;
  soften.connect(out).connect(master);

  // An echo gives the few notes some room to ring in.
  const echo = audio.createDelay(2);
  echo.delayTime.value = score.beat * 1.5;
  const feedback = audio.createGain();
  feedback.gain.value = 0.35;
  echo.connect(feedback).connect(echo);
  echo.connect(soften);

  /** One soft note: slow in, slow out. */
  const note = (freq: number, at: number, length: number, type: OscillatorType, volume: number, attack: number, wet: boolean) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(soften);
    if (wet) gain.connect(echo);
    osc.start(at);
    osc.stop(at + length + 0.1);
  };

  let beat = 0;
  let step = 3; // where the tune is in the scale
  const tick = () => {
    if (muted || audio.state !== "running") return;
    const at = audio.currentTime + 0.05;
    const bar = Math.floor(beat / 8) % score.chords.length;
    const chord = score.chords[bar];
    if (beat % 8 === 0) {
      // Held chord: each voice doubled a few cents apart so it shimmers instead of buzzing.
      const length = score.beat * 9;
      for (const n of chord) {
        note(hz(n) * 0.997, at, length, "sine", score.padVolume, length * 0.3, false);
        note(hz(n) * 1.003, at, length, "triangle", score.padVolume * 0.6, length * 0.3, false);
      }
    }
    if (mood === "scifi") {
      // The arpeggio walks up the chord, an octave higher, and rests now and then.
      if (Math.random() < score.density) note(hz(chord[beat % chord.length] + 12), at, score.beat * 2.2, score.lead, score.leadVolume, 0.01, true);
    } else if (Math.random() < score.density || beat % 8 === 0) {
      // The tune moves by small steps, so it sounds played, not random.
      step = Math.max(0, Math.min(score.scale.length - 1, step + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
      note(hz(score.scale[step]), at, score.beat * 3.5, score.lead, score.leadVolume, 0.015, true);
      if (mood === "detective") note(hz(score.scale[step]) * 2, at, score.beat * 1.5, "sine", score.leadVolume * 0.25, 0.01, true);
    }
    beat++;
  };
  tick();
  const timer = window.setInterval(tick, score.beat * 1000);

  ambience = {
    stop() {
      window.clearInterval(timer);
      out.gain.cancelScheduledValues(audio.currentTime);
      out.gain.setTargetAtTime(0, audio.currentTime, 0.3);
      window.setTimeout(() => {
        feedback.disconnect();
        echo.disconnect();
        soften.disconnect();
        out.disconnect();
      }, 1500);
    },
  };
}

export function stopAmbience() {
  ambience?.stop();
  ambience = null;
}
