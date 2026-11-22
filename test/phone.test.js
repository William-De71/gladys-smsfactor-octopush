import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, parsePhoneList, maskPhone } from '../src/phone.js';
import { contactPhone, normalizeConfig } from '../src/config.js';

test('phone numbers typed the usual ways become international', () => {
  const cases = [
    ['+33612345678', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33 (0)6 12-34-56-78', '+33612345678'],
    ['0033.6.12.34.56.78', '+33612345678'],
    ['06 12 34 56 78', '+33612345678'],
    ['06/12/34/56/78', '+33612345678'],
    ['+32 470 12 34 56', '+32470123456'],
  ];
  for (const [typed, expected] of cases) {
    assert.equal(normalizePhone(typed, '33'), expected, typed);
  }
  // A national number takes the default country code.
  assert.equal(normalizePhone('0470 12 34 56', '32'), '+32470123456');
});

test('what is not a phone number is refused', () => {
  for (const typed of [
    '',
    '   ',
    'GLADYS',
    '612345678',
    '+33',
    '06 12',
    '+0612345678',
    'tel:+33612345678',
    '+1234567890123456',
  ]) {
    assert.equal(normalizePhone(typed, '33'), null, typed);
  }
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone('0612345678', ''), null, 'no country code to add');
});

test('a list splits on commas, semicolons and lines, without duplicates', () => {
  assert.deepEqual(parsePhoneList('06 12 34 56 78, +33612345678;+32470123456\nabc', '33'), {
    valid: ['+33612345678', '+32470123456'],
    invalid: ['abc'],
  });
  assert.deepEqual(parsePhoneList(undefined, '33'), { valid: [], invalid: [] });
});

test('masked numbers tell two numbers apart without giving them away', () => {
  assert.equal(maskPhone('+33612345678'), '+336******78');
  assert.equal(maskPhone('12345'), '****');
});

test('the contact holds the phone number of the user', () => {
  assert.equal(contactPhone({ phone_number: ' 06 12 34 56 78 ' }, '33'), '+33612345678');
  assert.equal(contactPhone({}, '33'), null);
  assert.equal(contactPhone(undefined), null);
});

test('configuration defaults, per provider', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, {
    provider: 'smsfactor',
    smsfactorToken: '',
    octopushLogin: '',
    octopushApiKey: '',
    octopushSmsType: 'premium',
    sender: '',
    countryCode: '33',
    lowCreditsThreshold: 20,
    receiveSms: false,
  });
  const full = normalizeConfig({
    provider: 'octopush',
    octopush_login: ' me@example.com ',
    octopush_api_key: 'key',
    octopush_sms_type: 'low_cost',
    sender: ' Gladys-Maison! ',
    country_code: '+1',
    low_credits_threshold: 0,
    receive_sms: true,
  });
  assert.equal(full.provider, 'octopush');
  assert.equal(full.octopushLogin, 'me@example.com');
  assert.equal(full.octopushSmsType, 'low_cost');
  assert.equal(full.sender, 'GladysMaiso', 'letters and digits, 11 at most');
  assert.equal(full.countryCode, '1');
  assert.equal(full.lowCreditsThreshold, 0);
  assert.equal(full.receiveSms, true);
  assert.equal(normalizeConfig({ provider: 'octopush' }).lowCreditsThreshold, 2, 'euros');
  assert.equal(normalizeConfig({ provider: 'ovh' }).provider, 'smsfactor');
  assert.equal(normalizeConfig({ octopush_sms_type: 'gold' }).octopushSmsType, 'premium');
  assert.equal(normalizeConfig({ low_credits_threshold: -5 }).lowCreditsThreshold, 0);
});
