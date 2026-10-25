/**
 * Worker Cloudflare : la même API que le serveur Node, pour un site hébergé sur GitHub Pages.
 * La clé Twelve Data vit dans un secret du Worker et n'atteint jamais le navigateur.
 *
 * Déploiement : voir README.md (section « Mettre en ligne »).
 */
import { handleApi } from '../server/api.ts';
import { configure } from '../server/settings.ts';
import type { ApiErrorBody } from '../shared/types.ts';

export interface Env {
  /** Secret : npx wrangler secret put TWELVE_DATA_API_KEY */
  TWELVE_DATA_API_KEY?: string;
  /** Adresse du site GitHub Pages autorisé à appeler l'API, ex. https://nicolas.github.io */
  ALLOWED_ORIGIN?: string;
  DEMO?: string;
  QUOTE_TTL_SECONDS?: string;
  CREDITS_PER_MINUTE?: string;
  CREDITS_PER_DAY?: string;
  TWELVEDATA_BASE_URL?: string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowed = (env.ALLOWED_ORIGIN ?? '').trim().replace(/\/+$/, '');
    const origin = request.headers.get('origin');

    // Le navigateur envoie toujours « Origin » sur un appel entre sites. Seul le site déclaré peut
    // dépenser les crédits : un autre site (ou un appel sans Origin) est refusé d'emblée.
    const cors: Record<string, string> = allowed
      ? { 'access-control-allow-origin': allowed, vary: 'origin', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' }
      : { vary: 'origin' };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed && origin === allowed ? 204 : 403, headers: cors });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { error: 'Méthode non permise.', code: 'method_not_allowed' } satisfies ApiErrorBody, { ...cors, allow: 'GET, HEAD, OPTIONS' });
    }
    if (!url.pathname.startsWith('/api/')) {
      return json(404, { error: 'Cette adresse ne sert que l’API de Cotes (/api/…).', code: 'not_found' } satisfies ApiErrorBody, cors);
    }
    if (!allowed) {
      return json(
        500,
        { error: 'ALLOWED_ORIGIN n’est pas configuré dans wrangler.toml (adresse de ton site GitHub Pages).', code: 'misconfigured' } satisfies ApiErrorBody,
        cors,
      );
    }
    if (origin !== allowed) {
      return json(403, { error: 'Origine non autorisée.', code: 'forbidden_origin' } satisfies ApiErrorBody, cors);
    }

    configure({ ...env });
    const result = await handleApi(url);
    return json(result.status, result.body, { ...cors, ...result.headers });
  },
};
