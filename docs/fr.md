# Deutsche Bahn

Intégration non officielle, sans lien avec la Deutsche Bahn. Elle suit jusqu’à
trois gares de la Deutsche Bahn (Allemagne) et donne, pour chacune, le
prochain départ, son retard et les départs perturbés, plus un widget de
tableau des départs. Lecture seule : rien n’est réservé ni modifié.

Les données viennent de l’API officielle **Timetables** de la DB API
Marketplace, avec votre propre clé gratuite. L’intégration n’utilise pas
l’API privée de l’application DB Navigator.

> Cette intégration a été écrite d’après la documentation de l’API et testée
> avec un faux Gladys et une fausse API seulement : elle n’a jamais été testée
> avec de vrais identifiants DB. Les retours des premiers utilisateurs sont
> bienvenus sur le forum.

## 1. Obtenir votre clé gratuite

1. Créez un compte sur la
   [DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/).
2. Sous **Anwendungen** (applications), créez une application (un nom
   suffit). Notez son **Client ID** et son **Client Secret** (la clé d’API).
3. Dans le **Katalog**, ouvrez l’API **Timetables**, cliquez sur
   **Abonnieren** (s’abonner), choisissez l’offre **Free** et votre
   application.

## 2. Configurer

- **Client ID** et **clé d’API (Client Secret)** : les deux sont
  nécessaires ; avec un seul, rien n’est envoyé. Gardés par Gladys dans sa
  base, jamais réaffichés, envoyés seulement à la DB API Marketplace (dans les
  en-têtes `DB-Client-Id` et `DB-Api-Key`).
- **Gare 1 à 3** : un nom (`Köln Hbf`), un numéro EVA (`8000207`) ou un code
  DS100 (`KK`). Le bouton **Chercher une gare** liste les gares que DB connaît
  pour un nom, avec leur numéro EVA et leur code DS100. Quand un nom
  correspond à plusieurs gares, saisissez le numéro EVA.
- **Lignes** (optionnel) : lignes ou catégories séparées par des virgules
  (`RE 5, S 12, ICE`). **Direction** (optionnel) : une partie du nom d’une
  gare par laquelle ou vers laquelle le train va (`Koblenz`).
- **Intervalle de lecture** : 2 minutes par défaut (1 à 15).
- **Départs affichés** : les 60 prochaines minutes par défaut (15 à 180).
- **Perturbé à partir de** : 5 minutes de retard par défaut.
- **Langue des valeurs** : anglais ou français.

**Tester les identifiants** envoie une requête à DB (au plus toutes les 30
secondes) et dit si le Client ID et la clé d’API sont acceptés.

## 3. Les appareils

Chaque gare apparaît dans l’onglet **Découverte** une fois trouvée par DB
(nom `DB <gare>`, avec les filtres entre parenthèses). Fonctionnalités, toutes
en lecture seule :

| Fonctionnalité            | Valeur                                                                            |
| ------------------------- | --------------------------------------------------------------------------------- |
| Prochain départ           | texte, par exemple `14:05 RE 5 → Koblenz Hbf, voie 4 au lieu de 3, +4 min`        |
| Prochain départ dans      | minutes jusqu’au prochain départ qui circule (retard compris)                     |
| Retard du prochain départ | minutes, 0 à l’heure (données en direct seulement)                                |
| Départs perturbés         | départs de la fenêtre supprimés ou en retard à partir du seuil (direct seulement) |

L’heure affichée est l’heure prévue, heure locale de l’Allemagne. Un train
supprimé n’est pas « le prochain départ » : c’est le suivant qui circule. Un
train prévu dans les deux heures précédentes et encore attendu (en retard) est
aussi affiché ; un train plus en retard que cela est manqué.

Un train pour lequel DB ne signale aucun changement est à l’heure : c’est ainsi
que fonctionnent les données en direct de DB (`/fchg` liste les changements).
DB ne garantit pas que chaque train suivi y figure, et ses données ne
distinguent pas un train à l’heure d’un train qu’elle ne suit pas : les deux
s’affichent « à l’heure ».

Les valeurs sont republiées chaque minute d’après ce qui a été lu (sans
requête) : **Prochain départ dans** décompte entre deux lectures.

Ce qui n’est pas connu n’est pas publié (la dernière valeur reste ; Gladys n’a
pas d’« inconnu ») :

- aucun départ dans la fenêtre : le texte le dit, **Prochain départ dans** et
  **Retard** ne sont pas mis à jour (jamais un 0 pour « aucun ») ;
- des données en direct de plus de 10 minutes (2,5 intervalles si c’est plus
  long) : le texte finit par « horaire prévu seulement », retard et
  perturbations ne sont pas mis à jour ;
- aucun horaire pour l’heure en cours ni les suivantes (DB répond 404), ou une
  heure d’horaires manquante : rien n’est publié, le statut le dit ;
- l’heure répétée par le changement d’heure d’automne (02:00 à 03:00 heure
  d’hiver) : les heures sont ambiguës, rien n’est publié avant 03:00.
  Dans l’heure qui suit, un train de l’heure répétée encore en retard
  s’affiche avec un retard faux d’une heure (une heure par an).

## 4. Tableau de bord

Le widget **Départs Deutsche Bahn** montre les 8 prochains départs d’une gare,
avec le retard, la voie et les suppressions, l’heure des données en direct et
l’attribution des données. Il utilise ce que l’intégration a déjà lu : l’ouvrir n’envoie aucune requête à
DB.

## 5. Comment elle lit DB, et ses limites

- À chaque intervalle, pour chaque gare : les changements en direct
  (`/fchg`), une requête ; les horaires de chaque heure de la fenêtre
  (`/plan`) une fois par heure ; la gare elle-même une fois (gardée d’un
  redémarrage à l’autre). Les deux heures précédentes sont lues en dernier,
  une fois (un horaire passé ne change pas) et sont facultatives : une erreur
  sur elles (redemandées 15 minutes plus tard) n’empêche jamais de lire la
  gare ; seul un train en retard de cette période peut alors manquer.
- Une requête à la fois au plus, espacées de 1,5 s (40 par minute au plus,
  l’offre gratuite en permet 60). Un redémarrage, une reconnexion, un
  enregistrement du formulaire ou le bouton de test ne font pas venir les
  lectures plus tôt que l’intervalle (une gare changée attend 30 s après la
  dernière lecture).
- Quand /data ne peut pas être lu au démarrage, la première lecture attend un
  intervalle entier.
- **HTTP 429**, un 5xx sur la requête de gare, ou un 5xx sur toutes les gares
  d’un tour : toutes les requêtes attendent (Retry-After quand DB le donne,
  sinon 1 minute doublée jusqu’à 6 heures), même après un redémarrage. Un 5xx
  sur les horaires d’une seule gare : seule cette gare attend (Retry-After
  quand DB le donne, jusqu’à 6 heures ; sinon 1 minute doublée jusqu’à
  30 minutes), les autres sont lues normalement.
- **HTTP 401/403 sur la requête de gare** : les identifiants sont refusés.
  L’intégration s’arrête et ne les réessaie pas d’elle-même, même après un
  redémarrage ; saisissez d’autres identifiants ou appuyez sur **Tester les
  identifiants** (un succès lève l’arrêt). Un 401/403 sur une page d’horaires
  est d’abord vérifié sur la requête de gare : si les identifiants y sont
  acceptés, seule cette gare attend (5 minutes, doublées jusqu’à 1 heure).
- Aucune gare n’est commencée après 90 s dans un tour ; la gare laissée passe
  en premier au tour suivant.
- DB ne donne les horaires que pour un temps limité à l’avance (une heure sans plan est redemandée 15 minutes plus tard).

## 6. Ce qui est gardé dans /data

`/data/deutsche-bahn.json` : l’heure du dernier tour, une pause, un refus (8
bits d’une empreinte salée des identifiants, rien de plus) et les gares
trouvées (nom, numéro EVA, code DS100). Aucun identifiant. Quand le fichier ne
peut pas être lu, il n’est pas écrasé et il est relu toutes les 10 secondes ;
un fichier qui ne s’analyse pas est d’abord mis de côté en
`deutsche-bahn.json.bad`.

## Données et licence

Données d’horaires : Deutsche Bahn AG, via la
[DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables),
sous [licence Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.fr).
Les données sont modifiées : horaires prévus et changements en direct
fusionnés, filtrés par ligne et direction, et résumés (prochain départ, retard
en minutes entières, nombre de départs perturbés). Le widget affiche l’heure
des données en direct qu’il montre.
