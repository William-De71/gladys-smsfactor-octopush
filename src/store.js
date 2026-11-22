// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data/state.json (the
// only writable path of the container):
//
//   month, sent, creditsUsed, received,  counters of the current month (the
//   undelivered                          account widget), reset each month
//   lowCredits                           the last state of the low credits
//                                        transition, so a restart does not fire
//                                        `credits_low` again
//   incomingCursor, seenIncoming         where the reading of the received SMS
//                                        stands (SMSFactor): an SMS fires
//                                        `sms_received` once, never again
//                                        after a restart
//   recentIncoming                       the last SMS received, for the inbox
//                                        widget
//   pending                              the tickets of the SMS sent whose
//                                        delivery is not known yet
//                                        (SMSFactor), for `sms_undelivered`
//
// A missing or broken file starts empty. Writes go through a temporary file
// and a rename, one after the other.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/state.json';
const MAX_SEEN = 500;
const MAX_RECENT = 20;
const MAX_PENDING = 200;

/**
 * @description The month of an instant, 'YYYY-MM' (UTC).
 * @param {number} instant - The instant, in ms.
 * @returns {string} The month.
 * @example
 * monthOf(Date.UTC(2026, 10, 22)); // -> '2026-11'
 */
const monthOf = (instant) => new Date(instant).toISOString().slice(0, 7);

/**
 * @description A fresh state.
 * @param {number} now - Now, in ms.
 * @returns {object} The state.
 */
function emptyState(now) {
  return {
    version: 1,
    month: monthOf(now),
    sent: 0,
    creditsUsed: 0,
    received: 0,
    undelivered: 0,
    lowCredits: null,
    incomingCursor: null,
    seenIncoming: [],
    recentIncoming: [],
    pending: [],
  };
}

/**
 * @description Keep the known fields of a state read from disk.
 * @param {object} data - The parsed file.
 * @param {number} now - Now, in ms.
 * @returns {object} The state.
 */
function sanitize(data, now) {
  const state = emptyState(now);
  if (typeof data?.month === 'string') {
    state.month = data.month;
  }
  ['sent', 'creditsUsed', 'received', 'undelivered'].forEach((key) => {
    if (Number.isFinite(data?.[key]) && data[key] >= 0) {
      state[key] = data[key];
    }
  });
  if (typeof data?.lowCredits === 'boolean') {
    state.lowCredits = data.lowCredits;
  }
  if (typeof data?.incomingCursor === 'string') {
    state.incomingCursor = data.incomingCursor;
  }
  if (Array.isArray(data?.seenIncoming)) {
    state.seenIncoming = data.seenIncoming
      .filter((id) => typeof id === 'string' && id)
      .slice(-MAX_SEEN);
  }
  if (Array.isArray(data?.recentIncoming)) {
    state.recentIncoming = data.recentIncoming
      .filter((sms) => sms && typeof sms.id === 'string' && typeof sms.message === 'string')
      .slice(0, MAX_RECENT);
  }
  if (Array.isArray(data?.pending)) {
    state.pending = data.pending
      .filter((entry) => typeof entry?.ticket === 'string' && Number.isFinite(entry?.sentAt))
      .slice(-MAX_PENDING);
  }
  return state;
}

/**
 * @description Create the store.
 * @param {object} options - Options.
 * @param {string} [options.path] - The JSON file.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {object} options.logger - Logger.
 * @returns {object} The store.
 * @example
 * const store = createStore({ logger });
 * await store.load();
 */
function createStore({ path = DEFAULT_PATH, now = () => Date.now(), logger }) {
  let state = emptyState(now());
  let saving = Promise.resolve();

  /**
   * @description A new month starts the counters again.
   */
  function rollMonth() {
    const month = monthOf(now());
    if (state.month !== month) {
      state.month = month;
      state.sent = 0;
      state.creditsUsed = 0;
      state.received = 0;
      state.undelivered = 0;
    }
  }

  /**
   * @description Write the state (queued, never throws).
   * @returns {Promise<void>} Resolves once written (or failed).
   */
  function save() {
    const content = JSON.stringify(state);
    saving = saving.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, content);
        await rename(`${path}.tmp`, path);
      } catch (err) {
        logger.warn(`Unable to write ${path}: ${err.message}`);
      }
    });
    return saving;
  }

  return {
    /**
     * @description Read the file; a missing or broken file starts empty.
     * @returns {Promise<void>}
     */
    async load() {
      try {
        state = sanitize(JSON.parse(await readFile(path, 'utf8')), now());
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Unable to read ${path}: ${err.message}`);
        }
        state = emptyState(now());
      }
      rollMonth();
    },

    /** @returns {{ month: string, sent: number, creditsUsed: number, received: number, undelivered: number }} The counters. */
    counters() {
      rollMonth();
      return {
        month: state.month,
        sent: state.sent,
        creditsUsed: state.creditsUsed,
        received: state.received,
        undelivered: state.undelivered,
      };
    },

    /**
     * @description Count SMS sent by the integration.
     * @param {number} count - SMS sent (one per receiver).
     * @param {number|null} creditsUsed - Credits used.
     * @returns {Promise<void>}
     */
    recordSent(count, creditsUsed) {
      rollMonth();
      state.sent += count;
      if (Number.isFinite(creditsUsed)) {
        state.creditsUsed = Math.round((state.creditsUsed + creditsUsed) * 100) / 100;
      }
      return save();
    },

    /** @returns {boolean|null} The last low credits state (null: never read). */
    lowCredits: () => state.lowCredits,

    /**
     * @description Remember the low credits state.
     * @param {boolean} low - Below the threshold or not.
     * @returns {Promise<void>}
     */
    setLowCredits(low) {
      if (state.lowCredits === low) {
        return Promise.resolve();
      }
      state.lowCredits = low;
      return save();
    },

    /** @returns {string|null} The instant the reading of the received SMS stands at. */
    incomingCursor: () => state.incomingCursor,

    /**
     * @description Start reading the received SMS from an instant (first
     * start of the reception: the older ones are history, nothing fires).
     * @param {string} iso - The instant.
     * @param {string[]} [alreadyThere] - Ids of the SMS already received: never fired.
     * @returns {Promise<void>}
     */
    startIncoming(iso, alreadyThere = []) {
      state.incomingCursor = iso;
      state.seenIncoming = alreadyThere.filter((id) => typeof id === 'string').slice(-MAX_SEEN);
      return save();
    },

    /** @description Forget the reading of the received SMS (reception turned off). */
    stopIncoming() {
      if (state.incomingCursor === null && state.seenIncoming.length === 0) {
        return Promise.resolve();
      }
      state.incomingCursor = null;
      state.seenIncoming = [];
      return save();
    },

    /**
     * @description Whether an SMS received was already handled.
     * @param {string} id - Its id.
     * @returns {boolean} True when already seen.
     */
    seen: (id) => state.seenIncoming.includes(id),

    /**
     * @description Remember a handled SMS, move the cursor, keep it for the inbox.
     * @param {object} sms - The SMS received.
     * @returns {Promise<void>}
     */
    recordIncoming(sms) {
      rollMonth();
      state.seenIncoming = [...state.seenIncoming, sms.id].slice(-MAX_SEEN);
      state.received += 1;
      if (sms.receivedAt && (!state.incomingCursor || sms.receivedAt > state.incomingCursor)) {
        state.incomingCursor = sms.receivedAt;
      }
      state.recentIncoming = [
        {
          id: sms.id,
          sender: sms.sender,
          message: sms.message.slice(0, 2000),
          receivedAt: sms.receivedAt,
        },
        ...state.recentIncoming.filter((entry) => entry.id !== sms.id),
      ].slice(0, MAX_RECENT);
      return save();
    },

    /** @returns {object[]} The last SMS received, newest first. */
    recentIncoming: () => [...state.recentIncoming],

    /** @returns {Array<{ ticket: string, sentAt: number }>} SMS whose delivery is not known yet. */
    pending: () => [...state.pending],

    /**
     * @description Wait for the delivery report of an SMS sent.
     * @param {string} ticket - The ticket of the send.
     * @returns {Promise<void>}
     */
    addPending(ticket) {
      state.pending = [
        ...state.pending.filter((entry) => entry.ticket !== ticket),
        { ticket, sentAt: now() },
      ].slice(-MAX_PENDING);
      return save();
    },

    /**
     * @description Stop waiting for some SMS (delivered, failed, or too old).
     * @param {string[]} tickets - Their tickets.
     * @param {number} [undelivered] - How many of their SMS never reached the phone.
     * @returns {Promise<void>}
     */
    removePending(tickets, undelivered = 0) {
      rollMonth();
      state.undelivered += undelivered;
      const before = state.pending.length;
      state.pending = state.pending.filter((entry) => !tickets.includes(entry.ticket));
      return state.pending.length === before && undelivered === 0 ? Promise.resolve() : save();
    },

    /** @returns {Promise<void>} Resolves when every write is done (tests, shutdown). */
    flush: () => saving,
  };
}

export { createStore, monthOf, DEFAULT_PATH };
