const sections = ['overview', 'cases', 'users', 'organisations', 'integrations', 'activity', 'reports', 'alerts'] as const;
type AdminSection = (typeof sections)[number];

export function canViewAdminSection(section: AdminSection, globalAdmin: boolean) {
  return globalAdmin || (section !== 'integrations' && section !== 'activity');
}

export function getAdminSection(requested: string | null, globalAdmin: boolean): AdminSection {
  if (requested === 'approvals' && globalAdmin) return 'users';
  return sections.find((section) => section === requested && canViewAdminSection(section, globalAdmin)) ?? 'overview';
}
