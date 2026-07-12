// Pure, I/O-free catalogue of the documents a delivery rider must provide, plus the logic that
// decides which are required for a given vehicle track + city, and the overall onboarding status.
// Modelled on Uber/Bolt Nigeria (see docs/12-driver-onboarding-kyc.md).

export type VehicleTrack = 'BIKE' | 'CAR' | 'KEKE';
export type City = 'LAGOS' | 'ABUJA' | 'PORT_HARCOURT' | 'OTHER';

export type DocumentType =
  | 'PROFILE_PHOTO'
  | 'GOV_ID'
  | 'LICENSE'
  | 'ADDRESS_PROOF'
  | 'VEHICLE_REG'
  | 'PROOF_OF_OWNERSHIP'
  | 'ROADWORTHINESS'
  | 'INSURANCE'
  | 'VEHICLE_PHOTO'
  | 'GUARANTOR'
  | 'LASRRA'
  | 'LASDRI'
  | 'HACKNEY_PERMIT'
  | 'KEKE_PERMIT';

export interface DocumentSpec {
  type: DocumentType;
  label: string;
  tracks: 'ALL' | readonly VehicleTrack[];
  cities?: readonly City[];      // required only in these cities (omit = everywhere)
  requiresFlag?: 'guarantor';    // required only when the matching config flag is on
  expires: boolean;              // drives the expiry dashboard + auto-suspend (Phase C)
}

// The single source of truth. Adding/removing a requirement is a one-line change here.
export const DOCUMENT_SPECS: readonly DocumentSpec[] = [
  { type: 'PROFILE_PHOTO',     label: 'Profile photo',            tracks: 'ALL', expires: false },
  { type: 'GOV_ID',            label: 'Government ID (NIN/Passport)', tracks: 'ALL', expires: false },
  { type: 'LICENSE',           label: "Driver's/Rider's licence",  tracks: 'ALL', expires: true },
  { type: 'ADDRESS_PROOF',     label: 'Proof of address',          tracks: 'ALL', expires: false },
  { type: 'VEHICLE_REG',       label: 'Vehicle registration',      tracks: 'ALL', expires: true },
  { type: 'PROOF_OF_OWNERSHIP',label: 'Proof of ownership',        tracks: 'ALL', expires: false },
  { type: 'ROADWORTHINESS',    label: 'Roadworthiness certificate',tracks: 'ALL', expires: true },
  { type: 'INSURANCE',         label: 'Insurance certificate',     tracks: 'ALL', expires: true },
  { type: 'VEHICLE_PHOTO',     label: 'Vehicle photo (plate visible)', tracks: 'ALL', expires: false },
  { type: 'GUARANTOR',         label: 'Guarantor form',            tracks: 'ALL', requiresFlag: 'guarantor', expires: false },
  // Lagos-conditional layer:
  { type: 'LASRRA',            label: 'LASRRA card',               tracks: 'ALL',        cities: ['LAGOS'], expires: true },
  { type: 'LASDRI',            label: 'LASDRI card',               tracks: ['CAR'],      cities: ['LAGOS'], expires: true },
  { type: 'HACKNEY_PERMIT',    label: 'Hackney/commercial permit', tracks: ['CAR'],      cities: ['LAGOS'], expires: true },
  { type: 'KEKE_PERMIT',       label: 'Tricycle (LGA/union) permit', tracks: ['KEKE'],   cities: ['LAGOS'], expires: true },
] as const;

export interface CatalogContext {
  city: City;
  requireGuarantor: boolean;
}

function appliesToTrack(spec: DocumentSpec, track: VehicleTrack): boolean {
  return spec.tracks === 'ALL' || spec.tracks.includes(track);
}

/** The exact set of document types a rider on `track` must provide, given the city + flags. */
export function requiredDocuments(track: VehicleTrack, ctx: CatalogContext): DocumentType[] {
  return DOCUMENT_SPECS.filter((s) => {
    if (!appliesToTrack(s, track)) return false;
    if (s.cities && !s.cities.includes(ctx.city)) return false;
    if (s.requiresFlag === 'guarantor' && !ctx.requireGuarantor) return false;
    return true;
  }).map((s) => s.type);
}

export function specFor(type: DocumentType): DocumentSpec | undefined {
  return DOCUMENT_SPECS.find((s) => s.type === type);
}

// ---- Onboarding status ----

export type DocumentStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type DocumentStateOrMissing = DocumentStatus | 'MISSING';
export type OnboardingStatus = 'INCOMPLETE' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'EXPIRED';

/**
 * Roll the per-document states up into one onboarding status. Precedence (worst first) is
 * deliberate and fail-closed: a single expired/rejected/missing required document keeps the rider
 * out of APPROVED. Only when every required document is APPROVED does the rider qualify to operate.
 */
export function documentOnboardingStatus(
  required: readonly DocumentType[],
  stateByType: Readonly<Partial<Record<DocumentType, DocumentStateOrMissing>>>,
): OnboardingStatus {
  const states = required.map((t) => stateByType[t] ?? 'MISSING');
  if (states.some((s) => s === 'EXPIRED')) return 'EXPIRED';
  if (states.some((s) => s === 'REJECTED')) return 'ACTION_REQUIRED';
  if (states.some((s) => s === 'MISSING')) return 'INCOMPLETE';
  if (states.every((s) => s === 'APPROVED')) return 'APPROVED';
  return 'UNDER_REVIEW'; // all present, at least one still awaiting approval
}

/** Only a fully-approved document set lets a rider operate (mirrors riderCanOperate for KYC). */
export function documentsClearRider(status: OnboardingStatus): boolean {
  return status === 'APPROVED';
}
