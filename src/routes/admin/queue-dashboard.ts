/**
 * Bull Board Queue Dashboard
 *
 * Provides a web UI to monitor and manage BullMQ queues.
 * Access at /admin/queues when USE_JOB_QUEUE=true
 *
 * Security:
 * - Protected by HTTP Basic Auth (configured in index.ts)
 * - Set ADMIN_USERNAME and ADMIN_PASSWORD env vars
 * - Dashboard disabled in production if ADMIN_PASSWORD not set
 *
 * Features:
 * - View all queues (chat, deep-research, paper-generation, file-process)
 * - Monitor job states (waiting, active, completed, failed)
 * - Inspect job data and results
 * - Retry failed jobs
 * - Clean queues
 */

import { Elysia } from "elysia";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";
import { isJobQueueEnabled } from "../../services/queue/connection";
import { getChatQueue, getDeepResearchQueue, getFileProcessQueue, getPaperGenerationQueue } from "../../services/queue/queues";
import logger from "../../utils/logger";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Create the Bull Board dashboard route
 * Only initializes when job queue is enabled
 */
export function createQueueDashboard(): Elysia | null {
  if (!isJobQueueEnabled()) {
    logger.info("queue_dashboard_disabled_job_queue_not_enabled");
    return null;
  }

  // In production, require ADMIN_PASSWORD to be set
  if (IS_PRODUCTION && !ADMIN_PASSWORD) {
    logger.warn(
      "queue_dashboard_disabled_no_admin_password: Set ADMIN_PASSWORD env var to enable Bull Board in production"
    );
    return null;
  }

  try {
    // Get queue instances
    const chatQueue = getChatQueue();
    const deepResearchQueue = getDeepResearchQueue();
    const fileProcessQueue = getFileProcessQueue();
    const paperGenerationQueue = getPaperGenerationQueue();

    // Create Bull Board server adapter
    const serverAdapter = new ElysiaAdapter("/admin/queues");

    // Build queue adapters list
    const queueAdapters = [
      new BullMQAdapter(chatQueue),
      new BullMQAdapter(deepResearchQueue),
      new BullMQAdapter(paperGenerationQueue),
    ];

    // Add file-process queue if available
    if (fileProcessQueue) {
      queueAdapters.push(new BullMQAdapter(fileProcessQueue));
    }

    // Create Bull Board with queue adapters
    createBullBoard({
      queues: queueAdapters,
      serverAdapter,
    });

    logger.info(
      { path: "/admin/queues", authEnabled: !!ADMIN_PASSWORD },
      "queue_dashboard_initialized"
    );

    // Return the Elysia plugin (auth is handled separately in index.ts)
    return serverAdapter.registerPlugin() as unknown as Elysia;
  } catch (error) {
    logger.error({ error }, "queue_dashboard_initialization_failed");
    return null;
  }
}
