import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { api, get } from './api';
import { Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
import { useCountry } from './geography';
import { countryMapCenters, MapView } from './MapView';

interface Centre {
  id: string;
  name: string;
  address: string;
  services: string;
  facilities: string;
  openingHours: string;
  latitude: number;
  longitude: number;
  accessible: boolean;
  capacity: number | null;
}
interface ManagedCentre extends Centre {
  organisationId: string;
  depotId: string | null;
  published: boolean;
  version: string;
}
interface CentreManagement {
  organisations: { id: string; name: string }[];
  depots: { id: string; name: string; organisationId: string }[];
  centres: ManagedCentre[];
}

export function AssistanceCentres({ workspace = false }: { workspace?: boolean }) {
  const { t, i18n } = useTranslation();
  const country = useCountry();
  const [service, setService] = useState('');
  const [accessible, setAccessible] = useState(false);
  const query = useQuery({ queryKey: ['public-assistance-centres', country],
    queryFn: () => get<Centre[]>(`/public/assistance-centres?countryCode=${country}`) });
  const centres = (query.data ?? []).filter(c => (!accessible || c.accessible) &&
    c.services.toLocaleLowerCase().includes(service.trim().toLocaleLowerCase()));
  return <section className={workspace ? 'citizen-page stack' : 'container section stack'}>
    <PageHeader title={t('assistanceCentres')} description={t('centreDirectoryIntro')} />
    <div className="form-grid">
      <Field label={t('centreServiceFilter')}><input type="search" value={service} onChange={event => setService(event.target.value)} /></Field>
      <label className="checkbox-label"><input type="checkbox" checked={accessible}
        onChange={event => setAccessible(event.target.checked)} /> {t('centreAccessibleOnly')}</label>
    </div>
    {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
      centres.length ? <>
        <MapView key={country} initialZoom={centres.length === 1 ? 12 : 10} places={centres.map(c => ({ ...c, description: c.services }))} />
        <div className="stack">
          {centres.map(c => <Card key={c.id}>
            <h2>{c.name}</h2>
            <p><MapPin size={16} aria-hidden="true" /> {c.address}</p>
            <dl className="review-grid">
              <dt>{t('centreServices')}</dt><dd>{c.services}</dd>
              {c.facilities && <><dt>{t('facilities')}</dt><dd>{c.facilities}</dd></>}
              {c.openingHours && <><dt>{t('centreHours')}</dt><dd>{c.openingHours}</dd></>}
              <dt>{t('category.Accessibility')}</dt><dd>{t(c.accessible ? 'centreAccessYes' : 'centreAccessUnknown')}</dd>
              {c.capacity != null && <><dt>{t('capacity')}</dt><dd>{c.capacity.toLocaleString(i18n.language)}</dd></>}
            </dl>
          </Card>)}
        </div>
      </> : <Card><p>{t(query.data?.length ? 'centreNoMatches' : 'centreNone')}</p></Card>}
  </section>;
}

export function ManageAssistanceCentres() {
  const country = useCountry();
  return <CentreEditorWorkspace key={country} country={country} />;
}

function CentreEditorWorkspace({ country }: { country: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['manage-assistance-centres', country],
    queryFn: () => get<CentreManagement>(`/admin/assistance-centres?countryCode=${country}`) });
  const centre = query.data?.centres.find(c => c.id === editing);
  return <div className="stack">
    <PageHeader title="Assistance centres" action={<Button onClick={() => setEditing('new')}>Register centre</Button>} />
    {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : <>
      {editing && <CentreForm key={editing} country={country} options={query.data} centre={centre} close={() => setEditing(null)} />}
      {query.data.centres.length ? query.data.centres.map(c => <Card key={c.id}>
        <div className="inline spread">
          <div><h2>{c.name}</h2><p>{c.address} · {c.published ? 'Published' : 'Draft'}</p></div>
          <Button variant="secondary" onClick={() => setEditing(c.id)}>Edit<span className="sr-only"> {c.name}</span></Button>
        </div>
      </Card>) : <Card><p>No centres have been registered in this country.</p></Card>}
    </>}
  </div>;
}

function CentreForm({ country, options, centre, close }: {
  country: string;
  options: CentreManagement;
  centre?: ManagedCentre;
  close: () => void;
}) {
  const client = useQueryClient();
  const [organisationId, setOrganisationId] = useState(centre?.organisationId ?? '');
  const [depotId, setDepotId] = useState(centre?.depotId ?? '');
  const [latitude, setLatitude] = useState(centre?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(centre?.longitude.toString() ?? '');
  const point: [number, number] | undefined = latitude && longitude && Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180 ? [Number(latitude), Number(longitude)] : undefined;
  const write = useMutation({
    mutationFn: (data: FormData) => {
      const value = (name: string) => String(data.get(name) ?? '').trim();
      const body = {
        organisationId, depotId: depotId || null, latitude: Number(latitude), longitude: Number(longitude),
        name: value('name'), address: value('address'), services: value('services'), facilities: value('facilities'),
        openingHours: value('hours'), capacity: value('capacity') ? Number(value('capacity')) : null,
        accessible: data.has('accessible'), published: data.has('published'), version: centre?.version ?? null,
      };
      const path = '/admin/assistance-centres' + (centre ? '/' + centre.id : '') + '?countryCode=' + country;
      return centre ? api.put(path, body) : api.post(path, body);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['manage-assistance-centres', country] }),
        client.invalidateQueries({ queryKey: ['public-assistance-centres', country] }),
      ]);
      close();
    },
  });
  return <Card>
    <h2>{centre ? 'Edit centre' : 'Register centre'}</h2>
    <form className="stack" onSubmit={event => { event.preventDefault(); write.mutate(new FormData(event.currentTarget)); }}>
      <div className="form-grid">
        <Field label="Verified organisation"><select value={organisationId} required onChange={event => {
          setOrganisationId(event.target.value); setDepotId('');
        }}>
          <option value="">Select an organisation</option>
          {options.organisations.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}
        </select></Field>
        <Field label="Receiving depot"><select value={depotId} onChange={event => setDepotId(event.target.value)}>
          <option value="">No linked depot</option>
          {options.depots.filter(d => d.organisationId === organisationId).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}
        </select></Field>
        <Field label="Centre name"><input name="name" required maxLength={120} defaultValue={centre?.name} /></Field>
        <Field label="Public address"><input name="address" required maxLength={240} defaultValue={centre?.address} /></Field>
        <Field label="Latitude"><input type="number" step="any" min={-90} max={90} required value={latitude}
          onChange={event => setLatitude(event.target.value)} /></Field>
        <Field label="Longitude"><input type="number" step="any" min={-180} max={180} required value={longitude}
          onChange={event => setLongitude(event.target.value)} /></Field>
        <Field label="Available services"><textarea name="services" required maxLength={400} defaultValue={centre?.services} /></Field>
        <Field label="Facilities"><textarea name="facilities" maxLength={400} defaultValue={centre?.facilities} /></Field>
        <Field label="Opening hours"><input name="hours" maxLength={200} defaultValue={centre?.openingHours} /></Field>
        <Field label="Capacity"><input type="number" name="capacity" min={0} max={100000} defaultValue={centre?.capacity ?? ''} /></Field>
      </div>
      <MapView point={point} initialCenter={countryMapCenters[country]} initialZoom={6} height={230}
        onPick={(lat, lng) => { setLatitude(lat.toFixed(6)); setLongitude(lng.toFixed(6)); }} />
      <label className="checkbox-label"><input type="checkbox" name="accessible" defaultChecked={centre?.accessible} /> Accessible facilities</label>
      <label className="checkbox-label"><input type="checkbox" name="published" defaultChecked={centre?.published} /> Approve and publish this listing</label>
      {write.error && <ErrorState error={write.error} />}
      <div className="button-row"><Button busy={write.isPending} disabled={!point}>Save centre</Button>
        <Button type="button" variant="secondary" onClick={close} disabled={write.isPending}>Cancel</Button></div>
    </form>
  </Card>;
}
