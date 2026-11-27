// Art direction — custom thesis "Perth golden hour, Leonida grade" (adapted from T4 desert dusk: clear coastal air
// instead of dust). Late November, ~19:05 AWST: the sun sets WSW over the Narrows / Kings Park (bearing ≈245°).
// Frame: +x east, +z south → azimDeg (from +Z toward +X) = -65 for a WSW sun. Colours LINEAR. Read-only at runtime.
export const ART = {
  sun:   { elevDeg: 14, azimDeg: -65, color: [1.0, 0.62, 0.34], intensity: 11.0 },
  sky:   { zenith: [0.045, 0.11, 0.30], horizon: [1.05, 0.56, 0.30], groundTint: [0.26, 0.24, 0.22],
           cloudCover: 0.42, cloudSharp: 0.62, sunGlow: 1.35, burnGap: 0.12, fogFar: 4200 },
  fog:   { sigma: [0.00015, 0.00021, 0.00034], scatter: [0.90, 0.62, 0.48], heightFalloff: 0.004, baseHeight: 0.0,
           sunInscatter: 0.95, start: 45.0 },
  vol:   { density: 0.010, g: 0.65, steps: 20, strength: 1.0 },
  ambient: { skyIntensity: 1.0, envIntensity: 0.80 },
  grade: { exposure: 1.0, agxMix: 0.25, lookPower: 1.15, sat: 1.30, contrast: 0.24,
           splitShadow: [0.87, 0.98, 1.13], splitHigh: [1.12, 1.01, 0.84], vignette: 0.28,
           bloom: 0.07, bloomThreshold: 1.25, lensDirt: 0.25, chroma: 0.0012, grain: 0.018, sharpen: 0.28,
           adaptMin: 0.55, adaptMax: 1.8, adaptTau: 1.2 },
  surface: { wet: 0.0, dust: 0.05, snow: 0.0, macroVar: 0.28 },
  weather: { kind: 'none', amount: 0.0, wind: [-3.0, 0, 1.4], lightning: false },
};
