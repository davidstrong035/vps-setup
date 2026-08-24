export interface ParsedListRow {
    email: string;
    firstName?: string;
    lastName?: string;
}
export interface ProcessedS3ListResult {
    subscriberCount: number;
    chunkCount: number;
    manifestKey: string;
    previewRows: ParsedListRow[];
}
export declare const buildListUploadKey: (userId: string, listId: string, fileName: string) => string;
export declare const getMaxUploadFileSize: () => number;
export declare const getListUploadUrl: (userId: string, listId: string, fileName: string, contentType: string) => Promise<{
    uploadUrl: string;
    objectKey: string;
    maxFileSize: number;
}>;
export declare const processUploadedListObject: (userId: string, listId: string, objectKey: string) => Promise<ProcessedS3ListResult>;
export declare const getListManifest: (manifestKey: string) => Promise<{
    chunkKeys: string[];
}>;
export declare const deleteListObjects: (userId: string, listId: string, opts: {
    s3UploadKey?: string;
    s3ManifestKey?: string;
    s3ChunkCount?: number;
}) => Promise<void>;
export declare const getChunkRows: (chunkKey: string) => Promise<ParsedListRow[]>;
//# sourceMappingURL=s3-list.service.d.ts.map