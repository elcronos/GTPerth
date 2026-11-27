// Sound: offline-synthesised SFX bank (cookbook), player vehicle engine, a live two-tone Australian siren, horn,
// river lapping + city/wind beds, magpie warbles and gulls, and a dusk/chase score that rises with the wanted level.
import { createMixer } from '../../cookbook/audio/mixer.js';
import { buildBank, engineVoice, ENGINE_BASE_RPM } from '../../cookbook/audio/sfx.js';
import { buildMusic, createMusic, SONGS } from '../../cookbook/audio/music.js';

export function createAudio(G) {
  const mixer = createMixer({ volume: 0.8 });
  const A = { mixer, ready: false, music: null, chase: null, engine: null, siren: null, sirenOn: false };
  A.play = (name, o) => (A.ready && mixer.ctx.state === 'running' && mixer.has(name) ? mixer.play(name, o) : null);
  G.on('ready', () => (async () => {
    mixer.addBank(await buildBank(mixer.ctx, { sr: Math.min(44100, mixer.ctx.sampleRate) }));
    const dusk = await buildMusic(mixer.ctx, SONGS.dusk), chase = await buildMusic(mixer.ctx, SONGS.chase);
    await mixer.setEnv('outdoor');
    const start = () => {
      A.ready = true;
      A.music = createMusic(mixer, dusk, { intensity: 0.25 }); A.music.start();
      A.chase = createMusic(mixer, chase, { intensity: 0.0 });
      mixer.play('sea', { loop: true, bus: 'ambience', gain: 0.32 });
      mixer.play('wind', { loop: true, bus: 'ambience', gain: 0.12 });
    };
    if (mixer.ctx.state === 'running') start(); else mixer.unlocked.then(start);
  })().catch((e) => G.errors.push('audio: ' + (e && e.message || e))));
  G.on('update', () => mixer.update(G.camera));

  // live siren: wail between ~650 and ~1450 Hz (Australian "wail"), square-ish through a band-pass
  function makeSiren() {
    const ctx = mixer.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 1000; f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8;
    lfo.frequency.value = 0.22; lg.gain.value = 400; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.value = 0; o.connect(f); f.connect(g); g.connect(mixer.bus('sfx'));
    o.start(); lfo.start();
    return { g, lfo };
  }
  A.setSiren = (on, dist = 50) => {
    if (!A.ready) return;
    if (!A.siren) A.siren = makeSiren();
    const target = on ? Math.max(0.0, 0.16 * Math.min(1, 40 / Math.max(10, dist))) : 0;
    A.siren.g.gain.setTargetAtTime(target, mixer.ctx.currentTime, 0.2);
  };
  A.horn = () => {
    if (!A.ready) return;
    const ctx = mixer.ctx, t = ctx.currentTime, g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.setValueAtTime(0.16, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.45);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g); g.connect(mixer.bus('sfx'));
    for (const fr of [415, 520]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(lp); o.start(t); o.stop(t + 0.5); }
  };
  // magpie warble / gull: little FM chirps
  A.bird = (pos) => {
    if (!A.ready) return;
    const ctx = mixer.ctx, t = ctx.currentTime, g = ctx.createGain(); g.connect(mixer.bus('ambience')); g.gain.value = 0;
    const o = ctx.createOscillator(); o.type = 'sine'; o.connect(g);
    let tt = t; const n = 4 + (Math.random() * 5 | 0);
    for (let i = 0; i < n; i++) { const f = 900 + Math.random() * 1800; o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.8), tt + 0.12); g.gain.setValueAtTime(0.0, tt); g.gain.linearRampToValueAtTime(0.03, tt + 0.02); g.gain.linearRampToValueAtTime(0, tt + 0.14); tt += 0.12 + Math.random() * 0.1; }
    o.start(t); o.stop(tt + 0.1);
  };
  A.setVehicle = (v) => {
    if (A.engine) { A.engine.stop(); A.engine = null; }
    if (v && A.ready) A.engine = engineVoice(mixer, { follow: v.root, gain: v.kind === 'ferry' ? 1.3 : 0.9 });
    A.vehicle = v;
  };
  let birdT = 3;
  A.update = (dt, { wanted, player }) => {
    if (!A.ready) return;
    const v = A.vehicle;
    if (A.engine && v) {
      const sp = Math.abs(v.speed);
      const ferry = v.kind === 'ferry' || v.kind === 'policeboat';
      const rpm = ferry ? ENGINE_BASE_RPM * (0.55 + sp * 0.06) : ENGINE_BASE_RPM * (0.8 + (sp % 12) * 0.18 + Math.floor(sp / 12) * 0.25);
      A.engine.set(rpm, Math.max(0.1, Math.abs(v.throttle)));
    }
    // score: chase stem rises with stars
    const k = Math.min(1, wanted.stars / 3);
    A.music?.setIntensity?.(0.25 * (1 - k), 1.5);
    if (A.chase) { if (k > 0 && !A.chaseOn) { A.chase.start(); A.chaseOn = true; } A.chase.setIntensity?.(k, 1.5); }
    birdT -= dt; if (birdT <= 0) { birdT = 4 + Math.random() * 9; if (!player.vehicle || player.vehicle.kind !== 'ferry') A.bird(); }
  };
  A.setVolume = (v) => { mixer.master.gain.value = v; };
  return A;
}
