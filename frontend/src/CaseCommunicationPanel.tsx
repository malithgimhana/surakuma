import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { Badge, Button, ErrorState, Field, formatDate } from './components';
import { useCountries } from './geography';

type Message = {
  draft: { id: string; language: string; audience: string; source: string; publishedAt?: string | null };
  preview: string;
};
const names: Record<string, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்', hi: 'हिन्दी', ne: 'नेपाली' };
const defaults: Record<string, string[]> = { LK: ['si', 'ta'], IN: ['hi', 'ta'], NP: ['ne'] };

export function CaseCommunicationPanel({ requestId, country }: { requestId: string; country: string }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<string>();
  const client = useQueryClient();
  const path = `/requests/${requestId}/communications`;
  const key = ['case-communications', country, requestId];
  const countries = useCountries();
  const configured = Array.isArray(countries.data) ? countries.data.find(item => item.code === country)?.languages : undefined;
  const languages = [...new Set(['en', ...(configured?.split(',').map(code => code.trim()) ?? defaults[country] ?? [])])].filter(code => names[code]);
  const query = useQuery({ queryKey: key, queryFn: () => get<Message[]>(path), enabled: open });
  const write = useMutation({
    mutationFn: async (input: { id: string } | { audience: FormDataEntryValue | null; language: FormDataEntryValue | null }) => {
      if ('id' in input) await api.post(path + `/${input.id}/publish`, { wordingReviewed: true });
      else await api.post(path, input);
    },
    onSuccess: async () => {
      setConfirmed(undefined);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  return <details className="stack" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Draft a request update</summary>
    <form className="form-grid" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      write.mutate({ audience: data.get('audience'), language: data.get('language') });
    }}>
      <Field label="Audience"><select name="audience"><option value="Citizen">Citizen inbox and email</option>
        <option value="Staff">In-app case team</option></select></Field>
      <Field label="Draft language"><select name="language">{languages.map(code =>
        <option key={code} value={code}>{names[code]}</option>)}</select></Field>
      <Button busy={write.isPending}>Generate update draft</Button>
    </form>
    {(query.error || write.error) && <ErrorState error={write.error || query.error} />}
    {query.isFetching && <p role="status">Loading communication drafts…</p>}
    {query.data?.map(({ draft, preview }) => <article key={draft.id} className="recommendation stack">
      <div className="inline spread">
        <strong>{draft.audience} · {names[draft.language]} · {draft.source}</strong>
        <Badge value={draft.publishedAt ? 'Published' : 'Pending review'} />
      </div>
      <p lang={draft.language}>{preview}</p>
      {draft.publishedAt ? <small>{formatDate(draft.publishedAt)}</small> : <>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed === draft.id}
          onChange={event => setConfirmed(event.target.checked ? draft.id : undefined)} />
          I verified this wording and translation for the selected audience.
        </label>
        <Button busy={write.isPending} disabled={confirmed !== draft.id} onClick={() => write.mutate({ id: draft.id })}>Send reviewed update</Button>
      </>}
    </article>)}
  </details>;
}
