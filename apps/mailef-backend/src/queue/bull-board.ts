import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { mailQueue } from "./mail.queue";
import { mailDeadLetterQueue } from "./mail.dead-letter.queue";

/**
 * Bull Board server adapter — mounted behind auth in admin routes.
 */
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/api/admin/queues");

// Additional queues can be discovered dynamically if needed.
const queues = [mailQueue, mailDeadLetterQueue];

createBullBoard({
  queues: queues.map((q) => new BullMQAdapter(q)),
  serverAdapter,
});

export default serverAdapter;
