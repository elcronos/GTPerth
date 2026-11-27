// Art direction — custom thesis "Perth golden hour, Leonida grade" (adapted from T4 desert dusk: clear coastal air
// instead of dust). Late November, ~19:05 AWST: the sun sets WSW over the Narrows / Kings Park (bearing ≈245°).
// Frame: +x east, +z south → azimDeg (from +Z toward +X) = -65 for a WSW sun. Colours LINEAR. Read-only at runtime.
export const ART = {
  sun:   { elevDeg: 14, azimDeg: -65, color: [1.0, 0.62, 0.34], intensity: 11.0 },
  sky:   { zenith: [0.045, 0.11, 0.30], horizon: [1.05, 0.56, 0.30], groundTint: [0.30, 0.22, 0.18],
           cloudCover: 0.32, cloudSharp: 0.62, sunGlow: 1.35, burnGap: 0.35, fogFar: 4200 },
  fog:   { sigma: [0.00012, 0.00017, 0.00028], scatter: [0.98, 0.64, 0.42], heightFalloff: 0.004, baseHeight: 0.0,
           sunInscatter: 1.0, start: 40.0 },
  vol:   { density: 0.010, g: 0.65, steps: 20, strength: 0.8 },
  ambient: { skyIntensity: 1.0, envIntensity: 0.95 },
  grade: { exposure: 1.0, agxMix: 0.25, lookPower: 1.22, sat: 1.30, contrast: 0.24,
           splitShadow: [0.92, 1.0, 1.07], splitHigh: [1.08, 1.0, 0.88], vignette: 0.26,
           bloom: 0.07, bloomThreshold: 1.25, lensDirt: 0.25, chroma: 0.0012, grain: 0.018, sharpen: 0.28,
           adaptMin: 0.55, adaptMax: 1.9, adaptTau: 1.2 },
  surface: { wet: 0.0, dust: 0.05, snow: 0.0, macroVar: 0.28 },
  weather: { kind: 'none', amount: 0.0, wind: [-3.0, 0, 1.4], lightning: false },
};
