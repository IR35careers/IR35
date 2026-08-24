import { describe, expect, it } from "vitest";
import {
  automaticSubmissionPriority,
  bestDiscoveryCandidate,
  discoveryCandidateScore,
  discoveryProviderFromAdzunaPage,
  discoveryProviderOrder,
} from "@/lib/application-runner/source-resolution";

const job = {
  title: "Mould Joiner/ Carpenter",
  company_name: "Net-Temps",
  location: "Nottingham, Nottinghamshire",
};

describe("application source resolution", () => {
  it("recognises Resume Library evidence on an Adzuna listing", () => {
    expect(
      discoveryProviderFromAdzunaPage({
        body: "Mould Joiner role",
        html: '<img src="logo_cv_library.png" alt="Resume-Library">',
      }),
    ).toBe("cv_library");
    expect(
      discoveryProviderFromAdzunaPage({ body: "Apply", html: "" }),
    ).toBeNull();
  });

  it("recognises Totaljobs evidence on an Adzuna listing", () => {
    expect(
      discoveryProviderFromAdzunaPage({
        body: "DevOps Engineer",
        html: '<img alt="Total Jobs" src="provider-logo.png">',
      }),
    ).toBe("totaljobs");
  });

  it("checks both recovery boards when an Adzuna block hides its source", () => {
    expect(
      discoveryProviderOrder({
        body: "Access denied",
        html: "<title>Forbidden</title>",
      }),
    ).toEqual(["totaljobs", "cv_library"]);
    expect(
      discoveryProviderOrder({
        body: "Apply through Resume Library",
        html: '<img src="logo_cv_library.png">',
      }),
    ).toEqual(["cv_library", "totaljobs"]);
  });

  it("prioritises direct application forms over discovery links", () => {
    const base = { source_domain: "example.test" };
    expect(
      automaticSubmissionPriority({
        ...base,
        apply_url: "https://jobs.ashbyhq.com/example/role",
      }),
    ).toBeGreaterThan(
      automaticSubmissionPriority({
        ...base,
        apply_url: "https://www.adzuna.co.uk/details/123",
      }),
    );
    expect(
      automaticSubmissionPriority({
        ...base,
        apply_url: "not-a-url",
      }),
    ).toBe(0);
  });

  it("requires both the role and company before using a direct listing", () => {
    const exact = {
      title: "Mould Joiner/ Carpenter",
      context:
        "Mould Joiner/ Carpenter Posted 2 days ago by Net-Temps Nottingham Contract Easy Apply",
      href: "/job/225520701/mould-joiner-carpenter",
    };
    expect(discoveryCandidateScore(exact, job)).toBeGreaterThanOrEqual(95);
    expect(
      discoveryCandidateScore(
        { ...exact, context: exact.context.replace("Net-Temps", "Another Co") },
        job,
      ),
    ).toBe(0);
  });

  it("selects one unambiguous original listing", () => {
    expect(
      bestDiscoveryCandidate(
        [
          {
            title: "Mould Joiner/ Carpenter",
            context:
              "Posted by Net-Temps in Nottingham. Contract. Easy Apply.",
            href: "/job/225520701/mould-joiner-carpenter",
          },
          {
            title: "Mould Set Up",
            context: "Posted by Net-Temps in Nottingham. Contract.",
            href: "/job/225505345/mould-set-up",
          },
        ],
        job,
      )?.href,
    ).toBe("/job/225520701/mould-joiner-carpenter");
  });

  it("selects an exact Totaljobs role only when the company also matches", () => {
    const totalJobsRole = {
      title: "DevOps Engineer",
      company_name: "TALENT INTERNATIONAL UK LTD",
      location: "UK",
    };
    expect(
      bestDiscoveryCandidate(
        [
          {
            title: "DevOps Engineer",
            context:
              "TALENT INTERNATIONAL UK LTD UK £480.00 per day Contract Published 2 days ago",
            href:
              "/job/devops-engineer/talent-international-uk-ltd-job107879337",
          },
          {
            title: "DevOps Engineer",
            context: "Another recruiter London £550 per day Contract",
            href: "/job/devops-engineer/another-recruiter-job107879999",
          },
        ],
        totalJobsRole,
      )?.href,
    ).toBe(
      "/job/devops-engineer/talent-international-uk-ltd-job107879337",
    );
  });

  it("uses the advert description to distinguish duplicate title and company matches", () => {
    const totalJobsRole = {
      title: "DevOps Engineer",
      company_name: "TALENT INTERNATIONAL UK LTD",
      location: "UK",
      description:
        "Senior DevOps Engineer supporting an AWS data platform with Terraform, GitLab CI/CD, Python and active SC clearance.",
    };
    expect(
      bestDiscoveryCandidate(
        [
          {
            title: "DevOps Engineer",
            context:
              "TALENT INTERNATIONAL UK LTD UK £480 per day. Senior DevOps Engineer supporting an AWS data platform with Terraform, GitLab CI/CD, Python and active SC clearance.",
            href:
              "/job/devops-engineer/talent-international-uk-ltd-job107879337",
          },
          {
            title: "DevOps Engineer",
            context:
              "TALENT INTERNATIONAL UK LTD UK £480 per day. Streamline software development, testing and deployment processes.",
            href:
              "/job/devops-engineer/talent-international-uk-ltd-job107877198",
          },
        ],
        totalJobsRole,
      )?.href,
    ).toBe(
      "/job/devops-engineer/talent-international-uk-ltd-job107879337",
    );
  });
});
