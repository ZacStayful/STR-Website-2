'use client';

import { useActionState, useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import {
  cancelPauseAction,
  cancelSubscriptionAction,
  keepSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
} from './actions';
import { CANCEL_REASONS, IDLE, type BillingState, type PlanView } from './plan-view';

const CARD = 'rounded-2xl border border-[#e4e7dc] bg-white p-5';
const PRIMARY =
  'rounded-full bg-[#5d8156] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#4c6b46] disabled:opacity-60';
const SECONDARY =
  'rounded-full border border-[#e4e7dc] bg-white px-5 py-2 text-sm font-semibold text-[#2e3d2b] transition hover:bg-[#f1f3ec] disabled:opacity-60';
const QUIET = 'text-sm text-[#7a8274] underline underline-offset-2 hover:text-[#2e3d2b]';

export function ManagePlan({ view }: { view: PlanView }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [notice, setNotice] = useState<BillingState>(IDLE);
  // Bumped every time a dialog is opened. Used as a key so the dialog
  // remounts, which resets its step and its previous action result — cheaper
  // and less surprising than clearing that state from an effect.
  const [opened, setOpened] = useState(0);

  const open = (which: 'cancel' | 'pause') => {
    setNotice(IDLE);
    setOpened((n) => n + 1);
    if (which === 'cancel') setCancelOpen(true);
    else setPauseOpen(true);
  };

  return (
    <section className={`mt-6 ${CARD}`}>
      <h2 className="text-base font-semibold">Your plan</h2>
      <PlanSummary view={view} />

      {notice.success && (
        <p className="mt-3 rounded-lg bg-[#eef3ea] px-3 py-2 text-sm text-[#3f5c3a]">{notice.success}</p>
      )}
      {notice.error && (
        <p className="mt-3 rounded-lg bg-[#fbeceb] px-3 py-2 text-sm text-[#b3261e]">{notice.error}</p>
      )}

      <PlanActions
        view={view}
        onCancel={() => open('cancel')}
        onPause={() => open('pause')}
        onResult={setNotice}
      />

      <PauseDialog
        key={`pause-${opened}`}
        view={view}
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        onResult={setNotice}
      />
      <CancelDialog
        key={`cancel-${opened}`}
        view={view}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onResult={setNotice}
      />
    </section>
  );
}

function PlanSummary({ view }: { view: PlanView }) {
  const line = (main: string, sub?: string | null) => (
    <>
      <p className="mt-2 text-sm">{main}</p>
      {sub && <p className="mt-1 text-sm text-[#7a8274]">{sub}</p>}
    </>
  );

  if (view.managedByUs) {
    return line(
      `${view.planLabel ?? 'Stayful subscription'} — managed by our team.`,
      'Your subscription was set up by hand, so changes go through us rather than this page.',
    );
  }

  switch (view.status) {
    case 'paused':
      return line(
        view.pausedUntil ? `Paused until ${view.pausedUntil}.` : 'Your plan is paused.',
        "You're not being charged and no plan credit arrives until then. Any credit you already have still works, and everything you have saved is untouched.",
      );
    case 'paid':
    case 'subscription_trial':
      if (view.cancelScheduled) {
        return line(
          view.endsOn ? `Your plan ends on ${view.endsOn}.` : 'Your plan is ending.',
          "Your plan credit is yours until then, and nothing more will be charged. Top-up credit never expires.",
        );
      }
      if (view.pauseScheduled) {
        return line(
          view.pausesOn && view.pausedUntil
            ? `Paused from ${view.pausesOn} until ${view.pausedUntil}.`
            : 'A pause is booked.',
          'Nothing changes before then — you keep the credit you have already paid for.',
        );
      }
      return line(
        `${view.planLabel ?? 'Stayful subscription'}.`,
        view.renewsOn ? `Renews on ${view.renewsOn}, when your next month of plan credit arrives.` : null,
      );
    case 'free':
      return line(
        'Pay as you go.',
        "You're using welcome and top-up credit. Subscribe for monthly credit at the standard rate — top-up credit is spent at 1.5× that rate.",
      );
    case 'lapsed':
      return line('No active subscription.', 'Any credit you have left still works. Re-subscribe for monthly credit at the standard rate.');
  }
}

function PlanActions({
  view,
  onCancel,
  onPause,
  onResult,
}: {
  view: PlanView;
  onCancel: () => void;
  onPause: () => void;
  onResult: (state: BillingState) => void;
}) {
  if (view.managedByUs) {
    return (
      <div className="mt-4">
        <a href={view.contactHref} className={SECONDARY}>Email us about my plan</a>
      </div>
    );
  }

  if (view.status === 'free' || view.status === 'lapsed') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={view.checkoutHref} className={PRIMARY}>
          {view.status === 'lapsed' ? 'Re-subscribe' : 'Choose a plan'}
        </a>
        <a href="/account/billing#topup" className={QUIET}>Top up instead</a>
      </div>
    );
  }

  if (view.status === 'paused') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton action={resumeSubscriptionAction} className={PRIMARY} onResult={onResult}>
          Resume now
        </SubmitButton>
        <button type="button" onClick={onCancel} className={QUIET}>Cancel my plan</button>
      </div>
    );
  }

  if (view.cancelScheduled) {
    return (
      <div className="mt-4">
        <SubmitButton action={keepSubscriptionAction} className={PRIMARY} onResult={onResult}>
          Keep my plan
        </SubmitButton>
      </div>
    );
  }

  if (view.pauseScheduled) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton action={cancelPauseAction} className={SECONDARY} onResult={onResult}>
          Call off the pause
        </SubmitButton>
        {/* Deciding to leave outright is a normal thing to do after booking a
            pause, so it must not be a dead end. Cancelling lifts the pause so
            the end date lands on a real period end. */}
        <button type="button" onClick={onCancel} className={QUIET}>Cancel my plan</button>
      </div>
    );
  }

  // Active, nothing booked.
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onPause} className={SECONDARY}>Pause my plan</button>
      <button type="button" onClick={onCancel} className={QUIET}>Cancel my plan</button>
    </div>
  );
}

/** A one-click server action with pending state, reported back to the card. */
function SubmitButton({
  action,
  className,
  onResult,
  children,
}: {
  action: () => Promise<BillingState>;
  className: string;
  onResult: (state: BillingState) => void;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(async () => action(), IDLE);

  useEffect(() => {
    if (state.success || state.error) onResult(state);
  }, [state, onResult]);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className={className}>
        {pending ? 'Working…' : children}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------

function Shell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white text-[#2e3d2b] shadow-xl transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
          <div className="flex items-start justify-between gap-4 border-b border-[#e4e7dc] px-5 py-4">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-[#7a8274] transition-colors hover:bg-[#f1f3ec] hover:text-[#2e3d2b]" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="px-5 py-5">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PauseChoices({
  view,
  reason,
  comment,
  formAction,
  pending,
}: {
  view: PlanView;
  reason?: string;
  comment?: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  if (view.pauseChoices.length === 0) {
    return (
      <p className="text-sm text-[#b3261e]">
        We couldn&apos;t work out your renewal date, so we can&apos;t pause the plan from here.{' '}
        <a href={view.contactHref} className="underline">Email us</a> and we&apos;ll do it for you.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {view.pauseChoices.map(({ months, until }) => (
        <form key={months} action={formAction}>
          <input type="hidden" name="months" value={months} />
          {reason && <input type="hidden" name="reason" value={reason} />}
          {comment && <input type="hidden" name="comment" value={comment} />}
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-between rounded-xl border border-[#e4e7dc] px-4 py-3 text-left transition hover:border-[#5d8156] hover:bg-[#f7f8f4] disabled:opacity-60"
          >
            <span className="text-sm font-semibold">
              {months} month{months > 1 ? 's' : ''}
            </span>
            <span className="text-xs text-[#7a8274]">back on {until}</span>
          </button>
        </form>
      ))}
    </div>
  );
}

function PauseExplainer({ view }: { view: PlanView }) {
  return (
    <p className="mt-4 text-xs text-[#7a8274]">
      {view.pauseFrom
        ? `Nothing changes before ${view.pauseFrom} — you keep the credit you have already paid for. After that you won't be charged and no new plan credit arrives, then everything starts again by itself on the date you pick.`
        : "You won't be charged while your plan is paused, and it starts again by itself on the date you pick."}{' '}
      Your saved reports, watchlist and deal pipeline stay exactly as they are.
    </p>
  );
}

function PauseDialog({
  view,
  open,
  onOpenChange,
  onResult,
}: {
  view: PlanView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (state: BillingState) => void;
}) {
  const [state, formAction, pending] = useActionState(pauseSubscriptionAction, IDLE);

  useEffect(() => {
    if (state.success) {
      onResult(state);
      onOpenChange(false);
    }
  }, [state, onResult, onOpenChange]);

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Pause your plan">
      <p className="mb-4 text-sm text-[#7a8274]">How long would you like to pause for?</p>
      <PauseChoices view={view} formAction={formAction} pending={pending} />
      {state.error && <p className="mt-3 text-sm text-[#b3261e]">{state.error}</p>}
      <PauseExplainer view={view} />
    </Shell>
  );
}

type Step = 'reason' | 'offer' | 'confirm';

function CancelDialog({
  view,
  open,
  onOpenChange,
  onResult,
}: {
  view: PlanView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (state: BillingState) => void;
}) {
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<string>('');
  const [comment, setComment] = useState('');

  const [cancelState, cancelAction, cancelling] = useActionState(cancelSubscriptionAction, IDLE);
  const [pauseState, pauseAction, pausing] = useActionState(pauseSubscriptionAction, IDLE);

  useEffect(() => {
    const done = cancelState.success ? cancelState : pauseState.success ? pauseState : null;
    if (done) {
      onResult(done);
      onOpenChange(false);
    }
  }, [cancelState, pauseState, onResult, onOpenChange]);

  const error = cancelState.error ?? pauseState.error;
  // A paused member cancelling has nothing to be offered — skip the pitch.
  const canOffer = view.status !== 'paused' && !view.pauseScheduled;

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Cancel your plan">
      {step === 'reason' && (
        <>
          <p className="mb-4 text-sm text-[#7a8274]">
            Before you go — what&apos;s made you decide to cancel?
          </p>
          <div role="radiogroup" aria-label="Reason for cancelling" className="space-y-1">
            {CANCEL_REASONS.map((r) => (
              <label
                key={r.slug}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition ${
                  reason === r.slug ? 'border-[#5d8156] bg-[#f7f8f4]' : 'border-[#e4e7dc] hover:bg-[#f7f8f4]'
                }`}
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={r.slug}
                  checked={reason === r.slug}
                  onChange={() => setReason(r.slug)}
                  className="accent-[#5d8156]"
                />
                {r.label}
              </label>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Anything else you'd like to tell us? (optional)"
            className="mt-3 w-full rounded-xl border border-[#e4e7dc] px-3 py-2 text-sm"
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <Dialog.Close className={QUIET}>Never mind</Dialog.Close>
            <button
              type="button"
              onClick={() => setStep(canOffer ? 'offer' : 'confirm')}
              className={PRIMARY}
            >
              Continue
            </button>
          </div>
          <p className="mt-3 text-xs text-[#7a8274]">
            Telling us why is optional — you can carry on without picking anything.
          </p>
        </>
      )}

      {step === 'offer' && (
        <>
          <p className="mb-1 text-sm font-semibold">Would a break work instead?</p>
          <p className="mb-4 text-sm text-[#7a8274]">
            Pause for one, two or three months and keep everything you have saved. You won&apos;t pay
            a penny while it&apos;s paused.
          </p>
          <PauseChoices
            view={view}
            reason={reason}
            comment={comment}
            formAction={pauseAction}
            pending={pausing}
          />
          <PauseExplainer view={view} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStep('reason')} className={QUIET}>Back</button>
            <button type="button" onClick={() => setStep('confirm')} className={QUIET}>
              No thanks, cancel my plan
            </button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <>
          <p className="text-sm">
            {view.endsOn
              ? `You'll keep full access until ${view.endsOn}, then your plan ends.`
              : "You'll keep full access until the end of the period you've already paid for, then your plan ends."}
          </p>
          <p className="mt-2 text-sm text-[#7a8274]">
            Nothing more will be charged, and you can undo this any time before that date.
          </p>
          <form action={cancelAction} className="mt-5 flex items-center justify-between gap-3">
            <input type="hidden" name="reason" value={reason} />
            <input type="hidden" name="comment" value={comment} />
            <Dialog.Close className={PRIMARY}>Keep my plan</Dialog.Close>
            <button type="submit" disabled={cancelling} className={QUIET}>
              {cancelling ? 'Cancelling…' : 'Yes, cancel my plan'}
            </button>
          </form>
        </>
      )}

      {error && <p className="mt-3 text-sm text-[#b3261e]">{error}</p>}
    </Shell>
  );
}
