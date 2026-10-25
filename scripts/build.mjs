import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist');

/** Options esbuild communes au build de production et au mode développement. */
export function buildOptions(production) {
  return {
    absWorkingDir: ROOT,
    entryPoints: { app: 'src/main.tsx' },
    outdir: 'dist',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    minify: production,
    sourcemap: !production,
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
      // Adresse du Worker pour la version GitHub Pages (API_BASE=https://… npm run build). Vide en local.
      __API_BASE__: JSON.stringify((process.env.API_BASE ?? '').trim().replace(/\/+$/, '')),
    },
    logLevel: 'info',
  };
}

export async function copyPublic() {
  await mkdir(dist, { recursive: true });
  await cp(path.join(ROOT, 'public'), dist, { recursive: true });
}

// Exécuté directement : `node scripts/build.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await rm(dist, { recursive: true, force: true });
  await copyPublic();
  await esbuild.build(buildOptions(true));
  console.log('Client compilé dans dist/. Lance « npm start » pour démarrer le serveur.');
}
