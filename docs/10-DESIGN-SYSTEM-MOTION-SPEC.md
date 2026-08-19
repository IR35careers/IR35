# IR35Careers design system and motion specification

## Brand principles

1. **Clarity before cleverness.** Rates, status, source and next action are immediately legible.
2. **Calm confidence.** Restrained colour, ample whitespace and precise copy communicate trust.
3. **Contractor utility.** Every component supports discovery, understanding, preparation or tracking.
4. **Truthful state.** Inferred, incomplete, unavailable and demo states are labelled.
5. **Inclusive by default.** Keyboard, touch, zoom, reduced motion and assistive technology are first-class.

## Typography

- Family: Inter with system sans fallback. No additional display font in the first slice.
- Display: 48/52 desktop, 38/42 tablet, 34/38 mobile; weight 650-700.
- H1: 40/44 desktop, 32/36 mobile; weight 650.
- H2: 28/34 desktop, 24/30 mobile; weight 650.
- H3: 18/26; weight 600.
- Body: 16/26. Compact product body: 14/21. Meta: 12/18.
- Minimum routine UI text: 12px; never use very small text for essential status or actions.
- Reading measure: 60-72 characters; legal/reference material may reach 80.
- Use tabular numerals for rates, dates, counts and percentages.

## Colour tokens

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#0B1220` | Primary text and strongest action |
| `muted` | `#526074` | Secondary text |
| `canvas` | `#F6F8F7` | App/page background |
| `surface` | `#FFFFFF` | Cards, navigation and forms |
| `border` | `#DDE4E1` | Default separation |
| `brand-50` | `#ECFDF5` | Soft brand surface |
| `brand-100` | `#D1FAE5` | Selected and success-adjacent surface |
| `brand-500` | `#18A56F` | Accent and progress |
| `brand-600` | `#087A5B` | Primary action and accessible links |
| `brand-700` | `#096048` | Hover/pressed |
| `outside` | `#15803D` | Outside IR35 status with text/icon |
| `inside` | `#BE123C` | Inside IR35 status with text/icon |
| `tbc` | `#8A5A12` | TBC/inferred warning with text/icon |
| `info` | `#1D4ED8` | Informational state |
| `danger` | `#B42318` | Destructive action/error |

Status colour is never the sole carrier of meaning. Focus ring uses brand-600 with a visible offset on light and dark surfaces.

## Spacing, grid and containers

- Base spacing unit: 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
- Public reading container: 1120px. Search/product container: 1440px. Full application maximum: 1600px.
- Page gutters: 16px mobile, 24px tablet, 32px desktop.
- Grid: 4 columns mobile, 8 tablet, 12 desktop. Gaps: 16/20/24px.
- Breakpoints follow content pressure rather than device names; verify at 320, 360, 390, 768, 1024, 1440 and 1920.

## Surfaces, borders and elevation

- Radius: 8px compact control, 12px control/card, 16px standard card, 24px hero/feature surface, pill only for tags or segmented controls.
- Border: 1px neutral by default; 2px only for focus/selected emphasis.
- Shadow 1: subtle card lift. Shadow 2: floating menu/dialog. Avoid persistent heavy glow.
- Surface hierarchy: canvas -> surface -> raised surface -> modal. Do not nest more than three visually distinct card levels.

## Iconography and imagery

- Use Lucide only. Standard sizes: 16, 18, 20, 24.
- Icons support labels; unfamiliar icon-only controls require an accessible name and tooltip.
- Prefer product UI, data diagrams and lightweight CSS/SVG over stock photography.
- Company imagery uses authorised logos only; otherwise a neutral monogram.

## Density

- Public pages: comfortable, 48-56px primary controls.
- Search/results: compact but touch-safe, 44-48px controls and 16-20px card padding.
- Member tools: comfortable default with an optional future compact preference; never reduce touch targets.

## Component states

- **Default:** neutral border and surface.
- **Hover:** colour/border shift in 120-160ms; no large movement.
- **Focus:** 2px visible ring plus offset, never removed.
- **Active/pressed:** slightly darker surface or 1px transform; immediate.
- **Selected:** text/icon plus tinted surface and border.
- **Disabled:** reduced contrast, `not-allowed` only when helpful, reason available in copy.
- **Loading:** preserve layout; skeleton for known geometry, inline spinner for an action.
- **Empty:** state title, cause/context and one useful next action.
- **Error:** plain-language message, preserved input and retry/recovery.
- **Warning:** amber/tbc treatment, explanation and optional action.
- **Success:** explicit confirmation; toast may supplement but never replace in-context state.
- **Destructive:** danger colour, explicit object name and confirmation when hard to recover.

## Responsive behaviours

- Public navigation becomes a labelled menu sheet below tablet width.
- Member navigation uses a desktop top bar/sidebar and a mobile menu; never five squeezed labels.
- Search filters are a sidebar on wide screens and an accessible sheet on mobile.
- Desktop job detail may use a side panel; mobile uses a dedicated route or full-height sheet with browser history support.
- Tables switch to labelled cards; no essential horizontal scrolling.
- Sticky actions include safe-area padding and must not obscure content or focus.
- Layout works at 200% zoom and with long job/company names.

## Motion tokens

| Token | Duration | Use |
| --- | ---: | --- |
| `instant` | 80ms | Press acknowledgement |
| `fast` | 140ms | Hover, focus-adjacent feedback |
| `standard` | 200ms | Tabs, chips, save state |
| `enter` | 260ms | Sheet/dialog enter |
| `exit` | 180ms | Sheet/dialog exit |
| `route` | 320ms max | Optional content continuity, never blocking |

- Standard easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Exit easing: `cubic-bezier(0.4, 0, 1, 1)`.
- Spring: stiffness 360, damping 32, mass 0.8 for a short non-bouncy settle.
- Animate transform and opacity. Height animation is reserved for small disclosure content.
- Routine interactions never wait for animation completion and entrance animation plays once per meaningful state.
- `prefers-reduced-motion: reduce` disables ambient drift, spring movement and smooth scrolling; opacity feedback may remain near-instant.

## Skeleton and feedback patterns

- Job search: 5 fixed-height job-card skeletons; filters remain interactive; stale results remain visible with a subtle updating state.
- Job detail: header and two content blocks; never replace the whole application shell.
- Save: optimistic label/icon update, disabled duplicate action, rollback plus inline error on failure.
- Search: 250-350ms debounce, abort previous request, ignore stale response and announce current result count.

## Z-index

- Base content `0`.
- Sticky content `20`.
- Header/navigation `30`.
- Dropdown/popover `40`.
- Sheet/backdrop `50`.
- Dialog `60`.
- Toast `70`.
- Critical access curtain `80`; it must be recoverable and must not fail open.

