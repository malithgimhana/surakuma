import { expect, it } from 'vitest';
import i18n from '../i18n';
import { ne, hi } from '../locales/ne-hi';
it('covers the existing catalogue in Nepali and Hindi and preserves interpolation tokens', () => {
  const english = i18n.getResourceBundle('en', 'translation') as Record<string, string>;
  for (const catalog of [ne, hi])
    for (const [key, value] of Object.entries(english)) {
      expect(catalog[key], key).toBeTruthy();
      expect(catalog[key].match(/\{\{.*?\}\}/g) || [], key).toEqual(
        value.match(/\{\{.*?\}\}/g) || [],
      );
    }
});
