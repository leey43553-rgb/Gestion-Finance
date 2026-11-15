# Guide de compilation Windows 11 — Gestion Financière

Ce guide explique pas à pas comment fabriquer le logiciel **Gestion Financière** sous forme d'exécutable Windows (`.exe`) sans aucune compétence technique particulière.

---

## 1. Installer Node.js (version LTS)

1. Sur un ordinateur disposant temporairement d'Internet (pour préparer le programme), ouvrez votre navigateur et téléchargez **Node.js LTS** depuis le site officiel (`nodejs.org`, bouton vert **LTS**).
2. Double-cliquez sur le fichier téléchargé et cliquez sur **Next / Suivant** jusqu'à la fin de l'installation (laissez toutes les options par défaut).
3. Redémarrez votre ordinateur si demandé.

---

## 2. Ouvrir le dossier du projet

1. Ouvrez le dossier contenant les fichiers de **Gestion Financière** dans l'Explorateur Windows.
2. Cliquez dans la barre d'adresse en haut de la fenêtre de l'Explorateur, tapez `cmd`, puis appuyez sur **Entrée**.
   Une fenêtre noire (Invite de commandes) s'ouvre directement dans le bon dossier.

---

## 3. Installer les composants du logiciel

Dans la fenêtre noire, tapez exactement la commande suivante puis appuyez sur **Entrée** :

```bash
npm install
```

Patientez quelques minutes le temps que tous les modules nécessaires (interface, base de données locale, export Excel, Electron) soient téléchargés et assemblés. Une fois terminé, aucune connexion Internet ne sera plus jamais nécessaire.

---

## 4. Créer le fichier `.exe` pour Windows 11

Tapez ensuite la commande suivante puis appuyez sur **Entrée** :

```bash
npm run dist
```

Cette opération fabrique :
- L'interface complète de l'application (`dist/`),
- L'installateur Windows en français et la version portable sans installation.

---

## 5. Où trouver votre application `.exe` ?

Une fois la commande terminée, ouvrez le dossier **`release`** qui vient d'apparaître dans le dossier du projet. Vous y trouverez deux fichiers :

1. **`Gestion-Financiere-1.0.0-x64.exe`** *(Installateur Windows classique)*
   - Assistant d'installation en français, choix du dossier d'installation, création du raccourci sur le Bureau et dans le Menu Démarrer.
   - Vos données restent conservées même si vous mettez à jour ou désinstallez l'application.
2. **`Gestion-Financiere-Portable-1.0.0-x64.exe`** *(Version portable)*
   - Fonctionne directement par double-clic (par exemple depuis une clé USB), sans rien installer.

> **Option fichier HTML unique (sans Electron)** :
> Si vous souhaitez obtenir un seul fichier `index.html` autonome ouvrable directement dans n'importe quel navigateur hors-ligne, exécutez :
> ```bash
> npm run build:single
> ```
> Le fichier unique sera créé dans le dossier `dist-single/index.html`.

---

## 6. Message Windows SmartScreen (« Windows a protégé votre ordinateur »)

Lors du premier lancement d'un logiciel non signé par un certificat commercial Microsoft, Windows 11 affiche souvent un écran bleu intitulé **« Windows a protégé votre ordinateur »**.

Pour lancer l'application :
1. Cliquez sur le lien **« Informations complémentaires »** (ou **« Plus d'infos »**).
2. Un nouveau bouton apparaît en bas : cliquez sur **« Exécuter quand même »**.

C'est tout ! L'application démarre alors normalement et fonctionne **100 % hors-ligne**.

---

## 7. Où sont enregistrées vos sauvegardes automatiques ?

Dans la version Windows (`.exe`), **Gestion Financière** crée automatiquement une sauvegarde complète au format `.json` (incluant votre logo et toutes vos opérations) à l'ouverture et à la fermeture du logiciel dans :

`Documents\GestionFinanciere\Sauvegardes`

Les **30 dernières sauvegardes automatiques** sont conservées automatiquement (vous pouvez aussi modifier ce dossier depuis **Paramètres > Sauvegardes**).
