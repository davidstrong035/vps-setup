import { Router } from "express";
import {
  getSubscribers,
  addSubscriber,
  initiateS3SubscriberImport,
  completeS3SubscriberImport,
  importSubscribers,
  deleteSubscriber,
  unsubscribe,
} from "../controllers/subscriber.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// public unsubscribe link
router.get("/unsubscribe", unsubscribe);

// protected routes
router.get("/:listId/subscribers", authenticate, getSubscribers);
router.post("/:listId/subscribers", authenticate, addSubscriber);
router.post("/:listId/subscribers/import/initiate", authenticate, initiateS3SubscriberImport);
router.post("/:listId/subscribers/import/complete", authenticate, completeS3SubscriberImport);
router.post("/:listId/subscribers/import", authenticate, importSubscribers);
router.delete("/:listId/subscribers/:subscriberId", authenticate, deleteSubscriber);

export default router;
