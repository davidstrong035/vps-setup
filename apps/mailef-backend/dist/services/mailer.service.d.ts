import { type RuntimeMailSettings } from "./platform-settings.service";
interface SendMailOptions {
    to: string;
    subject: string;
    html: string;
    fromName: string;
    fromEmail: string;
    userId?: string | null;
}
export declare const verifyMailProvider: (overrides?: Partial<RuntimeMailSettings>) => Promise<void>;
export declare const sendEmail: (options: SendMailOptions, overrides?: Partial<RuntimeMailSettings>) => Promise<string>;
export {};
//# sourceMappingURL=mailer.service.d.ts.map