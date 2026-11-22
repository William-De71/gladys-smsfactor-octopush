// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: the connection status of the Configuration screen, the results of
// its buttons, the widget contents. Vocabulary of the Gladys interface
// (intégration, scène / Szene / escena) and of the SMS providers (expéditeur /
// Absender / remitente, crédits, solde).
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // connection status and Configuration screen buttons
  noCredentials_smsfactor: {
    en: 'Enter the SMSFactor API token in the configuration (SMSFactor account → API tokens).',
    fr: 'Saisissez le jeton d’API SMSFactor dans la configuration (compte SMSFactor → Tokens API).',
    de: 'Geben Sie das SMSFactor-API-Token in der Konfiguration ein (SMSFactor-Konto → API-Tokens).',
    es: 'Introduzca el token de API de SMSFactor en la configuración (cuenta SMSFactor → Tokens API).',
  },
  noCredentials_octopush: {
    en: 'Enter the login (e-mail address) and the API key of the Octopush account in the configuration.',
    fr: 'Saisissez l’identifiant (adresse e-mail) et la clé d’API du compte Octopush dans la configuration.',
    de: 'Geben Sie den Login (E-Mail-Adresse) und den API-Schlüssel des Octopush-Kontos in der Konfiguration ein.',
    es: 'Introduzca el usuario (correo electrónico) y la clave de API de la cuenta de Octopush en la configuración.',
  },
  statusConnected: {
    en: '{provider}: {credits} left, sender {sender}.',
    fr: '{provider} : {credits} restants, expéditeur {sender}.',
    de: '{provider}: {credits} übrig, Absender {sender}.',
    es: '{provider}: quedan {credits}, remitente {sender}.',
  },
  statusConnectedPostpaid: {
    en: '{provider}: monthly billing, sender {sender}.',
    fr: '{provider} : facturation mensuelle, expéditeur {sender}.',
    de: '{provider}: monatliche Abrechnung, Absender {sender}.',
    es: '{provider}: facturación mensual, remitente {sender}.',
  },
  senderDefault: {
    en: 'default of the account',
    fr: 'par défaut du compte',
    de: 'Standard des Kontos',
    es: 'predeterminado de la cuenta',
  },
  status_access_denied: {
    en: '{provider} refuses the credentials: check them in the configuration (a deleted token or a new API key no longer works).',
    fr: '{provider} refuse les identifiants : vérifiez-les dans la configuration (un jeton supprimé ou une clé d’API régénérée ne fonctionne plus).',
    de: '{provider} lehnt die Zugangsdaten ab: Prüfen Sie sie in der Konfiguration (ein gelöschtes Token oder ein neu erzeugter API-Schlüssel funktioniert nicht mehr).',
    es: '{provider} rechaza las credenciales: compruébelas en la configuración (un token eliminado o una clave de API regenerada deja de funcionar).',
  },
  status_account_not_validated: {
    en: 'The {provider} account is not validated yet: finish the onboarding steps on the {provider} website.',
    fr: 'Le compte {provider} n’est pas encore validé : terminez les étapes d’inscription sur le site de {provider}.',
    de: 'Das {provider}-Konto ist noch nicht freigeschaltet: Schließen Sie die Registrierung auf der Website von {provider} ab.',
    es: 'La cuenta de {provider} aún no está validada: complete los pasos de registro en el sitio de {provider}.',
  },
  status_rate_limited: {
    en: '{provider} limits the calls for now: the integration tries again later.',
    fr: '{provider} limite les appels pour le moment : l’intégration réessaie plus tard.',
    de: '{provider} begrenzt die Aufrufe gerade: Die Integration versucht es später erneut.',
    es: '{provider} limita las llamadas por ahora: la integración lo volverá a intentar más tarde.',
  },
  status_unreachable: {
    en: 'The {provider} API does not answer: check the internet connection of Gladys.',
    fr: 'L’API {provider} ne répond pas : vérifiez la connexion Internet de Gladys.',
    de: 'Die {provider}-API antwortet nicht: Prüfen Sie die Internetverbindung von Gladys.',
    es: 'La API de {provider} no responde: compruebe la conexión a Internet de Gladys.',
  },
  status_error: {
    en: '{provider} answered something unexpected: see the logs of the integration.',
    fr: '{provider} a répondu quelque chose d’inattendu : voir les journaux de l’intégration.',
    de: '{provider} hat unerwartet geantwortet: siehe Protokolle der Integration.',
    es: '{provider} respondió algo inesperado: consulte los registros de la integración.',
  },
  testOk: {
    en: 'Connected to {provider}: {credits} left. Senders: {senders}. SMS are sent with: {sender}.',
    fr: 'Connecté à {provider} : {credits} restants. Expéditeurs : {senders}. Les SMS partent avec : {sender}.',
    de: 'Mit {provider} verbunden: {credits} übrig. Absender: {senders}. SMS werden gesendet mit: {sender}.',
    es: 'Conectado a {provider}: quedan {credits}. Remitentes: {senders}. Los SMS se envían con: {sender}.',
  },
  testOkNoSenders: {
    en: 'Connected to {provider}: {credits} left. SMS are sent with: {sender}.',
    fr: 'Connecté à {provider} : {credits} restants. Les SMS partent avec : {sender}.',
    de: 'Mit {provider} verbunden: {credits} übrig. SMS werden gesendet mit: {sender}.',
    es: 'Conectado a {provider}: quedan {credits}. Los SMS se envían con: {sender}.',
  },
  sendersNone: { en: 'none', fr: 'aucun', de: 'keine', es: 'ninguno' },
  senderValidated: { en: 'validated', fr: 'validé', de: 'freigegeben', es: 'validado' },
  senderPending: {
    en: 'not validated',
    fr: 'non validé',
    de: 'nicht freigegeben',
    es: 'no validado',
  },
  postpaid: {
    en: 'monthly billing',
    fr: 'facturation mensuelle',
    de: 'monatliche Abrechnung',
    es: 'facturación mensual',
  },
  testSent: {
    en: 'Test SMS sent to {phone} through {provider}.',
    fr: 'SMS de test envoyé au {phone} via {provider}.',
    de: 'Test-SMS über {provider} an {phone} gesendet.',
    es: 'SMS de prueba enviado al {phone} a través de {provider}.',
  },
  testSentModerated: {
    en: 'Test SMS accepted by {provider} for {phone}: it is being moderated and leaves once approved.',
    fr: 'SMS de test accepté par {provider} pour le {phone} : il est en modération et partira une fois validé.',
    de: 'Test-SMS für {phone} von {provider} angenommen: Sie wird moderiert und nach der Freigabe gesendet.',
    es: 'SMS de prueba aceptado por {provider} para el {phone}: está en moderación y saldrá una vez aprobado.',
  },
  testNotSent: {
    en: 'The test SMS was not sent: {reason}',
    fr: 'Le SMS de test n’est pas parti : {reason}',
    de: 'Die Test-SMS wurde nicht gesendet: {reason}',
    es: 'El SMS de prueba no se envió: {reason}',
  },
  invalidPhone: {
    en: '“{phone}” is not a phone number: type it with its country code, for example +33612345678.',
    fr: '« {phone} » n’est pas un numéro de téléphone : saisissez-le avec l’indicatif du pays, par exemple +33612345678.',
    de: '„{phone}“ ist keine Telefonnummer: Geben Sie sie mit Ländervorwahl ein, zum Beispiel +4915112345678.',
    es: '«{phone}» no es un número de teléfono: escríbalo con el prefijo del país, por ejemplo +34612345678.',
  },

  // failure reasons, short (widget rows, ≤ 40 characters)
  reason_not_configured: {
    en: 'Credentials missing',
    fr: 'Identifiants manquants',
    de: 'Zugangsdaten fehlen',
    es: 'Faltan las credenciales',
  },
  reason_access_denied: {
    en: 'Credentials refused',
    fr: 'Identifiants refusés',
    de: 'Zugangsdaten abgelehnt',
    es: 'Credenciales rechazadas',
  },
  reason_not_enough_credits: {
    en: 'Not enough credits',
    fr: 'Crédits insuffisants',
    de: 'Zu wenig Guthaben',
    es: 'Créditos insuficientes',
  },
  reason_invalid_number: {
    en: 'Phone number refused',
    fr: 'Numéro refusé',
    de: 'Rufnummer abgelehnt',
    es: 'Número rechazado',
  },
  reason_invalid_sender: {
    en: 'Sender refused',
    fr: 'Expéditeur refusé',
    de: 'Absender abgelehnt',
    es: 'Remitente rechazado',
  },
  reason_blocked_number: {
    en: 'Number blocked (STOP)',
    fr: 'Numéro bloqué (STOP)',
    de: 'Nummer gesperrt (STOP)',
    es: 'Número bloqueado (STOP)',
  },
  reason_country_not_allowed: {
    en: 'Country not allowed',
    fr: 'Pays non autorisé',
    de: 'Land nicht erlaubt',
    es: 'País no autorizado',
  },
  reason_account_not_validated: {
    en: 'Account not validated',
    fr: 'Compte non validé',
    de: 'Konto nicht freigeschaltet',
    es: 'Cuenta no validada',
  },
  reason_rejected: {
    en: 'SMS refused',
    fr: 'SMS refusé',
    de: 'SMS abgelehnt',
    es: 'SMS rechazado',
  },
  reason_rate_limited: {
    en: 'Too many SMS or calls',
    fr: 'Trop de SMS ou d’appels',
    de: 'Zu viele SMS oder Aufrufe',
    es: 'Demasiados SMS o llamadas',
  },
  reason_server_error: {
    en: 'Server error',
    fr: 'Erreur du serveur',
    de: 'Serverfehler',
    es: 'Error del servidor',
  },
  reason_timeout: {
    en: 'No answer in time',
    fr: 'Pas de réponse à temps',
    de: 'Keine Antwort rechtzeitig',
    es: 'Sin respuesta a tiempo',
  },
  reason_unreachable: {
    en: 'Provider unreachable',
    fr: 'Fournisseur injoignable',
    de: 'Anbieter nicht erreichbar',
    es: 'Proveedor inaccesible',
  },
  reason_unexpected: {
    en: 'Unexpected answer',
    fr: 'Réponse inattendue',
    de: 'Unerwartete Antwort',
    es: 'Respuesta inesperada',
  },

  // amounts
  credits_one: { en: '{n} credit', fr: '{n} crédit', de: '{n} Guthaben', es: '{n} crédito' },
  credits_other: { en: '{n} credits', fr: '{n} crédits', de: '{n} Guthaben', es: '{n} créditos' },

  // widgets
  accountCaption: {
    en: '{provider} · {ago}',
    fr: '{provider} · {ago}',
    de: '{provider} · {ago}',
    es: '{provider} · {ago}',
  },
  tileCredits: { en: 'Credits left', fr: 'Crédits restants', de: 'Guthaben', es: 'Créditos' },
  tileBalance: { en: 'Balance', fr: 'Solde', de: 'Guthaben', es: 'Saldo' },
  rowSent: {
    en: 'Sent this month',
    fr: 'Envoyés ce mois-ci',
    de: 'Gesendet diesen Monat',
    es: 'Enviados este mes',
  },
  rowUndelivered: {
    en: 'Not delivered (month)',
    fr: 'Non remis (mois)',
    de: 'Nicht zugestellt (Monat)',
    es: 'No entregados (mes)',
  },
  rowReceived: {
    en: 'Replies this month',
    fr: 'Réponses ce mois-ci',
    de: 'Antworten diesen Monat',
    es: 'Respuestas este mes',
  },
  rowConnection: { en: 'API', fr: 'API', de: 'API', es: 'API' },
  connectionOk: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
  rowSender: { en: 'Sender', fr: 'Expéditeur', de: 'Absender', es: 'Remitente' },
  rowThreshold: {
    en: 'Low credits alert',
    fr: 'Alerte crédits bas',
    de: 'Warnung wenig Guthaben',
    es: 'Aviso de pocos créditos',
  },
  rowReception: {
    en: 'Replies',
    fr: 'Réponses',
    de: 'Antworten',
    es: 'Respuestas',
  },
  receptionOff: { en: 'Off', fr: 'Désactivées', de: 'Aus', es: 'Desactivadas' },
  receptionUnsupported: {
    en: 'Not with Octopush',
    fr: 'Pas avec Octopush',
    de: 'Nicht mit Octopush',
    es: 'No con Octopush',
  },
  rowLastFailure: {
    en: 'Failure {ago}',
    fr: 'Échec {ago}',
    de: 'Fehler {ago}',
    es: 'Fallo {ago}',
  },
  notReadYet: {
    en: 'The SMS account has not been read yet: come back in a few seconds.',
    fr: 'Le compte SMS n’a pas encore été lu : revenez dans quelques secondes.',
    de: 'Das SMS-Konto wurde noch nicht gelesen: Schauen Sie in ein paar Sekunden wieder vorbei.',
    es: 'La cuenta SMS aún no se ha leído: vuelva en unos segundos.',
  },
  creditsLowText: {
    en: 'Few credits left: top up the account on the website of the provider.',
    fr: 'Il reste peu de crédits : rechargez le compte sur le site du fournisseur.',
    de: 'Nur noch wenig Guthaben: Laden Sie das Konto auf der Website des Anbieters auf.',
    es: 'Quedan pocos créditos: recargue la cuenta en el sitio del proveedor.',
  },
  inboxCaption: {
    en: '{count} received this month',
    fr: '{count} reçue(s) ce mois-ci',
    de: '{count} in diesem Monat empfangen',
    es: '{count} recibida(s) este mes',
  },
  inboxEmpty: {
    en: 'No reply received since the reception was turned on.',
    fr: 'Aucune réponse reçue depuis l’activation de la réception.',
    de: 'Seit dem Einschalten des Empfangs ist keine Antwort eingegangen.',
    es: 'No se ha recibido ninguna respuesta desde que se activó la recepción.',
  },
  inboxDisabled: {
    en: 'The reception of replies is off: turn it on in the configuration, and leave the sender empty (a custom sender cannot be answered).',
    fr: 'La réception des réponses est désactivée : activez-la dans la configuration, et laissez l’expéditeur vide (on ne peut pas répondre à un expéditeur personnalisé).',
    de: 'Der Empfang von Antworten ist aus: Schalten Sie ihn in der Konfiguration ein und lassen Sie den Absender leer (auf einen eigenen Absender kann man nicht antworten).',
    es: 'La recepción de respuestas está desactivada: actívela en la configuración y deje el remitente vacío (no se puede responder a un remitente personalizado).',
  },
  inboxUnsupported: {
    en: 'Octopush tells replies only to a public web address: this widget works with SMSFactor.',
    fr: 'Octopush ne transmet les réponses qu’à une adresse web publique : ce widget fonctionne avec SMSFactor.',
    de: 'Octopush meldet Antworten nur an eine öffentliche Webadresse: Dieses Widget funktioniert mit SMSFactor.',
    es: 'Octopush solo envía las respuestas a una dirección web pública: este widget funciona con SMSFactor.',
  },
  ago_now: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  ago_minutes: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  ago_hours: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  ago_days: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is one of the four languages.
 * @param {any} value - The value.
 * @returns {boolean} True for en, fr, de or es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language (English fallback), with its substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('tileCredits', 'fr'); // -> 'Crédits restants'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/**
 * @description The text in every language, for a multi-language message.
 * Substitutions may be functions of the language.
 * @param {string} key - The TEXTS key.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 * @example
 * all('testSent', { phone: '+336******78', credits: 1 });
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(
        key,
        language,
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [
            name,
            typeof value === 'function' ? value(language) : value,
          ]),
        ),
      ),
    ]),
  );
}

/**
 * @description A number written the way a language does, with at most
 * `digits` decimals ("12,5" in French).
 * @param {number|null} value - The number.
 * @param {string} language - The language.
 * @param {number} [digits] - The decimals.
 * @returns {string} The text, "?" when unknown.
 * @example
 * formatNumber(12.5, 'fr'); // -> '12,5'
 */
function formatNumber(value, language, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '?';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * @description An amount of the account with its unit: "642 crédits",
 * "12,54 €".
 * @param {number|null} value - The amount.
 * @param {string} unit - 'credits' or 'eur'.
 * @param {string} language - The language.
 * @returns {string} The text, "?" when unknown.
 * @example
 * formatCredits(12.5, 'eur', 'fr'); // -> '12,50 €'
 */
function formatCredits(value, unit, language) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '?';
  }
  if (unit === 'eur') {
    return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
  }
  return t(value === 1 ? 'credits_one' : 'credits_other', language, {
    n: formatNumber(value, language),
  });
}

/**
 * @description "12 min ago" for an instant.
 * @param {number} instant - The instant, in ms.
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The relative time.
 * @example
 * ago(Date.now() - 600000, Date.now(), 'en'); // -> '10 min ago'
 */
function ago(instant, now, language) {
  const minutes = Math.max(0, Math.floor((now - instant) / 60000));
  if (minutes < 1) {
    return t('ago_now', language);
  }
  if (minutes < 60) {
    return t('ago_minutes', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('ago_hours', language, { n: hours });
  }
  return t('ago_days', language, { n: Math.floor(hours / 24) });
}

export { LANGUAGES, TEXTS, isLanguage, t, all, formatNumber, formatCredits, ago };
