import { displayKey, errorScreen, glassesErrorFromJob, resultScreen } from './state.js';
import type { GlassesScreen, JobView, PollOutcome } from './types.js';

/** Empty HUD: no title, no page indicator. Black pixels are off on G2 (no display-off API). */
export const BLANK_HUD_CONTENT = ' ';

export type BlankSession = {
  isDisplayBlank: boolean;
  screen: GlassesScreen;
  currentAnswer: string;
  compact: boolean;
  restorePageIndex: number;
};

export type BlankPollApply = {
  session: BlankSession;
  paint: 'blank' | 'hud' | 'none';
  rememberKey?: string;
  continuePolling: true;
};

export function hudContentFor(session: BlankSession, painted: string): string {
  return session.isDisplayBlank ? BLANK_HUD_CONTENT : painted;
}

export function enterBlank(session: BlankSession): BlankSession {
  if (session.isDisplayBlank) return session;
  return {
    ...session,
    isDisplayBlank: true,
    restorePageIndex: session.screen.pageIndex,
  };
}

export function leaveBlank(session: BlankSession): BlankSession {
  if (!session.isDisplayBlank) return session;
  return restoreVisible({ ...session, isDisplayBlank: false });
}

export function toggleBlank(session: BlankSession): BlankSession {
  return session.isDisplayBlank ? leaveBlank(session) : enterBlank(session);
}

export function restoreVisible(session: BlankSession): BlankSession {
  if (session.screen.kind !== 'result' || !session.currentAnswer) return session;
  return {
    ...session,
    screen: {
      ...resultScreen(session.currentAnswer, session.restorePageIndex, session.compact),
      jobId: session.screen.jobId,
      seq: session.screen.seq,
    },
  };
}

export function wakeOnNewResult(session: BlankSession, job: JobView): BlankSession {
  const answer = job.answer || '';
  return {
    ...session,
    isDisplayBlank: false,
    currentAnswer: answer,
    compact: false,
    restorePageIndex: 0,
    screen: {
      ...resultScreen(answer, 0, false),
      jobId: job.jobId,
      seq: job.seq,
    },
  };
}

/** Polling never stops in blank mode. Only a new complete/error job leaves blank. */
export function applyPollWhileBlank(session: BlankSession, decision: PollOutcome): BlankPollApply {
  if (!session.isDisplayBlank) {
    return { session, paint: 'none', continuePolling: true };
  }
  if (decision.kind === 'same' || decision.kind === 'empty') {
    return { session, paint: 'none', continuePolling: true };
  }
  if (decision.kind === 'processing') {
    return {
      session,
      paint: 'none',
      rememberKey: displayKey(decision.job),
      continuePolling: true,
    };
  }
  if (decision.kind === 'complete') {
    return {
      session: wakeOnNewResult(session, decision.job),
      paint: 'hud',
      rememberKey: displayKey(decision.job),
      continuePolling: true,
    };
  }
  return {
    session: {
      ...session,
      isDisplayBlank: false,
      screen: {
        ...errorScreen(glassesErrorFromJob(decision.job)),
        jobId: decision.job.jobId,
        seq: decision.job.seq,
      },
    },
    paint: 'hud',
    rememberKey: displayKey(decision.job),
    continuePolling: true,
  };
}
