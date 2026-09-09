/**
 * Sound effects, synthesised at runtime with the Web Audio API.
 *
 * There are no audio files anywhere in this project. Every sound is generated
 * from oscillators and gain envelopes when it plays, which keeps the bundle
 * small, works with no network, and means nothing here depends on an asset
 * licence.
 *
 * The palette is deliberately restrained. Sounds mark state changes the eye
 * might miss during a run: a step landing, a retry firing, a fallback taking
 * over, a workflow stopping safely. Anything more would be noise, and the app
 * starts muted-until-first-interaction anyway because browsers require a
 * gesture before audio may start.
 */

type Voice = 'sine' | 'triangle' | 'square' | 'sawtooth'

interface ToneSpec {
  freq: number
  /** Seconds. */
  duration: number
  voice?: Voice
  /** Peak gain, 0 to 1, before the master volume is applied. */
  gain?: number
  /** Seconds to wait before this tone starts. */
  delay?: number
  /** Slide to this frequency across the tone's life. */
  glideTo?: number
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let unlocked = false

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.16
    master.connect(ctx.destination)
  }
  return ctx
}

/**
 * Browsers refuse to start audio without a user gesture. Call this from the
 * first click; every later sound then plays without a warning in the console.
 */
export function unlockAudio(): void {
  if (unlocked) return
  const c = context()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  unlocked = true
}

export function setSoundEnabled(next: boolean): void {
  enabled = next
  if (next) unlockAudio()
}

export function isSoundEnabled(): boolean {
  return enabled
}

function play(spec: ToneSpec[]): void {
  if (!enabled) return
  const c = context()
  if (!c || !master) return
  if (c.state === 'suspended') void c.resume()

  const now = c.currentTime
  for (const tone of spec) {
    const start = now + (tone.delay ?? 0)
    const osc = c.createOscillator()
    const gain = c.createGain()

    osc.type = tone.voice ?? 'sine'
    osc.frequency.setValueAtTime(tone.freq, start)
    if (tone.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, tone.glideTo),
        start + tone.duration,
      )
    }

    const peak = tone.gain ?? 0.6
    // A short attack and an exponential tail keeps everything click free.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration)

    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(start + tone.duration + 0.02)
  }
}

/* -------------------------------------------------------------------------- */
/* The palette                                                                 */
/* -------------------------------------------------------------------------- */

export const sfx = {
  /** A block is picked up or dropped onto the canvas. */
  place: () => play([{ freq: 420, duration: 0.09, voice: 'triangle', gain: 0.4 }]),

  /** A step completed normally. Rises slightly, so a chain of them lifts. */
  stepOk: (index = 0) =>
    play([
      {
        freq: 520 + Math.min(index, 6) * 40,
        duration: 0.11,
        voice: 'sine',
        gain: 0.35,
      },
    ]),

  /** A step failed. Falls, and stays out of the way of the ear. */
  stepFail: () =>
    play([
      { freq: 260, glideTo: 150, duration: 0.26, voice: 'sawtooth', gain: 0.28 },
    ]),

  /** A retry is firing. Two quick, identical taps: "again". */
  retry: () =>
    play([
      { freq: 380, duration: 0.07, voice: 'square', gain: 0.22 },
      { freq: 380, duration: 0.07, voice: 'square', gain: 0.22, delay: 0.1 },
    ]),

  /** A fallback provider took over. A sideways step, not a failure. */
  fallback: () =>
    play([
      { freq: 340, duration: 0.1, voice: 'triangle', gain: 0.3 },
      { freq: 510, duration: 0.16, voice: 'triangle', gain: 0.3, delay: 0.09 },
    ]),

  /** A validator rejected the payload. */
  invalid: () =>
    play([
      { freq: 300, duration: 0.08, voice: 'square', gain: 0.25 },
      { freq: 220, duration: 0.16, voice: 'square', gain: 0.25, delay: 0.07 },
    ]),

  /** The workflow paused and is waiting on a person. */
  awaitHuman: () =>
    play([
      { freq: 660, duration: 0.12, voice: 'sine', gain: 0.3 },
      { freq: 880, duration: 0.18, voice: 'sine', gain: 0.26, delay: 0.13 },
    ]),

  /** The run finished successfully. A small major arpeggio. */
  success: () =>
    play([
      { freq: 523.25, duration: 0.14, voice: 'triangle', gain: 0.34 },
      { freq: 659.25, duration: 0.14, voice: 'triangle', gain: 0.34, delay: 0.11 },
      { freq: 783.99, duration: 0.3, voice: 'triangle', gain: 0.34, delay: 0.22 },
    ]),

  /** The puzzle's completion criteria were all met. Bigger, and earned. */
  solved: () =>
    play([
      { freq: 523.25, duration: 0.13, voice: 'triangle', gain: 0.36 },
      { freq: 659.25, duration: 0.13, voice: 'triangle', gain: 0.36, delay: 0.1 },
      { freq: 783.99, duration: 0.13, voice: 'triangle', gain: 0.36, delay: 0.2 },
      { freq: 1046.5, duration: 0.42, voice: 'triangle', gain: 0.4, delay: 0.3 },
      { freq: 1318.5, duration: 0.42, voice: 'sine', gain: 0.2, delay: 0.32 },
    ]),

  /** The run ended in an unhandled failure. */
  failure: () =>
    play([
      { freq: 330, duration: 0.16, voice: 'sawtooth', gain: 0.3 },
      { freq: 247, duration: 0.16, voice: 'sawtooth', gain: 0.3, delay: 0.14 },
      { freq: 165, glideTo: 110, duration: 0.42, voice: 'sawtooth', gain: 0.3, delay: 0.28 },
    ]),

  /** The workflow stopped safely. Deliberate, not sad. */
  safeStop: () =>
    play([
      { freq: 440, duration: 0.16, voice: 'sine', gain: 0.3 },
      { freq: 349.23, duration: 0.34, voice: 'sine', gain: 0.3, delay: 0.15 },
    ]),

  /** Generic click for panel controls. */
  click: () => play([{ freq: 640, duration: 0.045, voice: 'sine', gain: 0.18 }]),
}
