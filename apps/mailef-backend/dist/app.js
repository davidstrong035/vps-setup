"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./config/env");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const request_middleware_1 = require("./middleware/request.middleware");
const request_context_middleware_1 = require("./middleware/request-context.middleware");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const list_routes_1 = __importDefault(require("./routes/list.routes"));
const subscriber_routes_1 = __importDefault(require("./routes/subscriber.routes"));
const template_routes_1 = __importDefault(require("./routes/template.routes"));
const campaign_routes_1 = __importDefault(require("./routes/campaign.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const dead_letter_routes_1 = __importDefault(require("./routes/dead-letter.routes"));
const bull_board_1 = __importDefault(require("./queue/bull-board"));
const bull_board_auth_1 = __importDefault(require("./queue/bull-board-auth"));
const domain_routes_1 = __importDefault(require("./routes/domain.routes"));
const sender_routes_1 = __importDefault(require("./routes/sender.routes"));
const user_domain_routes_1 = __importDefault(require("./routes/user-domain.routes"));
const error_middleware_1 = require("./middleware/error.middleware");
const app = (0, express_1.default)();
const allowedOrigins = [process.env.CLIENT_URL, process.env.CLIENT_URLS]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((origin) => origin.trim())
    .filter(Boolean);
// security headers — allow the frontend to embed pages (e.g. Bull Board) in iframes
const parseClientUrls = () => {
    const raw = [process.env.CLIENT_URL, process.env.CLIENT_URLS].filter(Boolean);
    return raw
        .flatMap((v) => v.split(","))
        .map((origin) => origin.trim())
        .filter(Boolean);
};
const clientUrls = parseClientUrls();
app.use((0, helmet_1.default)({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            ...helmet_1.default.contentSecurityPolicy.getDefaultDirectives(),
            "frame-ancestors": ["'self'", ...clientUrls],
        },
    },
}));
// CORS
app.use((0, cors_1.default)({
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
}));
app.options("/{*path}", (0, cors_1.default)());
// body parsers
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// SNS sends text/plain for webhooks
app.use("/webhooks", express_1.default.text({ type: "*/*" }));
// attach request-scoped context for tracing/auditing
app.use(request_context_middleware_1.attachRequestContext);
// HTTP request logging
app.use(request_middleware_1.requestLogger);
// root health/info route
app.get("/", (_req, res) => res.json({ status: "ok", message: "Maileff API root" }));
// health check is defined in server.ts with enhanced system status
// routes
app.use("/api/auth", auth_routes_1.default);
app.use("/api/lists", list_routes_1.default);
app.use("/api/lists", subscriber_routes_1.default);
app.use("/api/templates", template_routes_1.default);
app.use("/api/campaigns", campaign_routes_1.default);
// Bull Board — mounted before the admin router's own authenticate middleware
// with its own auth handler that supports header, query param, and cookie tokens.
app.use("/api/admin/queues", bull_board_auth_1.default, bull_board_1.default.getRouter());
app.use("/api/admin", admin_routes_1.default);
app.use("/api/admin", dead_letter_routes_1.default);
app.use("/api/domains", domain_routes_1.default);
app.use("/api/sender", sender_routes_1.default);
app.use("/api/user-domains", user_domain_routes_1.default);
app.use("/webhooks", webhook_routes_1.default);
// public unsubscribe
app.get("/unsubscribe", (req, res) => {
    res.redirect(`/api/lists/unsubscribe?${new URLSearchParams(req.query)}`);
});
// 404 + error handler
app.use(error_middleware_1.notFound);
app.use(error_middleware_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map