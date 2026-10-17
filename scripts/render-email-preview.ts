import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderBetaLaunchEmail, renderWelcomeEmail } from "../src/lib/email/templates";

async function main() {
  const outputDirectory = path.join(process.cwd(), "tmp", "email-preview");
  await mkdir(outputDirectory, { recursive: true });
  const email = renderWelcomeEmail({ firstName: "Anvesh" });
  await writeFile(path.join(outputDirectory, "welcome.html"), email.html, "utf8");
  const launch = renderBetaLaunchEmail();
  await writeFile(path.join(outputDirectory, "beta-launch.html"), launch.html, "utf8");
}

void main();
