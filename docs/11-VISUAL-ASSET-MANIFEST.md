# Visual asset manifest

Reviewed: 2026-08-20

The public experience keeps product data and live HTML primary. A new original logo mark is the only generated brand image loaded in the interface; the framework serves an appropriately resized version so the source raster does not become a routine page-weight cost.

| Asset | Purpose | Brief / prompt summary | Provider | Dimensions and variants | Alt text | Approval | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IR35Careers path mark | Primary product identity | Interlocking doorway and route symbol expressing clarity through contract complexity and forward career movement. Prompt constrained the concept to a strong standalone silhouette, midnight navy and emerald, with no letters, competitor branding or stock recruitment icons. | OpenAI built-in image generation; selected from two candidates | Transparent 1254px source, optimised 256px navigation asset, 512px app icon and 180px Apple icon | Brand name is adjacent; the mark is decorative | Approved | Global navigation, app icons and social image |
| Homepage product preview | Demonstrate real discovery UI | Live HTML job cards using production-shaped API data; no baked-in copy or fake logos | Application UI | Responsive HTML | Native semantic content | Approved direction | Homepage hero/supporting section |
| Empty-state visuals | Reduce dead-space anxiety | Prefer small Lucide icon in a tinted token surface | Lucide | Vector 20-28px | Empty when decorative | Approved direction | Search, saved jobs, alerts |
| Open Graph image | Social sharing | Original branded composition using the approved path mark, live product promise and a restrained contractor-grid background; no third-party logos | Deterministic local composition from approved generated mark | 1200x630 PNG, 53KB | “IR35Careers - UK contracts with IR35 status and rates up front” | Approved | `/og-image.png` metadata |
| IR35 explainer diagram | Explain Inside/Outside/TBC paths | Planned original flow diagram using semantic tokens, short labels and HTML/SVG source | Pending | Responsive SVG plus 1200px WebP fallback | Full equivalent adjacent text | Pending | Resource hub |

## Asset rules

- Reference screenshots from the supplied PDF and `tmp/ui-audit/` are analysis-only and must not enter `public/`.
- Do not hotlink source-site imagery or reproduce competitor product screens.
- Generated raster assets, if later approved, live under `public/images/generated/<feature>/` with intrinsic size, WebP/AVIF output, mobile crop and recorded prompt summary.
- Informative images require useful alt text; decorative images use empty alt text.
- Important copy, rates, statuses and controls remain live HTML.
