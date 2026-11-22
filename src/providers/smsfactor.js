// -----------------------------------------------------------------------------
// SMSFactor (https://dev.smsfactor.com), with an API token
// (`Authorization: Bearer …`, JSON with `Accept: application/json`):
//
//   GET  /credits     credits left
//   GET  /senders     the senders of the account and their validation state
//   POST /send        send an SMS ("campaign": one text, several numbers)
//   GET  /messages    the messages over a period: sent ones with their
//                     delivery status (type=messages-out), received ones —
//                     replies to the SMS sent without a custom sender —
//                     (type=messages-in)
//
// SMSFactor answers HTTP 200 even when it refuses a call: the outcome is the
// `status` field of the body (1 OK, -1 authentication, -3 credits, -5 not
// found, -7 data, -8 under moderation — the SMS will leave —, -99 unknown).
// Numbers go without "+" ("33612345678"); dates are "Y-m-d H:i:s", Paris time.
// -----------------------------------------------------------------------------

import { ApiError, ERROR_KINDS, kindOfStatus, callJson, queryString } from '../http.js';
import { toParis, fromParis } from '../paris-time.js';
import { needsUnicode } from '../gsm.js';

const BASE_URL = 'https://api.smsfactor.com';
const LABEL = 'SMSFactor';

// The `status` codes of a SMSFactor answer.
const STATUS = Object.freeze({
  OK: 1,
  AUTH: -1,
  NOT_ENOUGH_CREDITS: -3,
  NOT_FOUND: -5,
  DATA: -7,
  MODERATION: -8,
  UNKNOWN: -99,
});

// Delivery statuses of a sent SMS (GET /messages), lower case.
const DELIVERY = Object.freeze({
  DELIVERED: 'delivered',
  SENT: 'sent',
  WAITING: 'waiting',
  MODERATION: 'moderation',
  DENIED: 'denied',
  NOT_SENT: 'not_sent',
  UNDELIVERED: 'undelivered',
});
const FINAL_FAILURES = new Set([DELIVERY.DENIED, DELIVERY.NOT_SENT, DELIVERY.UNDELIVERED]);

// Most rows GET /messages returns in one page (the documented maximum).
const PAGE_LENGTH = 1000;

/**
 * @description A count of the send report, 0 when missing.
 * @param {any} value - The raw value.
 * @returns {number} The count.
 */
const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * @description A number, or null when missing.
 * @param {any} value - The raw value.
 * @returns {number|null} The number.
 */
const numberOrNull = (value) => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number)
    ? number
    : null;
};

/**
 * @description The error of a SMSFactor answer, null when it is a success.
 * @param {number} httpStatus - HTTP status.
 * @param {any} data - The parsed body.
 * @returns {ApiError|null} The error.
 * @example
 * errorOf(200, { status: -1, message: 'Utilisateur ou mot de passe incorrect' }).kind; // -> 'auth'
 */
function errorOf(httpStatus, data) {
  const code = typeof data?.status === 'number' ? data.status : Number(data?.status);
  const providerMessage = [data?.message, data?.details]
    .filter((part) => typeof part === 'string' && part)
    .join(': ')
    .slice(0, 300);
  if (httpStatus >= 400) {
    return new ApiError(`SMSFactor answered HTTP ${httpStatus}`, {
      kind: kindOfStatus(httpStatus),
      status: httpStatus,
      code: Number.isFinite(code) ? code : null,
      providerMessage: providerMessage || null,
    });
  }
  if (code === STATUS.OK || code === STATUS.MODERATION) {
    return null;
  }
  if (!Number.isFinite(code)) {
    return new ApiError('SMSFactor sent an unexpected answer', {
      kind: ERROR_KINDS.UNEXPECTED,
      status: httpStatus,
    });
  }
  const kinds = {
    [STATUS.AUTH]: ERROR_KINDS.AUTH,
    [STATUS.NOT_FOUND]: ERROR_KINDS.NOT_FOUND,
    [STATUS.UNKNOWN]: ERROR_KINDS.SERVER,
  };
  return new ApiError(
    `SMSFactor refused the call (status ${code}${providerMessage ? `: ${providerMessage}` : ''})`,
    {
      kind: kinds[code] ?? ERROR_KINDS.BAD_REQUEST,
      status: httpStatus,
      code,
      providerMessage: providerMessage || null,
    },
  );
}

/**
 * @description Create the SMSFactor provider.
 * @param {object} options - Options.
 * @param {Function} options.getConfig - `() => normalizeConfig(...)` (token, sender).
 * @param {Function} options.transport - HTTP transport.
 * @returns {object} The provider.
 * @example
 * const provider = createSmsFactor({ getConfig: () => config, transport: fetchTransport });
 */
function createSmsFactor({ getConfig, transport }) {
  /**
   * @description Call the API; refused calls throw.
   * @param {string} method - HTTP method.
   * @param {string} path - Path, query string included.
   * @param {any} [body] - JSON body.
   * @returns {Promise<any>} The body.
   */
  async function call(method, path, body) {
    const { status, data } = await callJson({
      transport,
      label: LABEL,
      method,
      url: `${BASE_URL}${path}`,
      headers: { Authorization: `Bearer ${getConfig().smsfactorToken}` },
      body,
    });
    const error = errorOf(status, data);
    if (error) {
      throw error;
    }
    return data;
  }

  /**
   * @description Read the messages of a period, one direction.
   * @param {string} type - messages-in or messages-out.
   * @param {number} from - Start, in ms.
   * @param {number} to - End, in ms.
   * @returns {Promise<object[]>} The raw rows ([] when there is none).
   */
  async function messages(type, from, to) {
    try {
      const data = await call(
        'GET',
        `/messages${queryString({
          date_start: toParis(from),
          date_end: toParis(to),
          type,
          length: PAGE_LENGTH,
          sort: '-date',
        })}`,
      );
      return Array.isArray(data?.messages) ? data.messages : [];
    } catch (err) {
      // "Resource not found": nothing in that period.
      if (err instanceof ApiError && err.code === STATUS.NOT_FOUND) {
        return [];
      }
      throw err;
    }
  }

  return {
    id: 'smsfactor',
    name: LABEL,
    capabilities: Object.freeze({ reception: true, delivery: true, senders: true }),

    /** @returns {boolean} Whether the token is set. */
    hasCredentials: () => Boolean(getConfig().smsfactorToken),

    /**
     * @description Credits left.
     * @returns {Promise<{ creditsLeft: number|null, unit: string, postpaid: boolean }>} The account.
     */
    async readAccount() {
      const data = await call('GET', '/credits');
      return {
        creditsLeft: numberOrNull(data?.credits),
        unit: 'credits',
        postpaid: count(data?.postpaid) > 0 || data?.unlimited === true,
      };
    },

    /**
     * @description The senders of the account.
     * @returns {Promise<Array<{ sender: string, validated: boolean }>>} The senders.
     */
    async listSenders() {
      const data = await call('GET', '/senders');
      return (Array.isArray(data?.senders) ? data.senders : []).map((entry) => ({
        sender: String(entry?.sender ?? ''),
        // 2: request validated (0 in progress, 1 sent to the operator,
        // -1 rejected, 3 cancelled).
        validated: Number(entry?.status) === 2,
      }));
    },

    /**
     * @description Send one text to one or several numbers.
     * @param {string[]} receivers - Numbers in international format ("+33…").
     * @param {string} text - The text.
     * @returns {Promise<object>} The report: `{ ticket, sentCount, refused, creditsUsed,
     *   creditsLeft, moderated }`, `refused` counting the numbers SMSFactor filtered by cause.
     */
    async send(receivers, text) {
      const { sender } = getConfig();
      const data = await call('POST', '/send', {
        sms: {
          message: {
            text,
            // Notifications of a home are alerts, not marketing: sent at any
            // hour, no "STOP" mention.
            pushtype: 'alert',
            ...(sender ? { sender } : {}),
            unicode: needsUnicode(text) ? 1 : 0,
          },
          recipients: { gsm: receivers.map((phone) => ({ value: phone.replace(/^\+/, '') })) },
        },
      });
      const refused = {
        invalid: count(data?.invalid),
        blocked: count(data?.blacklisted) + count(data?.npai),
        notAllowed: count(data?.not_allowed) + count(data?.country_limit),
        flood: count(data?.flood),
      };
      const total = count(data?.total) || receivers.length;
      const sentCount = data?.sent === undefined ? total : count(data.sent);
      return {
        ticket: data?.ticket === undefined || data.ticket === null ? null : String(data.ticket),
        sentCount,
        refused,
        creditsUsed: numberOrNull(data?.cost),
        creditsLeft: numberOrNull(data?.credits),
        moderated: Number(data?.status) === STATUS.MODERATION,
      };
    },

    /**
     * @description The SMS received over a period (replies to the SMS sent).
     * @param {number} from - Start, in ms.
     * @param {number} to - End, in ms.
     * @returns {Promise<Array<{ id: string, sender: string, message: string, receivedAt: string|null }>>} The SMS.
     */
    async listIncoming(from, to) {
      return (await messages('messages-in', from, to))
        .filter((row) => row && (row.type === undefined || row.type === 'sms_mo'))
        .map((row) => {
          const instant = fromParis(row.date);
          const sender = String(row.sender ?? '');
          return {
            id: String(row.message_id ?? ''),
            sender: /^\d+$/.test(sender) ? `+${sender}` : sender,
            message: String(row.message ?? ''),
            receivedAt: instant === null ? null : new Date(instant).toISOString(),
          };
        })
        .filter((sms) => sms.id);
    },

    /**
     * @description The SMS sent over a period, with their delivery status.
     * @param {number} from - Start, in ms.
     * @param {number} to - End, in ms.
     * @returns {Promise<Array<{ ticket: string, destination: string, status: string, details: string }>>} The SMS.
     */
    async listOutgoing(from, to) {
      return (await messages('messages-out', from, to))
        .filter((row) => row && row.campaign_id !== undefined && row.campaign_id !== null)
        .map((row) => {
          const destination = String(row.destination ?? '');
          return {
            ticket: String(row.campaign_id),
            destination: /^\d+$/.test(destination) ? `+${destination}` : destination,
            status: String(row.status ?? '').toLowerCase(),
            details: String(row.status_details ?? '').slice(0, 200),
          };
        });
    },
  };
}

export { createSmsFactor, errorOf, STATUS, DELIVERY, FINAL_FAILURES, BASE_URL };
