/**
 * Rider KYC lifecycle. A rider cannot operate (accept jobs) until APPROVED,
 * and APPROVAL requires verified NIN + BVN (06-dispute-and-accountability §B1).
 */
export type KycStatus = 'UNSUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface KycInputs {
  ninVerified: boolean;
  bvnVerified: boolean;
  idDocUploaded: boolean;
  selfieMatched: boolean;
  addressProvided: boolean;
}

const TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = {
  UNSUBMITTED: ['PENDING'],
  PENDING: ['APPROVED', 'REJECTED'],
  REJECTED: ['PENDING'], // may resubmit
  APPROVED: [],
};

export function canKycTransition(from: KycStatus, to: KycStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Approval is only allowed when every identity requirement is satisfied. */
export function canApproveKyc(inputs: KycInputs): boolean {
  return (
    inputs.ninVerified &&
    inputs.bvnVerified &&
    inputs.idDocUploaded &&
    inputs.selfieMatched &&
    inputs.addressProvided
  );
}

export function riderCanOperate(status: KycStatus): boolean {
  return status === 'APPROVED';
}

export interface KycRecord { riderId: string; status: KycStatus; inputs: KycInputs }
