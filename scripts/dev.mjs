// Mode développement : recompile le client à chaque modification et démarre le serveur.
// Lancé par « npm run dev » (tsx watch redémarre aussi le serveur quand son code change).
import * as esbuild from 'esbuild';
import { buildOptions, copyPublic } from './build.mjs';

await copyPublic();
const context = await esbuild.context(buildOptions(false));
await context.watch();

await import('../server/index.ts');
console.log('Modifie les fichiers de src/ puis recharge la page pour voir les changements.');
