import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApplicationRunnerTestForm } from "@/components/admin/ApplicationRunnerTestForm";
import { verifyApplicationRunnerTestToken } from "@/lib/application-runner/test-token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Application runner test", robots: { index: false, follow: false } };

export default async function ApplicationRunnerTestPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  if (!verifyApplicationRunnerTestToken(token)) notFound();
  return <ApplicationRunnerTestForm />;
}
