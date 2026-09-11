# G2 pagination

The old iMessage/notification path was ~140 characters. This app does not use that. Answers are drawn with the Even Hub **text container** API on the native 576×288 canvas.

## Display constraints (official)

Sources: [Display & UI System](https://hub.evenrealities.com/docs/build/display), [Design Guidelines](https://hub.evenrealities.com/docs/build/design-guidelines).

- Canvas: 576×288 px per eye, 4-bit greyscale (shown as green)
- One LVGL firmware font — **no font size, family, weight, or alignment APIs**
- `paddingLength` 0–32 (this app uses 4)
- Full-screen text container ≈ **400–500 characters** visible
- `\n` is a hard line break; firmware wraps at container width
- `createStartUpPageContainer` / rebuild: 1,000 character cap; `textContainerUpgrade`: 2,000
- Overflow on the capturing container firmware-scrolls, which this app avoids by packing each page to a conservative line grid (more pages, no in-page scroll)

## Algorithm

Implemented in `even-app/src/pagination.ts`.

Pages are **line-limited**, not a 140-character or 400-character dump. Metrics are pessimistic so firmware wrap cannot overflow the 576×288 canvas:

| Symbol | How |
| --- | --- |
| `approxCharWidth` | 16 px (wide Latin glyphs) |
| `approxLineHeight` | 28 px |
| `CHARS_PER_LINE` | `floor((576 - 2*4) / 16)` ≈ 35 |
| `DISPLAY_LINES` | `floor((288 - 2*4) / 28)` |
| `BODY_LINES` | display rows minus 2 header rows |

Split:

1. Normalize newlines / spaces.
2. Word-wrap to `CHARS_PER_LINE` (hard `\n` kept).
3. Pack at most `BODY_LINES` wrapped rows per page.

Each HUD frame is:

```text
Ask AI                          1/4

<body of this page>
```

The painted frame is checked so wrapped line count ≤ `DISPLAY_LINES`. Swipe then only changes pages.

## Input

Official `OsEventTypeList` on `event.textEvent` (container `isEventCapture: 1`):

- `SCROLL_BOTTOM_EVENT` — next page
- `SCROLL_TOP_EVENT` — previous page
- `CLICK_EVENT` (or `undefined`, SDK quirk) — next page of the current answer
- `DOUBLE_CLICK_EVENT` — **Quick Blank** (native double press from G2 or R1)
- `LONG_PRESS_EVENT` on `sysEvent` — open the **Jobs** list (SDK 0.0.14+). Tap-then-long-press still opens the OS contextual menu.

Jobs history uses a native `ListContainerProperty` (`rebuildPageContainer`, max 20 rows / 64 characters). Scroll is firmware highlighting; tap uses `listEvent.currentSelectItemIndex`. Double tap or another long press returns to the previous HUD. A new photo jumps back to the latest job.

### Quick Blank

R1 double tap → blank display  
R1 double tap again → restore  
New Ask AI result → automatically display  

The Even Hub SDK (`0.0.15`) exposes `DOUBLE_CLICK_EVENT` for both the G2 temples and the R1 ring ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)). It does **not** expose a programmatic Display Off / hide-screen call ([Display & UI](https://hub.evenrealities.com/docs/build/display), [Page lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle) — `shutDownPageContainer` exits the plugin, which Quick Blank must not do).

App-level blank mode:

- `isDisplayBlank` stays in the plugin; `GET /api/latest` polling continues
- HUD content is a single space (no title, no page indicator). On G2, black pixels are off
- Result text, page index, and compact-mode flag are kept
- Two `CLICK_EVENT`s inside `DOUBLE_TAP_WINDOW_MS` (350ms, `even-app/src/doubleTap.ts`) also toggle, so a missing native double-press cannot page-turn instead
- Bounce window `TAP_BOUNCE_MS` (90ms) drops duplicate native + software toggles
- Swipes do not change pages while blank
- Exit is **Menu → Exit** (`shutDownPageContainer(1)`), not double tap

If Even OS ever consumes double press as system Back and the plugin never receives `DOUBLE_CLICK_EVENT`, Quick Blank will not fire from that gesture. This build still listens for the documented SDK event (same handler Even’s first-app sample uses).

Menu item IDs (SDK `menuObject` / `menuItemClickEvent`, 0.0.14+): Refresh, Previous Page, Next Page, Clear, Short Answer, Jobs, Exit.

## Tests

`even-app/tests/pagination.test.ts` uses a demo menu board long enough for 3–5 pages. Tune `approxCharWidth` / `approxLineHeight` if hardware wrapping disagrees; there is no public glyph-advance API in the SDK, so this is a documented approximation aligned with Even’s 400–500 character guidance.
