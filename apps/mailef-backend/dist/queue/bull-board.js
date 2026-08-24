"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@bull-board/api");
const bullMQAdapter_1 = require("@bull-board/api/bullMQAdapter");
const express_1 = require("@bull-board/express");
const mail_queue_1 = require("./mail.queue");
const mail_dead_letter_queue_1 = require("./mail.dead-letter.queue");
/**
 * Bull Board server adapter — mounted behind auth in admin routes.
 */
const serverAdapter = new express_1.ExpressAdapter();
serverAdapter.setBasePath("/api/admin/queues");
// Additional queues can be discovered dynamically if needed.
const queues = [mail_queue_1.mailQueue, mail_dead_letter_queue_1.mailDeadLetterQueue];
(0, api_1.createBullBoard)({
    queues: queues.map((q) => new bullMQAdapter_1.BullMQAdapter(q)),
    serverAdapter,
});
exports.default = serverAdapter;
//# sourceMappingURL=bull-board.js.map