<div align="center">
  <img src="public/macrocode-logo.svg" width="110" alt="Logo MacroCode" />
  <h1>MacroCode</h1>
  <p><strong>Un terminal IA sous votre contrôle — apportez votre clé, gardez vos données.</strong></p>
  <p>
    <a href="https://github.com/Geblkc/Macro-Code/releases"><img src="https://img.shields.io/github/v/release/Geblkc/Macro-Code?label=release&color=0a7ea4" alt="Version" /></a>
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-0a7ea4" alt="Plateforme" />
    <img src="https://img.shields.io/badge/Tauri-v2-24c8db" alt="Tauri v2" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--only-blue.svg" alt="Licence : GPL-2.0-only" /></a>
  </p>
  <p><a href="README.md">English</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.de.md">Deutsch</a> · <strong>Français</strong> · <a href="README.ru.md">Русский</a></p>
</div>

<img width="1920" height="1006" alt="Capture d'écran de MacroCode" src="https://github.com/user-attachments/assets/f67a19a7-9f72-458f-8236-75bbd31c18cd" />

## Qu'est-ce que MacroCode ?

MacroCode est une application de bureau open source et multiplateforme qui vous permet de
dialoguer et de travailler avec des modèles d'IA via une **interface de type terminal —
avec vos propres clés API** (BYOK). Construite avec Tauri v2 + React + TypeScript, elle se
présente comme un petit binaire natif et s'adresse aux développeurs qui aiment le texte,
les commandes et les outils pilotés au clavier.

Aucun serveur, aucun compte, aucune télémétrie : vos conversations sont stockées dans une
base SQLite locale, et vos clés ne quittent votre machine que sous forme d'en-têtes
d'authentification envoyés directement au fournisseur que vous avez configuré.

## Que peut-il faire ?

| | |
|---|---|
| 🧠 **7 fournisseurs** | Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek et xAI. Un fournisseur n'apparaît dans les listes qu'une fois sa clé saisie (ou, pour Ollama, une URL locale). |
| 🔮 **Des centaines de modèles** | Un petit catalogue éditorial enrichi avec les métadonnées de [models.dev](https://models.dev) : limites de contexte, capacités vision/raisonnement et tarifs. |
| ⌨️ **Expérience terminal** | Commandes slash (`/model`, `/tokens`, `/compact`, `/help`…), historique des messages avec `↑ ↓`, comptage instantané des tokens à chaque tour. |
| 🤖 **Mode agent** | Désignez un dossier de projet avec `/root` : il peut lire des fichiers, fouiller le code, éditer des fichiers et exécuter des commandes shell. Chaque écriture/exécution passe par une carte d'approbation que vous acceptez ou refusez ; `rm` est restreint et les dossiers système sont bloqués. Il se connecte également aux serveurs MCP (stdio ou HTTP) pour des outils supplémentaires. |
| 💸 **Maîtrise des coûts** | La mise en cache des prompts (breakpoints Anthropic / clés de cache compatibles OpenAI) allège les longues sessions ; `/tokens` indique précisément le coût de chaque tour, lectures du cache incluses. |
| 🌍 **5 langues** | Interface intégralement traduite : English, Deutsch, Español, Français et Türkçe ; le changement s'applique instantanément, sans redémarrage. |
| 🔒 **Vos données restent les vôtres** | Sessions en SQLite avec import/export JSON : tout est portable et utilisable hors ligne au besoin. |

## Installation

Téléchargez le paquet correspondant à votre plateforme sur la page
[Releases](https://github.com/Geblkc/Macro-Code/releases)
(Linux `.deb` / `.AppImage`, Windows `.msi` / `.exe`, macOS `.dmg`).

Ou compilez depuis les sources :

```bash
npm install
npm run tauri dev    # application de bureau complète (Rust + dépendances Tauri requises)
npm test             # tests unitaires
```

Paquets de production :

```bash
npm run dist:linux   # .deb / .rpm / AppImage
npm run build        # vérification des types + build web uniquement
```

## Premier lancement

1. Ouvrez **Paramètres** (ou tapez `/key`).
2. Collez la clé API de votre fournisseur et enregistrez. Pour [Ollama](https://ollama.com),
   une URL locale comme `http://localhost:11434` suffit.
3. Tapez un message — ou `/help` pour voir toutes les commandes.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — la structure du projet, module par module
- [`docs/MODELS.md`](docs/MODELS.md) — le catalogue de modèles et sa fusion avec models.dev
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — construire `.deb` / `.rpm` / AppImage en local, installateurs Windows via CI
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — journal daté de chaque changement
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — recommandations pour les pull requests

## Contribuer

Les contributions sont les bienvenues — rapports de bogues, traductions et pull requests.
Le workflow est décrit dans [`CONTRIBUTING.md`](CONTRIBUTING.md) ; veuillez ouvrir une
issue avant toute modification importante.

## Licence

MacroCode est publié sous licence **GNU General Public License version 2 uniquement**
(`GPL-2.0-only`) — voir le texte intégral dans [`LICENSE`](LICENSE).

```
Copyright (C) 2026 Gökhan Efe Balıkçı
```
