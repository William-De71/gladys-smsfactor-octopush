// -----------------------------------------------------------------------------
// Every handler of the SMSFactor + Octopush integration, registered on the
// Gladys client it receives: index.js passes the real one, the tests the fake
// Gladys of the SDK (`@gladysassistant/integration-sdk/testing`).
//
// A COMMUNICATION integration of the SEND-ONLY family (`messaging: { receive:
// false }`): Gladys notifications go out by SMS through the provider chosen in
// the configuration, SMSFactor or Octopush (two French SMS gateways).
//   - The provider, its credentials and the sender are set once by the
//     administrator (`config_schema`); each user enters the phone number their
//     notifications go to (`contact_schema`, "My account" block), which Gladys
//     hands with every message to `onSendMessage`.
//   - SMSFactor only (Octopush tells them by callback, which needs a public
//     URL): delivery reports (`sms_undelivered`) and replies to the SMS sent
//     without a custom sender (`sms_received`, inbox widget). Replies never
//     reach the brain: a send-only channel cannot carry a user's authority,
//     and an SMS sender can be spoofed.
//   - Scene triggers sms_not_sent / sms_undelivered / sms_received /
//     credits_low, scene actions send_sms / get_account, widgets account /
//     inbox, Configuration screen buttons test_connection / send_test_sms.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, contactPhone } from './config.js';
import { createSmsService, SmsError, FAILURE_REASONS, toSmsError } from './sms.js';
import { FINAL_FAILURES, DELIVERY } from './providers/smsfactor.js';
import { createStore, DEFAULT_PATH } from './store.js';
import {
  createFailureEvents,
  receivedPayload,
  undeliveredPayload,
  SCENE_TRIGGERS,
} from './events.js';
import { buildAccountWidget, buildInboxWidget, WIDGETS } from './widgets.js';
import { normalizePhone, parsePhoneList, maskPhone } from './phone.js';
import { t, all, formatCredits } from './i18n.js';

const ACTIONS = Object.freeze({ TEST_CONNECTION: 'test_connection', SEND_TEST: 'send_test_sms' });
const SCENE_ACTIONS = Object.freeze({ SEND_SMS: 'send_sms', GET_ACCOUNT: 'get_account' });

// The account (credits) is read every 15 minutes, and after every send from
// the credits the provider returns. The replies are read every minute when
// the reception is on; the delivery reports every 5 minutes while an SMS
// sent in the last 48 hours has none.
const ACCOUNT_INTERVAL_MS = 15 * 60 * 1000;
const INCOMING_INTERVAL_MS = 60 * 1000;
const DELIVERY_INTERVAL_MS = 5 * 60 * 1000;
const DELIVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
// Readings start a little before the instant they stand at: the clocks of the
// provider and of Gladys may differ. Ids already handled are skipped.
const MARGIN_MS = 10 * 60 * 1000;

const TEST_MESSAGE = 'Gladys Assistant: SMS test OK';

// Status message of each failure reason (the others: status_error).
const STATUS_OF_REASON = {
  [FAILURE_REASONS.NOT_CONFIGURED]: 'status_not_configured',
  [FAILURE_REASONS.ACCESS_DENIED]: 'status_access_denied',
  [FAILURE_REASONS.ACCOUNT_NOT_VALIDATED]: 'status_account_not_validated',
  [FAILURE_REASONS.RATE_LIMITED]: 'status_rate_limited',
  [FAILURE_REASONS.UNREACHABLE]: 'status_unreachable',
  [FAILURE_REASONS.TIMEOUT]: 'status_unreachable',
};

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options (tests).
 * @param {Function} [options.transport] - HTTP transport of the providers.
 * @param {string} [options.statePath] - The state file.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.wait] - `(ms) => Promise`, pauses before retries.
 * @param {number[]} [options.retryDelaysMs] - Pauses before the send retries.
 * @param {Function} [options.requestId] - Id of an Octopush send.
 * @param {boolean} [options.timers] - Start the periodic readings (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 * @example
 * createApp(new GladysIntegration());
 */
function createApp(
  gladys,
  {
    transport,
    statePath = DEFAULT_PATH,
    now = () => Date.now(),
    wait,
    retryDelaysMs,
    requestId,
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  let config = normalizeConfig();
  // What the account widget shows.
  let account = null;
  let readAt = null;
  let readFailure = null;
  let lastFailure = null;
  let lastStatus = null;
  let accountTimer = null;
  let incomingTimer = null;
  let deliveryTimer = null;
  let pollingIncoming = false;
  let pollingDelivery = false;

  const sms = createSmsService({
    getConfig: () => config,
    ...(transport ? { transport } : {}),
    ...(wait ? { wait } : {}),
    ...(retryDelaysMs ? { retryDelaysMs } : {}),
    ...(requestId ? { requestId } : {}),
  });
  const store = createStore({ path: statePath, now, logger });
  const failures = createFailureEvents(gladys, logger);

  /** @returns {object} The provider in use. */
  const provider = () => sms.provider();
  /** @returns {boolean} Whether the replies are read. */
  const receptionOn = () => config.receiveSms && provider().capabilities.reception;
  /**
   * @description Credits in a language, with their unit.
   * @param {number|null} value - The amount.
   * @returns {Function} `(language) => string`.
   */
  const creditsText = (value) => (language) =>
    formatCredits(value, account?.unit ?? 'credits', language);

  /**
   * @description Ask the dashboards to fetch the widgets again (fire and forget).
   * @param {string[]} [keys] - The widgets.
   */
  function refreshWidgets(keys = Object.values(WIDGETS)) {
    keys.forEach((key) => {
      Promise.resolve()
        .then(() => gladys.requestWidgetRefresh(key))
        .catch((err) => logger.debug?.(`Widget refresh of ${key} failed: ${err.message}`));
    });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description The status message of a failure.
   * @param {string} reason - One of FAILURE_REASONS.
   * @returns {object} The multi-language message.
   */
  function statusOf(reason) {
    if (reason === FAILURE_REASONS.NOT_CONFIGURED) {
      return all(`noCredentials_${provider().id}`);
    }
    return all(STATUS_OF_REASON[reason] ?? 'status_error', { provider: provider().name });
  }

  /**
   * @description The sender as the Configuration screen shows it.
   * @returns {Function} `(language) => string`.
   */
  const senderText = () => (language) => config.sender || t('senderDefault', language);

  /**
   * @description Compare the credits with the threshold; fire `credits_low`
   * when they go below it.
   * @param {number|null} creditsLeft - Credits left.
   * @param {object} [options] - Options.
   * @param {boolean} [options.fire] - Whether a scene trigger may fire (never for a scene action).
   * @returns {Promise<void>}
   */
  async function checkCredits(creditsLeft, { fire = true } = {}) {
    if (typeof creditsLeft !== 'number' || account?.postpaid) {
      return;
    }
    const low = creditsLeft < config.lowCreditsThreshold;
    if (!fire || low === store.lowCredits()) {
      return;
    }
    await store.setLowCredits(low);
    if (!low) {
      return;
    }
    logger.warn(`${creditsLeft} left, below the threshold of ${config.lowCreditsThreshold}`);
    try {
      await gladys.publishSceneEvent(SCENE_TRIGGERS.CREDITS_LOW, {
        credits_left: creditsLeft,
        threshold: config.lowCreditsThreshold,
        unit: account?.unit ?? 'credits',
        provider: provider().id,
      });
    } catch (err) {
      logger.warn(`Could not fire ${SCENE_TRIGGERS.CREDITS_LOW}: ${err.message}`);
    }
  }

  /**
   * @description Read the account (credits) and report the status.
   * @param {object} [options] - Options.
   * @param {boolean} [options.fire] - Whether credits_low may fire.
   * @returns {Promise<object|null>} The account, null on failure.
   */
  async function refreshAccount({ fire = true } = {}) {
    try {
      const read = await sms.readAccount();
      account = read;
      readAt = now();
      readFailure = null;
      await reportStatus(
        true,
        all(read.postpaid ? 'statusConnectedPostpaid' : 'statusConnected', {
          provider: provider().name,
          credits: creditsText(read.creditsLeft),
          sender: senderText(),
        }),
      );
      await checkCredits(read.creditsLeft, { fire });
      return read;
    } catch (err) {
      const failure = toSmsError(err);
      readFailure = failure.reason;
      account = failure.reason === FAILURE_REASONS.NOT_CONFIGURED ? null : account;
      if (failure.reason !== FAILURE_REASONS.NOT_CONFIGURED) {
        logger.warn(`Unable to read the SMS account (${failure.reason}): ${failure.message}`);
      }
      await reportStatus(false, statusOf(failure.reason));
      return null;
    } finally {
      refreshWidgets([WIDGETS.ACCOUNT]);
    }
  }

  /**
   * @description Count a send, take the credits the provider returned, and
   * wait for its delivery report.
   * @param {object} report - The send report.
   * @param {object} options - Options.
   * @param {boolean} options.fire - Whether credits_low may fire.
   * @returns {Promise<void>}
   */
  async function afterSend(report, { fire }) {
    await store.recordSent(report.sentCount, report.creditsUsed);
    if (report.ticket && provider().capabilities.delivery) {
      await store.addPending(report.ticket);
      scheduleDelivery();
    }
    if (account && typeof report.creditsLeft === 'number') {
      account = { ...account, creditsLeft: report.creditsLeft };
      readAt = now();
      await checkCredits(report.creditsLeft, { fire });
    }
    refreshWidgets([WIDGETS.ACCOUNT]);
  }

  /**
   * @description Whether the credentials were refused at the last reading: no
   * periodic call until the account reading (every 15 minutes, or a new
   * configuration) tells they work again.
   * @returns {boolean} True when the readings must wait.
   */
  const refused = () =>
    readFailure === FAILURE_REASONS.ACCESS_DENIED || readFailure === FAILURE_REASONS.NOT_CONFIGURED;

  /**
   * @description Read the replies since the last reading; fire `sms_received`
   * for each new one.
   * @returns {Promise<number>} The number of new SMS.
   */
  async function pollIncoming() {
    if (!receptionOn() || !provider().hasCredentials() || pollingIncoming || refused()) {
      return 0;
    }
    pollingIncoming = true;
    try {
      const cursor = store.incomingCursor();
      const to = now() + 60 * 1000;
      if (!cursor) {
        // First reading: what is already there is history, nothing fires.
        const history = await sms.listIncoming(now() - MARGIN_MS, to);
        await store.startIncoming(
          new Date(now()).toISOString(),
          history.map((entry) => entry.id),
        );
        return 0;
      }
      const fresh = (await sms.listIncoming(Date.parse(cursor) - MARGIN_MS, to))
        .filter((entry) => !store.seen(entry.id))
        .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
      for (const received of fresh) {
        await store.recordIncoming(received);
        logger.info(`SMS received from ${maskPhone(received.sender)}`);
        try {
          await gladys.publishSceneEvent(SCENE_TRIGGERS.SMS_RECEIVED, receivedPayload(received));
        } catch (err) {
          logger.warn(`Could not fire ${SCENE_TRIGGERS.SMS_RECEIVED}: ${err.message}`);
        }
      }
      if (fresh.length > 0) {
        refreshWidgets();
      }
      return fresh.length;
    } catch (err) {
      logger.warn(`Unable to read the SMS received: ${err.message}`);
      return 0;
    } finally {
      pollingIncoming = false;
    }
  }

  /**
   * @description Read the delivery reports of the SMS sent that have none
   * yet; fire `sms_undelivered` for each one that never reached the phone.
   * A send is settled once every number has a final status, or after 48 hours.
   * @returns {Promise<number>} The number of SMS reported undelivered.
   */
  async function pollDelivery() {
    const pending = store.pending();
    if (pending.length === 0 || pollingDelivery || refused()) {
      return 0;
    }
    if (!provider().capabilities.delivery || !provider().hasCredentials()) {
      await store.removePending(pending.map((entry) => entry.ticket));
      return 0;
    }
    pollingDelivery = true;
    try {
      const from = Math.min(...pending.map((entry) => entry.sentAt)) - MARGIN_MS;
      const rows = await sms.listOutgoing(from, now() + 60 * 1000);
      const settled = [];
      let undelivered = 0;
      for (const { ticket, sentAt } of pending) {
        const own = rows.filter((row) => row.ticket === ticket);
        const final =
          own.length > 0 &&
          own.every((row) => row.status === DELIVERY.DELIVERED || FINAL_FAILURES.has(row.status));
        if (final) {
          for (const row of own.filter((entry) => FINAL_FAILURES.has(entry.status))) {
            undelivered += 1;
            logger.warn(`SMS to ${maskPhone(row.destination)} not delivered (${row.status})`);
            try {
              await gladys.publishSceneEvent(
                SCENE_TRIGGERS.SMS_UNDELIVERED,
                undeliveredPayload(row),
              );
            } catch (err) {
              logger.warn(`Could not fire ${SCENE_TRIGGERS.SMS_UNDELIVERED}: ${err.message}`);
            }
          }
          settled.push(ticket);
        } else if (now() - sentAt > DELIVERY_WINDOW_MS) {
          settled.push(ticket);
        }
      }
      await store.removePending(settled, undelivered);
      if (undelivered > 0) {
        refreshWidgets([WIDGETS.ACCOUNT]);
      }
      return undelivered;
    } catch (err) {
      logger.warn(`Unable to read the delivery reports: ${err.message}`);
      return 0;
    } finally {
      pollingDelivery = false;
    }
  }

  /**
   * @description Start reading the delivery reports, if not already.
   */
  function scheduleDelivery() {
    if (!timers || deliveryTimer) {
      return;
    }
    deliveryTimer = setInterval(() => {
      pollDelivery()
        .then(() => {
          if (store.pending().length === 0) {
            clearInterval(deliveryTimer);
            deliveryTimer = null;
          }
        })
        .catch((err) => logger.error('Reading of the delivery reports failed', err));
    }, DELIVERY_INTERVAL_MS);
  }

  /**
   * @description (Re)start the periodic readings.
   */
  function schedule() {
    clearInterval(accountTimer);
    clearInterval(incomingTimer);
    clearInterval(deliveryTimer);
    accountTimer = null;
    incomingTimer = null;
    deliveryTimer = null;
    if (!timers) {
      return;
    }
    accountTimer = setInterval(() => {
      refreshAccount().catch((err) => logger.error('Account reading failed', err));
    }, ACCOUNT_INTERVAL_MS);
    if (receptionOn()) {
      incomingTimer = setInterval(() => {
        pollIncoming().catch((err) => logger.error('Reading of the SMS received failed', err));
      }, INCOMING_INTERVAL_MS);
    }
    if (store.pending().length > 0) {
      scheduleDelivery();
    }
  }

  // --- Outgoing message: Gladys asks us to deliver a notification --------------------
  // A scene "send a message", an alert or a notification routed to a user ends
  // up here, for the users who entered their phone number. `message` is
  // `{ text, file }`: an SMS carries text only, the attachment is dropped.
  gladys.onSendMessage(async (contact, message) => {
    const phone = contactPhone(contact, config.countryCode);
    const receivers = [phone ?? String(contact?.phone_number ?? '')];
    try {
      if (!phone) {
        throw new SmsError('The phone number of the user is not a valid phone number', {
          reason: FAILURE_REASONS.INVALID_NUMBER,
        });
      }
      logger.info(`onSendMessage -> SMS to ${maskPhone(phone)} through ${provider().name}`);
      const report = await sms.send([phone], message?.text);
      failures.sent(receivers);
      await afterSend(report, { fire: true });
    } catch (err) {
      const failure = toSmsError(err);
      logger.warn(
        `SMS to ${maskPhone(receivers[0])} not sent (${failure.reason}): ${failure.message}`,
      );
      lastFailure = { reason: failure.reason, at: now() };
      await failures.failed(receivers, failure);
      refreshWidgets([WIDGETS.ACCOUNT]);
      throw failure;
    }
  });

  // --- Scene actions -------------------------------------------------------------------
  // Their result goes to the scene; they never fire a scene trigger.
  gladys.onSceneAction(SCENE_ACTIONS.SEND_SMS, async (fields = {}) => {
    const { valid, invalid } = parsePhoneList(fields.phone_numbers, config.countryCode);
    if (valid.length === 0) {
      throw new Error('No valid phone number in the action (use +33612345678, one per comma)');
    }
    const report = await sms.send(valid, String(fields.message ?? ''));
    await afterSend(report, { fire: false });
    const refusedCount = Object.values(report.refused).reduce((sum, value) => sum + value, 0);
    return {
      sent_count: report.sentCount,
      invalid_numbers: invalid.join(', ').slice(0, 1000),
      refused_count: refusedCount,
      credits_used: report.creditsUsed ?? 0,
      credits_left: report.creditsLeft ?? account?.creditsLeft ?? 0,
    };
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_ACCOUNT, async () => {
    const read = await refreshAccount({ fire: false });
    if (!read) {
      throw new Error(`Unable to read the SMS account (${readFailure})`);
    }
    const counters = store.counters();
    return {
      credits_left: read.creditsLeft ?? 0,
      unit: read.unit,
      sent_this_month: counters.sent,
      received_this_month: counters.received,
      undelivered_this_month: counters.undelivered,
      provider: provider().id,
    };
  });

  // --- Configuration screen buttons ----------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    try {
      const read = await sms.readAccount();
      const senders = provider().capabilities.senders ? await sms.listSenders() : null;
      await refreshAccount({ fire: false });
      return all(senders === null ? 'testOkNoSenders' : 'testOk', {
        provider: provider().name,
        credits: (language) =>
          read.postpaid
            ? t('postpaid', language)
            : formatCredits(read.creditsLeft, read.unit, language),
        senders: (language) =>
          senders && senders.length > 0
            ? senders
                .map(
                  (entry) =>
                    `${entry.sender} (${t(entry.validated ? 'senderValidated' : 'senderPending', language)})`,
                )
                .join(', ')
                .slice(0, 80)
            : t('sendersNone', language),
        sender: senderText(),
      });
    } catch (err) {
      return statusOf(toSmsError(err).reason);
    }
  });

  gladys.onAction(ACTIONS.SEND_TEST, async (fields = {}) => {
    const typed = String(fields.phone_number ?? '').trim();
    const phone = normalizePhone(typed, config.countryCode);
    if (!phone) {
      return all('invalidPhone', { phone: typed.slice(0, 40) });
    }
    try {
      const report = await sms.send([phone], TEST_MESSAGE);
      await afterSend(report, { fire: false });
      return all(report.moderated ? 'testSentModerated' : 'testSent', {
        phone: maskPhone(phone),
        provider: provider().name,
      });
    } catch (err) {
      const failure = toSmsError(err);
      if (failure.reason === FAILURE_REASONS.NOT_CONFIGURED) {
        return all(`noCredentials_${provider().id}`);
      }
      return all('testNotSent', {
        reason: (language) => t(`reason_${failure.reason}`, language),
      });
    }
  });

  // --- Dashboard widgets -----------------------------------------------------------------
  gladys.onWidgetGet(WIDGETS.ACCOUNT, async ({ language } = {}) =>
    buildAccountWidget({
      snapshot: {
        provider: { id: provider().id, name: provider().name, ...provider().capabilities },
        account,
        readAt,
        readFailure,
        sender: config.sender,
        lastFailure,
        counters: store.counters(),
        threshold: config.lowCreditsThreshold,
        receiveSms: receptionOn(),
      },
      language,
      now: now(),
    }),
  );

  gladys.onWidgetGet(WIDGETS.INBOX, async ({ language } = {}) =>
    buildInboxWidget({
      messages: store.recentIncoming(),
      received: store.counters().received,
      receiveSms: receptionOn(),
      supported: provider().capabilities.reception,
      language,
    }),
  );

  // --- Configuration ---------------------------------------------------------------------

  /**
   * @description Read the configuration again.
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      config = normalizeConfig(await gladys.getConfig());
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    lastStatus = null;
    if (config.provider !== previous.provider) {
      // Another provider: its account, its replies, its tickets.
      account = null;
      readAt = null;
      lastFailure = null;
      await store.stopIncoming();
      await store.removePending(store.pending().map((entry) => entry.ticket));
    }
    if (!receptionOn()) {
      await store.stopIncoming();
    }
    if (
      config.lowCreditsThreshold !== previous.lowCreditsThreshold ||
      config.provider !== previous.provider
    ) {
      // A new threshold: the next reading compares again from scratch.
      await store.setLowCredits(null);
    }
    logger.info(
      `Configuration updated (${provider().name}, reception of replies ${receptionOn() ? 'on' : 'off'})`,
    );
    await refreshAccount();
    await pollIncoming();
    schedule();
    refreshWidgets();
  });

  // --- Connection lifecycle --------------------------------------------------------------
  gladys.on('connected', async () => {
    await loadConfig();
    await store.load();
    lastStatus = null;
    await refreshAccount();
    await pollIncoming();
    schedule();
  });

  // --- Graceful shutdown -----------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    clearInterval(accountTimer);
    clearInterval(incomingTimer);
    clearInterval(deliveryTimer);
    await store.flush();
  });

  return {
    getConfig: () => config,
    store,
    sms,
    refreshAccount,
    pollIncoming,
    pollDelivery,
    schedule,
  };
}

export { createApp, ACTIONS, SCENE_ACTIONS, TEST_MESSAGE, MARGIN_MS, DELIVERY_WINDOW_MS };
