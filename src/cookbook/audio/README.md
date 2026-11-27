# audio/ — offline-synthesised SFX, music stems, generated reverb, small live graph

Everything is rendered sample-by-sample into Float32Arrays inside **yielding generators**, time-sliced
(~6 ms per slice) so boot keeps animating. No audio files. Full bank (58 buffers) ≈ 1.5 s CPU at 44.1 kHz,
music stems ≈ 1 s at 32 kHz — run it after `G.ready`, not before the first frame.

## Files / API
| file | exports |
|---|---|
| `synth.js` | `render(recipe, {sr, seed, name})*` → `{L,R,sr,peak}` · `runJobs(gens, {budgetMs, onProgress})` → Promise · `toAudioBuffer(ctx,res)` · DSP: `Osc` (polyBLEP saw/square/pulse, sine, tri) `Noise` (white/pink/brown) `Biquad` (lp hp bp notch peak shelves) `OnePole` `Comb` `Allpass` `softclip` `fold` `envelope` `P` (param curves) `midiToHz` `dbToGain` |
| `sfx.js` | `PRESETS` (27 names, see below) · `buildBank(ctx, {sr, only})` → `{name: AudioBuffer[]}` · `presetJobs()` · `engineVoice(mixer, {follow,pos})` → `{set(rpm, load), stop()}` · `ENGINE_BASE_RPM` |
| `reverb.js` | `makeIR(ctx, kind)` → AudioBuffer · `renderIR(kind)*` · `IR_KINDS` = outdoor, hall, room, cave |
| `music.js` | `SONGS` (dusk, calm, chase) · `buildMusic(ctx, song, {sr})` → `{stems, loop, bpm}` · `createMusic(mixer, music, {intensity})` → `{start(), stop(fade), setIntensity(x, sec)}` · `parseChord('Dm7')` · `INTENSITY` curves |
| `mixer.js` | `createMixer({volume, maxVoices})` → `mixer` (below) |
| `meter.js` | `analyse(res)` · `audioSelfTest()` · `installAudioSelfTest()` → `window.__audioSelfTest()` |

**Presets:** rifle×2, pistol×2, shotgun×2, explosion_near×2, explosion_far×2, impact_metal×3, impact_concrete×3,
impact_flesh×3, step_concrete/metal/grass/snow ×4 each, reload, dry_click, ui_click, ui_hover, ui_confirm, pickup,
alarm (loop), drone_hum (loop), engine_idle / engine_high (loops, rpm via rate), wind / rain / sea (loops),
growl×2, laser×2, whoosh×2, ricochet×2, whiz×2. `mixer.play(name)` picks a random variant + ±4 % pitch.

**mixer:** `ctx, play(name|AudioBuffer, opts) → voice{stop(fade), setRate, setGain, setPos}`, `addBank(bank)`,
`setEnv('outdoor'|'hall'|'room'|'cave')` (A/B convolver crossfade), `duck(bus, db, attack, hold, release)`,
`update(camera)` (listener; zero-alloc), `setVolume(bus|'master', v)`, `unlock()` / `unlocked` (Promise; armed
automatically on first pointerdown/keydown/touchend), `bus(name)`. Buses: `sfx` 1.0, `music` 0.55, `ambience` 0.7, `ui` 0.6 →
duck → master → limiter (DynamicsCompressor −6 dB, 20:1, 2 ms) → trim 0.95.
play opts: `bus, gain, rate, pitchJitter, loop, send` (reverb 0..1), `when`, `pos` ([x,y,z]|Vector3 → HRTF + air-absorption
lowpass), `follow` (Object3D tracked in update), `refDistance` (2), `rolloff` (1), `speedOfSound` (delay = d/343), `duck:{bus,db,hold,release}`.

## Wiring
```js
import { createMixer } from './audio/mixer.js';
import { buildBank, engineVoice } from './audio/sfx.js';
import { buildMusic, createMusic, SONGS } from './audio/music.js';
import { installAudioSelfTest } from './audio/meter.js';
const mixer = createMixer(); installAudioSelfTest();
G.on('update', () => mixer.update(G.camera));
G.on('ready', async () => {
  mixer.addBank(await buildBank(mixer.ctx, { sr: Math.min(48000, mixer.ctx.sampleRate) }));
  await mixer.setEnv('outdoor');
  const music = createMusic(mixer, await buildMusic(mixer.ctx, SONGS.dusk));
  mixer.unlocked.then(() => { music.start(); mixer.play('wind', { loop: true, bus: 'ambience', gain: 0.4 }); });
  G.music = music;                                   // director: music.setIntensity(alert ? 1 : 0.3, 2)
});
// weapon:  mixer.play('rifle', { pos: muzzle, send: 0.45, duck: { db: -4, hold: 0.05 } });
// impact:  mixer.play('impact_' + surface, { pos: hit, send: 0.3 });
// steps:   mixer.play('step_' + groundKind, { pos: feet, gain: 0.7 });   (4 variants, random)
// boom:    mixer.play(dist < 60 ? 'explosion_near' : 'explosion_far', { pos, send: 0.6, speedOfSound: true, duck: { db: -9, hold: 0.6, release: 2 } });
```
Check: `cookbook/three/audio/meter.js` renders every SFX preset, music stem and reverb IR offline and meters them (pass = peak ≤ -1 dBFS, no NaN/Inf, not silent, no clipped samples); on a built page call `window.__audioSelfTest()`.

## Recipe format (make your own sounds)
`{ dur, peakDb, loop: seconds|'wrap', tail, layers:[...], fx:[...] }`; layer types `osc` (wave, freq PARAM, fm{ratio,index},
voices, detune), `noise` (color, stereo), `partials` (modal [ratio, amp, T60]), `crackle` (rate, grain), `impulse`, `custom`
(`gen*(out,i0,n,sr,rng)`); every layer: `start, dur, amp, pan, env{a,h,d(T60),s,r}|PARAM, filters[{type,f:PARAM,q,gain}], drive, fold, am{f,depth}`.
PARAM = number | `[[t,v],…]` | `{from,to,time,curve:'exp'}` | `t=>v`. fx: `echo, comb, allpass, drive, width, lp/hp/…`.
Full commented spec at the top of `synth.js`. Gunshot = crack (HP noise <15 ms) + body (pink LP sweep 5k→400 + sine 170→46 Hz) + tail (brown, slow LP) + slap echoes.

## Tuning tips
- Relative loudness lives in each preset's `peakDb` (every render is peak-normalised to it) — the meter can therefore never
  see a clip; it guards NaN/silence/regressions. Balance with buses, not by editing samples.
- Loops: noise beds use `loop: seconds` (equal-power crossfade); periodic content (engine, alarm, music) uses `'wrap'`.
  Modulation rates in loops must complete whole cycles in `dur` (see `drone_hum`, tension tremolo).
- New song: `{ bpm, beatsPerChord, chords: ['Am','F','C','G'] }` (qualities: m 7 maj7 m7 m9 add9 sus2 sus4 dim 5).
- Footsteps: alternate variants yourself if you want strict non-repetition (`mixer.play(bank.step_snow[i++ % 4])`).

## Cost
Live: ~3–4 nodes per voice (+ panner/biquad for 3D), maxVoices 48 (oldest stolen), one convolver active. Offline: see top.
Lower tiers can pass `sr: 32000` to buildBank (a proven rate) and `only: [...]` to skip unused presets.

## Pitfalls
- `play()` returns `null` until the context is running (never queues bursts of sounds before unlock).
- Never create per-frame voices for continuous sounds: start a loop once, then `setRate/setGain/setPos`.
- HRTF needs the listener updated every frame (`mixer.update(camera)`), otherwise panning freezes.
- Reverb send on UI/music: keep 0 (dry). Big sends on every shot muddy the mix — 0.3–0.5 for weapons outdoors.
