import { describe, expect, it } from 'vitest';

import { cloudErrorText, cloudFileDay, cloudFileName, cloudFilesToPrune, cloudSaveDue, formatBytes, formatCloudTime } from '../cloud';

describe('cloud copies', () => {
  it('names a copy by its day and reads it back', () => {
    expect(cloudFileName('2026-11-23')).toBe('2026-11-23.json');
    expect(cloudFileDay('2026-11-23.json')).toBe('2026-11-23');
    expect(cloudFileDay('.emptyFolderPlaceholder')).toBeNull();
  });

  it('keeps the newest and leaves other files alone', () => {
    const names = ['2026-11-20.json', 'note.txt', '2026-11-23.json', '2026-11-21.json', '2026-11-22.json'];
    expect(cloudFilesToPrune(names, 2)).toEqual(['2026-11-21.json', '2026-11-20.json']);
    expect(cloudFilesToPrune(names, 30)).toEqual([]);
  });

  it('saves again after the interval', () => {
    const now = new Date('2026-11-23T12:00:00');
    expect(cloudSaveDue(null, now)).toBe(true);
    expect(cloudSaveDue(new Date('2026-11-23T08:00:00').toISOString(), now)).toBe(false);
    expect(cloudSaveDue(new Date('2026-11-23T05:59:00').toISOString(), now)).toBe(true);
    expect(cloudSaveDue('garbage', now)).toBe(true);
  });

  it('says when, in words', () => {
    const now = new Date('2026-11-23T20:00:00');
    expect(formatCloudTime(new Date('2026-11-23T14:32:00').toISOString(), now)).toBe('oggi alle 14:32');
    expect(formatCloudTime(new Date('2026-11-22T09:05:00').toISOString(), now)).toBe('ieri alle 9:05');
    expect(formatCloudTime(new Date('2026-11-21T18:10:00').toISOString(), now)).toMatch(/^21 nov.* alle 18:10$/);
  });

  it('gives sizes and errors in words', () => {
    expect(formatBytes(840 * 1024)).toBe('840 KB');
    expect(formatBytes(1.24 * 1024 * 1024)).toBe('1,2 MB');
    expect(cloudErrorText(400, { error_code: 'invalid_credentials' })).toBe('Email o password sbagliate');
    expect(cloudErrorText(400, { error_code: 'refresh_token_already_used' })).toBe('Accesso scaduto: accedi di nuovo');
    expect(cloudErrorText(404, { error: 'Bucket not found' })).toBe('Il bucket «backups» non c’è');
    expect(cloudErrorText(403, { message: 'new row violates row-level security policy' })).toBe('Accesso negato: controlla le regole del bucket');
  });
});
