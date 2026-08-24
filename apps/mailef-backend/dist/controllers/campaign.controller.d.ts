import { Response } from "express";
import { AuthRequest } from "../types";
export declare const getCampaigns: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMyQueueOverview: (req: AuthRequest, res: Response) => Promise<void>;
export declare const createCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const updateCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const sendCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const scheduleCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getCampaignStats: (req: AuthRequest, res: Response) => Promise<void>;
export declare const pauseUserCampaign: (req: AuthRequest, res: Response) => Promise<void>;
export declare const cancelUserCampaign: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=campaign.controller.d.ts.map