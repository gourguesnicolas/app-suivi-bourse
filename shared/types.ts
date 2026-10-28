/**
 * Types partagés entre le serveur (Node) et le client (React).
 * Aucune importation ici : ce fichier doit rester du TypeScript « pur ».
 */

/**
 * Jeux de données que le client peut demander. Chaque période de l'interface
 * (1 j, 3 m, 5 a, etc.) est découpée dans l'un de ces jeux de données :
 *  - m5  : barres de 5 minutes (la dernière séance)
 *  - m30 : barres de 30 minutes (cinq dernières séances)
 *  - d1  : barres quotidiennes (jusqu'à 5 000 jours, soit une vingtaine d'années)
 *  - mo1 : barres mensuelles (tout l'historique disponible)
 *  - d1a, mo1a : comme d1 et mo1, mais en rendement total (cours ajustés pour les dividendes,
 *    comme s'ils avaient été réinvestis). Servent à la simulation.
 */
export type Dataset = 'm5' | 'm30' | 'd1' | 'mo1' | 'd1a' | 'mo1a';

export interface Quote {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  isMarketOpen: boolean;
  /** Date (et heure, si connue) de la dernière cotation, à l'heure de la bourse. */
  asOf: string;
}

export interface ApiErrorInfo {
  code: string;
  message: string;
}

export interface QuotesResponse {
  quotes: Quote[];
  /** Erreurs par symbole (titre introuvable, plan payant requis, etc.). */
  errors: Record<string, ApiErrorInfo>;
  fetchedAt: number;
}

export interface SeriesPoint {
  /** « AAAA-MM-JJ » (quotidien, mensuel) ou « AAAA-MM-JJ HH:mm:ss » (intrajournalier), à l'heure de la bourse. */
  t: string;
  /** Cours de clôture de la barre. */
  c: number;
}

export interface SeriesResponse {
  symbol: string;
  dataset: Dataset;
  currency: string;
  timezone: string;
  points: SeriesPoint[];
  fetchedAt: number;
  /** Vrai quand Twelve Data a échoué et que le serveur renvoie sa dernière copie en cache. */
  stale: boolean;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  country: string;
  currency: string;
  /** Faux quand le titre exige un plan payant chez Twelve Data. */
  available: boolean;
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface StatusResponse {
  mode: 'live' | 'demo';
  credits: {
    usedToday: number;
    dailyLimit: number;
    perMinute: number;
  };
}

export interface ApiErrorBody {
  error: string;
  code: string;
  retryAfter?: number;
}
