import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { fetchLatest, fetchHistory, fetchOpenAIStatus, postHudLog, ApiError } from './api.js';
import { loadAppConfig } from './config.js';
import { demoJobs } from './demo.js';
import { createDoubleTapGuard } from './doubleTap.js';
import { historyTitle, jobListLabels, mergeHistory } from './jobHistory.js';
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
  shouldApplySameJob,
  shouldKeepHudOnPollError,
  waitingScreen,
  hudLogMessage,
} from './state.js';
import type { GlassesScreen, JobView } from './types.js';

const MAIN_ID = 1;
const MAIN_NAME = 'main';
const LIST_ID = 2;
const LIST_NAME = 'jobs';
const HEAD_ID = 3;
const HEAD_NAME = 'jobstitle';
const LAST_ID_KEY = 'g2vision.lastJobId';

const MENU = {
  refresh: 1,
  previous: 2,
  next: 3,
  clear: 4,
  shortAnswer: 5,
  jobs: 6,
  exit: 7,
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
let pageMode: 'text' | 'list' = 'text';
let lastLongPressAt = 0;
let pollBusy = false;
let lastHudLog = '';
const tapGuard = createDoubleTapGuard();

const createResult = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [hudText()],
    menuObject: appMenu(),
  }),
);

if (createResult !== 0) {
  console.error('createStartUpPageContainer failed', createResult);
}
reportHud();

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

  if (eventHasType(event, OsEventTypeList.LONG_PRESS_EVENT)) {
    void onLongPress();
    return;
  }
  if (eventHasType(event, OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    onDoubleTap();
    return;
  }

  const listEvent = event.listEvent;
  if (pageMode === 'list' && listEvent && listEvent.containerID === LIST_ID) {
    switch (listEvent.eventType) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        void openHistoryJob(listEvent.currentSelectItemIndex ?? 0);
        break;
      default:
        break;
    }
    return;
  }

  const textEvent = event.textEvent;
  if (pageMode === 'text' && textEvent && textEvent.containerID === MAIN_ID) {
    switch (textEvent.eventType) {
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

function appMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: 'Refresh', itemID: MENU.refresh }),
      new MenuItemProperty({ itemName: 'Previous Page', itemID: MENU.previous }),
      new MenuItemProperty({ itemName: 'Next Page', itemID: MENU.next }),
      new MenuItemProperty({ itemName: 'Clear', itemID: MENU.clear }),
      new MenuItemProperty({ itemName: 'Short Answer', itemID: MENU.shortAnswer }),
      new MenuItemProperty({ itemName: 'Jobs', itemID: MENU.jobs }),
      new MenuItemProperty({ itemName: 'Exit', itemID: MENU.exit }),
    ],
  });
}

function hudText(): TextContainerProperty {
  return new TextContainerProperty({
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

function eventHasType(
  event: {
    sysEvent?: { eventType?: number };
    textEvent?: { eventType?: number };
    listEvent?: { eventType?: number };
  },
  type: number,
): boolean {
  return (
    event.sysEvent?.eventType === type ||
    event.textEvent?.eventType === type ||
    event.listEvent?.eventType === type
  );
}

function logPress(message: string, kind: string): void {
  if (config.mockApi || !config.apiBaseUrl || !config.deviceSecret) return;
  void postHudLog(config.apiBaseUrl, config.deviceSecret, message, kind);
}

function onDoubleTap(): void {
  if (pageMode === 'list') {
    void closeHistoryList();
    return;
  }
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
  if (isDisplayBlank || pageMode === 'list') return;
  logPress('Short press', 'short');
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

async function onLongPress(): Promise<void> {
  const now = Date.now();
  if (now - lastLongPressAt < 400) return;
  lastLongPressAt = now;
  logPress('Long press', 'long');
  if (isDisplayBlank) {
    isDisplayBlank = false;
  }
  await openHistoryList();
}

async function openHistoryList(): Promise<void> {
  try {
    await refreshHistory();
  } catch {
    // Keep the in-memory list if history fetch fails.
  }
  if (historyJobs.length === 0) {
    if (pageMode !== 'text') await rebuildTextPage();
    screen = errorScreen('No saved jobs yet.');
    await redraw();
    return;
  }
  const labels = jobListLabels(historyJobs);
  pageMode = 'list';
  const ok = await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 40,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 4,
          containerID: HEAD_ID,
          containerName: HEAD_NAME,
          content: 'Jobs   tap to open',
          textColor: 4,
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          xPosition: 0,
          yPosition: 40,
          width: 576,
          height: 248,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 4,
          containerID: LIST_ID,
          containerName: LIST_NAME,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: labels.length,
            itemName: labels,
            isItemSelectBorderEn: 1,
          }),
        }),
      ],
      menuObject: appMenu(),
    }),
  );
  if (!ok) {
    pageMode = 'text';
    await rebuildTextPage();
  }
}

async function openHistoryJob(index: number): Promise<void> {
  if (index < 0 || index >= historyJobs.length) return;
  logPress('Short press', 'short');
  showHistoryJob(index);
  await rebuildTextPage();
}

async function closeHistoryList(): Promise<void> {
  if (pageMode === 'text') return;
  await rebuildTextPage();
}

async function rebuildTextPage(): Promise<void> {
  pageMode = 'text';
  const ok = await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [hudText()],
      menuObject: appMenu(),
    }),
  );
  if (!ok) {
    await redraw();
  }
  reportHud();
}

async function redraw(): Promise<void> {
  if (pageMode !== 'text') return;
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: MAIN_ID,
      containerName: MAIN_NAME,
      content: paint(),
    }),
  );
  reportHud();
}

function reportHud(): void {
  if (config.mockApi || !config.apiBaseUrl || !config.deviceSecret) return;
  const message = hudLogMessage(screen.kind, screen.body);
  if (message === lastHudLog) return;
  lastHudLog = message;
  void postHudLog(config.apiBaseUrl, config.deviceSecret, message, screen.kind);
}

function turnPage(delta: number): void {
  if (isDisplayBlank || pageMode !== 'text') return;
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
      await rebuildTextPage();
      break;
    case MENU.shortAnswer:
      if (!currentAnswer) return;
      compact = !compact;
      isDisplayBlank = false;
      screen = resultScreen(currentAnswer, 0, compact, activeHudTitle());
      await rebuildTextPage();
      break;
    case MENU.jobs:
      await openHistoryList();
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
  if (pollBusy && !force) return;
  pollBusy = true;
  try {
    await pollOnceInner(force);
  } finally {
    pollBusy = false;
  }
}

async function pollOnceInner(force: boolean): Promise<void> {
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
    await rebuildTextPage();
    return;
  }

  try {
    const latest = await fetchLatest(config.apiBaseUrl, config.deviceSecret);
    if (latest.result) historyJobs = mergeHistory(historyJobs, [latest.result]);

    if (!openaiReady || force) {
      try {
        const status = await fetchOpenAIStatus(config.apiBaseUrl, config.deviceSecret);
        if (!status.ok) {
          openaiReady = false;
          isDisplayBlank = false;
          screen = errorScreen(glassesErrorFromOpenAICheck(status));
          await rebuildTextPage();
          return;
        }
        openaiReady = true;
      } catch {
        openaiReady = true;
      }
    }

    if (pageMode === 'list' && force) {
      await openHistoryList();
      return;
    }

    const decision = decidePoll(force ? undefined : lastSeenKey, latest.result);
    if (isDisplayBlank) {
      const applied = applyPollWhileBlank(blankSession(), decision);
      adopt(applied.session);
      if (applied.rememberKey) await remember(applied.rememberKey);
      if (applied.paint === 'none') return;
      await rebuildTextPage();
      return;
    }
    if (decision.kind === 'empty') {
      if (pageMode === 'list') return;
      if (screen.kind !== 'waiting' && screen.kind !== 'result') {
        screen = { ...waitingScreen() };
        await redraw();
      }
      return;
    }
    if (decision.kind === 'same') {
      if (shouldApplySameJob(screen.kind)) {
        const fresh = decidePoll(undefined, decision.job);
        if (fresh.kind === 'complete') {
          applyComplete(fresh.job);
          await rebuildTextPage();
          return;
        }
        if (fresh.kind === 'processing') {
          pollTick += 1;
          screen = { ...processingScreen(pollTick), jobId: fresh.job.jobId, seq: fresh.job.seq };
          await redraw();
          return;
        }
        if (fresh.kind === 'error') {
          screen = {
            ...errorScreen(glassesErrorFromJob(fresh.job)),
            jobId: fresh.job.jobId,
            seq: fresh.job.seq,
          };
          await rebuildTextPage();
          return;
        }
        screen = { ...waitingScreen() };
        await redraw();
        return;
      }
      if (screen.kind === 'error' && currentAnswer) {
        screen = resultScreen(currentAnswer, screen.pageIndex, compact, activeHudTitle());
        await redraw();
      }
      return;
    }
    if (decision.kind === 'processing') {
      await remember(displayKey(decision.job));
      if (pageMode === 'list' || historyIndex > 0) return;
      pollTick += 1;
      screen = { ...processingScreen(pollTick), jobId: decision.job.jobId, seq: decision.job.seq };
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
      await rebuildTextPage();
      return;
    }
    applyComplete(decision.job);
    await rebuildTextPage();
  } catch (err) {
    if (!force && shouldKeepHudOnPollError(screen.kind, Boolean(currentAnswer))) {
      return;
    }
    const status = err instanceof ApiError ? err.status : undefined;
    screen = errorScreen(classifyFetchError(err, status));
    await rebuildTextPage();
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
