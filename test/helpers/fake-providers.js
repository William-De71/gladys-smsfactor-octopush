// -----------------------------------------------------------------------------
// Fake SMSFactor and Octopush APIs, as the transport of src/http.js. They
// answer the endpoints the integration uses, the way the documentation of each
// provider shows them (SMSFactor: HTTP 200 and a `status` field; Octopush:
// HTTP 4xx and `{ code, message }`), and check the credentials of every call.
// Nothing touches the network.
// -----------------------------------------------------------------------------

const SMSFACTOR = 'https://api.smsfactor.com';
const OCTOPUSH = 'https://api.octopush.com/v1/public';

const SMSFACTOR_CONFIG = Object.freeze({ provider: 'smsfactor', smsfactor_token: 'sf-token' });
const OCTOPUSH_CONFIG = Object.freeze({
  provider: 'octopush',
  octopush_login: 'me@example.com',
  octopush_api_key: 'oct-key',
});

/**
 * @description A JSON answer.
 * @param {number} status - HTTP status.
 * @param {any} body - JSON body.
 * @returns {{ status: number, text: string }} The answer.
 */
const answer = (status, body) => ({ status, text: JSON.stringify(body) });

/**
 * @description Create the fake APIs.
 * @param {object} [options] - What they serve.
 * @param {number} [options.credits] - SMSFactor credits.
 * @param {object[]} [options.senders] - SMSFactor senders.
 * @param {Array} [options.sends] - SMSFactor answers of POST /send, one per call (the last
 *   repeats): an object merged into the success, or a function of the body.
 * @param {object[]} [options.incoming] - SMSFactor rows of messages-in.
 * @param {object[]} [options.outgoing] - SMSFactor rows of messages-out.
 * @param {number} [options.balance] - Octopush balance, in euros.
 * @param {Array} [options.octopushSends] - Octopush answers of a send (`{ status, body }`).
 * @returns {object} `{ transport, calls, state }`.
 * @example
 * const fake = createFakeProviders();
 * createApp(gladys, { transport: fake.transport });
 */
function createFakeProviders({
  credits = 100,
  senders = [{ id: 7, sender: 'GLADYS', status: '2' }],
  sends = [{}],
  incoming = [],
  outgoing = [],
  balance = 12.54,
  octopushSends = [{ status: 201 }],
} = {}) {
  const calls = [];
  const state = {
    credits,
    senders,
    sends: [...sends],
    incoming,
    outgoing,
    balance,
    octopushSends: [...octopushSends],
    down: null,
    ticket: 14672468,
  };

  /**
   * @description Next answer of a queue (the last one repeats).
   * @param {Array} queue - The queue.
   * @returns {any} The answer.
   */
  const next = (queue) => (queue.length > 1 ? queue.shift() : queue[0]);

  /**
   * @description SMSFactor.
   * @param {URL} url - The URL.
   * @param {object} init - fetch options.
   * @param {any} body - Parsed body.
   * @returns {{ status: number, text: string }} The answer.
   */
  function smsfactor(url, init, body) {
    if (init.headers.Authorization !== 'Bearer sf-token') {
      return answer(200, {
        status: -1,
        message: 'Le login et le mot de passe ne correspondent pas',
        details: 'Utilisateur ou mot de passe incorrect',
      });
    }
    const route = `${init.method} ${url.pathname}`;
    if (route === 'GET /credits') {
      return answer(200, {
        status: 1,
        message: 'OK',
        credits: String(state.credits),
        postpaid: '0',
        postpaid_limit: false,
        unlimited: false,
      });
    }
    if (route === 'GET /senders') {
      return answer(200, { status: 1, message: 'OK', senders: state.senders });
    }
    if (route === 'POST /send') {
      const planned = next(state.sends);
      if (typeof planned === 'function') {
        return planned(body);
      }
      const count = body.sms.recipients.gsm.length;
      const cost = count * (body.sms.message.text.length > 160 ? 2 : 1);
      state.credits -= cost;
      state.ticket += 1;
      return answer(200, {
        status: 1,
        message: 'OK',
        ticket: String(state.ticket),
        cost,
        credits: state.credits,
        total: count,
        sent: count,
        blacklisted: 0,
        duplicated: 0,
        npai: 0,
        invalid: 0,
        not_allowed: 0,
        flood: 0,
        country_limit: 0,
        ...planned,
      });
    }
    if (route === 'GET /messages') {
      const rows = url.searchParams.get('type') === 'messages-in' ? state.incoming : state.outgoing;
      if (rows.length === 0) {
        return answer(200, { status: -5, message: 'Resource not found' });
      }
      return answer(200, {
        status: 1,
        message: 'OK',
        totalRecords: rows.length,
        totalDisplayRecords: rows.length,
        messages: rows,
      });
    }
    return answer(404, { status: -5, message: 'Not found' });
  }

  /**
   * @description Octopush.
   * @param {URL} url - The URL.
   * @param {object} init - fetch options.
   * @returns {{ status: number, text: string }} The answer.
   */
  function octopush(url, init) {
    if (init.headers['api-login'] !== 'me@example.com' || init.headers['api-key'] !== 'oct-key') {
      return answer(403, { code: 403, message: "Access Denied. The user doesn't have ROLE_API." });
    }
    const route = `${init.method} ${url.pathname.replace('/v1/public', '')}`;
    if (route === 'GET /wallet/check-balance') {
      return answer(200, { amount: state.balance, unit: 'euros' });
    }
    if (route === 'POST /sms-campaign/send') {
      const planned = next(state.octopushSends);
      if (planned.status >= 400) {
        return answer(planned.status, planned.body);
      }
      const body = JSON.parse(init.body);
      state.balance = Math.round((state.balance - 0.05 * body.recipients.length) * 1000) / 1000;
      return answer(201, {
        sms_ticket: 'sms_5f3fbce61266e',
        number_of_contacts: body.recipients.length,
        number_of_sms_needed: 1,
        residual_credit: state.balance,
        total_cost: 0.05 * body.recipients.length,
        ...planned.body,
      });
    }
    return answer(404, { code: 404, message: 'Not found' });
  }

  /**
   * @description The transport.
   * @param {string} raw - The URL.
   * @param {object} init - fetch options.
   * @returns {Promise<{ status: number, text: string }>} The answer.
   */
  async function transport(raw, init) {
    const url = new URL(raw);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url: raw, headers: init.headers, body });
    if (state.down) {
      throw state.down;
    }
    if (raw.startsWith(SMSFACTOR)) {
      return smsfactor(url, init, body);
    }
    if (raw.startsWith(OCTOPUSH)) {
      return octopush(url, init);
    }
    throw new Error(`Unexpected URL ${raw}`);
  }

  return { transport, calls, state };
}

export { createFakeProviders, answer, SMSFACTOR_CONFIG, OCTOPUSH_CONFIG };
