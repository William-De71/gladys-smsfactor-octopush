// -----------------------------------------------------------------------------
// SMSFactor writes and reads its dates as "Y-m-d H:i:s" in the time zone of
// Paris, without any offset ("2026-11-22 10:11:03"). The integration keeps
// instants in UTC (ms or ISO strings, which compare as strings): these two
// helpers convert at the edge, daylight saving time included.
// -----------------------------------------------------------------------------

const ZONE = 'Europe/Paris';

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * @description The wall clock of Paris at an instant, as parts.
 * @param {number} instant - The instant, in ms.
 * @returns {object} `{ year, month, day, hour, minute, second }` (strings).
 */
function partsAt(instant) {
  return Object.fromEntries(
    FORMAT.formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

/**
 * @description An instant written the way SMSFactor expects it.
 * @param {number} instant - The instant, in ms.
 * @returns {string} "Y-m-d H:i:s", Paris time.
 * @example
 * toParis(Date.UTC(2026, 10, 22, 9, 11, 3)); // -> '2026-11-22 10:11:03'
 */
function toParis(instant) {
  const p = partsAt(instant);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * @description The instant of a date SMSFactor wrote.
 * @param {string} text - "Y-m-d H:i:s", Paris time (quotes tolerated).
 * @returns {number|null} The instant in ms, null when it is not a date.
 * @example
 * fromParis('2026-07-01 12:00:00'); // -> Date.UTC(2026, 6, 1, 10)
 */
function fromParis(text) {
  const match = /^"?(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})"?$/.exec(
    String(text ?? '').trim(),
  );
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // The offset of Paris at that moment (1 or 2 hours), read back from the
  // formatter; a second pass settles the hours around a change of time.
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const p = partsAt(guess);
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess = asUtc - (shown - guess);
  }
  return guess;
}

export { toParis, fromParis };
