// -----------------------------------------------------------------------------
// Runtime texts, English and French: feature names, the published text of
// the next departure, the status, the answers of the buttons, the widget.
// -----------------------------------------------------------------------------

const TEXTS = {
  featureNext: { en: 'Next departure', fr: 'Prochain départ' },
  featureNextIn: { en: 'Next departure in', fr: 'Prochain départ dans' },
  featureDelay: { en: 'Delay of the next departure', fr: 'Retard du prochain départ' },
  featureDisrupted: { en: 'Disrupted departures', fr: 'Départs perturbés' },
  platform: { en: 'pl.', fr: 'voie' },
  insteadOf: { en: 'instead of', fr: 'au lieu de' },
  cancelled: { en: 'cancelled', fr: 'supprimé' },
  onTime: { en: 'on time', fr: "à l'heure" },
  noLive: { en: 'timetable only', fr: 'horaire prévu seulement' },
  none: { en: 'No departure in the next {minutes} min', fr: 'Aucun départ dans les {minutes} min' },

  // Status of the configuration screen.
  missing: {
    en: 'Enter the Client ID and the API key of your DB API Marketplace application.',
    fr: 'Saisissez le Client ID et la clé d’API de votre application DB API Marketplace.',
  },
  half: {
    en: 'Both the Client ID and the API key are needed: nothing is sent with only one.',
    fr: 'Le Client ID et la clé d’API sont nécessaires tous les deux : rien n’est envoyé avec un seul.',
  },
  malformed: {
    en: 'The Client ID or the API key holds a space or a character that is not allowed.',
    fr: 'Le Client ID ou la clé d’API contient une espace ou un caractère non permis.',
  },
  noStation: {
    en: 'Credentials entered. Add a station (name, EVA number or DS100 code).',
    fr: 'Identifiants saisis. Ajoutez une gare (nom, numéro EVA ou code DS100).',
  },
  refused: {
    en: 'DB refused the credentials (HTTP {status}): check the Client ID, the API key and the Timetables subscription, then press Test.',
    fr: 'DB a refusé les identifiants (HTTP {status}) : vérifiez le Client ID, la clé d’API et l’abonnement Timetables, puis appuyez sur Tester.',
  },
  rateLimited: {
    en: 'DB asks to wait (HTTP 429): paused until {time}.',
    fr: 'DB demande d’attendre (HTTP 429) : pause jusqu’à {time}.',
  },
  server: {
    en: 'DB is unavailable (HTTP {status}): paused until {time}.',
    fr: 'DB est indisponible (HTTP {status}) : pause jusqu’à {time}.',
  },
  starting: {
    en: 'Starting: the first read comes at {time}.',
    fr: 'Démarrage : première lecture à {time}.',
  },
  readAll: { en: 'Read at {time}: {count} station(s).', fr: 'Lu à {time} : {count} gare(s).' },
  readSome: {
    en: 'Read at {time}: {ok} of {count} stations. {problem}',
    fr: 'Lu à {time} : {ok} gares sur {count}. {problem}',
  },
  readNone: { en: 'No station read. {problem}', fr: 'Aucune gare lue. {problem}' },
  storage: { en: ' /data unreadable: nothing kept.', fr: ' /data illisible : rien n’est gardé.' },
  configUnread: {
    en: 'The configuration could not be read from Gladys: trying again.',
    fr: 'La configuration n’a pas pu être lue depuis Gladys : nouvel essai.',
  },

  // Per-station problems (one is shown in the status).
  problem_unknown_station: {
    en: 'Station {slot}: no station of that name (use Find a station).',
    fr: 'Gare {slot} : aucune gare de ce nom (utilisez Chercher une gare).',
  },
  problem_ambiguous: {
    en: 'Station {slot}: several stations match, enter the EVA number (Find a station).',
    fr: 'Gare {slot} : plusieurs gares correspondent, saisissez le numéro EVA (Chercher une gare).',
  },
  problem_secondary: {
    en: 'Station {slot}: timetable refused (HTTP {status}), credentials accepted; tried again at {time}.',
    fr: 'Gare {slot} : horaires refusés (HTTP {status}), identifiants acceptés ; nouvel essai à {time}.',
  },
  problem_timeout: {
    en: 'Station {slot}: DB did not answer in time.',
    fr: 'Gare {slot} : DB n’a pas répondu à temps.',
  },
  problem_network: {
    en: 'Station {slot}: DB unreachable (network).',
    fr: 'Gare {slot} : DB injoignable (réseau).',
  },
  problem_bad_response: {
    en: 'Station {slot}: unreadable answer from DB.',
    fr: 'Gare {slot} : réponse illisible de DB.',
  },
  problem_too_large: {
    en: 'Station {slot}: answer too large, ignored.',
    fr: 'Gare {slot} : réponse trop grande, ignorée.',
  },
  problem_not_found: {
    en: 'Station {slot}: DB has no timetable for it.',
    fr: 'Gare {slot} : DB n’a pas d’horaires pour elle.',
  },
  problem_http: {
    en: 'Station {slot}: DB answered HTTP {status}.',
    fr: 'Gare {slot} : DB a répondu HTTP {status}.',
  },
  problem_partial: {
    en: 'Station {slot}: timetable incomplete, not published.',
    fr: 'Gare {slot} : horaires incomplets, non publiés.',
  },
  problem_stale: {
    en: 'Station {slot}: no live data, timetable only.',
    fr: 'Gare {slot} : pas de données en direct, horaires prévus seulement.',
  },
  problem_budget: {
    en: 'Station {slot}: left for the next round.',
    fr: 'Gare {slot} : remise au prochain tour.',
  },

  // Buttons.
  testOk: {
    en: 'Accepted by DB: the Timetables API answers.',
    fr: 'Accepté par DB : l’API Timetables répond.',
  },
  testRefused: {
    en: 'Refused by DB (HTTP {status}): check the Client ID, the API key and the Timetables subscription.',
    fr: 'Refusé par DB (HTTP {status}) : vérifiez le Client ID, la clé d’API et l’abonnement Timetables.',
  },
  testAgain: {
    en: 'Tested {seconds} s ago ({result}): wait a little before testing again.',
    fr: 'Testé il y a {seconds} s ({result}) : patientez un peu avant de tester à nouveau.',
  },
  testFailed: {
    en: 'No answer from DB ({code}): nothing was accepted nor refused.',
    fr: 'Pas de réponse de DB ({code}) : rien n’a été accepté ni refusé.',
  },
  paused: {
    en: 'Paused until {time} (DB asked to wait): nothing sent.',
    fr: 'En pause jusqu’à {time} (DB a demandé d’attendre) : rien envoyé.',
  },
  refusedKept: {
    en: 'These credentials were refused by DB: change them or press Test. Nothing sent.',
    fr: 'Ces identifiants ont été refusés par DB : changez-les ou appuyez sur Tester. Rien envoyé.',
  },
  searchInvalid: {
    en: 'Enter a station name, an EVA number or a DS100 code (2 to 80 characters).',
    fr: 'Saisissez un nom de gare, un numéro EVA ou un code DS100 (2 à 80 caractères).',
  },
  searchWait: {
    en: 'Wait a few seconds between two searches.',
    fr: 'Patientez quelques secondes entre deux recherches.',
  },
  searchNone: { en: 'No station found.', fr: 'Aucune gare trouvée.' },
  searchMore: { en: '(first {count} shown)', fr: '({count} premières affichées)' },

  // Widget.
  widgetUnknown: {
    en: 'This station is not configured any more.',
    fr: 'Cette gare n’est plus configurée.',
  },
  widgetNoData: { en: 'No timetable read yet.', fr: 'Aucun horaire lu pour l’instant.' },
  widgetLive: {
    en: 'Live data of {time} · Deutsche Bahn, CC BY 4.0',
    fr: 'Données en direct de {time} · Deutsche Bahn, CC BY 4.0',
  },
  widgetPlan: {
    en: 'Timetable only (no live data) · Deutsche Bahn, CC BY 4.0',
    fr: 'Horaire prévu seulement (pas de direct) · Deutsche Bahn, CC BY 4.0',
  },
};

export function t(key, language = 'en', values = {}) {
  const entry = TEXTS[key];
  const text = entry?.[language] ?? entry?.en ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) =>
    name in values ? String(values[name]) : `{${name}}`,
  );
}

/** Both languages of a text: { en, fr }. */
export const both = (key, values) => ({ en: t(key, 'en', values), fr: t(key, 'fr', values) });

export const KEYS = Object.keys(TEXTS);
export const ALL_TEXTS = TEXTS;
