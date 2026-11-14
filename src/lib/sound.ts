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

/** A quiet background bed for the room's theme. Replaces whatever was playing. */
export function startAmbience(mood: Mood) {
  stopAmbience();
  if (!ctx || !master) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
  out.connect(master);
  const nodes: (AudioScheduledSourceNode | AudioNode)[] = [];
  const timers: number[] = [];

  const drone = (freq: number, type: OscillatorType, volume: number, wobble = 0) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    if (wobble) {
      const lfo = ctx!.createOscillator();
      const depth = ctx!.createGain();
      lfo.frequency.value = wobble;
      depth.gain.value = volume * 0.6;
      lfo.connect(depth).connect(gain.gain);
      lfo.start();
      nodes.push(lfo);
    }
    osc.connect(gain).connect(out);
    osc.start();
    nodes.push(osc);
  };
  const hiss = (freq: number, q: number, volume: number, type: BiquadFilterType = "bandpass") => {
    const source = ctx!.createBufferSource();
    source.buffer = noiseBuffer(3);
    source.loop = true;
    const filter = ctx!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx!.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(out);
    source.start();
    nodes.push(source);
  };

  if (mood === "detective") {
    // Rain on a window, and a clock.
    hiss(5200, 0.4, 0.05, "highpass");
    hiss(900, 0.6, 0.03);
    timers.push(window.setInterval(() => !muted && tone(1900, 0, 0.03, "square", 0.02), 1000));
  } else if (mood === "horror") {
    drone(46, "sine", 0.16, 0.13);
    drone(69.5, "sine", 0.06, 0.07);
    hiss(240, 2, 0.03);
  } else {
    drone(110, "sawtooth", 0.012);
    drone(55, "sine", 0.12, 0.2);
    hiss(3200, 6, 0.012);
    timers.push(window.setInterval(() => !muted && tone(1480, 0, 0.09, "sine", 0.025), 5300));
  }

  ambience = {
    stop() {
      timers.forEach((t) => window.clearInterval(t));
      if (!ctx) return;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      window.setTimeout(() => {
        nodes.forEach((n) => "stop" in n && (n as AudioScheduledSourceNode).stop());
        out.disconnect();
      }, 1500);
    },
  };
}

export function stopAmbience() {
  ambience?.stop();
  ambience = null;
}
