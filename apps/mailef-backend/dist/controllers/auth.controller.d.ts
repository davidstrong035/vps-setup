import { Response } from "express";
import { AuthRequest } from "../types";
export declare const register: (req: AuthRequest, res: Response) => Promise<void>;
export declare const login: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMe: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMyEmailAllocation: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMyEmailAllocationHistory: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMyEmailActivity: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getMyMailSettings: (req: AuthRequest, res: Response) => Promise<void>;
export declare const forgotPassword: (req: AuthRequest, res: Response) => Promise<void>;
export declare const resetPassword: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=auth.controller.d.ts.map