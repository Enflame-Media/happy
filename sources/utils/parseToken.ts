import { decodeBase64 } from "@/encryption/base64";
import { decodeUTF8, encodeUTF8 } from "@/encryption/text";
import { AppError, ErrorCodes } from "@/utils/errors";

export function parseToken(token: string) {
    const [header, payload, signature] = token.split('.');
    const sub = JSON.parse(decodeUTF8(decodeBase64(payload))).sub;
    if (typeof sub !== 'string') {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, 'Invalid token');
    }
    return sub;
}