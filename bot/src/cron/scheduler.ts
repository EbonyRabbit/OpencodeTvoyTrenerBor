import cron, { type ScheduledTask } from "node-cron";
import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { cleanupExpired } from "./dedup.js";
import { runEveningPoll } from "./evening-scheduler.js";
import { runMorningNotification } from "./morning.js";
import { runMeasurementReminder } from "./measurement-reminder.js";
import { runAutoResume, runResumeReminder } from "./resume.js";
import { logBotEvent } from "./logger.js";

const CLEANUP_CRON = "0 * * * *";
const POLL_CRON = "*/15 * * * *";

const tasks: ScheduledTask[] = [];

function wrapWithGuard(
  name: string,
  fn: () => Promise<void>,
): () => Promise<void> {
  let isRunning = false;

  return async () => {
    if (isRunning) {
      console.log(`[SCHEDULER] ${name}: previous run still active, skipping`);
      return;
    }
    isRunning = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[SCHEDULER] ${name} error:`, err);
      try {
        await logBotEvent(`cron:${name}`, {
          status: "error",
          details: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // logging failed, nothing we can do
      }
    } finally {
      isRunning = false;
    }
  };
}

export function startScheduler(bot: Bot<MyContext>): void {
  tasks.push(
    cron.schedule(CLEANUP_CRON, wrapWithGuard("dedup_cleanup", async () => {
      await cleanupExpired();
    })),
  );

  tasks.push(
    cron.schedule(POLL_CRON, wrapWithGuard("evening_poll", () => runEveningPoll(bot))),
  );

  tasks.push(
    cron.schedule(POLL_CRON, wrapWithGuard("morning_notification", () => runMorningNotification(bot))),
  );

  tasks.push(
    cron.schedule(POLL_CRON, wrapWithGuard("measurement_reminder", () => runMeasurementReminder(bot))),
  );

  tasks.push(
    cron.schedule(POLL_CRON, wrapWithGuard("auto_resume", () => runAutoResume(bot))),
  );

  tasks.push(
    cron.schedule(POLL_CRON, wrapWithGuard("resume_reminder", () => runResumeReminder(bot))),
  );

  console.log(`[SCHEDULER] ${tasks.length} cron tasks started`);
}

export function stopScheduler(): void {
  for (const task of tasks) {
    task.stop();
  }
  tasks.length = 0;
  console.log("[SCHEDULER] All cron tasks stopped");
}
