// Art direction constants (schema: cookbook/CONTRACT.md). Pick a preset from references/art-direction.md, then tune
// here ONLY — every cookbook system reads G.ART at build time. Colours are LINEAR RGB; intensities are HDR.
// Sample: rainy golden-hour harbour. Read-only at runtime.
export const ART = {
  sun:   { elevDeg: 12, azimDeg: 210, color: [1.0, 0.72, 0.45], intensity: 8.0 },   // low + warm + backlit hero poses
  sky:   { zenith: [0.10, 0.16, 0.28], horizon: [0.85, 0.62, 0.45], groundTint: [0.20, 0.18, 0.16],
           cloudCover: 0.6, cloudSharp: 0.5, sunGlow: 1.0, burnGap: 0.6 },
  fog:   { sigma: [0.0055, 0.0068, 0.0090], scatter: [0.75, 0.62, 0.52], heightFalloff: 0.08, baseHeight: 0.0, sunInscatter: 1.0, start: 2.0 },
  vol:   { density: 0.014, g: 0.60, steps: 20, strength: 1.0 },
  ambient: { skyIntensity: 1.6, envIntensity: 1.8 },
  grade: { exposure: 1.0, agxMix: 0.25, lookPower: 1.15, sat: 1.18, contrast: 0.18,
           splitShadow: [0.92, 1.0, 1.08], splitHigh: [1.06, 1.0, 0.92], vignette: 0.30,
           bloom: 0.065, bloomThreshold: 1.2, lensDirt: 0.4, chroma: 0.0015, grain: 0.022, sharpen: 0.25,
           adaptMin: 0.6, adaptMax: 2.0, adaptTau: 1.5 },
  surface: { wet: 0.8, dust: 0.0, snow: 0.0, macroVar: 0.25 },
  weather: { kind: 'rain', amount: 0.7, wind: [1.5, 0, 0.4], lightning: false },   // lightning: true → storm flashes + thunder
};
