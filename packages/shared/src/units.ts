/**
 * Unidades e conversões.
 *
 * Regra do produto: **guardar sempre na unidade canónica do SI/mercado português**
 * (km, litros, kWh, euros) e converter apenas na apresentação. Evita o problema
 * clássico de relatórios que misturam milhas e quilómetros de integrações diferentes
 * (§50, §51).
 */

export const KM_PER_MILE = 1.609344;
export const LITRES_PER_GALLON_US = 3.785411784;
export const LITRES_PER_GALLON_UK = 4.54609;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

/**
 * Converte um consumo em `L/100 km` para `mpg` (US ou imperial).
 *
 * Derivação: `mpg = (100 km / L·100km⁻¹) / (galões por litro)`
 * — ou seja, `mpg = (100 / L) * (1 / litros-por-galão)`.
 */
export function litresPer100KmToMpg(l100: number, system: 'us' | 'uk' = 'us'): number | null {
  if (!Number.isFinite(l100) || l100 <= 0) return null;
  const litresPerGallon = system === 'us' ? LITRES_PER_GALLON_US : LITRES_PER_GALLON_UK;
  const kmPerLitre = 100 / l100;
  const kmPerGallon = kmPerLitre * litresPerGallon;
  return kmPerGallon / KM_PER_MILE;
}

/** Converte `kWh/100 km` para `Wh/km`. */
export function kwhPer100KmToWhPerKm(kwh100: number): number | null {
  if (!Number.isFinite(kwh100)) return null;
  return (kwh100 * 1000) / 100;
}

/** Converte `km/kWh` (eficiência de VE) para `kWh/100 km`. */
export function kmPerKwhToKwhPer100Km(kmPerKwh: number): number | null {
  if (!Number.isFinite(kmPerKwh) || kmPerKwh <= 0) return null;
  return 100 / kmPerKwh;
}

/** Converte `litros/100 km` em `km/l`. */
export function litresPer100KmToKmPerLitre(l100: number): number | null {
  if (!Number.isFinite(l100) || l100 <= 0) return null;
  return 100 / l100;
}

/** Converte `km/l` em `litros/100 km`. */
export function kmPerLitreToLitresPer100Km(kmPerLitre: number): number | null {
  if (!Number.isFinite(kmPerLitre) || kmPerLitre <= 0) return null;
  return 100 / kmPerLitre;
}

/** Converte litros em galões. */
export function litresToGallons(litres: number, system: 'us' | 'uk' = 'us'): number {
  return litres / (system === 'us' ? LITRES_PER_GALLON_US : LITRES_PER_GALLON_UK);
}

/** Converte cavalos (cv) em quilowatts. 1 cv = 0,73549875 kW. */
export function cvToKw(cv: number): number {
  return cv * 0.73549875;
}

/** Converte quilowatts em cavalos (cv). */
export function kwToCv(kw: number): number {
  return kw / 0.73549875;
}

/**
 * Normaliza o nível de bateria (SOC).
 * Aceita `0.42` e `42` e devolve sempre percentagem entre 0 e 100.
 */
export function normalizeStateOfCharge(input: number): number | null {
  if (!Number.isFinite(input)) return null;
  const percent = input > 0 && input <= 1 ? input * 100 : input;
  if (percent < 0 || percent > 100) return null;
  return Math.round(percent * 10) / 10;
}

/** Potência de carregamento média a partir de energia e duração. */
export function averageChargingPowerKw(energyKwh: number, durationMinutes: number): number | null {
  if (!Number.isFinite(energyKwh) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  return energyKwh / (durationMinutes / 60);
}
