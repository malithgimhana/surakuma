export type Category =
  'FoodWater' | 'Medical' | 'Shelter' | 'Transportation' | 'Accessibility' | 'Other';
export type Priority = 'Low' | 'Normal' | 'High' | 'Critical';
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
  id: string;
  organisationId: string;
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
  name: string;
  type: string;
  district: string;
  active: boolean;
  latitude: number;
  longitude: number;
}
export interface Organisation extends Entity {
  name: string;
}
export interface Lookups {
  crises: Crisis[];
  organisations: Organisation[];
}
export interface AidRequest extends Entity {
  reference: string;
  citizenId: string;
  crisisId: string;
  organisationId: string;
  category: Category;
  priority: Priority;
  description: string;
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  householdSize: number;
  accessibilityNeeds: string;
  quantity: number;
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
  status: Status;
  note: string;
  actorId: string;
}
export interface Allocation extends Entity {
  requestId: string;
  resourceId: string;
  quantity: number;
  status: 'Reserved' | 'Dispatched' | 'Delivered' | 'Cancelled';
}
export interface Placement extends Entity {
  requestId: string;
  shelterId: string;
  people: number;
  status: 'Reserved' | 'CheckedIn' | 'Departed' | 'Cancelled';
}
export interface RequestDetail {
  feedback?: {
    id: string;
    rating: number;
    received: boolean;
    problem: boolean;
    comment: string;
    createdAt: string;
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
}
export interface Decision extends Entity {
  action: string;
  reason: string;
  actorId: string;
  finalPriority: Priority;
}
export interface Duplicate extends Entity {
  candidateId: string;
  similarity: number;
  state: string;
  reason: string;
}
export interface AiDetail {
  recommendations: Recommendation[];
  decisions: Decision[];
  duplicates: Duplicate[];
}
export interface Resource extends Entity {
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
export interface Shelter extends Entity {
  organisationId: string;
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
export interface Alert extends Entity {
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
  message: string;
  sinhalaMessage: string;
  tamilMessage: string;
  requestId: string | null;
  read: boolean;
}
export interface Volunteer extends Entity {
  userId: string;
  organisationId: string;
  skills: string;
  availability: string;
  verified: boolean;
  available: boolean;
}
export interface VolunteerTask extends Entity {
  requestId: string;
  volunteerId: string;
  title: string;
  requiredSkill: string;
  dueAt: string;
  status:
    'Assigned' | 'Accepted' | 'Declined' | 'InProgress' | 'AwaitingVerification' | 'Completed';
  note: string;
}
export interface VolunteerData {
  profiles: Volunteer[];
  tasks: VolunteerTask[];
}
export interface Metrics {
  openCases: number;
  resolvedCases: number;
  overdueCases: number;
  escalatedCases: number;
  averageResponseHours: number | null;
  shelterOccupancy: number;
  shelterReserved: number;
  shelterCapacity: number;
  resourceReserved: number;
  resourceStock: number;
  aiOverrideFrequency: number;
  byStatus: { status: string; count: number }[];
  shortages: {
    id: string;
    reference: string;
    priority: Priority;
    outstanding: number;
    category: Category;
  }[];
}
