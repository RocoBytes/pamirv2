export function resolveAlertRecipient({ orgAlertEmail, override, nodeEnv, }) {
    const trimmedOverride = override?.trim();
    const hasOverride = Boolean(trimmedOverride);
    const isProduction = nodeEnv === 'production';
    if (!isProduction && hasOverride) {
        return { recipient: trimmedOverride, overrideIgnored: false };
    }
    return {
        recipient: orgAlertEmail,
        overrideIgnored: isProduction && hasOverride,
    };
}
