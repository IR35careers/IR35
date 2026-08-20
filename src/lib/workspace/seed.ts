import { DEMO_JOBS } from "@/lib/demo-jobs";
import { prepareApplication } from "@/lib/workspace/engine";
import type { ContractorProfile, InboxMessage, WorkspaceState } from "@/lib/workspace/types";

export const SAMPLE_CONTRACTOR_PROFILE: ContractorProfile = {
  fullName: "Alex Morgan",
  email: "alex.morgan@example.test",
  phone: "+44 7700 900000",
  location: "London, UK",
  linkedInUrl: "https://www.linkedin.com/in/alex-morgan-example",
  portfolioUrl: "https://alex-morgan.example.test",
  rightToWork: "yes",
  availability: "within two weeks",
  noticePeriod: "two weeks",
  limitedCompanyName: "Morgan Platform Consulting Ltd",
  companyNumber: "12345678",
  vatRegistered: true,
  clearance: "Eligible for BPSS; no active SC clearance claimed",
  defaultCvLabel: "Platform Engineering CV v4",
  forwardingEmail: "alex.morgan@example.test",
  networkContacts: [
    {
      id: "network-demo-sam",
      name: "Sam Taylor",
      company: "Northstar Digital",
      role: "Platform Engineering Lead",
      relationship: "Former delivery colleague",
      channel: "LinkedIn",
      notes: "Worked together on a cloud migration. Ask for context, not an assumed referral.",
      nextFollowUp: "2026-08-22",
      stage: "warm",
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z",
    },
  ],
  referralRequests: [],
};

export const SAMPLE_CV_TEXT = `Alex Morgan
alex.morgan@example.test | London | linkedin.com/in/alex-morgan-example

PROFESSIONAL SUMMARY
Senior platform and DevOps engineer delivering secure cloud services for UK organisations.

TECHNICAL SKILLS
AWS, Terraform, Kubernetes, Docker, Git, CI/CD, PostgreSQL, Python

PROFESSIONAL EXPERIENCE
Senior Platform Engineer | Example Consultancy | 2022-present
- Led the delivery of reusable Terraform modules across AWS environments.
- Improved Kubernetes release reliability by introducing tested deployment checks.
- Built CI/CD workflows and operational dashboards for product teams.
- Worked with security and engineering stakeholders to reduce platform risk.

DevOps Engineer | Example Digital | 2019-2022
- Supported container services and automated infrastructure changes.
- Documented recovery procedures and helped teams diagnose production incidents.

EDUCATION
BSc Computer Science
`;

const PREVIEW_NOW = "2026-08-19T12:00:00.000Z";

function seedMessages(applicationId: string): InboxMessage[] {
  return [
    {
      id: "msg-demo-interview",
      applicationId,
      from: "talent@northstar.example.test",
      subject: "Availability for an initial contract discussion",
      preview: "Thanks for sharing your details. Could you confirm two suitable times?",
      body: "Hi Alex,\n\nThanks for sharing your details. Could you confirm two suitable times for a 30-minute contract discussion this week?\n\nRegards,\nNorthstar Talent",
      classification: "interview",
      receivedAt: "2026-08-19T11:00:00.000Z",
      read: false,
    },
    {
      id: "msg-demo-action",
      applicationId,
      from: "applications@northstar.example.test",
      subject: "Working-pattern confirmation required",
      preview: "Please confirm that you can attend the London office two days per week.",
      body: "Please confirm that you can attend the London office two days per week. This is a fictional local-preview message and no reply will be sent.",
      classification: "action_required",
      receivedAt: "2026-08-18T12:00:00.000Z",
      read: true,
    },
  ];
}

export function createSeedWorkspaceState(): WorkspaceState {
  const prepared = prepareApplication({
    job: DEMO_JOBS[0],
    profile: SAMPLE_CONTRACTOR_PROFILE,
    cvText: SAMPLE_CV_TEXT,
    resumeVersionLabel: SAMPLE_CONTRACTOR_PROFILE.defaultCvLabel,
  });
  const application = {
    ...prepared,
    id: "app-demo-northstar",
    status: "replied" as const,
    truthApproved: true,
    materialsApproved: true,
    submissionApproved: true,
    mode: "external_handoff" as const,
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: PREVIEW_NOW,
    events: [
      { id: "event-demo-created", applicationId: "app-demo-northstar", type: "created" as const, label: "Application packet created", createdAt: "2026-08-15T12:00:00.000Z" },
      { id: "event-demo-applied", applicationId: "app-demo-northstar", type: "status_changed" as const, label: "Marked as applied on the original listing", createdAt: "2026-08-16T12:00:00.000Z" },
      { id: "event-demo-replied", applicationId: "app-demo-northstar", type: "message_received" as const, label: "Recruiter response linked to this application", createdAt: "2026-08-19T11:00:00.000Z" },
    ],
  };

  return {
    version: 1,
    profile: SAMPLE_CONTRACTOR_PROFILE,
    applications: [application],
    messages: seedMessages(application.id),
    automation: {
      enabled: false,
      dryRunOnly: true,
      minimumMatch: 70,
      minimumDayRate: 500,
      ir35: ["outside"],
      workplaces: ["remote", "hybrid"],
      dailyLimit: 5,
      prepareCoverLetter: true,
      requireHumanApproval: true,
      excludedCompanies: [],
    },
    automationRuns: [],
    inbox: {
      alias: "alex.morgan@inbox.ir35careers.local",
      forwardingEmail: SAMPLE_CONTRACTOR_PROFILE.forwardingEmail,
      forwardingEnabled: true,
      providerState: "preview",
    },
    entitlement: {
      plan: "preview",
      preparationCredits: 25,
      billingState: "not_connected",
    },
  };
}
