import { AlertCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { Badge, Button, Card, ErrorState, Field, formatDate } from './components';
import { intakeLabel, IntakeSummary } from './CitizenIntakeFields';
import type { AiDetail, Priority, Recommendation, RequestDetail } from './types';

const factorLabels: Record<string, string> = {
  item: 'Requested item', time: 'Time until help is needed', people: 'People affected',
  youngOrPregnant: 'Infant, young child, or pregnancy', olderIllOrDisabled: 'Older, ill, or disabled person',
  cutOff: 'Cut off or without essential services',
};

export function AssessmentBadge({ state }: { state?: RequestDetail['request']['assessmentState'] }) {
  return state === 'Completed' ? <span className="badge green">Ready</span> :
    state === 'Failed' ? <span className="badge red">Unavailable</span> :
    state === 'Pending' ? <span className="badge gray">Pending</span> : <span aria-label="No recorded AI assessment">—</span>;
}

export function CitizenTriageCard({ detail, advice, canReview }: {
  detail: RequestDetail; advice?: AiDetail; canReview: boolean;
}) {
  const { t } = useTranslation();
  const request = detail.request;
  const recommendation = advice?.recommendations[0];
  const [summary, nextCheck] = (recommendation?.explanation ?? '').split('\nNext check: ');
  const waiting = request.priorityScore != null && request.intakeScore != null ? request.priorityScore - request.intakeScore : 0;
  return <Card className="cm-panel citizen-triage-card">
    <div className="inline spread">
      <h2>Triage recommendation</h2><Badge value={request.priority} />
    </div>
    {request.immediateDanger && <p className="field-error citizen-triage-danger"><AlertCircle size={17} aria-hidden="true" /> Immediate danger reported</p>}
    <div className="citizen-triage-score">
      <strong>{intakeLabel(request.category, request.intake) ?? t(`category.${request.category}`)}</strong>
      {request.priorityScore != null && <div>
        <strong>{request.priorityScore} points</strong>
        {waiting > 0 && <small>{request.intakeScore} at intake + {waiting} for waiting</small>}
      </div>}
    </div>
    <section className="citizen-triage-description" aria-label={t('citizenRequestDescription')}>
      <h3>{t('citizenRequestDescription')}</h3><p>{request.description}</p>
    </section>
    {request.assessmentState === 'Failed' ? <div className="citizen-triage-unavailable" role="status">
      <AlertCircle size={20} aria-hidden="true" /><div><strong>AI assessment unavailable</strong><p>Review the recorded needs and current priority. Failed assessments keep a priority of High or above.</p></div>
    </div> : summary && recommendation?.provider ? <section className="citizen-triage-assessment" aria-label="AI assessment">
      <h3><Sparkles size={20} aria-hidden="true" /> {recommendation.model === 'gpt-6-luna' ? 'GPT-6 Luna' : recommendation.model} assessment</h3>
      <p>{summary}</p>
      {nextCheck && <p><strong>Next check:</strong> {nextCheck}</p>}
      <p>{recommendation.confidence == null ? 'Confidence unavailable' :
        `${Math.round(recommendation.confidence * 100)}% · ${recommendation.confidenceKind}`}</p>
      <Badge value={recommendation.reviewState} />
      {canReview && ['Pending', 'Defer'].includes(recommendation.reviewState) &&
        <TriageDecision key={recommendation.id} recommendation={recommendation} priority={request.priority}
          immediateDanger={request.immediateDanger === true} />}
    </section> : <p className="muted" role="status">{request.assessmentState === 'Skipped' ? 'Case closed before AI assessment.' :
      request.assessmentState === 'Completed' ? 'Loading AI assessment…' : 'AI assessment pending'}</p>}
    <details>
      <summary>{detail.intakeFactors?.length ? 'View score breakdown' : 'View intake answers'}</summary>
      {detail.intakeFactors?.length ? <ul>
        {detail.intakeFactors.map(factor => <li key={factor.factor}>{factorLabels[factor.factor] ?? factor.factor} · {factor.points}</li>)}
        {waiting > 0 && <li>Waiting · +{waiting}</li>}
      </ul> : null}
      {request.intake && <dl className="review-grid"><IntakeSummary category={request.category} value={request.intake} /></dl>}
    </details>
    {!!advice?.decisions.length && <details>
      <summary>AI review history</summary>
      {advice.decisions.map(decision => <div key={decision.id}>
        <p><strong>{decision.action}</strong> · {formatDate(decision.createdAt)} · {decision.finalPriority}</p>
        {decision.originalExplanation && <p>{decision.originalExplanation}</p>}
        {decision.originalPriority && <p>Recorded priority {decision.originalPriority} · {decision.originalConfidence == null ?
          'Confidence unavailable' :
          `${Math.round(decision.originalConfidence * 100)}% · ${decision.originalConfidenceKind}`}</p>}
        <p>{decision.reason || 'No reason recorded.'}</p>
        <small>Reviewer {decision.actorId}</small>
      </div>)}
    </details>}
    {detail.history.length > 0 && <details id="ai-history">
      <summary>Decision history</summary>
      {detail.history.map(entry => <p key={entry.id}><strong>{t(`status.${entry.status}`, { defaultValue: entry.status })}</strong> · {formatDate(entry.createdAt)} · {entry.note}</p>)}
    </details>}
    {canReview && <a className="button primary" href="#case-actions">Review case</a>}
  </Card>;
}

function TriageDecision({ recommendation, priority, immediateDanger }: {
  recommendation: Recommendation; priority: Priority; immediateDanger: boolean;
}) {
  const client = useQueryClient();
  const [finalPriority, setFinalPriority] = useState(priority);
  const [reason, setReason] = useState('');
  const write = useMutation({
    mutationFn: (action: string) => api.post(`/requests/${recommendation.requestId}/decisions`, {
      recommendationId: recommendation.id, action, reason: reason.trim(),
      finalPriority: action === 'Modify' ? finalPriority : null,
    }),
    onSuccess: async () => {
      setReason('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['ai', recommendation.requestId] }),
        client.invalidateQueries({ queryKey: ['staff-case', recommendation.requestId] }),
        client.invalidateQueries({ queryKey: ['requests'] }),
      ]);
    },
  });
  return <div className="stack">
    <p className="muted">Review the assessment before taking a case action.</p>
    <div className="form-grid">
      <Field label="Final priority for modification">
        <select value={finalPriority} disabled={immediateDanger || priority === 'Critical'}
          onChange={event => setFinalPriority(event.target.value as Priority)}>
          {['Low', 'Normal', 'Medium', 'High', 'Urgent', 'Critical'].map(value => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Review reason">
        <input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} />
      </Field>
    </div>
    {write.error && <ErrorState error={write.error} />}
    <div className="button-row">
      {['Approve', 'Modify', 'Reject', 'Defer'].map(action => <Button key={action} type="button"
        variant={action === 'Approve' ? 'primary' : 'secondary'}
        busy={write.isPending && write.variables === action}
        disabled={write.isPending || recommendation.reviewState === 'Defer' && action === 'Defer' ||
          ['Modify', 'Reject'].includes(action) && !reason.trim()}
        onClick={() => write.mutate(action)}>{action} assessment</Button>)}
    </div>
  </div>;
}
