import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check, MapPin, Search, ShieldCheck } from 'lucide-react';
import { api, get } from './api';
import { useAuth } from './auth';
import { Button, Card, Empty, ErrorState, Field, PageHeader } from './components';
import { isShelterWorkspace, shelterPath } from './countryScope';
import { countryPath } from './crisisOperationsApi';
import { AssignedCountry, RegionField, useCountry, useDivisions } from './geography';
import { locationSearchSchema, type LocationResult } from './locationSearch';
import { countryMapCenters, MapView } from './MapView';
import type { Shelter } from './types';
import './resource-location-fields.css';

const steps = ['Basics', 'Location', 'Facilities', 'Review'];
const facilityOptions = [
  'Drinking water',
  'Toilets',
  'First aid',
  'Family spaces',
  'Accessible entrance',
  'Electricity',
];
const validCoordinate = (value: string, limit: number) =>
  value.trim() !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;

export default function ShelterRegistration() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const country = useCountry();
  return isShelterWorkspace(user, pathname, search) ? (
    <RegistrationWizard key={country} country={country} />
  ) : (
    <Navigate to={shelterPath('/shelters/new')} replace />
  );
}

function RegistrationWizard({ country }: { country: string }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [registrationId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({
    name: '',
    organisationId: '',
    capacity: '',
    divisionId: null as string | null,
    address: '',
    latitude: '',
    longitude: '',
    facilities: [] as string[],
    additional: '',
  });
  const addressSearch = useMutation({
    mutationFn: async (query: string) => locationSearchSchema.parse(
      await get<unknown>(countryPath('/maps/geocode', country, { query })),
    ).features,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const touchedStep = useRef(false);
  useEffect(() => {
    if (touchedStep.current) heading.current?.focus();
  }, [step]);
  const changeStep = (next: number) => {
    touchedStep.current = true;
    addressSearch.reset();
    setConfirmed(false);
    setStep(next);
  };

  const organisationQuery = useQuery({
    queryKey: ['organisation-options', country],
    queryFn: () =>
      get<{ organisations: { id: string; name: string }[] }>(
        `/public/lookups?countryCode=${country}`,
      ),
  });
  const divisions = useDivisions(country);
  const organisations =
    organisationQuery.data?.organisations.filter((org) =>
      user?.memberships.some(
        (m) =>
          m.role === 'ShelterAdmin' &&
          m.countryCode === country &&
          !m.crisisId &&
          m.organisationId === org.id,
      ),
    ) ?? [];
  const organisation = organisations.find((org) => org.id === draft.organisationId);
  const division = divisions.data?.find((region) => region.id === draft.divisionId);
  const regionNames: string[] = [];
  const seenRegions = new Set<string>();
  for (
    let region = division;
    region && !seenRegions.has(region.id);
    region = divisions.data?.find((r) => r.id === region?.parentId)
  ) {
    regionNames.unshift(region.name);
    seenRegions.add(region.id);
  }
  const capacity = Number(draft.capacity);
  const basicValid = Boolean(
    draft.name.trim() &&
    draft.name.trim().length <= 150 &&
    organisation &&
    Number.isInteger(capacity) &&
    capacity >= 1 &&
    capacity <= 100000,
  );
  const hasPoint = validCoordinate(draft.latitude, 90) && validCoordinate(draft.longitude, 180);
  const locationValid = Boolean(
    draft.address.trim() && draft.address.trim().length <= 500 && hasPoint && division,
  );
  const facilities = [
    ...new Set([
      ...draft.facilities,
      ...draft.additional
        .split(/[,;\n]/)
        .map((f) => f.trim())
        .filter(Boolean),
    ]),
  ];
  const accessible = draft.facilities.includes('Accessible entrance');
  const write = useMutation({
    mutationFn: async () =>
      (
        await api.post<Shelter>(`/shelters?countryCode=${country}`, {
          registrationId,
          countryCode: country,
          name: draft.name.trim(),
          organisationId: organisation?.id,
          capacity,
          administrativeDivisionId: division?.id,
          address: draft.address.trim(),
          latitude: Number(draft.latitude),
          longitude: Number(draft.longitude),
          facilities: facilities.join(', '),
          accessible,
          open: false,
        })
      ).data,
    onSuccess: async (shelter) => {
      await client.invalidateQueries({ queryKey: ['shelter-dashboard', country] });
      navigate(shelterPath('/shelters', { shelter: shelter.id }), {
        replace: true,
        state: { registeredShelter: shelter.id },
      });
    },
  });
  const submitting = useRef(false);
  const update = <Key extends keyof typeof draft>(key: Key, value: (typeof draft)[Key]) => {
    setConfirmed(false);
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (write.isError) write.reset();
  };
  const addressQuery = draft.address.trim();
  const canSearchAddress = addressQuery.length >= 3 && addressQuery.length <= 150 && !addressSearch.isPending;

  function setLocation(latitude: number, longitude: number, address?: string) {
    addressSearch.reset();
    setConfirmed(false);
    setDraft((previous) => ({
      ...previous,
      address: address ?? previous.address,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }));
    if (write.isError) write.reset();
  }

  function selectLocation(result: LocationResult) {
    const [longitude, latitude] = result.geometry.coordinates;
    setLocation(latitude, longitude, result.properties.label);
  }

  function searchAddress() {
    if (!canSearchAddress) return;
    addressSearch.mutate(addressQuery, {
      onSuccess: (results) => {
        if (results.length === 1) selectLocation(results[0]);
      },
    });
  }

  const validSteps = [basicValid, locationValid, true, basicValid && locationValid && confirmed];
  return (
    <div className="shelter-management shelter-page">
      <PageHeader
        title="Register a new shelter"
        description="Record a location and safe capacity for operational verification."
        action={
          <Link className="button secondary" to={shelterPath('/shelters')}>
            <ArrowLeft size={17} />
            Cancel &amp; return
          </Link>
        }
      />
      <ol className="shelter-steps" aria-label="Registration progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}>
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="shelter-wizard-grid">
        <Card>
          <h2 tabIndex={-1} ref={heading}>
            {
              [
                'Basic information',
                'Location and coverage',
                'Facilities and accessibility',
                'Review & confirm',
              ][step]
            }
          </h2>
          <form
            key={step}
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validSteps[step] || submitting.current) return;
              if (step !== 3) changeStep(step + 1);
              else {
                submitting.current = true;
                write.mutate(undefined, {
                  onError: () => {
                    submitting.current = false;
                  },
                });
              }
            }}
          >
            {step === 0 && (
              <div className="form-grid">
                <Field label="Shelter name">
                  <input
                    required
                    maxLength={150}
                    value={draft.name}
                    onChange={(e) => update('name', e.target.value)}
                  />
                </Field>
                <Field label="Operating organisation">
                  <select
                    required
                    value={draft.organisationId}
                    disabled={organisationQuery.isPending}
                    onChange={(e) => update('organisationId', e.target.value)}
                  >
                    <option value="">
                      {organisationQuery.isPending
                        ? 'Loading organisations…'
                        : 'Choose a verified organisation'}
                    </option>
                    {organisations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Maximum capacity" hint="Safe spaces for people">
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    required
                    value={draft.capacity}
                    onChange={(e) => update('capacity', e.target.value)}
                  />
                </Field>
                <Field label="Initial operational status">
                  <input value="Pending operational verification" readOnly />
                </Field>
                {organisationQuery.error && (
                  <ErrorState
                    error={organisationQuery.error}
                    retry={() => void organisationQuery.refetch()}
                  />
                )}
                {organisationQuery.isSuccess && !organisations.length && (
                  <Empty title="No verified operating organisations are assigned" />
                )}
              </div>
            )}
            {step === 1 && (
              <>
                <div className="form-grid">
                  <RegionField
                    countryCode={country}
                    hideDistrictSuffix
                    initialDivisionId={draft.divisionId}
                    onChange={(value) => update('divisionId', value)}
                  />
                  <div className="resource-location-search">
                    <Field label="Address">
                      <input
                        required
                        maxLength={500}
                        value={draft.address}
                        onChange={(e) => {
                          addressSearch.reset();
                          update('address', e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                          e.preventDefault();
                          searchAddress();
                        }}
                      />
                    </Field>
                    <Button type="button" variant="secondary" disabled={!canSearchAddress}
                      busy={addressSearch.isPending} onClick={searchAddress}>
                      {!addressSearch.isPending && <Search size={17} aria-hidden="true" />}
                      {t('searchLocation')}
                    </Button>
                  </div>
                  <Field label="Latitude">
                    <input
                      type="number"
                      required
                      step="any"
                      min={-90}
                      max={90}
                      value={draft.latitude}
                      onChange={(e) => {
                        addressSearch.reset();
                        update('latitude', e.target.value);
                      }}
                    />
                  </Field>
                  <Field label="Longitude">
                    <input
                      type="number"
                      required
                      step="any"
                      min={-180}
                      max={180}
                      value={draft.longitude}
                      onChange={(e) => {
                        addressSearch.reset();
                        update('longitude', e.target.value);
                      }}
                    />
                  </Field>
                </div>
                {divisions.error && (
                  <ErrorState error={divisions.error} retry={() => void divisions.refetch()} />
                )}
                {divisions.isPending ? (
                  <p role="status">Loading administrative regions…</p>
                ) : (
                  !division && <p className="muted">Select an administrative region to continue.</p>
                )}
                {addressQuery.length > 150 && (
                  <p className="muted">Use 150 characters or fewer to search for a location.</p>
                )}
                {addressSearch.isError && (
                  <p className="muted" role="status">
                    Location search is unavailable. Choose a point on the map or enter the coordinates.
                  </p>
                )}
                {addressSearch.isSuccess && (addressSearch.data.length === 0 ? (
                  <p className="muted" role="status">{t('locationNotFound')}</p>
                ) : (
                  <>
                    <p className="muted" role="status">{t('chooseLocationResult')}</p>
                    <ul className="resource-location-results">
                      {addressSearch.data.map((result, index) => (
                        <li key={index}>
                          <Button type="button" variant="secondary" onClick={() => selectLocation(result)}>
                            {result.properties.label}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                ))}
                <p className="muted">
                  <MapPin size={15} aria-hidden="true" /> You can also choose a point on the map or
                  enter its coordinates.
                </p>
                <MapView
                  point={hasPoint ? [Number(draft.latitude), Number(draft.longitude)] : undefined}
                  initialCenter={countryMapCenters[country]}
                  initialZoom={country === 'IN' ? 5 : 7}
                  height={245}
                  onPick={setLocation}
                  failureMessage="Map tiles are unavailable. Use search or enter the coordinates."
                />
              </>
            )}
            {step === 2 && (
              <>
                <fieldset className="shelter-facility-options">
                  <legend>Available facilities</legend>
                  {facilityOptions.map((facility) => (
                    <label className="shelter-chip" key={facility}>
                      <input
                        type="checkbox"
                        checked={draft.facilities.includes(facility)}
                        onChange={(e) =>
                          update(
                            'facilities',
                            e.target.checked
                              ? [...draft.facilities, facility]
                              : draft.facilities.filter((item) => item !== facility),
                          )
                        }
                      />
                      {facility}
                    </label>
                  ))}
                </fieldset>
                <Field
                  label="Additional facilities"
                  hint="Use commas to separate other facilities."
                >
                  <textarea
                    value={draft.additional}
                    maxLength={500}
                    onChange={(e) => update('additional', e.target.value)}
                  />
                </Field>
              </>
            )}
            {step === 3 && (
              <>
                <div className="shelter-review-grid">
                  <ReviewSection title="Basic information" edit={() => changeStep(0)}>
                    <dt>Shelter name</dt>
                    <dd>{draft.name.trim()}</dd>
                    <dt>Operating organisation</dt>
                    <dd>{organisation?.name ?? 'Select an organisation'}</dd>
                    <dt>Maximum capacity</dt>
                    <dd>{capacity.toLocaleString()} spaces</dd>
                    <dt>Proposed status</dt>
                    <dd>Pending operational verification</dd>
                  </ReviewSection>
                  <ReviewSection title="Location" edit={() => changeStep(1)}>
                    <dt>Country</dt>
                    <dd>
                      <AssignedCountry code={country} />
                    </dd>
                    <dt>Administrative region</dt>
                    <dd>{regionNames.join(' · ') || 'Select a region'}</dd>
                    <dt>Address</dt>
                    <dd>{draft.address.trim()}</dd>
                    <dt>Coordinates</dt>
                    <dd>
                      {draft.latitude}, {draft.longitude}
                    </dd>
                  </ReviewSection>
                  <ReviewSection title="Facilities & accessibility" edit={() => changeStep(2)}>
                    <dt>Facilities</dt>
                    <dd>{facilities.join(', ') || 'None recorded'}</dd>
                    <dt>Accessible entrance</dt>
                    <dd>{accessible ? 'Reported available' : 'Not recorded'}</dd>
                    <dt>Required information</dt>
                    <dd>
                      {basicValid && locationValid
                        ? 'Complete'
                        : 'Review basic information and location'}
                    </dd>
                  </ReviewSection>
                  <ReviewSection title="Operational readiness" edit={() => changeStep(0)}>
                    <dt>Registration</dt>
                    <dd>Ready to submit</dd>
                    <dt>Initial allocation availability</dt>
                    <dd>Closed to placements</dd>
                    <dt>Verification required</dt>
                    <dd>Confirm safe capacity, facilities and accessibility before opening.</dd>
                  </ReviewSection>
                </div>
                <label className="checkbox-label shelter-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={write.isPending}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I confirm that the shelter information is accurate.
                </label>
              </>
            )}
            {write.error && <ErrorState error={write.error} />}
            <div className="shelter-wizard-actions">
              {step > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={write.isPending}
                  onClick={() => changeStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                  Back to {steps[step - 1]}
                </Button>
              )}
              <Button disabled={!validSteps[step]} busy={write.isPending}>
                {step === 3 ? (
                  <>
                    <Check size={17} />
                    Register shelter
                  </>
                ) : (
                  <>
                    Continue to {steps[step + 1]}
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
        <aside className="stack">
          <Card>
            <h2>
              <ShieldCheck size={18} /> Registration checklist
            </h2>
            <dl className="shelter-assignments">
              <div>
                <dt>Operating organisation and safe limit</dt>
                <dd>{basicValid ? 'Complete' : 'Required'}</dd>
              </div>
              <div>
                <dt>Address, region and map location</dt>
                <dd>{locationValid ? 'Complete' : 'Required'}</dd>
              </div>
              <div>
                <dt>Facilities and accessibility</dt>
                <dd>{facilities.length ? 'Recorded' : 'Confirm on site'}</dd>
              </div>
            </dl>
            <p className="shelter-hint">
              After registration, use operational review to confirm the shelter can accept
              households.
            </p>
          </Card>
          <Card>
            <h2>
              <MapPin size={18} /> Assigned country
            </h2>
            <AssignedCountry code={country} />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  edit,
  children,
}: {
  title: string;
  edit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="shelter-review-section">
      <div className="inline spread">
        <h3>{title}</h3>
        <Button type="button" variant="secondary" onClick={edit} aria-label={`Edit ${title}`}>
          Edit
        </Button>
      </div>
      <dl>{children}</dl>
    </section>
  );
}
