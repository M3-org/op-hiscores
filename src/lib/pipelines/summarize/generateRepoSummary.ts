import { createStep, pipe, mapStep } from "../types";
import { SummarizerPipelineContext } from "./context";
import { generateRepoSummary } from "./aiRepoSummary";
import { generateTimeIntervals } from "../generateTimeIntervals";
import { IntervalType, TimeInterval, toDateString } from "@/lib/date-utils";
import { storeRepoSummary } from "./mutations";
import { isNotNullOrUndefined } from "@/lib/typeHelpers";
import { getRepoMetrics } from "../export/queries";
import { getRepoFilePath, writeToFile } from "@/lib/fsHelpers";
import { existsSync } from "node:fs";

/**
 * Check if a summary already exists for a repository on a specific date and interval type
 */
async function checkExistingSummary(
  repoId: string,
  date: string,
  intervalType: IntervalType,
  outputDir?: string,
): Promise<boolean> {
  if (!outputDir) return false;

  const filename = `${date}.md`;
  const summaryPath = getRepoFilePath(
    outputDir,
    repoId,
    "summaries",
    intervalType,
    filename,
  );

  return existsSync(summaryPath);
}

/**
 * Generate repository summary for a specific time interval
 */
export const generateRepoSummaryForInterval = createStep(
  "RepoSummary",
  async (
    { interval, repoId }: { interval: TimeInterval; repoId: string },
    context: SummarizerPipelineContext,
  ) => {
    const { logger, aiSummaryConfig, overwrite } = context;

    if (!aiSummaryConfig.enabled) {
      logger?.debug(
        `AI summary generation is disabled, skipping ${interval.intervalType} summary for ${repoId}`,
      );
      return null;
    }

    const intervalLogger = logger
      ?.child(interval.intervalType)
      .child(toDateString(interval.intervalStart));

    // Query parameters for this interval
    const dateRange = {
      startDate: toDateString(interval.intervalStart),
      endDate: toDateString(interval.intervalEnd),
    };

    try {
      // Check if summary already exists (skip if overwrite is true)
      if (!overwrite) {
        const summaryExists = await checkExistingSummary(
          repoId,
          dateRange.startDate,
          interval.intervalType,
          context.outputDir,
        );
        if (summaryExists) {
          intervalLogger?.debug(
            `${interval.intervalType} summary already exists for ${repoId} on ${dateRange.startDate}, skipping generation`,
          );
          return;
        }
      }

      // Get metrics for this time period
      const metrics = await getRepoMetrics({
        repository: repoId,
        dateRange,
      });

      // Generate the summary based on interval type
      const summary = await generateRepoSummary(
        metrics,
        aiSummaryConfig,
        dateRange,
        interval.intervalType,
      );

      if (!summary) {
        intervalLogger?.debug(
          `No activity for repo ${repoId} on ${dateRange.startDate}, skipping summary generation`,
        );
        return;
      }

      // Store the summary in database
      await storeRepoSummary(
        repoId,
        toDateString(interval.intervalStart),
        summary,
        interval.intervalType,
      );

      // Export summary as markdown file if outputDir is configured
      const filename = `${toDateString(interval.intervalStart)}.md`;
      const outputPath = getRepoFilePath(
        context.outputDir,
        repoId,
        "summaries",
        interval.intervalType,
        filename,
      );
      await writeToFile(outputPath, summary);

      intervalLogger?.info(
        `Generated and exported ${interval.intervalType} summary for repo ${repoId}`,
        {
          outputPath,
        },
      );

      return summary;
    } catch (error) {
      intervalLogger?.error(`Error processing repository ${repoId}`, {
        error: (error as Error).message,
      });
    }
  },
);

/**
 * Pipeline for generating monthly repository summaries
 */
export const generateMonthlyRepoSummaries = pipe(
  generateTimeIntervals<{ repoId: string }>("month"),
  (input, context: SummarizerPipelineContext) => {
    if (context.enabledIntervals.month) {
      return input;
    }
    return [];
  },
  mapStep(generateRepoSummaryForInterval),
  createStep("Filter null results", (results) => {
    return results.filter(isNotNullOrUndefined);
  }),
);

/**
 * Pipeline for generating weekly repository summaries
 */
export const generateWeeklyRepoSummaries = pipe(
  generateTimeIntervals<{ repoId: string }>("week"),
  (input, context: SummarizerPipelineContext) => {
    if (context.enabledIntervals.week) {
      return input;
    }
    return [];
  },
  mapStep(generateRepoSummaryForInterval),
  createStep("Filter null results", (results) => {
    return results.filter(isNotNullOrUndefined);
  }),
);

/**
 * Pipeline for generating daily repository summaries
 */
export const generateDailyRepoSummaries = pipe(
  generateTimeIntervals<{ repoId: string }>("day"),
  (input, context: SummarizerPipelineContext) => {
    if (context.enabledIntervals.day) {
      return input;
    }
    return [];
  },
  mapStep(generateRepoSummaryForInterval),
  createStep("Filter null results", (results) => {
    return results.filter(isNotNullOrUndefined);
  }),
);
