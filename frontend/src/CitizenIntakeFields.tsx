import { Fragment, useId } from 'react';
import { Link } from 'react-router-dom';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Field } from './components';
import { isMeasuredUnit, unitSymbol } from './quantity';
import { foodItems } from './supplyItems';
import type { Category } from './types';

export const maxSupplyItems = 4;
export const blankSupplyItem = { item: '', quantity: 1, unit: '' };
export const intakeSchema = z.object({
  need: z.string(), timing: z.string(), medicineName: z.string().max(100),
  danger: z.string(), safeTonight: z.string(), travelHelp: z.string(),
  vehicleSupport: z.string(), accessService: z.string(), destination: z.string().max(500),
  youngOrPregnant: z.boolean(), olderIllOrDisabled: z.boolean(), cutOff: z.boolean(),
  stepFree: z.boolean(), accessibleToilet: z.boolean(), caregiverSpace: z.boolean(),
  supplyItems: z.array(z.object({ item: z.string().max(120), quantity: z.number().min(0.01).max(100000),
    unit: z.string().max(32) })).max(maxSupplyItems),
});

export type CitizenIntake = z.infer<typeof intakeSchema>;

export const blankIntake: CitizenIntake = {
  need: '', timing: '', medicineName: '', danger: '', safeTonight: '', travelHelp: '',
  vehicleSupport: '', accessService: '', destination: '', youngOrPregnant: false,
  olderIllOrDisabled: false, cutOff: false, stepFree: false, accessibleToilet: false, caregiverSpace: false, supplyItems: [],
};

type StringKey = 'need' | 'timing' | 'medicineName' | 'danger' | 'safeTonight' | 'travelHelp' | 'vehicleSupport' | 'accessService';
type FlagKey = 'youngOrPregnant' | 'olderIllOrDisabled' | 'cutOff' | 'stepFree' | 'accessibleToilet' | 'caregiverSpace';
type Choices = Record<string, string>;
type Question = { key: StringKey; label: string; choices?: Choices; radio?: boolean };

const answers = { Yes: 'Yes', No: 'No', Unsure: 'Not sure' };
const supplyTimes = { Out: 'Already out', WithinSixHours: 'Within 6 hours', WithinDay: 'More than 6 hours, up to 24 hours',
  Later: 'More than 24 hours', Unsure: 'Not sure' };
const itemDeadlines = { ...supplyTimes, Out: 'Needed right now' };
const serviceTimes = { Now: 'Right now', WithinSixHours: 'Within 6 hours', Today: 'Today', Later: 'After today',
  NoDeadline: 'No fixed deadline', Unsure: 'Not sure' };
const medicalNeeds = { MedicineRefill: 'Medicine refill', MedicalCare: 'Help getting medical care', MedicalSupplies: 'Medical supplies' };
const flags: Record<FlagKey, string> = { youngOrPregnant: 'Infant, young child, or pregnancy',
  olderIllOrDisabled: 'Older, ill, or disabled person', cutOff: 'Cut off or without essential services',
  stepFree: 'Step-free entrance', accessibleToilet: 'Accessible toilet', caregiverSpace: 'Space for a caregiver' };

export function needsQuantity(category: Category, intake: Pick<CitizenIntake, 'need'>) {
  return category === 'FoodWater' || category === 'Medical' && intake.need === 'MedicalSupplies';
}

function questions(category: Category, need: string, supplyItems?: CitizenIntake['supplyItems']): Question[] {
  switch (category) {
    case 'FoodWater': return [
      ...(!supplyItems?.length ? [{ key: 'need', label: 'Which item do you need?', choices: foodItems } as Question] : []),
      (supplyItems?.length ?? 0) > 1
        ? { key: 'timing', label: 'When is the most urgent item needed?', choices: itemDeadlines }
        : need === 'Clothes' || need === 'Blankets'
        ? { key: 'timing', label: 'When do you need it?', choices: itemDeadlines }
        : { key: 'timing', label: 'When will it run out?', choices: supplyTimes },
    ];
    case 'Medical': return [
      { key: 'need', label: 'What medical help is needed?', choices: medicalNeeds },
      ...(need === 'MedicineRefill' ? [
        { key: 'medicineName', label: 'Medicine name (if known)' },
        { key: 'timing', label: 'When will it run out?', choices: supplyTimes },
      ] as Question[] : [{ key: 'timing', label: 'When do you need medical help?', choices: serviceTimes } as Question]),
      { key: 'danger', label: 'Is anyone in immediate danger?', choices: answers, radio: true },
    ];
    case 'Shelter': return [
      { key: 'safeTonight', label: 'Do you have a safe place to stay tonight?', choices: answers },
      { key: 'travelHelp', label: 'Do you need help getting there?', choices: answers, radio: true },
    ];
    case 'Transportation': return [
      { key: 'need', label: 'Where do you need to go?', choices: { SafePlace: 'To a safe place', MedicalVisit: 'To a medical visit', EssentialService: 'To an essential service', Other: 'Somewhere else' } },
      { key: 'timing', label: 'When do you need to leave?', choices: serviceTimes },
      { key: 'vehicleSupport', label: 'What vehicle support do you need?', choices: { None: 'No specific vehicle needs', Wheelchair: 'Space for a wheelchair', BoardingHelp: 'Help getting in or out', Unsure: 'Not sure' } },
    ];
    case 'Accessibility': return [
      { key: 'need', label: 'What support do you need?', choices: { SignLanguage: 'Sign language interpretation', Mobility: 'Mobility equipment', StepFreeAccess: 'Step-free access', Communication: 'Communication support', Other: 'Other support' } },
      { key: 'accessService', label: 'Which service do you need to access?', choices: { Registration: 'Relief registration', Distribution: 'Aid distribution', Shelter: 'Shelter', Healthcare: 'Healthcare', Other: 'Another service' } },
      { key: 'timing', label: 'When do you need this support?', choices: serviceTimes },
    ];
    case 'Other': return [{ key: 'timing', label: 'When do you need help?', choices: serviceTimes }];
  }
}

const flagGroup = (category: Category): { title: string; keys: FlagKey[] } | undefined => category === 'FoodWater'
  ? { title: 'Does any of this apply?', keys: ['youngOrPregnant', 'olderIllOrDisabled', 'cutOff'] }
  : category === 'Shelter' ? { title: 'What does the shelter need?', keys: ['stepFree', 'accessibleToilet', 'caregiverSpace'] } : undefined;

export function validateIntake(category: Category, intake: CitizenIntake, ctx: z.RefinementCtx) {
  for (const question of questions(category, intake.supplyItems[0]?.item || intake.need, intake.supplyItems)) {
    if (question.choices && !Object.hasOwn(question.choices, intake[question.key]))
      ctx.addIssue({ code: 'custom', path: ['intake', question.key], message: 'Select an option.' });
  }
  if (!needsQuantity(category, intake)) return;
  const listed = new Set<string>();
  if (!intake.supplyItems.length) {
    ctx.addIssue({ code: 'custom', path: ['intake', 'supplyItems'], message: 'Add an item.' });
  }
  intake.supplyItems.forEach((line, index) => {
    const path = ['intake', 'supplyItems', index];
    const name = line.item.trim().toLowerCase();
    if (!name || (category === 'FoodWater' && !Object.hasOwn(foodItems, line.item)) || listed.has(name))
      ctx.addIssue({ code: 'custom', path: [...path, 'item'], message: 'Enter a different item.' });
    listed.add(name);
    if (!line.unit) ctx.addIssue({ code: 'custom', path: [...path, 'unit'], message: 'Select a unit.' });
    if (line.quantity !== Number(line.quantity.toFixed(isMeasuredUnit(line.unit) ? 2 : 0)))
      ctx.addIssue({ code: 'custom', path: [...path, 'quantity'], message: 'Enter a valid quantity for the selected unit.' });
  });
}

export const peopleLabels: Record<Category, string> = {
  FoodWater: 'How many people need it?', Medical: 'How many people need help?', Shelter: 'How many people need shelter?',
  Transportation: 'How many people need a ride?', Accessibility: 'How many people need support?', Other: 'How many people need help?',
};

export const descriptionLabels: Partial<Record<Category, string>> = {
  Shelter: 'Describe your situation', Accessibility: 'Describe what would help', Other: 'What do you need help with?',
};

type IntakeRegister = (name: `intake.${keyof CitizenIntake}`) => UseFormRegisterReturn;

export function CitizenIntakeFields({ category, value, renderField, people, supplies, flagControls }: {
  category: Category;
  value: CitizenIntake;
  renderField: (question: Question) => React.ReactNode;
  people: React.ReactNode;
  supplies: React.ReactNode;
  flagControls: React.ReactNode;
}) {
  const fields = questions(category, value.supplyItems[0]?.item || value.need, value.supplyItems);
  const { t } = useTranslation();
  const grid = fields.filter(question => !question.radio);
  const radios = fields.filter(question => question.radio);
  const peoplePosition = category === 'Medical' ? 1 : category === 'Transportation' ? 2 : grid.length;
  return <>
    {category === 'FoodWater' && supplies}
    <div className="form-grid citizen-intake-grid">
      {grid.slice(0, peoplePosition).map(question => <Fragment key={question.key}>{renderField(question)}</Fragment>)}
      {people}
      {grid.slice(peoplePosition).map(question => <Fragment key={question.key}>{renderField(question)}</Fragment>)}
    </div>
    {category === 'Medical' && supplies}
    {flagControls}
    {radios.map(question => <Fragment key={question.key}>{renderField(question)}</Fragment>)}
    {category === 'Medical' && value.danger === 'Yes' && (
      <div className="citizen-danger-notice" role="alert">
        <strong>{t('intake.immediateDanger')}</strong>
        <Link to="/contact" target="_blank" rel="noopener noreferrer">{t('intake.openEmergencyContacts')}</Link>
      </div>
    )}
  </>;
}

export function IntakeQuestion({ question, register, error, onNeedChange }: {
  question: Question;
  register: IntakeRegister;
  error?: string;
  onNeedChange?: (need: string) => void;
}) {
  const { t } = useTranslation();
  const { key, choices, radio, label } = question;
  const input = register(`intake.${key}`);
  const errorId = useId();
  const title = t(`intake.${label}`, { defaultValue: label });
  if (radio) return <fieldset className="citizen-intake-options">
    <legend>{title}</legend>
    <div className="citizen-intake-choices">
      {Object.entries(choices ?? {}).map(([code, text]) => <label key={code} className="checkbox-label">
        <input type="radio" value={code} aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined} {...input} />{t(`intake.${text}`, { defaultValue: text })}
      </label>)}
    </div>
    {error && <p className="field-error" role="alert" id={errorId}>{error}</p>}
  </fieldset>;
  return <Field label={title} error={error}>
    {choices ? <select {...input} onChange={event => {
      void input.onChange(event);
      if (key === 'need') onNeedChange?.(event.target.value);
    }}>
      <option value="">{t('selectOption')}</option>
      {Object.entries(choices).map(([code, text]) => <option key={code} value={code}>{t(`intake.${text}`, { defaultValue: text })}</option>)}
    </select> : <input maxLength={100} {...input} />}
  </Field>;
}

export function IntakeFlags({ category, register }: {
  category: Category; register: IntakeRegister;
}) {
  const { t } = useTranslation();
  const group = flagGroup(category);
  if (!group) return null;
  return <fieldset className="citizen-intake-options">
    <legend>{t(`intake.flags.${category}`, { defaultValue: group.title })}</legend>
    <div className="citizen-intake-choices">
      {group.keys.map(key => <label className="checkbox-label" key={key}>
        <input type="checkbox" {...register(`intake.${key}`)} />{t(`intake.flag.${key}`, { defaultValue: flags[key] })}
      </label>)}
    </div>
  </fieldset>;
}

export function intakeLabel(category: Category, intake?: Partial<CitizenIntake> | null) {
  if ((intake?.supplyItems?.length ?? 0) > 1) return undefined;
  const need = intake?.need;
  const entry = questions(category, need ?? '').find(question => question.key === 'need');
  return need ? entry?.choices?.[need] : undefined;
}

export function IntakeSummary({ category, value }: { category: Category; value: Partial<CitizenIntake> }) {
  const { t } = useTranslation();
  const selectedFlags = (flagGroup(category)?.keys ?? []).filter(key => value[key]);
  return <>
    {Boolean(value.supplyItems?.length) && <><dt>{t('intake.requestedItems')}</dt>
      <dd><ul className="citizen-requested-items">{value.supplyItems?.map(({ item, quantity, unit }) => {
        const label = category === 'FoodWater' ? foodItems[item] : undefined;
        return <li key={item}>{label ? t(`intake.${label}`) : item} · {quantity} {unitSymbol(unit)}</li>;
      })}</ul></dd></>}
    {questions(category, value.supplyItems?.[0]?.item || value.need || '', value.supplyItems).map(({ key, label, choices }) => {
      const answer = value[key];
      if (!answer) return null;
      return <Fragment key={key}>
        <dt>{t(`intake.${label}`, { defaultValue: label })}</dt>
        <dd>{choices?.[answer] ? t(`intake.${choices[answer]}`, { defaultValue: choices[answer] }) : answer}</dd>
      </Fragment>;
    })}
    {selectedFlags.length > 0 && <><dt>{t('intake.reportedCircumstances', { defaultValue: 'Reported circumstances' })}</dt>
      <dd>{selectedFlags.map(key => t(`intake.flag.${key}`, { defaultValue: flags[key] })).join(', ')}</dd></>}
    {category === 'Transportation' && value.destination && <><dt>{t('intake.destination', { defaultValue: 'Destination' })}</dt><dd>{value.destination}</dd></>}
  </>;
}
