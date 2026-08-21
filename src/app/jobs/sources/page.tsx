import { permanentRedirect } from "next/navigation";

export default function RetiredPublicSourceHealthPage() {
  permanentRedirect("/jobs");
}
