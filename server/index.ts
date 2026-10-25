import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { handleApi } from './api.ts';
import { nodeConfig, settings } from './config.ts';

function sendJson(res: http.ServerResponse, status: number, body: unknown, extra: http.OutgoingHttpHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Fichiers statiques (le client compilé dans dist/)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  // Les fichiers cachés (.env, .git…) n'ont rien à faire ici.
  if (relative.split('/').some((part) => part.startsWith('.') && part !== '')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
    return;
  }

  let file = path.normalize(path.join(nodeConfig.distDir, relative));
  // Empêche de sortir du dossier dist (ex. « /../.env »).
  if (file !== nodeConfig.distDir && !file.startsWith(nodeConfig.distDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  if (!isFile(file)) {
    // Une adresse sans extension est une « page » de l'application : on sert index.html.
    if (path.extname(relative) !== '') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    file = path.join(nodeConfig.distDir, 'index.html');
    if (!isFile(file)) {
      res
        .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        .end("Le client n'est pas compilé. Lance « npm run build » (ou « npm run dev »).");
      return;
    }
  }

  const ext = path.extname(file).toLowerCase();
  const headers: http.OutgoingHttpHeaders = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (ext === '.html') headers['content-security-policy'] = CSP;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Méthode non permise.', code: 'method_not_allowed' }, { allow: 'GET, HEAD' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const result = await handleApi(url);
      sendJson(res, result.status, result.body, result.headers);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error(err);
    if (res.headersSent) res.end();
    else sendJson(res, 500, { error: 'Erreur interne du serveur.', code: 'internal' });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${nodeConfig.port} est déjà utilisé. Change PORT dans le fichier .env.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(nodeConfig.port, nodeConfig.host, () => {
  const shown = nodeConfig.host === '127.0.0.1' || nodeConfig.host === '::1' ? 'localhost' : nodeConfig.host;
  console.log(`Cotes est prêt : http://${shown}:${nodeConfig.port}`);
  if (settings.demo) {
    console.log('Mode démo : données fictives. Ajoute TWELVE_DATA_API_KEY dans .env pour les vrais cours.');
  } else {
    console.log(`Twelve Data : ${settings.creditsPerMinute} crédits/minute, ${settings.creditsPerDay}/jour.`);
  }
  if (!existsSync(path.join(nodeConfig.distDir, 'index.html'))) {
    console.warn("Le client n'est pas compilé : lance « npm run build » (ou « npm run dev »).");
  }
});
