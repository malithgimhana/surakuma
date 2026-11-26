export type Category =
  'FoodWater' | 'Medical' | 'Shelter' | 'Transportation' | 'Accessibility' | 'Other';
import type { CitizenIntake } from './CitizenIntakeFields';

export type Priority = 'Low' | 'Normal' | 'Medium' | 'High' | 'Urgent' | 'Critical';
export type Status =
  | 'Submitted'
  | 'UnderReview'
  | 'Verified'
  | 'Approved'
  | 'InProgress'
  | 'PartiallyFulfilled'
  | 'Fulfilled'
  | 'Closed'
  | 'Rejected'
  | 'Cancelled';
export interface Membership {
  depotId?: string | null;
  countryCode?: string;
  crisisId?: string | null;
  id: string;
  organisationId: string | null;
  role: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
  language: string;
  roles: string[];
  memberships: Membership[];
  householdSize: number;
  accessibilityNeeds: string;
}
export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface Crisis extends Entity {
  countryCode?: string;
  administrativeDivisionId?: string | null;
  name: string;
  type: string;
  district: string;
  active: boolean;
  primaryOrganisationId: string | null;
  latitude: number;
  longitude: number;
}
export interface Organisation extends Entity {
  name: string;
}
export interface Lookups {
  crises: { id: string; name: string }[];
  organisations: { id: string; name: string }[];
}
export interface AidRequest extends Entity {
  requiresCentreHandover?: boolean;
  requiresCoordinatorAuthorization?: boolean;
  authorizedAt?: string | null;
  reference: string;
  legacyReference?: string | null;
  citizenId: string;
  crisisId: string;
  organisationId: string | null;
  assignedCaseManagerId: string | null;
  requestedForSomeoneElse: boolean;
  requesterRelationship: string;
  requesterContact: string;
  category: Category;
  priority: Priority;
  intake?: Partial<CitizenIntake> | null;
  intakeScore?: number | null;
  priorityScore?: number | null;
  immediateDanger?: boolean;
  assessmentState?: 'Pending' | 'Completed' | 'Failed' | 'Skipped' | null;
  description: string;
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  householdSize: number;
  accessibilityNeeds: string;
  quantity: number;
  unit?: string | null;
  unitRequiresClarification?: boolean;
  administrativeDivisionId?: string | null;
  deliveredQuantity: number;
  status: Status;
  escalated: boolean;
  synthetic: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  pageNumber: number;
  pageSize: number;
}
export interface History extends Entity {
  status: Status | 'Escalated' | 'CoordinatorAuthorized';
  note: string;
  actorId: string;
}
export interface Allocation extends Entity {
  caseDispatchId?: string | null;
  packedAt?: string | null;
  confirmedQuantity?: number | null;
  requestQuantity?: number | null;
  unit?: string | null;
  requestId: string;
  resourceId: string;
  quantity: number;
  status: 'Reserved' | 'Dispatched' | 'Delivered' | 'Cancelled' | 'DeliveryException';
}
export interface Placement extends Entity {
  requestId: string;
  shelterId: string;
  shelterName?: string | null;
  people: number;
  status: 'Reserved' | 'CheckedIn' | 'Departed' | 'Cancelled';
}
export interface RequestDetail {
  hasStockShortage?: boolean | null;
  intakeFactors?: { factor: string; points: number }[] | null;
  items?: { id: string; name: string; category?: Category; unit: string; requiredQuantity: number; approvedQuantity: number; deliveredQuantity: number }[];
  administrativeRegion?: string | null;
  crisisName?: string | null;
  organisationName?: string | null;
  consolidations?: { originalId: string; originalReference: string; primaryId: string; primaryReference: string; createdAt: string }[];
  feedback?: {
    id: string;
    rating: number;
    received: boolean;
    problem: boolean;
    comment: string;
    createdAt: string;
    isSuperseded?: boolean;
  }[];
  request: AidRequest;
  history: History[];
  attachments: { id: string; originalName: string; size: number; contentType: string }[];
  allocations: Allocation[];
  placements: Placement[];
}
export interface Recommendation extends Entity {
  requestId: string;
  category: Category;
  priority: Priority;
  explanation: string;
  provider: string;
  model: string;
  fallback: boolean;
  confidence: number | null;
  confidenceKind: string;
  reviewState: string;
  signalsJson?: string | null;
  urgencyFactorsJson?: string | null;
  urgencyScore?: number | null;
}
export interface Decision extends Entity {
  recommendationId: string;
  action: string;
  reason: string;
  actorId: string;
  finalPriority: Priority;
  originalPriority?: Priority;
  originalConfidence?: number | null;
  originalConfidenceKind?: string;
  originalExplanation?: string;
}
export interface Duplicate extends Entity {
  candidateId: string;
  similarity: number;
  state: string;
  reason: string;
  model?: string | null;
}
export interface AiDetail {
  recommendations: Recommendation[];
  decisions: Decision[];
  duplicates: Duplicate[];
  processing?: { state: string; attempts: number; failureReason?: string | null } | null;
}
export interface Resource extends Entity {
  countryCode?: string;
  depotId?: string | null;
  organisationId: string;
  name: string;
  category: Category;
  unit: string;
  stock: number;
  reserved: number;
  available: number;
  locationText: string;
  latitude: number;
  longitude: number;
  suitability: string;
  transportAvailable: boolean;
}
export interface PublicShelter {
  id: string;
  updatedAt: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  capacity: number;
  reserved: number;
  occupancy: number;
  available: number;
  accessible: boolean;
  open: boolean;
  facilities: string;
}
export interface Shelter extends PublicShelter {
  countryCode?: string;
  administrativeDivisionId?: string | null;
  organisationId: string;
  createdAt: string;
  pendingVerification?: boolean;
  operationalUpdatedAt?: string | null;
}
export interface Alert extends Entity {
  popupDescription?: string | null;
  visualSummary?: string | null;
  visualKind?: 'flood' | 'storm' | 'landslide' | 'other' | null;
  visualImageUrl?: string | null;
  publishedAt?: string | null;
  translationsJson?: string;
  crisisId: string;
  title: string;
  message: string;
  sinhalaTitle: string;
  sinhalaMessage: string;
  tamilTitle: string;
  tamilMessage: string;
  severity: string;
  area: string;
  authority: string;
  expiresAt: string;
  published: boolean;
}
export interface Notification extends Entity {
  allocationId?: string | null;
  scopeRole?: string | null;
  scopeOrganisationId?: string | null;
  scopeCountryCode?: string | null;
  isInternal: boolean;
  crisisId: string | null;
  taskId: string | null;
  message: string;
  sinhalaMessage: string;
  tamilMessage: string;
  hindiMessage?: string | null;
  nepaliMessage?: string | null;
  communicationSource?: string | null;
  requestId: string | null;
  read: boolean;
}
export interface Volunteer extends Entity {
  taskRequestId?: string | null;
  taskDispatchId?: string | null;
  userId: string;
  organisationId: string;
  skills: string;
  availability: string;
  verified: boolean;
  available: boolean;
  countryCode?: string;
  serviceRegionId?: string | null;
}
export interface VolunteerTask extends Entity {
  caseDispatchId?: string | null;
  startsAt?: string;
  requestId: string;
  volunteerId: string;
  title: string;
  requiredSkill: string;
  instructions?: string;
  dueAt: string;
  status:
    'Assigned' | 'Accepted' | 'Declined' | 'InProgress' | 'AwaitingVerification' | 'Completed' | 'Returned';
  note: string;
}
export interface VolunteerData {
  profiles: Volunteer[];
  tasks: VolunteerTask[];
  names: Record<string, string>;
  history?: {
    id: string;
    taskId: string;
    actorId?: string;
    createdAt: string;
    action: string;
    workDescription: string;
    outcome: string;
    peopleAssisted: number | null;
    issues: string;
    note: string;
  }[];
}
export interface Metrics {
  stockByUnit?: { category: string; unit: string; stock: number; reserved: number }[];
  openCases: number;
  resolvedCases: number;
  overdueCases: number;
  escalatedCases: number;
  averageResponseHours: number | null;
  shelterOccupancy: number;
  shelterReserved: number;
  shelterCapacity: number;
  resourceReserved: number | null;
  resourceStock: number | null;
  resourceUnit?: string | null;
  aiOverrideFrequency: number;
  aiApprovedCount: number;
  aiModifiedCount: number;
  aiRejectedCount: number;
  aiDeferredCount: number;
  byStatus: { status: string; count: number }[];
  shortages: {
    id: string;
    reference: string;
    priority: Priority;
    outstanding: number;
    category: Category;
  }[];
}

export interface FulfilmentEvidence {
  algorithm: string;
  source: string;
  processingState: string;
  reviewState: string;
  needs: string[];
}
export interface AllocationRecommendations {
  outstanding: number; shortage: boolean; queuePosition: number; competingRequests: number; shortageExplanation: string;
  unit?: string | null; unitRequiresClarification?: boolean;
  evidence?: FulfilmentEvidence | null;
  candidates: { resourceId: string; name: string; unit: string; available: number; suggestedQuantity: number; score: number; distanceKm: number | null; transportAvailable: boolean; shortForRequest: boolean; reason: string; availableInRequestUnit: number; remainingAfterReservation: number }[];
}
