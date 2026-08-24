import mongoose from "mongoose";
import { IWebhookEvent } from "../types";
declare const _default: mongoose.Model<IWebhookEvent, {}, {}, {}, mongoose.Document<unknown, {}, IWebhookEvent, {}, mongoose.DefaultSchemaOptions> & IWebhookEvent & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IWebhookEvent>;
export default _default;
//# sourceMappingURL=WebhookEvent.model.d.ts.map