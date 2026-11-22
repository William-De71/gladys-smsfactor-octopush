// -----------------------------------------------------------------------------
// Scene triggers of the SMSFactor + Octopush integration.
//
//   sms_not_sent   Gladys could not send a notification by SMS. One event per
//                  TRANSITION, never one per failed message: the first failure
//                  fires, the following ones of the same scope stay silent
//                  until an SMS goes through again. The scope is the account
//                  (credentials, credits, sender, provider down…), or the
//                  phone number for a number the provider refuses. This is
//                  what keeps a scene that answers the failure through this
//                  same channel from looping.
//   sms_undelivered the provider reported that an SMS it accepted never
//                  reached the phone (SMSFactor: denied, not sent,
//                  undelivered). Once per SMS and number.
//   sms_received   a reply to an SMS sent without a custom sender arrived
//                  (SMSFactor). Once per SMS, never again after a restart
//                  (store.js).
//   credits_low    the credits went below the threshold of the configuration;
//                  armed again once they are back above it.
//
// A scene ACTION never fires a trigger: its result goes to the scene.
// Event data is flat (scalars only) and holds the declared variables only.
// -----------------------------------------------------------------------------

import { FAILURE_REASONS } from './sms.js';
import { maskPhone } from './phone.js';

const SCENE_TRIGGERS = Object.freeze({
  SMS_NOT_SENT: 'sms_not_sent',
  SMS_UNDELIVERED: 'sms_undelivered',
  SMS_RECEIVED: 'sms_received',
  CREDITS_LOW: 'credits_low',
});

const ACCOUNT_SCOPE = 'account';
const MAX_DATA_TEXT = 1000;

/**
 * @description The first word of an SMS, in capitals and without accents nor
 * punctuation: what a scene filters on ("OPEN", "STATUS").
 * @param {string} message - The text.
 * @returns {string} The keyword, '' when there is none.
 * @example
 * keywordOf(' Statut ? '); // -> 'STATUT'
 */
function keywordOf(message) {
  const first = String(message ?? '')
    .trim()
    .split(/\s+/)[0];
  return (first ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .toUpperCase()
    .slice(0, 40);
}

/**
 * @description The payload of `sms_received`.
 * @param {object} sms - The SMS received (sms.getIncoming).
 * @returns {object} The event data.
 * @example
 * receivedPayload({ id: 1, sender: '+33612345678', message: 'Statut', receivedAt: '…' });
 */
function receivedPayload(sms) {
  return {
    sender: sms.sender,
    message: sms.message.slice(0, MAX_DATA_TEXT),
    keyword: keywordOf(sms.message),
    received_at: sms.receivedAt,
  };
}

/**
 * @description The payload of `sms_undelivered`.
 * @param {object} sms - `{ ticket, destination, status, details }` (listOutgoing).
 * @returns {object} The event data.
 * @example
 * undeliveredPayload({ ticket: '1', destination: '+33612345678', status: 'undelivered', details: '' });
 */
function undeliveredPayload(sms) {
  return {
    phone_number: maskPhone(sms.destination),
    status: sms.status,
    details: String(sms.details ?? '').slice(0, MAX_DATA_TEXT),
    ticket: sms.ticket,
  };
}

/**
 * @description Track the failures and fire `sms_not_sent` on the first one of
 * each scope.
 * @param {object} gladys - The GladysIntegration client.
 * @param {object} logger - Logger.
 * @returns {{ failed: Function, sent: Function }} The tracker.
 * @example
 * const failures = createFailureEvents(gladys, logger);
 * await failures.failed(['+33612345678'], err);
 * failures.sent(['+33612345678']);
 */
function createFailureEvents(gladys, logger) {
  const failing = new Set();

  return {
    /**
     * @description A notification was not sent: fire the trigger if its scope
     * was not already failing. Never throws.
     * @param {string[]} receivers - The numbers of the SMS.
     * @param {object} err - An SmsError.
     * @returns {Promise<void>}
     */
    async failed(receivers, err) {
      const reason = err.reason ?? FAILURE_REASONS.UNEXPECTED;
      const scope =
        reason === FAILURE_REASONS.INVALID_NUMBER ? `number:${receivers.join(',')}` : ACCOUNT_SCOPE;
      if (failing.has(scope)) {
        return;
      }
      failing.add(scope);
      try {
        await gladys.publishSceneEvent(SCENE_TRIGGERS.SMS_NOT_SENT, {
          reason,
          status: typeof err.status === 'number' ? err.status : null,
          error: String(err.message).slice(0, MAX_DATA_TEXT),
          phone_number: receivers.map(maskPhone).join(', ').slice(0, MAX_DATA_TEXT),
        });
      } catch (eventErr) {
        logger.warn(`Could not fire ${SCENE_TRIGGERS.SMS_NOT_SENT}: ${eventErr.message}`);
      }
    },

    /**
     * @description An SMS went through: the account works again, and so do
     * these numbers.
     * @param {string[]} receivers - The numbers of the SMS.
     */
    sent(receivers) {
      failing.delete(ACCOUNT_SCOPE);
      failing.delete(`number:${receivers.join(',')}`);
    },
  };
}

export { createFailureEvents, receivedPayload, undeliveredPayload, keywordOf, SCENE_TRIGGERS };
