/**
 * Pure support-chat domain. No framework, no I/O — the bot script, the escalation SLA and the
 * flow-completion rule live here so they can be unit-tested in isolation and can't drift.
 *
 * The bot is a tiny scripted funnel: for each complaint category we ask one or two canned
 * multiple-choice clarifying questions (the user taps an option), then a final free-text
 * "describe your issue" step. When the free-text step is answered the flow is complete and the
 * thread escalates to a human agent under a 30-minute SLA.
 */

export type SupportCategory =
  | 'PAYMENT'
  | 'DELIVERY_ISSUE'
  | 'CONDUCT'
  | 'ACCOUNT'
  | 'APP_ISSUE'
  | 'OTHER';

export type SupportStatus = 'BOT' | 'AWAITING_AGENT' | 'AGENT_JOINED' | 'RESOLVED';

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  'PAYMENT', 'DELIVERY_ISSUE', 'CONDUCT', 'ACCOUNT', 'APP_ISSUE', 'OTHER',
];

export function isSupportCategory(v: unknown): v is SupportCategory {
  return typeof v === 'string' && (SUPPORT_CATEGORIES as readonly string[]).includes(v);
}

/**
 * A single scripted step. `kind: 'choice'` shows tap options; `kind: 'freetext'` invites the user to
 * type their issue and is always the last step (answering it completes the flow).
 */
export interface BotStep {
  kind: 'choice' | 'freetext';
  prompt: string;
  options?: readonly string[];
}

/**
 * The guided script per category: zero-based, the clarifying tap questions first, then the closing
 * free-text step. Copy is short and Nigerian-friendly (plain, warm, no jargon).
 */
const SCRIPTS: Readonly<Record<SupportCategory, readonly BotStep[]>> = {
  PAYMENT: [
    {
      kind: 'choice',
      prompt: 'Sorry about the wahala with payment. Which one is it?',
      options: ['I was charged but no delivery', 'Money removed twice', 'Refund never came', 'Wallet or payout issue'],
    },
    {
      kind: 'freetext',
      prompt: 'Got it. Please tell us exactly what happened — amount, date and anything else that can help us sort it fast.',
    },
  ],
  DELIVERY_ISSUE: [
    {
      kind: 'choice',
      prompt: 'Let’s look into your delivery. What went wrong?',
      options: ['Rider never showed up', 'Item arrived damaged', 'Wrong or missing item', 'Delivered to wrong place'],
    },
    {
      kind: 'choice',
      prompt: 'Thanks. Where is the delivery now?',
      options: ['Still not delivered', 'Already delivered', 'I’m not sure'],
    },
    {
      kind: 'freetext',
      prompt: 'Please describe the issue in your own words so an agent can help you quickly.',
    },
  ],
  CONDUCT: [
    {
      kind: 'choice',
      prompt: 'We take this serious. Who is the complaint about?',
      options: ['The rider', 'The customer', 'A recipient', 'Someone else'],
    },
    {
      kind: 'freetext',
      prompt: 'Please tell us what happened. Share as much detail as you can — we’ll review it carefully.',
    },
  ],
  ACCOUNT: [
    {
      kind: 'choice',
      prompt: 'Let’s sort your account. What do you need help with?',
      options: ['Can’t log in', 'Verification (KYC) issue', 'Change my details', 'Delete my account'],
    },
    {
      kind: 'freetext',
      prompt: 'Please describe the problem so we can help you get back on track.',
    },
  ],
  APP_ISSUE: [
    {
      kind: 'choice',
      prompt: 'Sorry the app is misbehaving. What are you seeing?',
      options: ['App keeps crashing', 'A screen is stuck', 'Something is not loading', 'Other bug'],
    },
    {
      kind: 'freetext',
      prompt: 'Please describe the problem — and if you can, tell us your phone model. It helps us fix it.',
    },
  ],
  OTHER: [
    {
      kind: 'freetext',
      prompt: 'No problem — tell us how we can help and an agent will get back to you.',
    },
  ],
};

/** The bot's very first message when a thread opens for a category. */
export function botOpeningPrompt(category: SupportCategory): string {
  const steps = SCRIPTS[category];
  return steps[0]!.prompt;
}

/**
 * The tap options a user can pick at a given step (empty for the free-text step or past the end).
 * `step` is zero-based and refers to the step the user is currently answering.
 */
export function botFollowUps(category: SupportCategory, step: number): readonly string[] {
  const s = SCRIPTS[category][step];
  return s && s.kind === 'choice' && s.options ? s.options : [];
}

/** The full step at an index, or undefined past the end. */
export function botStep(category: SupportCategory, step: number): BotStep | undefined {
  return SCRIPTS[category][step];
}

/** How many scripted steps a category has. */
export function scriptLength(category: SupportCategory): number {
  return SCRIPTS[category].length;
}

/**
 * True once the user has answered every scripted step — i.e. the next step index has reached the end
 * of the script. At that point there is nothing more for the bot to ask and the thread escalates.
 */
export function isFlowComplete(category: SupportCategory, nextStep: number): boolean {
  return nextStep >= SCRIPTS[category].length;
}

/** How long a human agent has to join once a thread is waiting: 30 minutes. */
export const AGENT_JOIN_SLA_MS = 30 * 60_000;

/** The subset of thread fields escalation reads and rewrites (kept structural so it's easy to test). */
export interface EscalatableThread {
  status: SupportStatus;
  agentJoinDeadline?: number;
}

/**
 * Move a thread to AWAITING_AGENT and stamp the 30-minute join deadline. Pure: returns a new object,
 * never mutates the input.
 */
export function escalate<T extends EscalatableThread>(thread: T, nowMs: number): T {
  return { ...thread, status: 'AWAITING_AGENT', agentJoinDeadline: nowMs + AGENT_JOIN_SLA_MS };
}
