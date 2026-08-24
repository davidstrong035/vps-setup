import "./config/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { requestLogger } from "./middleware/request.middleware";
import { attachRequestContext } from "./middleware/request-context.middleware";

import authRoutes from "./routes/auth.routes";
import listRoutes from "./routes/list.routes";
import subscriberRoutes from "./routes/subscriber.routes";
import templateRoutes from "./routes/template.routes";
import campaignRoutes from "./routes/campaign.routes";
import webhookRoutes from "./routes/webhook.routes";
import adminRoutes from "./routes/admin.routes";
import deadLetterRoutes from "./routes/dead-letter.routes";
import bullBoardAdapter from "./queue/bull-board";
import bullBoardAuthMiddleware from "./queue/bull-board-auth";

import domainRoutes from "./routes/domain.routes";
import senderRoutes from "./routes/sender.routes";
import userDomainRoutes from "./routes/user-domain.routes";
import { errorHandler, notFound } from "./middleware/error.middleware";

const app = express();

const allowedOrigins = [process.env.CLIENT_URL, process.env.CLIENT_URLS]
  .filter(Boolean)
  .flatMap((value) => value!.split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);

// security headers — allow the frontend to embed pages (e.g. Bull Board) in iframes
const parseClientUrls = (): string[] => {
  const raw = [process.env.CLIENT_URL, process.env.CLIENT_URLS].filter(Boolean);
  return raw
    .flatMap((v) => (v as string).split(","))
    .map((origin) => origin.trim())
    .filter(Boolean);
};
const clientUrls = parseClientUrls();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "frame-ancestors": ["'self'", ...clientUrls],
      },
    },
  }),
);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.options("/{*path}", cors());

// body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// SNS sends text/plain for webhooks
app.use("/webhooks", express.text({ type: "*/*" }));

// attach request-scoped context for tracing/auditing
app.use(attachRequestContext);

// HTTP request logging
app.use(requestLogger);


// root health/info route
app.get("/", (_req, res) => res.json({ status: "ok", message: "Maileff API root" }));
// health check is defined in server.ts with enhanced system status

// routes
app.use("/api/auth", authRoutes);
app.use("/api/lists", listRoutes);
app.use("/api/lists", subscriberRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/campaigns", campaignRoutes);
// Bull Board — mounted before the admin router's own authenticate middleware
// with its own auth handler that supports header, query param, and cookie tokens.
app.use("/api/admin/queues", bullBoardAuthMiddleware, bullBoardAdapter.getRouter());

app.use("/api/admin", adminRoutes);
app.use("/api/admin", deadLetterRoutes);
app.use("/api/domains", domainRoutes);
app.use("/api/sender", senderRoutes);
app.use("/api/user-domains", userDomainRoutes);
app.use("/webhooks", webhookRoutes);

// public unsubscribe
app.get("/unsubscribe", (req, res) => {
  res.redirect(`/api/lists/unsubscribe?${new URLSearchParams(req.query as any)}`);
});

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

export default app;
