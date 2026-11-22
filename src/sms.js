// -----------------------------------------------------------------------------
// The SMS service of the house: the provider chosen in the configuration
// (SMSFactor or Octopush, src/providers/), the send with its checks and
// retries, and why an SMS was not sent (FAILURE_REASONS, the same for both
// providers so that scenes filter on one list).
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { ApiError, ERROR_KINDS, fetchTransport } from './http.js';
import { createSmsFactor, STATUS as SMSFACTOR } from './providers/smsfactor.js';
import { createOctopush, CODES as OCTOPUSH } from './providers/octopush.js';

// Why an SMS was not sent, as the `reason` of an SmsError and of the
// `sms_not_sent` scene trigger. Scenes store these values: never rename one.
const FAILURE_REASONS = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  ACCESS_DENIED: 'access_denied',
  NOT_ENOUGH_CREDITS: 'not_enough_credits',
  INVALID_NUMBER: 'invalid_number',
  INVALID_SENDER: 'invalid_sender',
  BLOCKED_NUMBER: 'blocked_number',
  COUNTRY_NOT_ALLOWED: 'country_not_allowed',
  ACCOUNT_NOT_VALIDATED: 'account_not_validated',
  REJECTED: 'rejected',
  RATE_LIMITED: 'rate_limited',
  SERVER_ERROR: 'server_error',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  UNEXPECTED: 'unexpected',
});

const PROVIDERS = Object.freeze({ SMSFACTOR: 'smsfactor', OCTOPUSH: 'octopush' });
const DEFAULT_PROVIDER = PROVIDERS.SMSFACTOR;

// Pauses before retrying a send the provider answered 429 (too many calls) or
// 503 (unavailable): nothing was created. Never a timeout or another 5xx with
// SMSFactor: the SMS may have left, and a duplicate alert is worse than a
// reported failure. Octopush sends carry a request id, refused twice.
const RETRY_DELAYS_MS = [2 * 1000, 5 * 1000];
const RETRYABLE_STATUSES = new Set([429, 503]);

// Longest text of one send: Octopush takes 1 to 1224 characters; the same
// bound for SMSFactor keeps the cost of a runaway text in check. Past it, the
// text is cut instead of being refused.
const MAX_MESSAGE_LENGTH = 1224;

/**
 * @description An SMS that was not sent, with the reason.
 */
class SmsError extends Error {
  /**
   * @param {string} message - Readable message, in English, without any credential.
   * @param {object} details - Details.
   * @param {string} details.reason - One of FAILURE_REASONS.
   * @param {number|null} [details.status] - HTTP status, when the provider answered.
   * @param {Error} [details.cause] - Underlying error.
   */
  constructor(message, { reason, status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SmsError';
    this.reason = reason;
    this.status = status;
  }
}

/**
 * @description The failure reason of a refused call.
 * @param {Error} err - An ApiError (or anything else).
 * @returns {string} One of FAILURE_REASONS.
 * @example
 * reasonOf(new ApiError('x', { kind: 'bad_request', code: 104 })); // -> 'not_enough_credits'
 */
function reasonOf(err) {
  if (err instanceof SmsError) {
    return err.reason;
  }
  if (!(err instanceof ApiError)) {
    return FAILURE_REASONS.UNEXPECTED;
  }
  const message = err.providerMessage ?? '';
  switch (err.code) {
    case SMSFACTOR.NOT_ENOUGH_CREDITS:
    case OCTOPUSH.NOT_ENOUGH_CREDIT:
      return FAILURE_REASONS.NOT_ENOUGH_CREDITS;
    case OCTOPUSH.NO_VALID_RECIPIENT:
    case OCTOPUSH.INVALID_PHONE:
      return FAILURE_REASONS.INVALID_NUMBER;
    case OCTOPUSH.INVALID_SENDER:
    case OCTOPUSH.INVALID_SENDER_PREMIUM:
      return FAILURE_REASONS.INVALID_SENDER;
    case OCTOPUSH.NOT_VALIDATED:
      return FAILURE_REASONS.ACCOUNT_NOT_VALIDATED;
    default:
      break;
  }
  switch (err.kind) {
    case ERROR_KINDS.AUTH:
      return FAILURE_REASONS.ACCESS_DENIED;
    case ERROR_KINDS.BAD_REQUEST:
      if (/sender|exp[ée]diteur/i.test(message)) {
        return FAILURE_REASONS.INVALID_SENDER;
      }
      if (/num[ée]ro|number|destinat|gsm|recipient/i.test(message)) {
        return FAILURE_REASONS.INVALID_NUMBER;
      }
      if (/cr[ée]dit/i.test(message)) {
        return FAILURE_REASONS.NOT_ENOUGH_CREDITS;
      }
      return FAILURE_REASONS.REJECTED;
    case ERROR_KINDS.NOT_FOUND:
      return FAILURE_REASONS.REJECTED;
    case ERROR_KINDS.RATE_LIMITED:
      return FAILURE_REASONS.RATE_LIMITED;
    case ERROR_KINDS.SERVER:
      return FAILURE_REASONS.SERVER_ERROR;
    case ERROR_KINDS.TIMEOUT:
      return FAILURE_REASONS.TIMEOUT;
    case ERROR_KINDS.UNREACHABLE:
      return FAILURE_REASONS.UNREACHABLE;
    default:
      return FAILURE_REASONS.UNEXPECTED;
  }
}

/**
 * @description Wrap any failure into an SmsError.
 * @param {Error} err - The failure.
 * @returns {SmsError} The SmsError.
 */
function toSmsError(err) {
  if (err instanceof SmsError) {
    return err;
  }
  return new SmsError(err.message, {
    reason: reasonOf(err),
    status: typeof err.status === 'number' ? err.status : null,
    cause: err,
  });
}

/**
 * @description Why a send reached no number at all, from the counts the
 * provider filtered.
 * @param {object} refused - `{ invalid, blocked, notAllowed, flood }`.
 * @returns {string} One of FAILURE_REASONS.
 */
function reasonOfRefused(refused) {
  if (refused.notAllowed > 0) {
    return FAILURE_REASONS.COUNTRY_NOT_ALLOWED;
  }
  if (refused.blocked > 0) {
    return FAILURE_REASONS.BLOCKED_NUMBER;
  }
  if (refused.flood > 0) {
    return FAILURE_REASONS.RATE_LIMITED;
  }
  return FAILURE_REASONS.INVALID_NUMBER;
}

/**
 * @description Wait for a given time.
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>} Resolves after `ms`.
 */
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * @description Create the SMS service.
 * @param {object} options - Options.
 * @param {Function} options.getConfig - `() => normalizeConfig(...)`.
 * @param {Function} [options.transport] - HTTP transport (tests).
 * @param {Function} [options.wait] - `(ms) => Promise` (tests).
 * @param {number[]} [options.retryDelaysMs] - Pauses before the retries (tests).
 * @param {Function} [options.requestId] - Id of an Octopush send (tests).
 * @returns {object} The service.
 * @example
 * const sms = createSmsService({ getConfig: () => config });
 * await sms.send(['+33612345678'], 'Hello');
 */
function createSmsService({
  getConfig,
  transport = fetchTransport,
  wait = sleep,
  retryDelaysMs = RETRY_DELAYS_MS,
  requestId = randomUUID,
}) {
  const providers = {
    [PROVIDERS.SMSFACTOR]: createSmsFactor({ getConfig, transport }),
    [PROVIDERS.OCTOPUSH]: createOctopush({ getConfig, transport, requestId }),
  };

  /** @returns {object} The provider of the configuration. */
  const provider = () => providers[getConfig().provider] ?? providers[DEFAULT_PROVIDER];

  /**
   * @description Run a provider call; failures become SmsError.
   * @param {Function} fn - `(provider) => Promise`.
   * @returns {Promise<any>} Its result.
   */
  async function run(fn) {
    const current = provider();
    if (!current.hasCredentials()) {
      throw new SmsError(`The ${current.name} credentials are missing in the configuration`, {
        reason: FAILURE_REASONS.NOT_CONFIGURED,
      });
    }
    try {
      return await fn(current);
    } catch (err) {
      throw toSmsError(err);
    }
  }

  /**
   * @description Send one SMS to one or several numbers.
   * @param {string[]} receivers - Numbers in international format.
   * @param {string} message - The text.
   * @returns {Promise<object>} `{ ticket, sentCount, refused, creditsUsed, creditsLeft,
   *   moderated, receivers }`.
   */
  async function send(receivers, message) {
    if (!Array.isArray(receivers) || receivers.length === 0) {
      throw new SmsError('No phone number to send the SMS to', {
        reason: FAILURE_REASONS.INVALID_NUMBER,
      });
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new SmsError('The SMS text is empty', { reason: FAILURE_REASONS.REJECTED });
    }
    const text =
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : message;
    return run(async (current) => {
      // One id for every attempt: Octopush refuses it twice (code 182), so a
      // retry never delivers an SMS twice.
      const id = requestId();
      for (let attempt = 0; ; attempt += 1) {
        try {
          const report = await current.send(receivers, text, { requestId: id });
          if (report.sentCount === 0) {
            throw new SmsError(`${current.name} sent the SMS to none of the numbers`, {
              reason: reasonOfRefused(report.refused),
            });
          }
          return { ...report, receivers };
        } catch (err) {
          if (err instanceof ApiError && attempt > 0 && err.code === OCTOPUSH.DUPLICATE_REQUEST) {
            // The previous attempt went through after all.
            return {
              ticket: null,
              sentCount: receivers.length,
              refused: { invalid: 0, blocked: 0, notAllowed: 0, flood: 0 },
              creditsUsed: null,
              creditsLeft: null,
              moderated: false,
              receivers,
            };
          }
          if (
            err instanceof ApiError &&
            RETRYABLE_STATUSES.has(err.status) &&
            attempt < retryDelaysMs.length
          ) {
            await wait(retryDelaysMs[attempt]);
            continue;
          }
          throw err;
        }
      }
    });
  }

  return {
    send,
    /** @returns {object} The provider in use (id, name, capabilities). */
    provider,
    /** @returns {Promise<object>} Credits or balance. */
    readAccount: () => run((current) => current.readAccount()),
    /** @returns {Promise<object[]>} The senders (SMSFactor). */
    listSenders: () => run((current) => current.listSenders()),
    /**
     * @param {number} from - Start, in ms.
     * @param {number} to - End, in ms.
     * @returns {Promise<object[]>} SMS received (SMSFactor).
     */
    listIncoming: (from, to) => run((current) => current.listIncoming(from, to)),
    /**
     * @param {number} from - Start, in ms.
     * @param {number} to - End, in ms.
     * @returns {Promise<object[]>} SMS sent with their delivery status (SMSFactor).
     */
    listOutgoing: (from, to) => run((current) => current.listOutgoing(from, to)),
  };
}

export {
  createSmsService,
  SmsError,
  FAILURE_REASONS,
  PROVIDERS,
  DEFAULT_PROVIDER,
  reasonOf,
  toSmsError,
  MAX_MESSAGE_LENGTH,
  RETRY_DELAYS_MS,
};
