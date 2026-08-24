"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sesClient = void 0;
require("./env");
const client_ses_1 = require("@aws-sdk/client-ses");
exports.sesClient = new client_ses_1.SESClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
        }
        : undefined,
});
//# sourceMappingURL=ses.js.map