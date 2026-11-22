// -----------------------------------------------------------------------------
// The pieces under the handlers: the error format of each provider, the
// failure reasons, the retries, the Paris dates of SMSFactor and the GSM
// alphabet. Nothing touches the network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSmsService, reasonOf, FAILURE_REASONS, MAX_MESSAGE_LENGTH } from '../src/sms.js';
import { errorOf as smsfactorError } from '../src/providers/smsfactor.js';
import { errorOf as octopushError } from '../src/providers/octopush.js';
import { ApiError, ERROR_KINDS, callJson, queryString } from '../src/http.js';
import { normalizeConfig } from '../src/config.js';
import { toParis, fromParis } from '../src/paris-time.js';
import { needsUnicode } from '../src/gsm.js';
import { createFakeProviders, answer, SMSFACTOR_CONFIG } from './helpers/fake-providers.js';

test('SMSFactor answers HTTP 200 with a status: 1 and -8 are successes', () => {
  assert.equal(smsfactorError(200, { status: 1 }), null);
  assert.equal(smsfactorError(200, { status: -8 }), null, 'under moderation: it will leave');
  assert.equal(smsfactorError(200, { status: -1, message: 'x' }).kind, ERROR_KINDS.AUTH);
  assert.equal(smsfactorError(200, { status: -5 }).kind, ERROR_KINDS.NOT_FOUND);
  assert.equal(smsfactorError(200, { status: -99 }).kind, ERROR_KINDS.SERVER);
  assert.equal(smsfactorError(200, { status: -7 }).kind, ERROR_KINDS.BAD_REQUEST);
  assert.equal(smsfactorError(200, null).kind, ERROR_KINDS.UNEXPECTED);
  assert.equal(smsfactorError(502, null).kind, ERROR_KINDS.SERVER);
  assert.equal(smsfactorError(429, null).kind, ERROR_KINDS.RATE_LIMITED);
});

test('Octopush answers 2xx on success, 4xx with a code otherwise', () => {
  assert.equal(octopushError(201, {}), null);
  assert.equal(octopushError(403, { code: 403, message: 'ROLE_API' }).kind, ERROR_KINDS.AUTH);
  assert.equal(octopushError(400, { code: 401 }).kind, ERROR_KINDS.AUTH);
  const credit = octopushError(400, { code: 104, message: "You don't have enough credit." });
  assert.equal(credit.code, 104);
  assert.equal(credit.kind, ERROR_KINDS.BAD_REQUEST);
});

test('failure reasons of both providers', () => {
  const api = (details) => new ApiError('x', details);
  assert.equal(reasonOf(api({ kind: 'bad_request', code: -3 })), 'not_enough_credits');
  assert.equal(reasonOf(api({ kind: 'bad_request', code: 104 })), 'not_enough_credits');
  assert.equal(reasonOf(api({ kind: 'bad_request', code: 113 })), 'account_not_validated');
  assert.equal(reasonOf(api({ kind: 'bad_request', code: 172 })), 'invalid_sender');
  assert.equal(
    reasonOf(api({ kind: 'bad_request', code: -7, providerMessage: 'Expéditeur invalide' })),
    'invalid_sender',
  );
  assert.equal(
    reasonOf(api({ kind: 'bad_request', code: -7, providerMessage: 'Numéro invalide' })),
    'invalid_number',
  );
  assert.equal(reasonOf(api({ kind: 'bad_request', code: -7 })), 'rejected');
  assert.equal(reasonOf(api({ kind: 'auth' })), 'access_denied');
  assert.equal(reasonOf(api({ kind: 'timeout' })), 'timeout');
  assert.equal(reasonOf(api({ kind: 'unreachable' })), 'unreachable');
  assert.equal(reasonOf(new Error('boom')), 'unexpected');
  // Every reason the code produces is a declared one.
  for (const reason of ['not_enough_credits', 'account_not_validated', 'access_denied']) {
    assert.ok(Object.values(FAILURE_REASONS).includes(reason));
  }
});

test('a send is retried on 429 and 503 only, then reported', async () => {
  const fake = createFakeProviders({
    sends: [() => answer(503, { status: -99 }), () => answer(429, { status: -99 }), {}],
  });
  const config = normalizeConfig(SMSFACTOR_CONFIG);
  const waits = [];
  const sms = createSmsService({
    getConfig: () => config,
    transport: fake.transport,
    wait: async (ms) => waits.push(ms),
  });
  const report = await sms.send(['+33612345678'], 'hello');
  assert.equal(report.sentCount, 1);
  assert.deepEqual(waits, [2000, 5000]);

  fake.state.sends = [() => answer(500, { status: -99 })];
  await assert.rejects(sms.send(['+33612345678'], 'hello'), { reason: 'server_error' });
  assert.equal(fake.calls.filter((call) => call.method === 'POST').length, 4, 'no retry on 500');
});

test('empty texts are refused, long ones are cut', async () => {
  const fake = createFakeProviders();
  const config = normalizeConfig(SMSFACTOR_CONFIG);
  const sms = createSmsService({ getConfig: () => config, transport: fake.transport });
  await assert.rejects(sms.send(['+33612345678'], '  '), { reason: 'rejected' });
  await assert.rejects(sms.send([], 'x'), { reason: 'invalid_number' });
  await sms.send(['+33612345678'], 'a'.repeat(5000));
  const text = fake.calls.at(-1).body.sms.message.text;
  assert.equal(text.length, MAX_MESSAGE_LENGTH);
  assert.ok(text.endsWith('…'));
});

test('callJson: timeouts and network errors become ApiError, bodies may be empty', async () => {
  const timeout = async () => {
    throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  };
  await assert.rejects(
    callJson({ transport: timeout, label: 'X', method: 'GET', url: 'https://x', headers: {} }),
    { kind: 'timeout' },
  );
  const down = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(
    callJson({ transport: down, label: 'X', method: 'GET', url: 'https://x', headers: {} }),
    { kind: 'unreachable' },
  );
  const empty = async () => ({ status: 204, text: '' });
  assert.deepEqual(
    await callJson({ transport: empty, label: 'X', method: 'GET', url: 'https://x', headers: {} }),
    { status: 204, data: null },
  );
  assert.equal(queryString({ a: 1, b: null }), '?a=1');
  assert.equal(queryString({}), '');
});

test('SMSFactor dates are Paris wall clock, summer and winter time', () => {
  assert.equal(toParis(Date.UTC(2026, 10, 22, 9, 11, 3)), '2026-11-22 10:11:03');
  assert.equal(toParis(Date.UTC(2026, 6, 1, 10, 0, 0)), '2026-07-01 12:00:00');
  assert.equal(fromParis('2026-11-22 10:11:03'), Date.UTC(2026, 10, 22, 9, 11, 3));
  assert.equal(fromParis('"2026-07-01 12:00:00"'), Date.UTC(2026, 6, 1, 10, 0, 0));
  assert.equal(
    fromParis('2026-03-29 03:30:00'),
    Date.UTC(2026, 2, 29, 1, 30, 0),
    'after the change',
  );
  assert.equal(fromParis(''), null);
  assert.equal(fromParis('yesterday'), null);
  // The hour repeated when winter time starts (25 October 2026, 02:00-03:00)
  // is ambiguous in Paris time: SMSFactor cannot tell it either.
  for (const instant of [Date.UTC(2026, 0, 15, 23, 59, 59), Date.UTC(2026, 9, 25, 12, 0, 0)]) {
    assert.equal(fromParis(toParis(instant)), instant);
  }
});

test('Unicode only for characters outside the GSM alphabet', () => {
  assert.equal(needsUnicode('Porte ouverte à 20 h, température 19 C ?'), false);
  assert.equal(needsUnicode('Prix : 3 € [promo] ~ ok'), false);
  assert.equal(needsUnicode('Coût'), true, 'û is not GSM');
  assert.equal(needsUnicode('Fenêtre'), true, 'ê is not GSM');
  assert.equal(needsUnicode('Alarme 🔥'), true);
  assert.equal(needsUnicode(''), false);
});
