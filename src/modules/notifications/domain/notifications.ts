export type JobStage =
  | 'ACCEPTED' | 'EN_ROUTE_PICKUP' | 'PICKED_UP' | 'EN_ROUTE_DROP'
  | 'ARRIVED' | 'COMPLETED' | 'REFUNDED';

const MESSAGES: Readonly<Record<JobStage, string>> = {
  ACCEPTED: 'A rider accepted your job.',
  EN_ROUTE_PICKUP: 'Your rider is heading to pickup.',
  PICKED_UP: 'Your package has been picked up.',
  EN_ROUTE_DROP: 'Your rider is on the way to the drop-off.',
  ARRIVED: 'Your rider has arrived. Share your delivery code only when you have the item.',
  COMPLETED: 'Delivered. Payment released to the rider.',
  REFUNDED: 'Your payment has been refunded.',
};

export function stageMessage(stage: JobStage): string {
  return MESSAGES[stage];
}

/** Idempotency key so a stage is notified exactly once even if the trigger fires twice. */
export function notificationKey(jobId: string, stage: JobStage): string {
  return `notify:${jobId}:${stage}`;
}

export function decideNotification(alreadySent: boolean): 'send' | 'skip' {
  return alreadySent ? 'skip' : 'send';
}

/** Prefer push; fall back to SMS when push isn't available. */
export function chooseChannel(pushAvailable: boolean): 'push' | 'sms' {
  return pushAvailable ? 'push' : 'sms';
}
