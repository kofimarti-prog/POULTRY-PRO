// ---------- Poultry Calculators ----------
// Each calculator returns { result, feedback: {level, text} } so the UI can render
// a consistent result + comparison-to-standard pattern across all tools.
//
// IMPORTANT SAFETY BOUNDARY: the medicine/water dilution calculator performs only
// arithmetic on values the farmer supplies from their vet or product label. It does
// NOT recommend drug names, active ingredients, or dosage amounts — that would be
// veterinary medical advice, which this app is not positioned to give safely.

const Calc = {

  // ---- FCR: Feed Conversion Ratio ----
  // FCR = total feed consumed (kg) / total live weight gained (kg)
  // Lower is better. Standard broiler FCR benchmarks by age (industry-typical ranges).
  fcrBenchmarks: [
    { maxDays: 7, good: 1.2, ok: 1.4 },
    { maxDays: 14, good: 1.4, ok: 1.6 },
    { maxDays: 21, good: 1.6, ok: 1.8 },
    { maxDays: 28, good: 1.8, ok: 2.0 },
    { maxDays: 35, good: 2.0, ok: 2.2 },
    { maxDays: 42, good: 2.2, ok: 2.4 },
    { maxDays: 999, good: 2.4, ok: 2.6 },
  ],
  fcr(feedKg, weightGainKg, ageDays) {
    if (!feedKg || !weightGainKg) return null;
    const value = feedKg / weightGainKg;
    const bench = this.fcrBenchmarks.find(b => ageDays <= b.maxDays) || this.fcrBenchmarks[this.fcrBenchmarks.length - 1];
    let level, key;
    if (value <= bench.good) { level = 'good'; key = 'fcrGood'; }
    else if (value <= bench.ok) { level = 'warning'; key = 'fcrOk'; }
    else { level = 'danger'; key = 'fcrPoor'; }
    return { value: value.toFixed(2), unit: '', level, feedbackKey: key, benchmark: `${bench.good}–${bench.ok}` };
  },

  // ---- Daily & total feed requirement ----
  // Rough industry rule-of-thumb grams/bird/day by age band (broiler-oriented, adjustable).
  feedPerBirdByAge: [
    { maxDays: 7, gramsPerDay: 18 },
    { maxDays: 14, gramsPerDay: 38 },
    { maxDays: 21, gramsPerDay: 62 },
    { maxDays: 28, gramsPerDay: 90 },
    { maxDays: 35, gramsPerDay: 115 },
    { maxDays: 42, gramsPerDay: 135 },
    { maxDays: 999, gramsPerDay: 150 },
  ],
  feedRequirement(birdCount, ageDays) {
    if (!birdCount) return null;
    const band = this.feedPerBirdByAge.find(b => ageDays <= b.maxDays) || this.feedPerBirdByAge[this.feedPerBirdByAge.length - 1];
    const dailyKg = (birdCount * band.gramsPerDay) / 1000;
    return { value: dailyKg.toFixed(1), unit: 'kg/day', level: 'info', feedbackKey: 'feedEstimateInfo', gramsPerBird: band.gramsPerDay };
  },

  // ---- Water requirement ----
  // General rule-of-thumb: water intake is roughly 1.6-2x feed intake by weight,
  // higher in hot climates. We use 1.8x as a reasonable general multiplier.
  waterRequirement(birdCount, ageDays, isHotClimate) {
    if (!birdCount) return null;
    const feed = this.feedRequirement(birdCount, ageDays);
    if (!feed) return null;
    const multiplier = isHotClimate ? 2.2 : 1.8;
    const waterLiters = parseFloat(feed.value) * multiplier;
    return { value: waterLiters.toFixed(1), unit: 'L/day', level: 'info', feedbackKey: 'waterEstimateInfo' };
  },

  // ---- Temperature-Humidity Index (THI) — heat stress risk ----
  // THI = T - (0.55 - 0.0055*RH) * (T - 14.5), T in Celsius
  thi(tempC, humidityPct) {
    if (tempC === null || humidityPct === null) return null;
    const value = tempC - (0.55 - 0.0055 * humidityPct) * (tempC - 14.5);
    let level, key;
    if (value < 27) { level = 'good'; key = 'thiNormal'; }
    else if (value < 32) { level = 'warning'; key = 'thiAlert'; }
    else if (value < 35) { level = 'warning'; key = 'thiDanger'; }
    else { level = 'danger'; key = 'thiEmergency'; }
    return { value: value.toFixed(1), unit: 'THI', level, feedbackKey: key };
  },

  // ---- Stocking density / shed space ----
  // Standard guidance: ~0.065–0.09 m² per broiler at market weight; layers ~0.045-0.055 m² (cage-free floor).
  stockingDensity(birdCount, breedType, shedAreaM2) {
    if (!birdCount || !shedAreaM2) return null;
    const areaPerBird = shedAreaM2 / birdCount;
    const standard = breedType === 'layer' ? { min: 0.045, max: 0.055 } : { min: 0.065, max: 0.09 };
    let level, key;
    if (areaPerBird < standard.min) { level = 'danger'; key = 'densityOvercrowded'; }
    else if (areaPerBird <= standard.max) { level = 'good'; key = 'densityGood'; }
    else { level = 'info'; key = 'densityRoomy'; }
    return { value: areaPerBird.toFixed(3), unit: 'm²/bird', level, feedbackKey: key, benchmark: `${standard.min}–${standard.max}` };
  },

  // ---- Recommended equipment counts ----
  // Standard ratios: 1 pan feeder per ~50 birds (broilers), 1 nipple drinker per ~10-12 birds,
  // 1 bell drinker per ~80-100 birds.
  equipment(birdCount) {
    if (!birdCount) return null;
    return {
      panFeeders: Math.ceil(birdCount / 50),
      bellDrinkers: Math.ceil(birdCount / 90),
      nippleDrinkers: Math.ceil(birdCount / 11),
      level: 'info',
      feedbackKey: 'equipmentInfo',
    };
  },

  // ---- Ventilation / fan estimate ----
  // Rough rule-of-thumb: ~0.15-0.2 m³/min airflow per kg live bird weight in hot climates (tunnel ventilation, simplified).
  ventilation(birdCount, avgWeightKg) {
    if (!birdCount || !avgWeightKg) return null;
    const totalWeightKg = birdCount * avgWeightKg;
    const airflowM3Min = totalWeightKg * 0.18;
    // Assume one standard 50" fan moves roughly ~400 m³/min
    const fansNeeded = Math.max(1, Math.ceil(airflowM3Min / 400));
    return { value: fansNeeded, unit: 'fans (50")', level: 'info', feedbackKey: 'ventilationInfo', airflow: airflowM3Min.toFixed(0) };
  },

  // ---- Water/medicine dilution calculator (arithmetic only, no drug recommendations) ----
  // Farmer supplies the dose rate from their vet/product label (e.g. "2 mL per liter"),
  // this just scales it to their actual water volume / flock size.
  dilution(doseAmount, doseUnit, doseWaterVolume, actualWaterVolume) {
    if (!doseAmount || !doseWaterVolume || !actualWaterVolume) return null;
    const ratio = doseAmount / doseWaterVolume;
    const totalNeeded = ratio * actualWaterVolume;
    return { value: totalNeeded.toFixed(2), unit: doseUnit, level: 'info', feedbackKey: 'dilutionInfo' };
  },

  // ---- Bedding / litter estimator ----
  // Rough guidance: ~0.5-1 kg of litter material per bird for standard depth, adjust by season.
  bedding(birdCount, isWinter) {
    if (!birdCount) return null;
    const perBird = isWinter ? 1.0 : 0.6;
    const totalKg = birdCount * perBird;
    return { value: totalKg.toFixed(0), unit: 'kg', level: 'info', feedbackKey: 'beddingInfo' };
  },

  // ---- EPEF: European Production Efficiency Factor ----
  // EPEF = (livability% × avg body weight kg) / (age days × FCR) × 100
  epef(livabilityPct, avgWeightKg, ageDays, fcrValue) {
    if (!livabilityPct || !avgWeightKg || !ageDays || !fcrValue) return null;
    const value = ((livabilityPct * avgWeightKg) / (ageDays * fcrValue)) * 100;
    let level, key;
    if (value >= 400) { level = 'good'; key = 'epefExcellent'; }
    else if (value >= 300) { level = 'good'; key = 'epefGood'; }
    else if (value >= 200) { level = 'warning'; key = 'epefAverage'; }
    else { level = 'danger'; key = 'epefPoor'; }
    return { value: value.toFixed(0), unit: '', level, feedbackKey: key };
  },
};
