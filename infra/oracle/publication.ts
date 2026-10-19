import { z } from "zod";
import { shaSchema, WORKER_REPOSITORY } from "./image-trust";

/** A workflow_run event is not itself proof of all required release checks. */
export async function verifyPublicationGates(input: unknown, request: (path: string) => Promise<unknown>) {
  const revision = shaSchema.parse(input);
  const repository = z.object({ full_name: z.literal(WORKER_REPOSITORY), private: z.literal(false), default_branch: z.literal("main") })
    .parse(await request(`/repos/${WORKER_REPOSITORY}`));
  const head = z.object({ sha: shaSchema }).parse(await request(`/repos/${repository.full_name}/commits/main`));
  if (head.sha !== revision) throw new Error("Main moved; publication must wait for its own release checks.");
  const runs = z.object({ workflow_runs: z.array(z.object({ head_sha: shaSchema, head_branch: z.string().nullable(),
    event: z.string(), path: z.string(), status: z.string(), conclusion: z.string().nullable(),
    head_repository: z.object({ full_name: z.literal(WORKER_REPOSITORY) }),
  })).max(100) });
  for (const workflow of ["quality.yml", "oracle-arm64.yml", "codeql.yml"]) {
    const result = runs.parse(await request(`/repos/${repository.full_name}/actions/workflows/${workflow}/runs?head_sha=${revision}&event=push&per_page=20`));
    if (!result.workflow_runs.some(run => run.head_sha === revision && run.head_branch === "main" && run.event === "push"
      && run.path === `.github/workflows/${workflow}` && run.status === "completed" && run.conclusion === "success"))
      throw new Error("Exact main commit requires successful release, native ARM and CodeQL push checks.");
  }
  return revision;
}
