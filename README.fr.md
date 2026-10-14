<p align="center">
  <img src="assets/icon.png" alt="Logo Q de Quotalala" width="104" height="104">
</p>
<h1 align="center">Quotalala</h1>
<p align="center">Un prompt. Votre projet. Claude, Codex et Gemini en option.</p>
<p align="center">
  <a href="README.md">🇬🇧 English</a> · <a href="README.tr.md">🇹🇷 Türkçe</a> · <a href="README.de.md">🇩🇪 Deutsch</a> · <a href="README.es.md">🇪🇸 Español</a> · <strong>🇫🇷 Français</strong>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/quotalala">npm</a> · <a href="LICENSE">MIT</a> · Windows · Node.js 22.12+
</p>

Quotalala est une application de bureau locale avec Electron qui coordonne vos CLI d'IA déjà connectées à vos comptes. Ouvrez-la dans votre projet et écrivez un prompt : Claude planifie le travail, répartit les tâches et vérifie les résultats. Les conversations enregistrées et la mémoire du projet se chargent automatiquement.

## Démarrer dans votre projet

Ouvrez un terminal **dans le dossier du projet sur lequel vous souhaitez travailler** :

```powershell
npx quotalala
```

Ou installez une seule fois, puis utilisez la commande courte :

```powershell
npm install -g quotalala
quotalala
```

Le dossier courant devient le répertoire de travail des agents, même sans `.git` ni fichier de configuration du projet. Pour ouvrir un autre dossier :

```powershell
quotalala --project "C:\projects\my-app"
```

**Prérequis :** Windows, Node.js 22.12+ et les CLI `claude` et `codex` installées et connectées. Vérifiez la connexion avec `claude auth status` et `codex login status`. L'agent Gemini facultatif utilise `agy`. La première installation npm télécharge Electron ; aucun installateur Quotalala supplémentaire ni compilation native n'est nécessaire. La commande ouvre une fenêtre de bureau.

## Ce qui change

| Travail manuel | Avec Quotalala |
| --- | --- |
| Répéter le contexte à chaque agent | Envoyer un prompt ; Claude prépare un plan |
| Choisir qui exécute chaque tâche | Voir l'agent, le niveau du modèle et la raison |
| Copier les résultats entre outils | Le coordinateur transmet les sorties |
| Reconstituer où vous en étiez | Retrouver conversations, chronologie et mémoire modifiable du projet |

1. **Planifier :** Claude découpe le travail selon l'état local des quotas et le contexte du projet.
2. **Exécuter :** Les tâches vont à Claude, Codex ou Gemini activé. Une erreur de quota peut provoquer un transfert ; un modèle indisponible est remplacé par le modèle par défaut de la CLI.
3. **Vérifier :** Claude rassemble et contrôle les résultats. La chronologie affiche les affectations, transferts et erreurs, avec les entrées et sorties consultables.

La répartition repose sur les données locales d'utilisation et d'erreurs de quota. Elle ne mesure pas les quotas des fournisseurs en temps réel et ne garantit pas une consommation réduite.




## Une petite salle d’équipe

L’écran principal présente un petit bureau : Claude coordonne, Codex développe et Gemini recherche lorsqu’il est activé. Les bureaux reflètent les événements réels : travail, questions, réponses, fin et annulation. Cliquez sur une bulle ou la barre des messages pour ouvrir et copier le message. Les contrôles existants restent dans les détails des connexions et des agents ; la salle peut être repliée.

La vue **n’ajoute aucun appel aux CLI**. Questions et réponses continuent de passer automatiquement par Claude. Gemini désactivé reste éteint. Les historiques et travaux annulés n’affichent aucune animation de travail ; les préférences de mouvement réduit sont respectées.

En arrière-plan, des notifications silencieuses signalent un résultat prêt, un obstacle ou un plan à approuver. Cliquer ouvre la bonne session sans lancer ni répéter de tâche. Les échanges entre agents et les annulations manuelles restent silencieux. Les notifications de tâches se désactivent dans les réglages et ne contiennent ni prompts ni réponses. Leur réception dépend des paramètres du système d’exploitation.

## Claude dirige l’équipe

En mode coordonné, Claude garde la responsabilité après le plan initial. Les agents envoient des résultats ou des questions. Claude évalue ensemble les résultats indépendants, répond à l’agent en attente, consulte un autre agent activé ou crée une tâche de correction précise. Questions, décisions et réponses apparaissent comme texte sélectionnable et copiable dans la conversation d’équipe et la chronologie.

La dernière réponse de coordination contient la synthèse, sans appel supplémentaire. Le système autorise **3 tours de coordination** au niveau léger, avec au total **8 tâches, 2 essais par tâche et 20 appels**. Poser une question et reprendre après la réponse compte aussi comme des essais. Les étapes terminées sont conservées ; les corrections sont de nouvelles étapes. Lorsque l’aperçu du plan est activé, les tâches et réponses des tours suivants demandent aussi une validation modifiable.

Chaque transfert partage au plus 3 extraits pertinents de 1600 caractères. Les nouveaux appels d’équipe utilisent des conversations CLI neuves avec le contexte nécessaire ; les sorties complètes restent enregistrées localement. Les longs extraits peuvent être tronqués. Une limite atteinte produit un résultat partiel. Les anciens plans conservent leur fonctionnement précédent. Gemini exige toujours l’acceptation explicite du risque ; une économie de quota n’est pas garantie.

## Exécution, arrêt et preuves

- **Mode économique :** choisissez un agent et un niveau pour exécuter directement. Une exécution réussie utilise un appel de prompt ; planification, synthèse, mémoire et vérification supplémentaire sont ignorées. Ce mode fonctionne sans coordination de Claude. Un repli de modèle/session peut ajouter un essai.
- **Validation du plan :** modifiez tâches, prompts, raisons et agent/niveau, ou supprimez des tâches. Le backend revalide le plan et la disponibilité ; les modèles viennent toujours du catalogue vérifié.
- Maximum **8 sous-tâches, 2 essais par tâche et 20 appels par exécution**. Repli de modèle et transfert partagent cette limite. Les opérations déjà échouées ne sont pas répétées. Délai par appel : **1–1800 secondes**, 180 par défaut ; aide : 10 secondes.
- La sortie en direct reste sélectionnable et copiable. **Arrêter** termine l'arbre des processus et empêche les tâches en attente de démarrer. Annulation, échec et réussite sont distincts ; les résultats partiels sont conservés. Reprendre réutilise le plan et ne relance pas les étapes réussies. Les effets d'une étape incomplète ne sont pas annulés.
- Les déclarations de l'agent sont distinguées des résultats non vérifiés indépendamment. Métadonnées des fichiers, références fichier/ligne et commandes/codes de sortie fournis par la CLI (actuellement Codex) sont affichés. Les revues exigent des références ; les explications générales non. La synthèse n'est pas un test indépendant ; une vérification supplémentaire facultative utilise du quota.
- Après une exécution coordonnée réussie avec de nouveaux résultats, Claude actualise un résumé modifiable de **2000 caractères maximum**. La planification reçoit au plus **20 titres d’événements**.
- Une seconde instance transmet le projet à la fenêtre existante. Pendant une tâche, le changement attend ; le répertoire de travail reste fixe. Des fichiers temporaires uniques protègent les écritures atomiques. Les sessions interrompues sont détectées au démarrage et peuvent être reprises.

Les métadonnées ne prouvent pas la justesse du contenu. Les contrôles sans événements structurés restent des déclarations de l'agent. Certaines CLI mettent la sortie en mémoire tampon ; un arrêt brutal peut perdre la dernière seconde du texte en direct. La reprise exige l'enregistrement de l'historique. Windows est testé ; macOS/Linux et la première migration d'un historique volumineux restent des limites.

## Mémoire du projet

- Les conversations sont regroupées par projet. Vous pouvez ouvrir, renommer, supprimer ou reprendre une session.
- Après une exécution coordonnée réussie avec de nouveaux résultats, Claude actualise un résumé modifiable de **2000 caractères maximum**. La planification reçoit au plus **20 titres d’événements**.
- Les sorties et journaux peuvent être sélectionnés et copiés. Filtrez par niveau ou agent ; les fiches d'erreur proposent une solution et la sortie brute à copier.

`Ctrl+N` ouvre une conversation ; `Ctrl+Enter` envoie le prompt. L'interface est disponible en turc et en anglais ; les traductions du README n'ajoutent pas de langues à l'interface.

## Données locales et autorisations

Aucune clé API, lecture de fichiers d'identifiants, aucun proxy ni partage de compte. Les prompts sont envoyés via stdin aux CLI officielles avec vos propres comptes connectés. Les sessions et la mémoire sont des fichiers JSON dans `~/.quotalala/sessions/` et `~/.quotalala/memory/`. Les paramètres permettent de désactiver l'enregistrement ou d'effacer l'historique ; la mémoire peut être modifiée ou réinitialisée. Les CLI peuvent conserver leurs propres transcriptions.

Les clés et jetons reconnaissables sont masqués avant l'enregistrement. Les motifs ne détectent pas tous les secrets ; relisez les diagnostics avant de les partager. Ouvrir un dossier ne contourne pas les restrictions des CLI. La réussite du processus ne suffit pas à considérer une analyse bloquée comme terminée.

> **Gemini est désactivé par défaut.** L'activation d'`agy` nécessite l'acceptation de l'avertissement sur sa carte. Celui-ci explique les restrictions de comptes signalées en lien avec l'utilisation automatisée. Aucun nom de modèle Gemini n'est inclus sans vérification sur la machine de développement.

## Installateur de bureau

Un installateur Windows NSIS peut également être généré et ne nécessite pas Node.js :

```powershell
& "C:\path\to\Quotalala.exe" --project "C:\projects\my-app"
```

L'application détecte le projet si elle est lancée depuis un dossier contenant `.git`, `AGENTS.md` ou `package.json`. Sinon, elle retrouve le dernier projet. La barre latérale permet de changer de projet ou d'ouvrir le premier dossier. Aucune Release avec installateur n'a encore été publiée ; l'installateur vérifié localement n'est pas signé.

<details>
<summary><strong>Développement, tests et création de paquets</strong></summary>

Dans le dépôt Quotalala cloné :

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:startup
npm run test:instance
npm run check
npm run pack:cli
npm run build -- --win --publish never
```

Utilisez `npm start -- --project "C:\projects\my-app"` pour tester un autre projet. Les tests utilisent des CLI simulées et des données locales d'exemple. Les tests de quotas réels nécessitent une autorisation explicite : [AGENTS.md](AGENTS.md).

`pack:cli` crée une archive npm autonome avec une version fixée d'Electron et vérifie sa liste de fichiers. Publiez l'archive générée, pas le manifeste de développement à la racine. Pour NSIS, Electron reste une dépendance de développement. Ces commandes ne publient rien automatiquement.

Les modèles et leurs sources sont dans `~/.quotalala/models.json`, modifiable dans les paramètres. Les modèles preview sont exclus des choix par défaut. La découverte automatique des modèles et les niveaux de raisonnement Gemini restent à développer. La prise en charge de macOS et Linux est prévue.

Contrôles de publication et avis connus concernant les dépendances de compilation : [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). L'application utilise un renderer protégé, l'isolation de contexte et un pont IPC limité. Backend : `src/main/` ; interface : `src/renderer/`.

</details>

## Licence

[MIT](LICENSE) · Quotalala Contributors
