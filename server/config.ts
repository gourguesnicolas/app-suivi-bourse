import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure, settings } from './settings.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Charge le fichier .env s'il existe (Node 20.12+). Les variables déjà définies dans
// l'environnement ont priorité.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // Pas de fichier .env : on utilise seulement l'environnement.
}

configure(process.env);

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Réglages propres au serveur Node (port, dossier du client compilé). */
export const nodeConfig = {
  port: positiveInt(process.env.PORT, 3000),
  host: process.env.HOST?.trim() || '127.0.0.1',
  distDir: path.join(ROOT, 'dist'),
} as const;

export { settings };
