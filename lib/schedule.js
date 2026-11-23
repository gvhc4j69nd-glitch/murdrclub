'use strict';

/**
 * Club Time. In a daily club every phase ends at a fixed local hour in the
 * club's time zone, so 18:00 is 18:00 for the club all year, through
 * daylight-saving changes. Fast clubs (for testing) just use minutes.
 */

// The local hour each phase ends at.
const PHASE_END_HOUR = {
  day: 18,       // Errands and the Lounge, 08:00–18:00
  tribunal: 21,  // The Tribunal, 18:00–21:00
  backroom: 8,   // The Back Room, 21:00–08:00 next morning
};

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }));
  }
  return formatters.get(tz);
}

/** The wall-clock date and time at instant `ts` in `tz`. */
function localParts(ts, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour, mi: out.minute };
}

/** How far `tz` is ahead of UTC at instant `ts`, in milliseconds. */
function offsetAt(ts, tz) {
  const p = localParts(ts, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return asUtc - Math.floor(ts / 60000) * 60000;
}

/** The UTC instant at which the wall clock in `tz` reads the given time. */
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - offsetAt(guess, tz);
  const second = offsetAt(ts, tz);
  if (guess - second !== ts) ts = guess - second;
  return ts;
}

/**
 * The first time after `after + minGapMs` that the local clock in `tz` reads
 * `hour`:00.
 */
function nextLocalHour(after, tz, hour, minGapMs = 0) {
  const p = localParts(after, tz);
  for (let add = 0; add < 4; add += 1) {
    const day = new Date(Date.UTC(p.y, p.mo - 1, p.d + add));
    const ts = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0, tz);
    if (ts > after + minGapMs) return ts;
  }
  return after + minGapMs + 24 * 3600 * 1000; // unreachable in practice
}

/**
 * When a phase that starts at `start` should end.
 * `firstDay` gives the opening day at least four hours so people can arrive.
 */
function phaseEnd(settings, phase, start, { firstDay = false } = {}) {
  if (settings.pace === 'fast') {
    const minutes = settings.fastMinutes[phase];
    return start + minutes * 60 * 1000;
  }
  const gap = firstDay ? 4 * 3600 * 1000 : 30 * 60 * 1000;
  return nextLocalHour(start, settings.timeZone, PHASE_END_HOUR[phase], gap);
}

module.exports = { PHASE_END_HOUR, isValidTimeZone, localParts, zonedToUtc, nextLocalHour, phaseEnd };
