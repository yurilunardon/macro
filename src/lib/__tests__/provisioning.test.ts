import { describe, expect, it } from 'vitest';

import { expiryStatus, formatExpiry, parseProvisioningExpiry } from '../provisioning';

function profile(xmlBody: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>AppIDName</key><string>Macro</string>
  <key>CreationDate</key><date>2026-10-25T10:00:00Z</date>
${xmlBody}
</dict></plist>`;
  // The real file wraps the plist in a binary signature, including bytes above 127.
  const before = [0x30, 0x82, 0x2c, 0x5a, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0xff, 0x00];
  const after = [0xa0, 0x82, 0x0d, 0x00, 0xff, 0xfe];
  return new Uint8Array([...before, ...Array.from(xml, (c) => c.charCodeAt(0)), ...after]);
}

describe('parseProvisioningExpiry', () => {
  it('finds the expiry inside the signed profile', () => {
    const bytes = profile('  <key>ExpirationDate</key>\n  <date>2026-11-01T10:00:00Z</date>');
    expect(parseProvisioningExpiry(bytes)?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('reads real-sized profiles, whatever falls on a chunk boundary', () => {
    const plist = profile('  <key>ExpirationDate</key>\n  <date>2026-11-01T10:00:00Z</date>');
    for (const padding of [4070, 4096, 9000]) {
      const bytes = new Uint8Array(padding + plist.length);
      bytes.fill(0xaa, 0, padding);
      bytes.set(plist, padding);
      expect(parseProvisioningExpiry(bytes)?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    }
  });

  it('returns null when there is no expiry or no profile', () => {
    expect(parseProvisioningExpiry(profile(''))).toBeNull();
    expect(parseProvisioningExpiry(new Uint8Array())).toBeNull();
    expect(parseProvisioningExpiry(profile('<key>ExpirationDate</key><date>mai</date>'))).toBeNull();
  });
});

describe('expiryStatus', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it('grades the time left', () => {
    expect(expiryStatus(new Date('2026-11-05T12:00:00Z'), now).level).toBe('ok');
    expect(expiryStatus(new Date('2026-11-01T12:00:00Z'), now).level).toBe('soon');
    expect(expiryStatus(new Date('2026-10-31T06:00:00Z'), now).level).toBe('urgent');
    expect(expiryStatus(new Date('2026-10-30T11:00:00Z'), now).level).toBe('expired');
    expect(expiryStatus(new Date('2026-10-31T12:00:00Z'), now).hoursLeft).toBe(24);
  });
});

describe('formatExpiry', () => {
  it('says today, tomorrow or the date', () => {
    const now = new Date(2026, 9, 30, 9, 0);
    expect(formatExpiry(new Date(2026, 9, 30, 18, 30), now)).toBe('oggi alle 18:30');
    expect(formatExpiry(new Date(2026, 9, 31, 8, 5), now)).toBe('domani alle 08:05');
    expect(formatExpiry(new Date(2026, 10, 3, 8, 5), now)).toBe('martedì 3 novembre');
  });
});
