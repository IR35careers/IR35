import { projectConfig } from "./scripts/bots/vercel-config";

// System-provided project identity, never a branch's claimed preview flag.
// Unknown/missing project IDs retain every production deployment hold.
export const config = projectConfig(process.env.VERCEL_PROJECT_ID);
