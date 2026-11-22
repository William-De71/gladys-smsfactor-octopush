// -----------------------------------------------------------------------------
// The handlers of src/app.js, driven by the fake Gladys of the SDK (the real
// GladysIntegration with an in-memory Gladys, so payloads are checked the way
// the core checks them) against fake SMSFactor and Octopush APIs. Nothing
// touches the network; the state file lives in a temporary directory.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, TEST_MESSAGE, DELIVERY_WINDOW_MS } from '../src/app.js';
import {
  createFakeProviders,
  answer,
  SMSFACTOR_CONFIG,
  OCTOPUSH_CONFIG,
} from './helpers/fake-providers.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const CONTACT = { phone_number: '06 12 34 56 78' };
const MESSAGE = { text: 'The front door is open', file: null };
const outputsOf = (ack) => ack.data?.outputs ?? ack.data;
const messageOf = (ack) => ack.data?.message ?? ack.data;

/**
 * @description A connected fake Gladys running the integration against the fake providers.
 * @param {object} [options] - Options.
 * @param {object} [options.config] - Configuration (SMSFactor by default).
 * @param {object} [options.fake] - Options of createFakeProviders.
 * @param {string} [options.statePath] - The state file (a new temporary one by default).
 * @param {Function} [options.now] - The clock.
 * @returns {Promise<object>} `{ gladys, fake, app, statePath }`.
 */
async function start({
  config = SMSFACTOR_CONFIG,
  fake: options = {},
  statePath,
  now = () => Date.now(),
} = {}) {
  const path = statePath ?? join(await mkdtemp(join(tmpdir(), 'sms-fr-')), 'state.json');
  const fake = createFakeProviders(options);
  const gladys = createFakeGladys({ config });
  let id = 0;
  const app = createApp(gladys, {
    transport: fake.transport,
    statePath: path,
    now,
    wait: async () => {},
    retryDelaysMs: [0, 0],
    requestId: () => `req-${(id += 1)}`,
    timers: false,
  });
  await gladys.connect();
  return { gladys, fake, app, statePath: path };
}

const sendsOf = (fake) => fake.calls.filter((call) => call.method === 'POST');

/**
 * @description Check a scene event against its manifest declaration.
 * @param {object} event - `{ key, data }`.
 */
function assertDeclared(event) {
  const trigger = byKey(manifest.scene_triggers).get(event.key);
  assert.ok(trigger, event.key);
  const variables = trigger.variables.map((variable) => variable.key).sort();
  assert.deepEqual(Object.keys(event.data).sort(), variables, event.key);
  for (const value of Object.values(event.data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
  }
}

test('SMSFactor: connects, reads the credits, never puts the token in a URL', async () => {
  const { gladys, fake } = await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.fr,
    'SMSFactor : 100 crédits restants, expéditeur par défaut du compte.',
  );
  assert.equal(fake.calls[0].url, 'https://api.smsfactor.com/credits');
  assert.equal(fake.calls[0].headers.Accept, 'application/json');
  assert.ok(fake.calls.every((call) => !call.url.includes('sf-token')));
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('Octopush: connects and shows the balance in euros', async () => {
  const { gladys, fake } = await start({ config: { ...OCTOPUSH_CONFIG, sender: 'GLADYS' } });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.fr,
    // Intl puts a no-break space before the euro sign.
    'Octopush : 12,54\u00a0€ restants, expéditeur GLADYS.',
  );
  assert.equal(fake.calls[0].headers['api-login'], 'me@example.com');
  assert.equal(fake.calls[0].headers['api-key'], 'oct-key');
});

test('without credentials: disconnected with the right message, no call', async () => {
  for (const provider of ['smsfactor', 'octopush']) {
    const { gladys, fake } = await start({ config: { provider } });
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.deepEqual(Object.keys(gladys.fake.connectionStatus.message).sort(), [
      'de',
      'en',
      'es',
      'fr',
    ]);
    assert.match(
      gladys.fake.connectionStatus.message.en,
      provider === 'smsfactor' ? /SMSFactor API token/ : /Octopush account/,
    );
    assert.equal(fake.calls.length, 0);
  }
});

test('refused credentials (SMSFactor status -1 in HTTP 200, Octopush 403): disconnected', async () => {
  const sf = await start({ config: { ...SMSFACTOR_CONFIG, smsfactor_token: 'deleted' } });
  assert.equal(sf.gladys.fake.connectionStatus.connected, false);
  assert.match(sf.gladys.fake.connectionStatus.message.en, /SMSFactor refuses the credentials/);
  const oct = await start({ config: { ...OCTOPUSH_CONFIG, octopush_api_key: 'old' } });
  assert.match(oct.gladys.fake.connectionStatus.message.en, /Octopush refuses the credentials/);
});

test('SMSFactor: a message goes as an alert to the number of the user, without "+"', async () => {
  const { gladys, fake, app } = await start();
  const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(ack.success, true);
  const [send] = sendsOf(fake);
  assert.equal(send.url, 'https://api.smsfactor.com/send');
  assert.deepEqual(send.body, {
    sms: {
      message: { text: 'The front door is open', pushtype: 'alert', unicode: 0 },
      recipients: { gsm: [{ value: '33612345678' }] },
    },
  });
  assert.equal(app.store.counters().sent, 1);
  assert.deepEqual(
    app.store.pending().map((entry) => entry.ticket),
    ['14672469'],
  );
  assert.deepEqual(gladys.fake.sceneEvents, []);
  assert.ok(gladys.fake.widgetRefreshes.includes('account'));
});

test('SMSFactor: the sender is sent when set, Unicode only when the text needs it', async () => {
  const { gladys, fake } = await start({ config: { ...SMSFACTOR_CONFIG, sender: 'GLADYS' } });
  await gladys.fake.sendMessage(CONTACT, { text: 'Fenêtre ouverte 🔥' });
  await gladys.fake.sendMessage(CONTACT, { text: 'Porte ouverte à 20 h' });
  const [unicode, plain] = sendsOf(fake).map((call) => call.body.sms.message);
  assert.equal(unicode.sender, 'GLADYS');
  assert.equal(unicode.unicode, 1);
  assert.equal(plain.unicode, 0);
});

test('Octopush: a message goes as a premium alert, with a request id', async () => {
  const { gladys, fake, app } = await start({ config: OCTOPUSH_CONFIG });
  const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(ack.success, true);
  const [send] = sendsOf(fake);
  assert.equal(send.url, 'https://api.octopush.com/v1/public/sms-campaign/send');
  assert.deepEqual(send.body, {
    recipients: [{ phone_number: '+33612345678' }],
    text: 'The front door is open',
    type: 'sms_premium',
    purpose: 'alert',
    request_id: 'req-1',
  });
  assert.deepEqual(app.store.pending(), [], 'Octopush has no delivery report to read');
  const low = await start({ config: { ...OCTOPUSH_CONFIG, octopush_sms_type: 'low_cost' } });
  await low.gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(sendsOf(low.fake)[0].body.type, 'sms_low_cost');
});

test('Octopush: a retried send keeps its request id, and a duplicate means it went through', async () => {
  const { gladys, fake } = await start({
    config: OCTOPUSH_CONFIG,
    fake: {
      octopushSends: [
        { status: 503, body: { code: 0, message: 'Service unavailable' } },
        { status: 400, body: { code: 182, message: 'Loop detected. "request_id" already used!' } },
      ],
    },
  });
  const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(ack.success, true);
  const ids = sendsOf(fake).map((call) => call.body.request_id);
  assert.deepEqual(ids, ['req-1', 'req-1']);
});

test('a refused SMS fails the message and fires sms_not_sent once, until an SMS goes through', async () => {
  const { gladys, fake } = await start({
    fake: { sends: [() => answer(200, { status: -3, message: 'Not enough credits' })] },
  });
  for (let i = 0; i < 3; i += 1) {
    const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
    assert.equal(ack.success, false);
  }
  assert.equal(gladys.fake.sceneEvents.length, 1);
  const [event] = gladys.fake.sceneEvents;
  assertDeclared(event);
  assert.equal(event.data.reason, 'not_enough_credits');
  assert.equal(event.data.status, 200);
  assert.equal(event.data.phone_number, '+336******78');
  // Credits are back: the next failure fires again.
  fake.state.sends = [{}];
  assert.equal((await gladys.fake.sendMessage(CONTACT, MESSAGE)).success, true);
  fake.state.sends = [() => answer(200, { status: -3, message: 'Not enough credits' })];
  await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('Octopush refusals map to the shared reasons', async () => {
  const cases = [
    [{ code: 104, message: "You don't have enough credit." }, 'not_enough_credits'],
    [{ code: 106, message: '"sender" field is not valid.' }, 'invalid_sender'],
    [{ code: 113, message: 'Your account is not validated yet.' }, 'account_not_validated'],
    [{ code: 121, message: 'Mention STOP is missing.' }, 'rejected'],
    [{ code: 181, message: '"phone_number" field is not valid.' }, 'invalid_number'],
  ];
  for (const [body, reason] of cases) {
    const { gladys } = await start({
      config: OCTOPUSH_CONFIG,
      fake: { octopushSends: [{ status: 400, body }] },
    });
    await gladys.fake.sendMessage(CONTACT, MESSAGE);
    assert.equal(gladys.fake.sceneEvents[0]?.data.reason, reason, body.message);
  }
});

test('SMSFactor: a send that reaches no number reports why', async () => {
  const cases = [
    [{ sent: 0, invalid: 1 }, 'invalid_number'],
    [{ sent: 0, blacklisted: 1 }, 'blocked_number'],
    [{ sent: 0, not_allowed: 1 }, 'country_not_allowed'],
    [{ sent: 0, flood: 1 }, 'rate_limited'],
  ];
  for (const [result, reason] of cases) {
    const { gladys } = await start({ fake: { sends: [result] } });
    const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
    assert.equal(ack.success, false);
    assert.equal(gladys.fake.sceneEvents[0].data.reason, reason);
  }
});

test('SMSFactor: a campaign under moderation (status -8) counts as sent', async () => {
  const { gladys } = await start({ fake: { sends: [{ status: -8, message: 'Moderation' }] } });
  assert.equal((await gladys.fake.sendMessage(CONTACT, MESSAGE)).success, true);
  const tested = await gladys.fake.action('send_test_sms', { phone_number: '0612345678' });
  assert.match(messageOf(tested).fr, /en modération/);
});

test('a wrong number of a user fires for that number only, without blocking the account', async () => {
  const { gladys, fake } = await start();
  await gladys.fake.sendMessage({ phone_number: 'not a number' }, MESSAGE);
  await gladys.fake.sendMessage({ phone_number: 'not a number' }, MESSAGE);
  assert.equal(gladys.fake.sceneEvents.length, 1);
  assert.equal(gladys.fake.sceneEvents[0].data.reason, 'invalid_number');
  assert.equal(sendsOf(fake).length, 0);
  // Another failure of the account still fires.
  fake.state.sends = [() => answer(200, { status: -99, message: 'Unknown error' })];
  await gladys.fake.sendMessage({ phone_number: '+33600000000' }, MESSAGE);
  assert.equal(gladys.fake.sceneEvents.length, 2);
  assert.equal(gladys.fake.sceneEvents[1].data.reason, 'server_error');
});

test('a network failure is never retried: the SMS may have left', async () => {
  const { gladys, fake } = await start();
  fake.state.down = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  const ack = await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(ack.success, false);
  assert.equal(sendsOf(fake).length, 1);
  assert.equal(gladys.fake.sceneEvents[0].data.reason, 'timeout');
});

test('the credits going below the threshold fire credits_low once, armed again after a top-up', async () => {
  const { gladys, fake } = await start({
    config: { ...SMSFACTOR_CONFIG, low_credits_threshold: 99 },
  });
  await gladys.fake.sendMessage(CONTACT, MESSAGE); // 99: not below
  assert.equal(gladys.fake.sceneEvents.length, 0);
  await gladys.fake.sendMessage(CONTACT, MESSAGE); // 98
  await gladys.fake.sendMessage(CONTACT, MESSAGE); // 97
  const low = gladys.fake.sceneEvents.filter((event) => event.key === 'credits_low');
  assert.equal(low.length, 1);
  assertDeclared(low[0]);
  assert.deepEqual(low[0].data, {
    credits_left: 98,
    threshold: 99,
    unit: 'credits',
    provider: 'smsfactor',
  });
  fake.state.credits = 500;
  await gladys.fake.action('test_connection');
  fake.state.credits = 50;
  await gladys.fake.sceneAction('get_account');
  assert.equal(gladys.fake.sceneEvents.length, 1, 'a scene action never fires a trigger');
});

test('Octopush: credits_low compares the balance in euros (2 € by default)', async () => {
  const { gladys } = await start({ config: OCTOPUSH_CONFIG, fake: { balance: 1.5 } });
  const [event] = gladys.fake.sceneEvents;
  assertDeclared(event);
  assert.deepEqual(event.data, {
    credits_left: 1.5,
    threshold: 2,
    unit: 'eur',
    provider: 'octopush',
  });
});

test('credits_low does not fire again after a restart', async () => {
  const config = { ...SMSFACTOR_CONFIG, low_credits_threshold: 50 };
  const first = await start({ config, fake: { credits: 10 } });
  assert.equal(first.gladys.fake.sceneEvents.length, 1);
  await first.app.store.flush();
  const second = await start({ config, fake: { credits: 10 }, statePath: first.statePath });
  assert.equal(second.gladys.fake.sceneEvents.length, 0);
});

test('the send_sms scene action: several numbers, declared outputs only, no trigger', async () => {
  const { gladys, fake } = await start({ fake: { sends: [{ sent: 1, invalid: 1 }] } });
  const ack = await gladys.fake.sceneAction('send_sms', {
    phone_numbers: '06 12 34 56 78, +33600000000, nope',
    message: 'Dinner is ready',
  });
  assert.equal(ack.success, true);
  const outputs = outputsOf(ack);
  const declared = byKey(manifest.scene_actions)
    .get('send_sms')
    .outputs.map((o) => o.key);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort());
  assert.equal(outputs.sent_count, 1);
  assert.equal(outputs.invalid_numbers, 'nope');
  assert.equal(outputs.refused_count, 1);
  assert.equal(outputs.credits_used, 2);
  assert.equal(outputs.credits_left, 98);
  assert.deepEqual(sendsOf(fake)[0].body.sms.recipients.gsm, [
    { value: '33612345678' },
    { value: '33600000000' },
  ]);
  assert.deepEqual(gladys.fake.sceneEvents, []);

  const none = await gladys.fake.sceneAction('send_sms', { phone_numbers: 'nope', message: 'x' });
  assert.equal(none.success, false);
});

test('the get_account scene action returns the credits and the counters', async () => {
  const { gladys } = await start();
  await gladys.fake.sendMessage(CONTACT, MESSAGE);
  const outputs = outputsOf(await gladys.fake.sceneAction('get_account'));
  assert.deepEqual(outputs, {
    credits_left: 99,
    unit: 'credits',
    sent_this_month: 1,
    received_this_month: 0,
    undelivered_this_month: 0,
    provider: 'smsfactor',
  });
});

test('Configuration screen: test the connection, send a test SMS', async () => {
  const { gladys, fake } = await start({
    fake: {
      senders: [
        { sender: 'GLADYS', status: '2' },
        { sender: 'MAISON', status: '0' },
      ],
    },
  });
  const tested = await gladys.fake.action('test_connection');
  assert.equal(tested.success, true);
  assert.equal(
    messageOf(tested).fr,
    'Connecté à SMSFactor : 100 crédits restants. Expéditeurs : GLADYS (validé), MAISON (non validé). Les SMS partent avec : par défaut du compte.',
  );

  const wrong = await gladys.fake.action('send_test_sms', { phone_number: 'hello' });
  assert.match(messageOf(wrong).en, /is not a phone number/);
  assert.equal(sendsOf(fake).length, 0);

  const sent = await gladys.fake.action('send_test_sms', { phone_number: '+33 6 12 34 56 78' });
  assert.equal(messageOf(sent).fr, 'SMS de test envoyé au +336******78 via SMSFactor.');
  assert.equal(sendsOf(fake)[0].body.sms.message.text, TEST_MESSAGE);

  const octopush = await start({ config: OCTOPUSH_CONFIG });
  const octTest = await octopush.gladys.fake.action('test_connection');
  assert.equal(
    messageOf(octTest).en,
    'Connected to Octopush: €12.54 left. SMS are sent with: default of the account.',
  );
});

test('SMSFactor replies: history is skipped, each new one fires once, never again after a restart', async () => {
  let clock = Date.parse('2026-11-22T08:00:00Z');
  const incoming = [
    {
      message_id: 255,
      sender: '33611111111',
      message: 'old',
      date: '2026-11-22 08:55:00',
      type: 'sms_mo',
    },
  ];
  const config = { ...SMSFACTOR_CONFIG, receive_sms: true };
  const first = await start({ config, fake: { incoming }, now: () => clock });
  assert.deepEqual(first.gladys.fake.sceneEvents, [], 'the SMS already there is history');
  const read = first.fake.calls.find((call) => call.url.includes('/messages'));
  const params = new URL(read.url).searchParams;
  assert.equal(params.get('type'), 'messages-in');
  assert.equal(params.get('date_start'), '2026-11-22 08:50:00', 'Paris time, 10 min margin');

  clock += 60 * 1000;
  incoming.push({
    message_id: 256,
    sender: '33612345678',
    message: 'Météo demain ?',
    date: '2026-11-22 09:00:30',
    type: 'sms_mo',
  });
  assert.equal(await first.app.pollIncoming(), 1);
  assert.equal(await first.app.pollIncoming(), 0);
  const [event] = first.gladys.fake.sceneEvents;
  assertDeclared(event);
  assert.deepEqual(event, {
    key: 'sms_received',
    data: {
      sender: '+33612345678',
      message: 'Météo demain ?',
      keyword: 'METEO',
      received_at: '2026-11-22T08:00:30.000Z',
    },
  });
  await first.app.store.flush();

  const second = await start({
    config,
    fake: { incoming },
    statePath: first.statePath,
    now: () => clock,
  });
  assert.equal(await second.app.pollIncoming(), 0);
  assert.deepEqual(second.gladys.fake.sceneEvents, []);
  const saved = JSON.parse(await readFile(first.statePath, 'utf8'));
  assert.equal(saved.received, 1);
  assert.equal(saved.recentIncoming[0].message, 'Météo demain ?');
});

test('reception off, or Octopush: no reply read, the inbox says why', async () => {
  const { gladys, fake, app } = await start();
  assert.equal(await app.pollIncoming(), 0);
  assert.ok(!fake.calls.some((call) => call.url.includes('/messages')));
  const off = await gladys.fake.widgetGet('inbox', { language: 'fr' });
  assert.match(off.data.content.components[0].text, /réception des réponses est désactivée/);

  const oct = await start({ config: { ...OCTOPUSH_CONFIG, receive_sms: true } });
  assert.equal(await oct.app.pollIncoming(), 0);
  const unsupported = await oct.gladys.fake.widgetGet('inbox', { language: 'en' });
  assert.match(unsupported.data.content.components[0].text, /works with SMSFactor/);
});

test('SMSFactor delivery reports: an undelivered SMS fires sms_undelivered once', async () => {
  let clock = Date.parse('2026-11-22T08:00:00Z');
  const outgoing = [];
  const { gladys, app } = await start({ fake: { outgoing }, now: () => clock });
  await gladys.fake.sendMessage(CONTACT, MESSAGE);
  await gladys.fake.sendMessage({ phone_number: '0698765432' }, MESSAGE);
  const [first, second] = app.store.pending().map((entry) => entry.ticket);

  outgoing.push(
    { campaign_id: Number(first), destination: '33612345678', status: 'SENT', status_details: '' },
    { campaign_id: Number(second), destination: '33698765432', status: 'DELIVERED' },
  );
  clock += 5 * 60 * 1000;
  assert.equal(await app.pollDelivery(), 0);
  assert.deepEqual(
    app.store.pending().map((entry) => entry.ticket),
    [first],
  );

  outgoing[0].status = 'UNDELIVERED';
  outgoing[0].status_details = 'Phone off';
  assert.equal(await app.pollDelivery(), 1);
  assert.equal(await app.pollDelivery(), 0);
  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'sms_undelivered');
  assert.equal(events.length, 1);
  assertDeclared(events[0]);
  assert.deepEqual(events[0].data, {
    phone_number: '+336******78',
    status: 'undelivered',
    details: 'Phone off',
    ticket: first,
  });
  assert.equal(app.store.counters().undelivered, 1);
  assert.deepEqual(app.store.pending(), []);
});

test('SMSFactor delivery reports: a send without a final status is dropped after 48 hours', async () => {
  let clock = Date.parse('2026-11-22T08:00:00Z');
  const { gladys, app } = await start({
    fake: { outgoing: [{ campaign_id: 1, destination: '33600000000', status: 'SENT' }] },
    now: () => clock,
  });
  await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.equal(app.store.pending().length, 1);
  clock += DELIVERY_WINDOW_MS + 1;
  await app.pollDelivery();
  assert.deepEqual(app.store.pending(), []);
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('both widgets are valid in every language, for both providers, without any call', async () => {
  for (const config of [
    { ...SMSFACTOR_CONFIG, receive_sms: true, low_credits_threshold: 150 },
    { ...OCTOPUSH_CONFIG, sender: 'GLADYS' },
  ]) {
    const clock = Date.parse('2026-11-22T08:00:00Z');
    const { gladys, app, fake } = await start({
      config,
      now: () => clock,
      fake: {
        incoming: [
          { message_id: 9, sender: '33612345678', message: 'STATUS', date: '2026-11-22 09:00:10' },
        ],
      },
    });
    await app.pollIncoming();
    fake.state.sends = [() => answer(200, { status: -3, message: 'Not enough credits' })];
    fake.state.octopushSends = [{ status: 400, body: { code: 104, message: 'No credit' } }];
    await gladys.fake.sendMessage(CONTACT, MESSAGE);
    const before = fake.calls.length;
    for (const language of ['en', 'fr', 'de', 'es']) {
      for (const key of ['account', 'inbox']) {
        const ack = await gladys.fake.widgetGet(key, { language });
        assert.equal(ack.success, true, `${key} ${language}`);
        assert.deepEqual(validateWidgetContent(ack.data.content), [], `${key} ${language}`);
      }
    }
    assert.equal(fake.calls.length, before, 'a widget never costs a call to the provider');
    const account = (await gladys.fake.widgetGet('account', { language: 'en' })).data.content;
    const tile = account.components.find((component) => component.type === 'value');
    const rows = account.components.find((component) => component.type === 'status').items;
    assert.ok(
      rows.some((row) => row.value === 'Not enough credits' && row.label.startsWith('Failure')),
    );
    if (config.provider === 'octopush') {
      assert.equal(tile.unit, '€');
      assert.equal(tile.label, 'Balance');
      assert.ok(rows.some((row) => row.value === 'Not with Octopush'));
    } else {
      assert.equal(tile.color, 'danger');
      assert.ok(rows.some((row) => row.label === 'Not delivered (month)'));
    }
  }
});

test('switching provider forgets the replies and the tickets of the other one', async () => {
  const clock = Date.parse('2026-11-22T08:00:00Z');
  const { gladys, app } = await start({
    config: { ...SMSFACTOR_CONFIG, receive_sms: true },
    now: () => clock,
  });
  await gladys.fake.sendMessage(CONTACT, MESSAGE);
  assert.ok(app.store.incomingCursor());
  assert.equal(app.store.pending().length, 1);
  await gladys.fake.configUpdated({ ...OCTOPUSH_CONFIG, receive_sms: true });
  assert.equal(app.store.incomingCursor(), null);
  assert.deepEqual(app.store.pending(), []);
  assert.equal(app.getConfig().provider, 'octopush');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('refused credentials: replies and delivery reports are not read meanwhile', async () => {
  const { app, fake } = await start({
    config: { ...SMSFACTOR_CONFIG, smsfactor_token: 'deleted', receive_sms: true },
  });
  const before = fake.calls.length;
  assert.equal(await app.pollIncoming(), 0);
  assert.equal(await app.pollDelivery(), 0);
  assert.equal(fake.calls.length, before);
});
