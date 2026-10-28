# Cotes

Application web de suivi boursier : actions, FNB (ETF), forex et crypto, avec l'API gratuite de [Twelve Data](https://twelvedata.com).

- Liste de suivi (jusqu'à 10 titres) mémorisée dans le navigateur, avec recherche de symboles
- Graphique avec 12 périodes : **1 j, 5 j, 1 m, 3 m, 6 m, CA, 1 a, 3 a, 5 a, 7 a, 10 a, Max** (CA = cumul annuel, depuis le 1er janvier)
- Onglet **Simulation** : deux portefeuilles côte à côte sur une période choisie, en montant ou en parts (fractions permises), frais de gestion annuels déduits, dividendes réinvestis ou non
- Survol à la souris ou au clavier (flèches), thèmes clair et sombre, affichage adapté au mobile
- Ta clé API reste sur le serveur : elle n'est jamais envoyée au navigateur
- Le serveur compte les crédits et respecte les limites du plan gratuit (8 par minute, 800 par jour)

## Démarrage

Il te faut Node 20.12 ou plus récent.

```bash
npm install
npm run dev
```

Ouvre ensuite http://localhost:3000.

Sans clé API, l'application démarre en **mode démo** avec des données fictives, pour que tu puisses l'essayer tout de suite.

### Brancher les vrais cours

1. Crée un compte gratuit sur Twelve Data et copie ta clé : https://twelvedata.com/account/api-keys
2. Copie `.env.example` en `.env` et colle la clé :
   ```
   TWELVE_DATA_API_KEY=ta_cle_ici
   ```
3. Relance `npm run dev`.

### Version « production »

```bash
npm run build   # compile le client dans dist/
npm start       # démarre le serveur sur http://localhost:3000
```

## Mettre en ligne (GitHub Pages + Cloudflare Worker)

GitHub Pages ne sert que des fichiers statiques. Le site (React) va donc sur GitHub Pages, et un petit **Worker Cloudflare** joue le rôle du serveur : il garde ta clé Twelve Data secrète, met les réponses en cache et refuse les appels qui ne viennent pas de ton site.

**1. Déployer le Worker (API)**

```bash
npm install
npx wrangler login
```

Dans `wrangler.toml`, remplace `ALLOWED_ORIGIN` par l'adresse de ton site GitHub Pages, sans le nom du dépôt (ex. `https://gourguesnicolas.github.io`). Puis :

```bash
npx wrangler secret put TWELVE_DATA_API_KEY   # colle ta clé quand on te la demande
npm run deploy:api
```

Wrangler affiche l'adresse du Worker, du genre `https://cotes-api.ton-sous-domaine.workers.dev`. Note-la.

**2. Pousser le code sur GitHub**

Crée un dépôt **public** nommé `app-suivi-bourse` (GitHub Pages gratuit exige un dépôt public), sans README, puis :

```bash
git init -b main
git add .
git commit -m "Cotes : suivi boursier"
git remote add origin https://github.com/TON-NOM/app-suivi-bourse.git
git push -u origin main
```

Le fichier `.env` est ignoré par git : ta clé ne part jamais dans le dépôt.

**3. Activer Pages**

Dans le dépôt, sur GitHub :
1. *Settings > Pages > Source* : choisis **GitHub Actions**.
2. *Settings > Secrets and variables > Actions > Variables > New repository variable* : nom `API_BASE`, valeur = l'adresse du Worker (sans barre oblique finale).
3. *Actions* : relance le workflow « Mettre en ligne sur GitHub Pages » (ou refais un `git push`).

Le site sera à `https://TON-NOM.github.io/app-suivi-bourse/`.

À savoir :
- Le site est public : toute personne qui connaît l'adresse peut l'ouvrir, et ses visites dépensent **tes** crédits Twelve Data via le Worker. Ne partage pas le lien largement. Ta liste de suivi, elle, reste dans ton navigateur.
- Le compteur de crédits affiché est approximatif sur Cloudflare : chaque instance du Worker compte de son côté. Twelve Data applique de toute façon ses propres limites et l'application affiche le message d'erreur correspondant.
- Pour essayer le Worker en local : `npm run dev:api` (mets `ALLOWED_ORIGIN = "http://localhost:3000"` le temps du test et compile avec `API_BASE`).

## Ce que couvre le plan gratuit

- **Inclus** : actions et FNB américains, forex, crypto.
- **Non inclus** : la Bourse de Toronto (TSX) et les autres marchés internationaux demandent un plan payant. Ces titres apparaissent dans la recherche avec la mention « Plan payant » et ne peuvent pas être ajoutés.
- Les cours du plan gratuit peuvent être différés. Vérifie les conditions actuelles sur le site de Twelve Data; elles changent de temps en temps.
- Le plan gratuit est destiné à un usage interne : n'affiche pas ces données publiquement sans vérifier la licence.

## Comment sont comptés les crédits

Un appel coûte 1 crédit par symbole. Pour rester sous 800 par jour :

- Les cotes sont gardées en cache 5 minutes quand la bourse est ouverte, 30 minutes quand elle est fermée (`QUOTE_TTL_SECONDS` dans `.env`).
- Chaque jeu d'historique est chargé une seule fois par titre, puis réutilisé pour plusieurs périodes. Un appel « quotidien » sert 1 m, 3 m, 6 m, CA, 1 a, 3 a, 5 a, 7 a et 10 a. « Max » utilise un appel mensuel, « 1 j » un appel aux 5 minutes et « 5 j » un appel aux 30 minutes.
- Le compteur de crédits du jour s'affiche en bas de la barre latérale.
- Si Twelve Data est indisponible, le serveur renvoie sa dernière copie en cache et l'indique.

## Structure

```
server/    Serveur Node (sans dépendance) : proxy Twelve Data, cache, limiteur, mode démo
worker/    Point d'entrée du Worker Cloudflare (même API que le serveur Node)
.github/   Workflow de déploiement GitHub Pages
shared/    Types partagés entre serveur et client
src/       Client React + TypeScript (graphique dessiné en SVG, sans bibliothèque)
scripts/   Compilation (esbuild) et mode développement
public/    index.html, icône, script du thème
```

## Variables d'environnement

Voir `.env.example` : `TWELVE_DATA_API_KEY`, `DEMO`, `PORT`, `HOST`, `QUOTE_TTL_SECONDS`, `CREDITS_PER_MINUTE`, `CREDITS_PER_DAY`.

Par défaut, le serveur n'écoute que sur ton poste (`127.0.0.1`). Ne l'expose pas sur Internet tel quel : il n'a pas d'authentification et dépense tes crédits.

## Polices

Les polices (Bricolage Grotesque et Instrument Sans) sont chargées depuis Google Fonts. Hors ligne, l'application utilise les polices du système.

## Vérification

`npm run typecheck` vérifie les types du client et du serveur.
