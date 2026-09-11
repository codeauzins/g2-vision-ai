import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { fetchLatest, fetchHistory, fetchOpenAIStatus, ApiError } from './api.js';
import { loadAppConfig } from './config.js';
import { demoJobs } from './demo.js';
import { createDoubleTapGuard } from './doubleTap.js';
import {
  historyTitle,
  mergeHistory,
  newerHistoryIndex,
  olderHistoryIndex,
} from './jobHistory.js';
import {
  applyPollWhileBlank,
  hudContentFor,
  toggleBlank,
  type BlankSession,
} from './quickBlank.js';
import {
  TITLE,
  classifyFetchError,
  decidePoll,
  displayKey,
  errorScreen,
  glassesErrorFromJob,
  glassesErrorFromOpenAICheck,
  checkingScreen,
  nextIndex,
  prevIndex,
  processingScreen,
  renderScreen,
  resultScreen,
  waitingScreen,
} from './state.js';
import type { GlassesScreen, JobView } from './types.js';

const MAIN_ID = 1;
const MAIN_NAME = 'main';
const LAST_ID_KEY = 'g2vision.lastJobId';

const MENU = {
  refresh: 1,
  previous: 2,
  next: 3,
  clear: 4,
  shortAnswer: 5,
  olderJob: 6,
  newerJob: 7,
  exit: 8,
} as const;

const config = loadAppConfig();
const bridge = await waitForEvenAppBridge();

let screen: GlassesScreen = { ...checkingScreen() };
let lastSeenKey: string | undefined;
let compact = false;
let currentAnswer = '';
let pollTick = 0;
let started = false;
let openaiReady = false;
let isDisplayBlank = false;
let restorePageIndex = 0;
let historyJobs: JobView[] = [];
let historyIndex = 0;
let lastLongPressAt = 0;
const tapGuard = createDoubleTapGuard();

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: MAIN_ID,
  containerName: MAIN_NAME,
  content: paint(),
  textColor: 4,
  isEventCapture: 1,
});

const createResult = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
    menuObject: new MenuContainerProperty({
      menuItems: [
        new MenuItemProperty({ itemName: 'Refresh', itemID: MENU.refresh }),
        new MenuItemProperty({ itemName: 'Previous Page', itemID: MENU.previous }),
        new MenuItemProperty({ itemName: 'Next Page', itemID: MENU.next }),
        new MenuItemProperty({ itemName: 'Clear', itemID: MENU.clear }),
        new MenuItemProperty({ itemName: 'Short Answer', itemID: MENU.shortAnswer }),
        new MenuItemProperty({ itemName: 'Older Job', itemID: MENU.olderJob }),
        new MenuItemProperty({ itemName: 'Newer Job', itemID: MENU.newerJob }),
        new MenuItemProperty({ itemName: 'Exit', itemID: MENU.exit }),
      ],
    }),
  }),
);

if (createResult !== 0) {
  console.error('createStartUpPageContainer failed', createResult);
}

try {
  lastSeenKey = (await bridge.getLocalStorage(LAST_ID_KEY)) || undefined;
} catch {
  lastSeenKey = undefined;
}

bridge.onEvenHubEvent((event) => {
  const menuId = event.menuItemClickEvent?.itemID;
  if (menuId != null) {
    void onMenu(menuId);
    return;
  }

  const sysType = event.sysEvent?.eventType;
  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    onDoubleTap();
    return;
  }
  if (sysType === OsEventTypeList.LONG_PRESS_EVENT) {
    void onOlderJob();
    return;
  }

  const textEvent = event.textEvent;
  if (textEvent && textEvent.containerID === MAIN_ID) {
    switch (textEvent.eventType) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        onDoubleTap();
        break;
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        onPossibleClick();
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (!isDisplayBlank) turnPage(1);
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (!isDisplayBlank) turnPage(-1);
        break;
    }
  }
});

if (config.mockApi) {
  openaiReady = true;
  historyJobs = demoJobs();
  historyIndex = 0;
  applyComplete(historyJobs[0]!);
} else {
  void startPolling();
}

function paint(): string {
  return hudContentFor(blankSession(), renderScreen(screen.kind, screen.title, screen.body, screen.pageIndex, screen.pages.length));
}

function blankSession(): BlankSession {
  return {
    isDisplayBlank,
    screen,
    currentAnswer,
    compact,
    restorePageIndex,
  };
}

function adopt(next: BlankSession): void {
  isDisplayBlank = next.isDisplayBlank;
  screen = next.screen;
  currentAnswer = next.currentAnswer;
  compact = next.compact;
  restorePageIndex = next.restorePageIndex;
}

function onDoubleTap(): void {
  const result = tapGuard.onNativeDouble(Date.now());
  if (result.action !== 'toggle') return;
  adopt(toggleBlank(blankSession()));
  void redraw();
}

function onPossibleClick(): void {
  const result = tapGuard.onClick(Date.now());
  if (result.action === 'toggle') {
    adopt(toggleBlank(blankSession()));
    void redraw();
    return;
  }
  if (result.action !== 'wait') return;
  const token = result.token;
  window.setTimeout(() => {
    const later = tapGuard.onWaitElapsed(token, Date.now());
    if (later.action === 'single') onSingleTap();
  }, tapGuard.windowMs);
}

function onSingleTap(): void {
  if (isDisplayBlank) return;
  if (historyIndex > 0) {
    void onNewerJob();
    return;
  }
  if (screen.kind === 'result') {
    turnPage(1);
  } else if (screen.kind === 'error' || screen.kind === 'waiting') {
    void pollOnce(true);
  }
}

function activeHudTitle(): string {
  return historyTitle(TITLE, historyIndex, historyJobs.length);
}

function showHistoryJob(index: number): void {
  const job = historyJobs[index];
  if (!job) return;
  historyIndex = index;
  compact = false;
  isDisplayBlank = false;
  const title = activeHudTitle();
  if (job.status === 'complete' && job.answer) {
    currentAnswer = job.answer;
    screen = { ...resultScreen(currentAnswer, 0, compact, title), jobId: job.jobId, seq: job.seq };
  } else {
    currentAnswer = '';
    screen = {
      ...errorScreen(glassesErrorFromJob(job), title),
      jobId: job.jobId,
      seq: job.seq,
    };
  }
  void redraw();
}

async function refreshHistory(): Promise<void> {
  if (config.mockApi) {
    historyJobs = mergeHistory(historyJobs, demoJobs());
    return;
  }
  if (!config.apiBaseUrl || !config.deviceSecret) return;
  const payload = await fetchHistory(config.apiBaseUrl, config.deviceSecret);
  historyJobs = mergeHistory(historyJobs, payload.results || []);
  if (historyIndex >= historyJobs.length) historyIndex = Math.max(0, historyJobs.length - 1);
}

async function onOlderJob(): Promise<void> {
  if (isDisplayBlank) return;
  const now = Date.now();
  if (now - lastLongPressAt < 400) return;
  lastLongPressAt = now;
  try {
    await refreshHistory();
  } catch {
    // Keep the in-memory list if history fetch fails.
  }
  if (historyJobs.length === 0) return;
  if (screen.kind === 'waiting' || screen.kind === 'checking') {
    showHistoryJob(0);
    return;
  }
  const next = olderHistoryIndex(historyIndex, historyJobs.length);
  if (next === historyIndex) return;
  showHistoryJob(next);
}

async function onNewerJob(): Promise<void> {
  if (isDisplayBlank) return;
  const next = newerHistoryIndex(historyIndex);
  if (next === historyIndex) return;
  showHistoryJob(next);
}

async function redraw(): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: MAIN_ID,
      containerName: MAIN_NAME,
      content: paint(),
    }),
  );
}

function turnPage(delta: number): void {
  if (isDisplayBlank) return;
  if (screen.kind !== 'result' || screen.pages.length <= 1) return;
  const index =
    delta > 0
      ? nextIndex(screen.pageIndex, screen.pages.length)
      : prevIndex(screen.pageIndex, screen.pages.length);
  screen = resultScreen(currentAnswer, index, compact, activeHudTitle());
  void redraw();
}

async function onMenu(itemID: number): Promise<void> {
  switch (itemID) {
    case MENU.refresh:
      await pollOnce(true);
      break;
    case MENU.previous:
      turnPage(-1);
      break;
    case MENU.next:
      turnPage(1);
      break;
    case MENU.clear:
      currentAnswer = '';
      compact = false;
      isDisplayBlank = false;
      historyIndex = 0;
      screen = openaiReady ? { ...waitingScreen() } : { ...checkingScreen() };
      await redraw();
      break;
    case MENU.shortAnswer:
      if (!currentAnswer) return;
      compact = !compact;
      isDisplayBlank = false;
      screen = resultScreen(currentAnswer, 0, compact, activeHudTitle());
      await redraw();
      break;
    case MENU.olderJob:
      await onOlderJob();
      break;
    case MENU.newerJob:
      await onNewerJob();
      break;
    case MENU.exit:
      void bridge.shutDownPageContainer(1);
      break;
    default:
      break;
  }
}

async function startPolling(): Promise<void> {
  if (started) return;
  started = true;
  await pollOnce(false);
  window.setInterval(() => {
    void pollOnce(false);
  }, config.pollMs);
}

async function pollOnce(force: boolean): Promise<void> {
  if (config.mockApi) {
    openaiReady = true;
    historyJobs = demoJobs();
    historyIndex = 0;
    applyComplete(historyJobs[0]!);
    return;
  }
  if (!config.apiBaseUrl || !config.deviceSecret) {
    isDisplayBlank = false;
    screen = errorScreen(
      !config.apiBaseUrl
        ? 'Backend URL is not set. Rebuild with VITE_API_BASE_URL.'
        : 'App authentication failed.',
    );
    await redraw();
    return;
  }

  try {
    if (!openaiReady || force) {
      const status = await fetchOpenAIStatus(config.apiBaseUrl, config.deviceSecret);
      if (!status.ok) {
        openaiReady = false;
        isDisplayBlank = false;
        screen = errorScreen(glassesErrorFromOpenAICheck(status));
        await redraw();
        return;
      }
      openaiReady = true;
    }

    const latest = await fetchLatest(config.apiBaseUrl, config.deviceSecret);
    try {
      const payload = await fetchHistory(config.apiBaseUrl, config.deviceSecret);
      historyJobs = mergeHistory(historyJobs, payload.results || []);
      if (latest.result) historyJobs = mergeHistory(historyJobs, [latest.result]);
    } catch {
      if (latest.result) historyJobs = mergeHistory(historyJobs, [latest.result]);
    }

    const decision = decidePoll(force ? undefined : lastSeenKey, latest.result);
    if (isDisplayBlank) {
      const applied = applyPollWhileBlank(blankSession(), decision);
      adopt(applied.session);
      if (applied.rememberKey) await remember(applied.rememberKey);
      if (applied.paint === 'none') return;
      await redraw();
      return;
    }
    if (decision.kind === 'empty') {
      if (screen.kind !== 'waiting' && screen.kind !== 'result') {
        screen = { ...waitingScreen() };
        await redraw();
      }
      return;
    }
    if (decision.kind === 'same') return;
    if (decision.kind === 'processing') {
      if (historyIndex > 0) {
        await remember(displayKey(decision.job));
        return;
      }
      pollTick += 1;
      screen = { ...processingScreen(pollTick), jobId: decision.job.jobId, seq: decision.job.seq };
      await remember(displayKey(decision.job));
      await redraw();
      return;
    }
    if (decision.kind === 'error') {
      historyIndex = 0;
      screen = {
        ...errorScreen(glassesErrorFromJob(decision.job)),
        jobId: decision.job.jobId,
        seq: decision.job.seq,
      };
      await remember(displayKey(decision.job));
      await redraw();
      return;
    }
    applyComplete(decision.job);
    await redraw();
  } catch (err) {
    const status = err instanceof ApiError ? err.status : undefined;
    isDisplayBlank = false;
    screen = errorScreen(classifyFetchError(err, status));
    await redraw();
  }
}

function applyComplete(job: JobView): void {
  historyJobs = mergeHistory(historyJobs, [job]);
  historyIndex = 0;
  currentAnswer = job.answer || '';
  compact = false;
  screen = {
    ...resultScreen(currentAnswer, 0, compact, activeHudTitle()),
    jobId: job.jobId,
    seq: job.seq,
  };
  lastSeenKey = displayKey(job);
  void remember(lastSeenKey);
}

async function remember(key: string): Promise<void> {
  lastSeenKey = key;
  try {
    await bridge.setLocalStorage(LAST_ID_KEY, key);
  } catch {
    // Storage is optional; polling still de-dupes in memory.
  }
}
