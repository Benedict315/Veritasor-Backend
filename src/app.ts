import express, { type Express } from "express";
import cors from "cors";
import type { Server } from "node:http";
import { config } from "./config/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { apiVersionMiddleware, versionResponseMiddleware } from "./middleware/apiVersion.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { attestationsRouter } from "./routes/attestations.js";
import businessRoutes from "./routes/businesses.js";
import { healthRouter } from "./routes/health.js";
import { runStartupDependencyReadinessChecks } from "./startup/readiness.js";

export const app = express();

/**
 * Synchronously configure the Express application with all middleware and routes.
 * This is called at module load time so `app` is ready for direct import in tests.
 */
function configureAppSync(): void {
  // API version negotiation middleware (must be early to capture version signals)
  app.use(apiVersionMiddleware);
  app.use(versionResponseMiddleware);

  app.use(cors(config.cors));
  app.use(express.json());
  app.use(requestLogger);

  // Route mounts
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/attestations", attestationsRouter);
  app.use("/api/businesses", businessRoutes);

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);
}

configureAppSync();

/**
 * Run async startup dependency readiness checks.
 * Throws if critical dependencies are not ready.
 */
export async function runReadinessChecks(): Promise<void> {
  const readinessReport = await runStartupDependencyReadinessChecks();

  if (!readinessReport.ready) {
    const failedChecks = readinessReport.checks
      .filter((check) => !check.ready)
      .map((check) => `${check.dependency}: ${check.reason ?? "failed"}`)
      .join("; ");

    throw new Error(`Startup readiness checks failed: ${failedChecks}`);
  }
}

/**
 * Start the HTTP server after readiness checks pass.
 * @param port - Port number to listen on
 * @returns The HTTP server instance
 */
export async function startServer(port: number): Promise<Server> {
  await runReadinessChecks();

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on port ${port}`);
      resolve(server);
    });
  });
}

