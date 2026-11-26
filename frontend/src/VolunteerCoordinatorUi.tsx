import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileCheck2,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from './components';
import type { VolunteerMetric, VolunteerWorkspaceData } from './volunteerWorkspace';
import { coordinationPath } from './volunteerWorkspace';
import './volunteer-workspace.css';

const metrics = {
  verified: {
    label: 'Verified volunteers',
    icon: ShieldCheck,
    tone: 'green',
    href: coordinationPath('directory', { verification: 'verified' }),
  },
  available: {
    label: 'Available verified volunteers',
    icon: Users,
    tone: 'green',
    href: coordinationPath('directory', { availability: 'available', verification: 'verified' }),
  },
  open: {
    label: 'Open assignments',
    icon: ClipboardList,
    tone: 'blue',
    href: coordinationPath('deployments', { status: 'open' }),
  },
  deployments: {
    label: 'Active deployments',
    icon: Radio,
    tone: 'blue',
    href: coordinationPath('deployments'),
  },
  reports: {
    label: 'Reports awaiting verification',
    icon: FileCheck2,
    tone: 'amber',
    href: coordinationPath('reports'),
  },
  overdue: {
    label: 'Overdue tasks',
    icon: Clock3,
    tone: 'red',
    href: coordinationPath('deployments', { status: 'overdue' }),
  },
} satisfies Record<
  VolunteerMetric,
  { label: string; icon: typeof Users; tone: string; href: string }
>;

export function VolunteerMetrics({
  data,
  keys = Object.keys(metrics) as VolunteerMetric[],
}: {
  data: VolunteerWorkspaceData;
  keys?: VolunteerMetric[];
}) {
  return (
    <div className={`vc-metrics ${keys.length === 4 ? 'vc-metrics-short' : ''}`}>
      {keys.map((key) => {
        const { label, icon: Icon, tone, href } = metrics[key];
        return (
          <Link key={key} to={href} className="vc-metric" data-tone={tone}>
            <span className="vc-metric-icon">
              <Icon size={19} aria-hidden="true" />
            </span>
            <span className="vc-metric-content">
              <strong>{data.metrics[key].toLocaleString()}</strong>
              <span>{label}</span>
            </span>
            <ArrowRight className="vc-metric-arrow" size={15} aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

export function VolunteerPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="vc-panel">
      <div className="vc-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function VolunteerPill({
  children,
  tone = 'blue',
}: {
  children: ReactNode;
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'neutral';
}) {
  return (
    <span className="vc-pill" data-tone={tone}>
      {children}
    </span>
  );
}

export function VolunteerTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap vc-table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table aria-label={label} className="vc-table">
        {children}
      </table>
    </div>
  );
}

export function useVolunteerPagination<T>(rows: T[], size = 10) {
  const [storedPage, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(storedPage, pages);
  const offset = (page - 1) * size;
  const pagination = rows.length > 0 && (
    <div className="vc-pagination">
      <span>
        {offset + 1}–{Math.min(offset + size, rows.length)} of {rows.length}
      </span>
      {pages > 1 && (
        <div>
          <Button
            type="button"
            variant="secondary"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            type="button"
            variant="secondary"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      )}
    </div>
  );
  return { rows: rows.slice(offset, offset + size), pagination, reset: () => setPage(1) };
}
