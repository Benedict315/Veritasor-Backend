import express, { type Express } from "express";
import type { Server } from "node:http";
import { config } from "./config/index.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { apiVersionMiddleware, versionResponseMiddleware } from "./middleware/apiVersion.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { attestationsRouter } from "./routes/attestations.js";
import businessRoutes from "./routes/businesses.js";
import { healthRouter } from "./routes/health.js";

export const app: Express = express();

app.use(apiVersionMiddleware);
app.use(versionResponseMiddleware);
app.use(createCorsMiddleware());
app.use(express.json());
app.use(requestLogger);

app.use("/api/health", healthRouter);
app.use("/api/attestations", attestationsRouter);
app.use("/api/auth", authRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/businesses", businessRoutes);
app.use(errorHandler);

/**
 * Start the HTTP server after running readiness checks.
 */
export async function startServer(port: number): Promise<Server> {
  const { runStartupDependencyReadinessChecks } = await import(
    "./startup/readiness.js"
  );
  const readinessReport = await runStartupDependencyReadinessChecks();

  if (!readinessReport.ready) {
    const failedChecks = readinessReport.checks
      .filter((check) => !check.ready)
      .map((check) => `${check.dependency}: ${check.reason ?? "failed"}`)
      .join("; ");

    throw new Error(`Startup readiness failed: ${failedChecks}`);
  }

  return new Promise<Server>((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[Server] Listening on port ${port}`);
      resolve(server);
    });
  });
}
