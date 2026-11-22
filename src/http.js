// -----------------------------------------------------------------------------
// The HTTP layer shared by the two SMS providers: JSON calls with a timeout,
// and a failure classified once, the same way for both (ERROR_KINDS).
//
// This module holds only HTTP (no SDK, no Gladys concept): the transport is
// injected, so the tests never touch the network. Tokens and API keys travel
// in headers only, never in a URL, an error message or a log line.
// -----------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 15 * 1000;

// Kinds of failure, used by the rest of the integration to pick a message
// and a scene trigger reason.
const ERROR_KINDS = Object.freeze({
  AUTH: 'auth',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request',
  RATE_LIMITED: 'rate_limited',
  SERVER: 'server',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  UNEXPECTED: 'unexpected',
});

/**
 * @description A call the provider refused or could not answer.
 */
class ApiError extends Error {
  /**
   * @param {string} message - Readable message, without any credential.
   * @param {object} details - Failure details.
   * @param {string} details.kind - One of ERROR_KINDS.
   * @param {number|null} [details.status] - HTTP status, when the provider answered.
   * @param {number|string|null} [details.code] - The error code of the answer (Octopush `code`, SMSFactor `status`).
   * @param {string|null} [details.providerMessage] - The message of the answer.
   * @param {Error} [details.cause] - Underlying error.
   */
  constructor(message, { kind, status = null, code = null, providerMessage = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.providerMessage = providerMessage;
  }
}

/**
 * @description The kind of failure of an HTTP status.
 * @param {number} status - The HTTP status.
 * @returns {string} One of ERROR_KINDS.
 * @example
 * kindOfStatus(429); // -> 'rate_limited'
 */
function kindOfStatus(status) {
  if (status === 401 || status === 403) {
    return ERROR_KINDS.AUTH;
  }
  if (status === 404) {
    return ERROR_KINDS.NOT_FOUND;
  }
  if (status === 429) {
    return ERROR_KINDS.RATE_LIMITED;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  if (status >= 400) {
    return ERROR_KINDS.BAD_REQUEST;
  }
  return ERROR_KINDS.UNEXPECTED;
}

/**
 * @description The default transport: fetch with a timeout, answering
 * `{ status, text }`.
 * @param {string} url - The URL.
 * @param {object} init - fetch options.
 * @returns {Promise<{ status: number, text: string }>} The answer.
 * @example
 * await fetchTransport('https://api.smsfactor.com/credits', { method: 'GET' });
 */
async function fetchTransport(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: response.status, text: await response.text() };
}

/**
 * @description A query string, '' when there is nothing to add.
 * @param {object} [query] - Name -> value (null and undefined are skipped).
 * @returns {string} '?a=1&b=2' or ''.
 * @example
 * queryString({ date_start: '2026-11-22 10:00:00' }); // -> '?date_start=2026-11-22+10%3A00%3A00'
 */
function queryString(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([name, value]) => {
    if (value !== null && value !== undefined) {
      params.append(name, String(value));
    }
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * @description Call a JSON API once.
 * @param {object} options - The call.
 * @param {Function} options.transport - `(url, init) => Promise<{ status, text }>`.
 * @param {string} options.label - The provider name, for the error messages.
 * @param {string} options.method - HTTP method.
 * @param {string} options.url - Full URL, query string included.
 * @param {object} options.headers - Headers (credentials included).
 * @param {any} [options.body] - JSON body.
 * @returns {Promise<{ status: number, data: any }>} The status and the parsed answer
 *   (null for an empty or non-JSON one). HTTP errors are NOT thrown here: each
 *   provider reads its own error format first.
 * @throws {ApiError} When the provider cannot be reached.
 * @example
 * await callJson({ transport, label: 'SMSFactor', method: 'GET', url, headers });
 */
async function callJson({ transport, label, method, url, headers, body }) {
  let answer;
  try {
    answer = await transport(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ApiError(
      timeout ? `${label} did not answer in time` : `${label} cannot be reached: ${err.message}`,
      { kind: timeout ? ERROR_KINDS.TIMEOUT : ERROR_KINDS.UNREACHABLE, cause: err },
    );
  }
  let data = null;
  if (answer.text) {
    try {
      data = JSON.parse(answer.text);
    } catch {
      data = null;
    }
  }
  return { status: answer.status, data };
}

export { ApiError, ERROR_KINDS, kindOfStatus, fetchTransport, queryString, callJson };
