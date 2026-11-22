// -----------------------------------------------------------------------------
// Octopush (https://dev.octopush.com), with the login (e-mail address) and the
// API key of the account, in the `api-login` and `api-key` headers:
//
//   GET  /v1/public/wallet/check-balance   the balance ({ amount, unit })
//   POST /v1/public/sms-campaign/send      send an SMS (up to 500 numbers)
//
// Refusals come as HTTP 4xx with `{ code, message }` (103 no valid recipient,
// 104 not enough credit, 106 invalid sender, 113 account not validated yet,
// 121 STOP mention missing, 142 free pack: own number only…). Octopush tells
// delivery reports and replies only through callbacks (a public URL): the
// integration does not track them, and says so.
//
// Every send carries a `request_id`: Octopush refuses the same id twice
// within 24 hours (code 182), so retrying a send cannot deliver it twice.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { ApiError, ERROR_KINDS, kindOfStatus, callJson } from '../http.js';

const BASE_URL = 'https://api.octopush.com/v1/public';
const LABEL = 'Octopush';

// The error codes the integration reads (others: their HTTP status decides).
const CODES = Object.freeze({
  NO_VALID_RECIPIENT: 103,
  NOT_ENOUGH_CREDIT: 104,
  INVALID_SENDER: 106,
  NOT_VALIDATED: 113,
  STOP_MISSING: 121,
  FREE_PACK: 142,
  INVALID_SENDER_PREMIUM: 172,
  INVALID_PHONE: 181,
  DUPLICATE_REQUEST: 182,
  AUTHENTICATION: 401,
  ACCESS_DENIED: 403,
});

// SMS types of an Octopush send (config value -> API value).
const SMS_TYPES = Object.freeze({ premium: 'sms_premium', low_cost: 'sms_low_cost' });
const DEFAULT_SMS_TYPE = 'premium';

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
 * @description The error of an Octopush answer, null when it is a success.
 * @param {number} httpStatus - HTTP status.
 * @param {any} data - The parsed body.
 * @returns {ApiError|null} The error.
 * @example
 * errorOf(400, { code: 104, message: "You don't have enough credit." }).code; // -> 104
 */
function errorOf(httpStatus, data) {
  if (httpStatus >= 200 && httpStatus < 300) {
    return null;
  }
  const code = numberOrNull(data?.code);
  const providerMessage =
    typeof data?.message === 'string' && data.message ? data.message.slice(0, 300) : null;
  let kind = kindOfStatus(httpStatus);
  if (code === CODES.AUTHENTICATION || code === CODES.ACCESS_DENIED) {
    kind = ERROR_KINDS.AUTH;
  }
  return new ApiError(
    `Octopush answered HTTP ${httpStatus}${code === null ? '' : ` (code ${code}${providerMessage ? `: ${providerMessage}` : ''})`}`,
    { kind, status: httpStatus, code, providerMessage },
  );
}

/**
 * @description Create the Octopush provider.
 * @param {object} options - Options.
 * @param {Function} options.getConfig - `() => normalizeConfig(...)` (login, key, sender, SMS type).
 * @param {Function} options.transport - HTTP transport.
 * @param {Function} [options.requestId] - `() => string`, the id of a send (tests).
 * @returns {object} The provider.
 * @example
 * const provider = createOctopush({ getConfig: () => config, transport: fetchTransport });
 */
function createOctopush({ getConfig, transport, requestId = randomUUID }) {
  /**
   * @description Call the API; refused calls throw.
   * @param {string} method - HTTP method.
   * @param {string} path - Path.
   * @param {any} [body] - JSON body.
   * @returns {Promise<any>} The body.
   */
  async function call(method, path, body) {
    const config = getConfig();
    const { status, data } = await callJson({
      transport,
      label: LABEL,
      method,
      url: `${BASE_URL}${path}`,
      headers: { 'api-login': config.octopushLogin, 'api-key': config.octopushApiKey },
      body,
    });
    const error = errorOf(status, data);
    if (error) {
      throw error;
    }
    return data;
  }

  return {
    id: 'octopush',
    name: LABEL,
    capabilities: Object.freeze({ reception: false, delivery: false, senders: false }),

    /** @returns {boolean} Whether the login and the API key are set. */
    hasCredentials: () => Boolean(getConfig().octopushLogin && getConfig().octopushApiKey),

    /**
     * @description The balance of the account.
     * @returns {Promise<{ creditsLeft: number|null, unit: string, postpaid: boolean }>} The account.
     */
    async readAccount() {
      const data = await call('GET', '/wallet/check-balance');
      return {
        creditsLeft: numberOrNull(data?.amount),
        // "euros" in the documentation; anything else is shown as credits.
        unit: /euro/i.test(String(data?.unit ?? '')) ? 'eur' : 'credits',
        postpaid: false,
      };
    },

    /** @returns {Promise<Array>} Octopush has no API for the senders. */
    async listSenders() {
      return [];
    },

    /**
     * @description Send one text to one or several numbers.
     * @param {string[]} receivers - Numbers in international format ("+33…").
     * @param {string} text - The text.
     * @param {object} [options] - Options.
     * @param {string} [options.requestId] - The id of the send (kept across retries).
     * @returns {Promise<object>} The report: `{ ticket, sentCount, refused, creditsUsed,
     *   creditsLeft, moderated }`.
     */
    async send(receivers, text, { requestId: id = requestId() } = {}) {
      const config = getConfig();
      const data = await call('POST', '/sms-campaign/send', {
        recipients: receivers.map((phone) => ({ phone_number: phone })),
        text,
        type: SMS_TYPES[config.octopushSmsType] ?? SMS_TYPES[DEFAULT_SMS_TYPE],
        // Notifications of a home are alerts (transactional), not marketing:
        // sent at any hour, no "STOP" mention.
        purpose: 'alert',
        ...(config.sender ? { sender: config.sender } : {}),
        request_id: id,
      });
      const sentCount = numberOrNull(data?.number_of_contacts) ?? receivers.length;
      return {
        ticket: typeof data?.sms_ticket === 'string' ? data.sms_ticket : null,
        sentCount,
        refused: {
          invalid: Math.max(0, receivers.length - sentCount),
          blocked: 0,
          notAllowed: 0,
          flood: 0,
        },
        creditsUsed: numberOrNull(data?.total_cost),
        creditsLeft: numberOrNull(data?.residual_credit),
        moderated: false,
      };
    },

    /** @returns {Promise<Array>} Octopush tells replies by callback only. */
    async listIncoming() {
      return [];
    },

    /** @returns {Promise<Array>} Octopush tells delivery reports by callback only. */
    async listOutgoing() {
      return [];
    },
  };
}

export { createOctopush, errorOf, CODES, SMS_TYPES, DEFAULT_SMS_TYPE, BASE_URL };
