// -----------------------------------------------------------------------------
// The GSM 7-bit alphabet of SMS (3GPP TS 23.038): a text made of these
// characters fits 160 per SMS; one character outside (an emoji, "œ", "ê")
// turns the whole SMS into Unicode, 70 characters per SMS. SMSFactor refuses
// or mangles such characters unless the send asks for Unicode, so the
// integration asks for it only when the text needs it (it costs more).
// -----------------------------------------------------------------------------

const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXTENSION = '^{}\\[~]|€\f';
const GSM = new Set([...BASIC, ...EXTENSION]);

/**
 * @description Whether a text needs Unicode SMS.
 * @param {string} text - The text.
 * @returns {boolean} True when a character is outside the GSM alphabet.
 * @example
 * needsUnicode('Porte ouverte'); // -> false
 * needsUnicode('Fenêtre 🔥'); // -> true
 */
function needsUnicode(text) {
  for (const char of String(text ?? '')) {
    if (!GSM.has(char)) {
      return true;
    }
  }
  return false;
}

export { needsUnicode };
