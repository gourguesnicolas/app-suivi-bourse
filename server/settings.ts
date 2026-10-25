/**
 * Réglages communs au serveur Node et au Worker Cloudflare.
 * Ce fichier ne doit utiliser aucune API propre à Node : il est aussi compilé pour Workers.
 */

export interface Settings {
  apiKey: string;
  /** Sans clé (ou avec DEMO=1), on fabrique des données fictives. */
  demo: boolean;
  baseUrl: string;
  creditsPerMinute: number;
  creditsPerDay: number;
  /** Durée de vie des cotes pendant que la bourse est ouverte. */
  quoteTtlOpenMs: number;
  /** Bourse fermée : les cours ne bougent plus, inutile de dépenser des crédits. */
  quoteTtlClosedMs: number;
}

export type EnvLike = Record<string, string | undefined>;

export const settings: Settings = {
  apiKey: '',
  demo: true,
  baseUrl: 'https://api.twelvedata.com',
  creditsPerMinute: 8,
  creditsPerDay: 800,
  quoteTtlOpenMs: 300_000,
  quoteTtlClosedMs: 30 * 60_000,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Lit les variables d'environnement (process.env sous Node, `env` sous Workers). */
export function configure(env: EnvLike): Settings {
  const apiKey = (env.TWELVE_DATA_API_KEY ?? '').trim();
  const demoForced = ['1', 'true', 'yes', 'oui'].includes((env.DEMO ?? '').trim().toLowerCase());

  settings.apiKey = apiKey;
  settings.demo = demoForced || apiKey === '';
  settings.baseUrl = (env.TWELVEDATA_BASE_URL?.trim() || 'https://api.twelvedata.com').replace(/\/+$/, '');
  settings.creditsPerMinute = positiveInt(env.CREDITS_PER_MINUTE, 8);
  settings.creditsPerDay = positiveInt(env.CREDITS_PER_DAY, 800);
  settings.quoteTtlOpenMs = positiveInt(env.QUOTE_TTL_SECONDS, 300) * 1000;
  return settings;
}
