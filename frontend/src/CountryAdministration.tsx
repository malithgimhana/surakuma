import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, LockKeyhole, Plus } from 'lucide-react';
import { api } from './api';
import { useCountries, useCountry } from './geography';
import type { Country } from './geography';
import { Button, Card, ErrorState, Field, Loading } from './components';

const languageNames = [
  ['en', 'English'],
  ['si', 'Sinhala'],
  ['ta', 'Tamil'],
  ['ne', 'Nepali'],
  ['hi', 'Hindi'],
] as const;

interface Contact {
  label: string;
  number: string;
  sourceUrl: string;
}

const emptyContact: Contact = { label: '', number: '', sourceUrl: '' };

export function CountryAdministration() {
  const code = useCountry();
  const countries = useCountries();
  const country = Array.isArray(countries.data) ? countries.data.find((item) => item.code === code) : undefined;

  if (countries.isPending) return <Loading />;
  if (countries.error) return <ErrorState error={countries.error} retry={() => void countries.refetch()} />;
  if (!country) return <Card><p>Public services settings are unavailable for the selected country.</p></Card>;
  return <CountryServicesForm key={country.code} country={country} />;
}

function CountryServicesForm({ country }: { country: Country }) {
  const client = useQueryClient();
  const [available, setAvailable] = useState(() => country.languages.split(','));
  const [required, setRequired] = useState(() => country.requiredAlertLanguages.split(','));
  const [contacts, setContacts] = useState<Contact[]>(() => JSON.parse(country.emergencyContactsJson || '[]'));
  const [newContact, setNewContact] = useState<Contact | null>(null);
  const save = useMutation({
    mutationFn: async (data: { languages: string; requiredAlertLanguages: string; contacts: Contact[] }) => {
      const response = await api.put(`/countries/${country.code}/services`, data);
      if (response.status !== 204) throw new Error('The API must be updated to publish country settings directly.');
    },
    onSuccess: async (_, data) => {
      setContacts(data.contacts);
      setNewContact(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['countries'] }),
        client.invalidateQueries({ queryKey: ['audit', country.code] }),
      ]);
    },
  });

  return (
    <Card className="country-services">
      <h2>Public services in {country.name}</h2>
      <p className="muted">Manage public languages, alert translations and emergency contacts.</p>
      <form onChange={() => { if (!save.isPending) save.reset(); }} onSubmit={(event) => {
        event.preventDefault();
        const updatedContacts = (newContact ? [...contacts, newContact] : contacts)
          .map(({ label, number, sourceUrl }) => ({ label: label.trim(), number: number.trim(), sourceUrl: sourceUrl.trim() }))
          .filter(({ label, number, sourceUrl }) => label || number || sourceUrl);
        save.mutate({
          languages: available.join(','),
          requiredAlertLanguages: required.join(','),
          contacts: updatedContacts,
        });
      }}>
        <fieldset className="country-services-fields" disabled={save.isPending}>
          <section className="country-services-panel" aria-labelledby="country-language-heading">
            <h3 id="country-language-heading">Languages and alerts</h3>
            <p className="muted">English is always available and required for public alerts. Untranslated interface text appears in English.</p>
            <table className="country-language-table">
              <thead>
                <tr><th scope="col">Language</th><th scope="col">Available</th><th scope="col">Required for alerts</th></tr>
              </thead>
              <tbody>
                {languageNames.map(([code, name]) => (
                  <tr key={code}>
                    <th scope="row">
                      <span className="country-language-name">
                        {name}
                        {code === 'en' && <LockKeyhole size={15} aria-label="Always required" />}
                      </span>
                    </th>
                    <td>
                      <input type="checkbox" aria-label={`Make ${name} available`} checked={available.includes(code)} disabled={code === 'en'}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setAvailable(checked ? [...available, code] : available.filter((item) => item !== code));
                          if (!checked) setRequired(required.filter((item) => item !== code));
                        }} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`Require ${name} for alerts`} checked={required.includes(code)}
                        disabled={code === 'en' || !available.includes(code)}
                        onChange={(event) => setRequired(event.target.checked ? [...required, code] : required.filter((item) => item !== code))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="country-services-panel" aria-labelledby="country-contact-heading">
            <h3 id="country-contact-heading">Emergency contacts</h3>
            <p className="muted">Use an official HTTPS source for each contact.</p>
            {contacts.length === 0 && !newContact && <p className="country-contacts-empty">No emergency contacts configured.</p>}
            {contacts.map((contact, index) => (
              <ContactFields key={index} contact={contact} title={`Contact ${index + 1}`} onChange={(updated) =>
                setContacts(contacts.map((item, position) => position === index ? updated : item))
              } />
            ))}
            {newContact ? (
              <ContactFields contact={newContact} title="New contact" onChange={setNewContact} autoFocus />
            ) : contacts.length < 20 && (
              <Button type="button" variant="secondary" onClick={() => setNewContact(emptyContact)}>
                <Plus size={17} aria-hidden="true" /> Add contact
              </Button>
            )}
          </section>
        </fieldset>
        <div className="country-services-footer">
          <p className="muted">Saving publishes these settings immediately and records the update in Activity.</p>
          <div className="organisation-dialog-actions">
            {newContact && <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setNewContact(null)}>Cancel new contact</Button>}
            <Button busy={save.isPending}>Save and publish</Button>
          </div>
        </div>
        {save.isSuccess && (
          <p className="organisation-notice" role="status">
            <CircleCheck size={18} aria-hidden="true" />
            Public services settings for {country.name} are live.
          </p>
        )}
        {save.error && <ErrorState error={save.error} />}
      </form>
    </Card>
  );
}

function ContactFields({ contact, title, onChange, autoFocus }: {
  contact: Contact;
  title: string;
  onChange: (contact: Contact) => void;
  autoFocus?: boolean;
}) {
  const hasDetails = !!(contact.label.trim() || contact.number.trim() || contact.sourceUrl.trim());

  return (
    <fieldset className={autoFocus ? 'country-contact-fields new-contact' : 'country-contact-fields'}>
      <legend>{title}</legend>
      <Field label="Service name">
        <input value={contact.label} onChange={(event) => onChange({ ...contact, label: event.target.value })}
          required={hasDetails} maxLength={100} autoFocus={autoFocus} />
      </Field>
      <Field label="Telephone">
        <input type="tel" value={contact.number} onChange={(event) => onChange({ ...contact, number: event.target.value })}
          required={hasDetails} maxLength={25} />
      </Field>
      <div className="country-contact-source">
        <Field label="Official source">
          <input type="url" value={contact.sourceUrl} onChange={(event) => onChange({ ...contact, sourceUrl: event.target.value })}
            required={hasDetails} placeholder="https://" />
        </Field>
      </div>
    </fieldset>
  );
}
