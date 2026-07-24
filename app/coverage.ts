import type { Context } from "./types";

export interface MissingCell {
  country: number;
  wave: number;
}

/** Requested country×wave cells that have no data for the current mode/set. */
export function missingScopeCells(
  contexts: Pick<Context, "country_code" | "wave">[],
  countries: number[],
  waves: number[],
): MissingCell[] {
  const available = new Set(contexts.map((item) => `${item.country_code}:${item.wave}`));
  return countries.flatMap((country) =>
    waves
      .filter((wave) => !available.has(`${country}:${wave}`))
      .map((wave) => ({ country, wave })),
  );
}

export interface ScopeIntersection {
  countries: number[];
  waves: number[];
  removedCountries: number[];
  removedWaves: number[];
  /** Honest note when the draft model forced a coarser removal than the gap. */
  note: string | null;
}

/**
 * Opt-in「移除缺失組合」policy (never applied silently on run):
 * - a country with NO selected wave available is dropped entirely;
 * - a wave unavailable for ALL selected countries is dropped;
 * - a wave missing for only SOME countries cannot be expressed per-country in
 *   the draft model, so it is dropped for every selected country (with a note
 *   saying exactly that).
 */
export function intersectScopeWithAvailability(
  contexts: Pick<Context, "country_code" | "wave">[],
  countries: number[],
  waves: number[],
): ScopeIntersection {
  const available = new Set(contexts.map((item) => `${item.country_code}:${item.wave}`));
  const removedCountries = countries.filter(
    (country) => !waves.some((wave) => available.has(`${country}:${wave}`)),
  );
  const keptCountries = countries.filter((country) => !removedCountries.includes(country));
  const partialWaves = waves.filter((wave) => {
    const usable = keptCountries.filter((country) => available.has(`${country}:${wave}`));
    return usable.length > 0 && usable.length < keptCountries.length;
  });
  const removedWaves = keptCountries.length
    ? waves.filter(
      (wave) => !keptCountries.every((country) => available.has(`${country}:${wave}`)),
    )
    : [];
  const keptWaves = waves.filter((wave) => !removedWaves.includes(wave));
  const notes: string[] = [];
  if (removedCountries.length) {
    notes.push(`已移除沒有資料的國家或地區 ${removedCountries.length} 個`);
  }
  if (partialWaves.length) {
    const labels = partialWaves.map((wave) => `W${wave}`).join("、");
    notes.push(`波次 ${labels} 只對部分國家有資料；分析模型無法依國家分別保留，已一併移除`);
  } else if (removedWaves.length) {
    const labels = removedWaves.map((wave) => `W${wave}`).join("、");
    notes.push(`已移除所有國家都沒有資料的波次 ${labels}`);
  }
  return {
    countries: keptCountries,
    waves: keptWaves,
    removedCountries,
    removedWaves,
    note: notes.length ? notes.join("；") : null,
  };
}
