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
- Overflow on the capturing container can firmware-scroll; we still paginate so a long answer is readable without hunting

## Algorithm

Implemented in `even-app/src/pagination.ts`.

Constants derived from the canvas:

| Symbol | How |
| --- | --- |
| `approxCharWidth` | 13 px (proportional LVGL, not mono) |
| `approxLineHeight` | 20 px |
| `CHARS_PER_LINE` | `floor((576 - 2*4) / 13)` ≈ 43 |
| `BODY_LINES` | total rows minus 2 header rows |
| `PAGE_CHAR_BUDGET` | `CHARS_PER_LINE * BODY_LINES` |

That budget sits near Even’s 400–500 character visible-page estimate, not 140.

Split order:

1. Normalize newlines / spaces.
2. Break on blank lines (paragraphs).
3. If a paragraph still exceeds the budget, break on sentence endings `[.!?]` .
4. If a sentence is still too long, pack **words**; only then split an oversize token.

Each HUD frame is:

```text
Ask AI                          1/4

<body of this page>
```

Page index is preserved while you swipe. **Short Answer** in the contextual menu rebuilds pages from `compactAnswer()` (first sentences, one-page target).

## Input

Official `OsEventTypeList` on `event.textEvent` (container `isEventCapture: 1`):

- `SCROLL_BOTTOM_EVENT` — next page
- `SCROLL_TOP_EVENT` — previous page
- `CLICK_EVENT` (or `undefined`, SDK quirk) — next page, after the Quick Blank window
- `DOUBLE_CLICK_EVENT` — **Quick Blank** (native double press from G2 or R1)

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

Menu item IDs (SDK `menuObject` / `menuItemClickEvent`, 0.0.14+): Refresh, Previous Page, Next Page, Clear, Short Answer, Exit.

## Tests

`even-app/tests/pagination.test.ts` uses a demo menu board long enough for 3–5 pages. Tune `approxCharWidth` / `approxLineHeight` if hardware wrapping disagrees; there is no public glyph-advance API in the SDK, so this is a documented approximation aligned with Even’s 400–500 character guidance.
