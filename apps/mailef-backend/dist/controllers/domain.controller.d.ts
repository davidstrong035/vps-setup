import { Request, Response } from 'express';
export declare const getAllDomains: (_req: Request, res: Response) => Promise<void>;
export declare const createDomain: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const updateDomain: (req: Request, res: Response) => Promise<void>;
export declare const deleteDomain: (req: Request, res: Response) => Promise<void>;
export declare const setDefaultDomain: (req: Request, res: Response) => Promise<void>;
export declare const setBlocklistStatus: (req: Request, res: Response) => Promise<void>;
export declare const setCooldown: (req: Request, res: Response) => Promise<void>;
export declare const setReputationScore: (req: Request, res: Response) => Promise<void>;
export declare const resetBounceComplaint: (req: Request, res: Response) => Promise<void>;
export declare const resetDomainUsage: (req: Request, res: Response) => Promise<void>;
//# sourceMappingURL=domain.controller.d.ts.map