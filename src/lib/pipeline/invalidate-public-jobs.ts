import { revalidatePath, revalidateTag } from "next/cache";

/** The sitemap has its own Full Route cache, separate from inventory batches. */
export function invalidatePublicJobs(): void {
  revalidateTag("public-jobs", { expire: 0 });
  revalidatePath("/sitemap.xml");
}
