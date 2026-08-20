import { describe, expect, it } from "vitest";
import { alertToPreviewApi, alertToSearch, type JobAlertFilter } from "@/lib/alerts";

const alert: JobAlertFilter = {
  id: "alert-1",
  name: "Outside platform roles",
  q: "platform engineer",
  ir35: "outside",
  remote: "hybrid",
  min_rate: 600,
  skills: ["AWS", "Terraform"],
  seniority: "senior",
  rate_type: "daily",
  sponsorship: "stated",
};

describe("job alert links", () => {
  it("preserves every saved filter when opening the job board", () => {
    const url = new URL(alertToSearch(alert), "https://www.ir35careers.com");
    expect(url.pathname).toBe("/jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "platform engineer",
      ir35: "outside",
      remote: "hybrid",
      min_rate: "600",
      skills: "AWS,Terraform",
      seniority: "senior",
      rate_type: "daily",
      sponsorship: "stated",
    });
  });

  it("builds a bounded preview request and supports an unfiltered alert", () => {
    expect(new URL(alertToPreviewApi(alert, 50), "https://www.ir35careers.com").searchParams.get("per_page")).toBe("10");
    expect(alertToSearch({ ...alert, q: null, ir35: null, remote: null, min_rate: null, skills: [], seniority: null, rate_type: null, sponsorship: null })).toBe("/jobs");
  });
});
