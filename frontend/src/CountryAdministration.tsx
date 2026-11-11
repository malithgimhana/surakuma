import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCountries, useCountry } from './geography';
import { Button, Card, Field, ErrorState } from './components';
export function CountryAdministration() {
  const code = useCountry(),
    countries = useCountries(),
    client = useQueryClient();
  const country = Array.isArray(countries.data)
    ? countries.data.find((c) => c.code === code)
    : undefined;
  const save = useMutation({
    mutationFn: (data: unknown) => api.put(`/countries/${code}/services`, data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['countries'] }),
  });
  if (!country) return null;
  const contacts: { label: string; number: string; sourceUrl: string }[] = JSON.parse(
    country.emergencyContactsJson || '[]',
  );
  return (
    <Card>
      <h2>{country.name}: public services</h2>
      {save.error && <ErrorState error={save.error} />}
      {save.isSuccess && <p role="status">Country services saved.</p>}
      <form
        className="stack"
        key={code}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            languages: f.getAll('languages').join(','),
            requiredAlertLanguages: f.getAll('requiredLanguages').join(','),
            contacts: Array.from({ length: contacts.length + 1 }, (_, i) => ({
              label: String(f.get(`label${i}`) || ''),
              number: String(f.get(`number${i}`) || ''),
              sourceUrl: String(f.get(`source${i}`) || ''),
            })).filter((c) => c.label || c.number || c.sourceUrl),
          });
        }}
      >
        <fieldset>
          <legend>Available languages</legend>
          {['en', 'si', 'ta', 'ne', 'hi'].map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                name="languages"
                value={l}
                defaultChecked={country.languages.split(',').includes(l)}
              />{' '}
              {{ en: 'English', si: 'Sinhala', ta: 'Tamil', ne: 'Nepali', hi: 'Hindi' }[l]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Required alert translations</legend>
          {['en', 'si', 'ta', 'ne', 'hi'].map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                name="requiredLanguages"
                value={l}
                defaultChecked={country.requiredAlertLanguages.split(',').includes(l)}
              />{' '}
              {l}
            </label>
          ))}
        </fieldset>
        <p>
          English is the fallback. Nepali and Hindi alert translations can be supplied by staff;
          untranslated interface text uses English.
        </p>
        {[...contacts, { label: '', number: '', sourceUrl: '' }].map((c, i) => (
          <fieldset key={i}>
            <legend>
              {i < contacts.length ? 'Emergency contact' : 'Add a contact (optional)'}
            </legend>
            <Field label="Service name">
              <input name={`label${i}`} defaultValue={c.label} />
            </Field>
            <Field label="Telephone">
              <input name={`number${i}`} defaultValue={c.number} />
            </Field>
            <Field label="Official source">
              <input type="url" name={`source${i}`} defaultValue={c.sourceUrl} />
            </Field>
          </fieldset>
        ))}
        <Button busy={save.isPending}>Save public services</Button>
      </form>
    </Card>
  );
}
