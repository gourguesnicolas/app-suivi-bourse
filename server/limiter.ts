import { ApiHttpError } from './errors.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Compteur de crédits Twelve Data.
 *
 * Le plan gratuit permet 8 crédits par minute et 800 par jour. Une requête coûte
 * un crédit par symbole. Le limiteur met les appels en file d'attente pour ne
 * jamais dépasser la limite par minute, et refuse net quand la limite du jour est atteinte.
 */
export class CreditLimiter {
  readonly perMinute: number;
  readonly perDay: number;
  private events: { t: number; cost: number }[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private day = utcDay();
  private usedToday = 0;

  constructor(perMinute: number, perDay: number) {
    this.perMinute = perMinute;
    this.perDay = perDay;
  }

  snapshot() {
    this.rollDay();
    return { usedToday: this.usedToday, dailyLimit: this.perDay, perMinute: this.perMinute };
  }

  /** Réserve `cost` crédits, en attendant au besoin (au plus `maxWaitMs`). */
  acquire(cost: number, maxWaitMs = 20_000): Promise<void> {
    const run = this.tail.then(() => this.take(cost, maxWaitMs));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private rollDay() {
    const today = utcDay();
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
  }

  private async take(cost: number, maxWaitMs: number): Promise<void> {
    if (cost > this.perMinute) {
      throw new ApiHttpError(500, 'internal', 'Requête trop volumineuse pour la limite par minute.');
    }
    this.rollDay();
    if (this.usedToday + cost > this.perDay) {
      throw new ApiHttpError(
        429,
        'daily_limit',
        `Limite quotidienne de ${this.perDay} crédits Twelve Data atteinte. Elle se réinitialise à minuit UTC.`,
      );
    }

    const startedAt = Date.now();
    for (;;) {
      const now = Date.now();
      this.events = this.events.filter((e) => now - e.t < 60_000);
      const used = this.events.reduce((sum, e) => sum + e.cost, 0);
      if (used + cost <= this.perMinute) {
        this.events.push({ t: now, cost });
        this.usedToday += cost;
        return;
      }

      // Combien de temps avant que assez d'anciens appels sortent de la fenêtre d'une minute?
      let remaining = used;
      let freeAt = now;
      for (const e of this.events) {
        remaining -= e.cost;
        freeAt = e.t + 60_000;
        if (remaining + cost <= this.perMinute) break;
      }
      const wait = Math.max(freeAt - now, 0) + 25;
      if (now - startedAt + wait > maxWaitMs) {
        throw new ApiHttpError(
          429,
          'rate_limited',
          'Limite par minute de Twelve Data atteinte. Réessaie dans quelques secondes.',
          Math.ceil(wait / 1000),
        );
      }
      await sleep(wait);
    }
  }
}
