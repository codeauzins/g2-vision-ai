import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { fetchLatest, ApiError } from './api.js';
import { loadAppConfig } from './config.js';
import { demoJob } from './demo.js';
import {
  classifyFetchError,
  decidePoll,
  displayKey,
  errorScreen,
  glassesErrorFromJob,
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
} as const;

const config = loadAppConfig();
const bridge = await waitForEvenAppBridge();

let screen: GlassesScreen = { ...waitingScreen() };
let lastSeenKey: string | undefined;
let compact = false;
let currentAnswer = '';
let pollTick = 0;
let started = false;

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

  const textEvent = event.textEvent;
  if (textEvent && textEvent.containerID === MAIN_ID) {
    switch (textEvent.eventType) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined:
        if (screen.kind === 'result') {
          turnPage(1);
        } else if (screen.kind === 'error' || screen.kind === 'waiting') {
          void pollOnce(true);
        }
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        void bridge.shutDownPageContainer(1);
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        turnPage(1);
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        turnPage(-1);
        break;
    }
  }
});

if (config.mockApi) {
  applyComplete(demoJob());
} else {
  void startPolling();
}

function paint(): string {
  return renderScreen(screen.kind, screen.title, screen.body, screen.pageIndex, screen.pages.length);
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
  if (screen.kind !== 'result' || screen.pages.length <= 1) return;
  const index =
    delta > 0
      ? nextIndex(screen.pageIndex, screen.pages.length)
      : prevIndex(screen.pageIndex, screen.pages.length);
  screen = resultScreen(currentAnswer, index, compact);
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
      screen = { ...waitingScreen() };
      await redraw();
      break;
    case MENU.shortAnswer:
      if (!currentAnswer) return;
      compact = !compact;
      screen = resultScreen(currentAnswer, 0, compact);
      await redraw();
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
    applyComplete(demoJob());
    return;
  }
  if (!config.apiBaseUrl || !config.deviceSecret) {
    screen = errorScreen(
      !config.apiBaseUrl
        ? 'Backend URL is not set. Rebuild with VITE_API_BASE_URL.'
        : 'App authentication failed.',
    );
    await redraw();
    return;
  }

  try {
    const latest = await fetchLatest(config.apiBaseUrl, config.deviceSecret);
    const decision = decidePoll(force ? undefined : lastSeenKey, latest.result);
    if (decision.kind === 'empty') {
      if (screen.kind === 'processing' || screen.kind === 'error') {
        screen = { ...waitingScreen() };
        await redraw();
      }
      return;
    }
    if (decision.kind === 'same') return;
    if (decision.kind === 'processing') {
      pollTick += 1;
      screen = { ...processingScreen(pollTick), jobId: decision.job.jobId, seq: decision.job.seq };
      await remember(displayKey(decision.job));
      await redraw();
      return;
    }
    if (decision.kind === 'error') {
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
    screen = errorScreen(classifyFetchError(err, status));
    await redraw();
  }
}

function applyComplete(job: JobView): void {
  currentAnswer = job.answer || '';
  compact = false;
  screen = {
    ...resultScreen(currentAnswer, 0, compact),
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
