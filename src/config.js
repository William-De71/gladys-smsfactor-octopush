// -----------------------------------------------------------------------------
// Configuration of the SMSFactor + Octopush integration.
//
// Two levels, as the manifest declares them:
//   - `config_schema` (the administrator, once for the house): the provider
//     (SMSFactor or Octopush) and its credentials, the sender, the default
//     country code, the low credits threshold and the reception of replies;
//   - `contact_schema` (each user, in the "My account" block): the phone
//     number their notifications go to. Gladys hands it with every message.
// -----------------------------------------------------------------------------

import { PROVIDERS, DEFAULT_PROVIDER } from './sms.js';
import { SMS_TYPES, DEFAULT_SMS_TYPE } from './providers/octopush.js';
import { normalizePhone } from './phone.js';

const DEFAULT_COUNTRY_CODE = '33';
// Below this, `credits_low` fires: SMS credits for SMSFactor, euros for
// Octopush (its balance is an amount), when the field is left empty.
const DEFAULT_LOW_CREDITS = Object.freeze({ smsfactor: 20, octopush: 2 });

/**
 * @description A trimmed string, '' for anything else.
 * @param {any} value - The raw value.
 * @returns {string} The string.
 */
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @description Normalize the integration configuration.
 * @param {object} [raw] - The raw values (gladys.config).
 * @returns {object} The configuration used by the integration.
 * @example
 * normalizeConfig({ provider: 'smsfactor', smsfactor_token: 'eyJ…' });
 */
function normalizeConfig(raw = {}) {
  const provider = Object.values(PROVIDERS).includes(raw.provider)
    ? raw.provider
    : DEFAULT_PROVIDER;
  const countryCode = text(raw.country_code).replace(/\D/g, '') || DEFAULT_COUNTRY_CODE;
  const threshold = Number(raw.low_credits_threshold);
  const thresholdSet =
    raw.low_credits_threshold !== undefined &&
    raw.low_credits_threshold !== null &&
    raw.low_credits_threshold !== '' &&
    Number.isFinite(threshold);
  return {
    provider,
    smsfactorToken: text(raw.smsfactor_token),
    octopushLogin: text(raw.octopush_login),
    octopushApiKey: text(raw.octopush_api_key),
    octopushSmsType: Object.hasOwn(SMS_TYPES, raw.octopush_sms_type)
      ? raw.octopush_sms_type
      : DEFAULT_SMS_TYPE,
    // Letters and digits only: what both providers accept (3 to 11).
    sender: text(raw.sender)
      .replace(/[^A-Za-z0-9 ]/g, '')
      .trim()
      .slice(0, 11),
    countryCode,
    lowCreditsThreshold: thresholdSet ? Math.max(0, threshold) : DEFAULT_LOW_CREDITS[provider],
    receiveSms: raw.receive_sms === true || raw.receive_sms === 'true',
  };
}

/**
 * @description The phone number of a user, from the values of their "My
 * account" block.
 * @param {object} [contact] - The contact_schema values.
 * @param {string} countryCode - Default country code.
 * @returns {string|null} The international number, or null.
 * @example
 * contactPhone({ phone_number: '06 12 34 56 78' }, '33'); // -> '+33612345678'
 */
function contactPhone(contact = {}, countryCode = DEFAULT_COUNTRY_CODE) {
  return normalizePhone(text(contact.phone_number), countryCode);
}

export { normalizeConfig, contactPhone, DEFAULT_COUNTRY_CODE, DEFAULT_LOW_CREDITS };
