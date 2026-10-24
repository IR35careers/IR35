import { runSchedule } from "./cron";

runSchedule(process.argv[2], process.env).then(result => console.log(`cron_${result}`)).catch(() => {
  console.error("cron_failed; values and provider errors withheld"); process.exitCode = 1;
});
