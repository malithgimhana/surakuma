import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from './api';
import { Button, categories, Field } from './components';
import vocabulary from './request-category-vocabulary.json';
import type { Category } from './types';

const category = z.enum(categories);
const categorySuggestion = z.object({
  options: z.array(category),
  recommendation: category.nullable(),
  source: z.enum(['OpenAI', 'Rules', 'NoMatch']),
  receipt: z.string().nullable(),
  model: z.string().nullish(),
});

function localSuggestion(description: string): z.infer<typeof categorySuggestion> {
  const text = description.normalize().toLowerCase();
  const matching = new Set(vocabulary.filter(entry => entry.terms.some(term => text.includes(term)))
    .map(entry => entry.category));
  const options = categories.filter(option => matching.has(option));
  return {
    options,
    recommendation: options.length === 1 ? options[0] : null,
    source: options.length ? 'Rules' : 'NoMatch',
    receipt: null,
  };
}

export function RequestCategoryHelp({ country, draftKey, description, onDescription, onReceipt, onChoose }: {
  country: string;
  draftKey: string;
  description: string;
  onDescription: (value: string) => void;
  onReceipt: (receipt: string | null) => void;
  onChoose: (category: Category) => void;
}) {
  const { t } = useTranslation();
  const currentText = useRef(description.trim());
  const request = useMutation({
    mutationFn: async (text: string) => {
      try {
        const response = await api.post<unknown>('/requests/category-suggestion', {
          description: text, countryCode: country, draftKey, useDescriptionWithAi: true,
        });
        const parsed = categorySuggestion.safeParse(response.data);
        if (parsed.success && parsed.data.source !== 'NoMatch') return parsed.data;
      } catch {
        // The form can still suggest a category when the API is unavailable.
      }
      return localSuggestion(text);
    },
  });
  const result = request.variables === description.trim() ? request.data : undefined;
  const recommendation = result?.recommendation;
  const options = result && (recommendation
    ? [recommendation, ...result.options.filter(option => option !== recommendation)]
    : result.options);
  return <details className="request-category-help">
    <summary><Sparkles aria-hidden="true" size={19} /> {t('requestCategoryHelp')}</summary>
    <div className="stack">
      <Field label={t('requestCategoryHelpDescribe')}>
        <textarea rows={3} maxLength={600} value={description} onChange={event => {
          currentText.current = event.target.value.trim();
          onDescription(event.target.value);
          onReceipt(null);
        }} />
      </Field>
      <div><Button type="button" variant="secondary" disabled={description.trim().length < 3} busy={request.isPending}
        onClick={event => {
          const disclosure = event.currentTarget.closest('details');
          onReceipt(null);
          request.mutate(description.trim(), {
            onSuccess: (suggestion, text) => {
              if (currentText.current === text && disclosure?.open) onReceipt(suggestion.receipt);
            },
          });
        }}>{t('requestCategoryHelpAsk')}</Button></div>
      {request.isPending && <small className="muted" role="status">{t('requestCategoryHelpLoading')}</small>}
      {request.isError && request.variables === description.trim() &&
        <p role="status">{t('requestCategoryHelpUnavailable')}</p>}
      {result && <div className="stack">
        <p role="status">{!options?.length ? t('requestCategoryHelpNoMatch') :
          recommendation ? t('requestCategoryHelpSuggested', { category: t('category.' + recommendation) }) :
            t('requestCategoryHelpMultiple')}</p>
        {!!options?.length && <>
          <small className="muted">
            {t(result.source === 'OpenAI' ? 'requestCategoryHelpAiSource' : 'requestCategoryHelpLocalSource')}
            {result.source === 'OpenAI' && result.model && <> · {result.model === 'gpt-6-luna' ? 'GPT-6 Luna' : result.model}</>}
          </small>
          <div className="button-row">
            {options.map(option => <Button type="button" variant={option === recommendation ? 'primary' : 'secondary'}
              onClick={() => {
                onReceipt(result.receipt);
                onChoose(option);
              }} key={option}>{t('requestCategoryHelpUse', { category: t('category.' + option) })}</Button>)}
          </div>
        </>}
      </div>}
    </div>
  </details>;
}
