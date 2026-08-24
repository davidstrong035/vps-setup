import { Response } from "express";
import { AuthRequest } from "../types";
export declare const listUserDomains: (req: AuthRequest, res: Response) => Promise<void>;
export declare const createUserDomain: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteUserDomain: (req: AuthRequest, res: Response) => Promise<void>;
export declare const setUserDefaultDomain: (req: AuthRequest, res: Response) => Promise<void>;
export declare const listUserRelays: (req: AuthRequest, res: Response) => Promise<void>;
export declare const createUserRelay: (req: AuthRequest, res: Response) => Promise<void>;
export declare const updateUserRelay: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteUserRelay: (req: AuthRequest, res: Response) => Promise<void>;
export declare const linkRelayToDomain: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getUserNextSendTime: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getUserSendTimes: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=user-domain.controller.d.ts.map