# Visual asset manifest

Reviewed: 2026-08-19

The first UI slice intentionally uses typography, CSS, Lucide icons and real product data. No raster hero image is necessary, so no image-generation action has been taken. This avoids decorative payload and keeps the contractor search task primary.

| Asset | Purpose | Brief / prompt summary | Provider | Dimensions and variants | Alt text | Approval | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IR35Careers brand mark | Existing product identity | Green rounded square with white briefcase/building symbol; retain current identity | Existing CSS + Lucide | Vector/CSS at 28-40px | Brand name is adjacent; icon decorative | Retained | Global navigation |
| Homepage product preview | Demonstrate real discovery UI | Live HTML job cards using production-shaped API data; no baked-in copy or fake logos | Application UI | Responsive HTML | Native semantic content | Approved direction | Homepage hero/supporting section |
| Empty-state visuals | Reduce dead-space anxiety | Prefer small Lucide icon in a tinted token surface | Lucide | Vector 20-28px | Empty when decorative | Approved direction | Search, saved jobs, alerts |
| Open Graph image | Social sharing | Planned original branded type composition: headline, status/rate chips and abstract grid; no third-party logos | Pending | 1200x630 WebP/PNG | “IR35Careers - UK contracts with IR35 status and rates up front” | Pending | Metadata currently references a missing file |
| IR35 explainer diagram | Explain Inside/Outside/TBC paths | Planned original flow diagram using semantic tokens, short labels and HTML/SVG source | Pending | Responsive SVG plus 1200px WebP fallback | Full equivalent adjacent text | Pending | Resource hub |

## Asset rules

- Reference screenshots from the supplied PDF and `tmp/ui-audit/` are analysis-only and must not enter `public/`.
- Do not hotlink source-site imagery or reproduce competitor product screens.
- Generated raster assets, if later approved, live under `public/images/generated/<feature>/` with intrinsic size, WebP/AVIF output, mobile crop and recorded prompt summary.
- Informative images require useful alt text; decorative images use empty alt text.
- Important copy, rates, statuses and controls remain live HTML.

