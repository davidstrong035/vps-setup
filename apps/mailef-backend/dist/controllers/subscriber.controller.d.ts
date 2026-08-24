import { Response } from "express";
import { AuthRequest } from "../types";
export declare const getSubscribers: (req: AuthRequest, res: Response) => Promise<void>;
export declare const addSubscriber: (req: AuthRequest, res: Response) => Promise<void>;
export declare const initiateS3SubscriberImport: (req: AuthRequest, res: Response) => Promise<void>;
export declare const completeS3SubscriberImport: (req: AuthRequest, res: Response) => Promise<void>;
export declare const importSubscribers: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteSubscriber: (req: AuthRequest, res: Response) => Promise<void>;
export declare const unsubscribe: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=subscriber.controller.d.ts.map