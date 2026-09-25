import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";
import { syncChatGeneratedImagePromptText, updateChatMessage, type ChatMessage } from "./chat-storage";
import { generatedImageFilename, generateImageFromConfiguredApi } from "./image-generation-service";
import { updateMomentPost } from "./moments-storage";
import type { MomentPost } from "./moments-types";
import { resolveMediaForUse } from "./media-resolver";

function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function dispatchChatMessagesUpdated(sessionId: string, message: ChatMessage): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat-messages-updated", {
        detail: { sessionId, message },
    }));
}

function dispatchMomentsUpdated(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("moments-updated"));
}

export function createPendingChatGeneratedImageData(
    mediaData: ChatMessage["mediaData"] | undefined,
    description?: string,
): ChatMessage["mediaData"] {
    const label = (description || mediaData?.label || "").trim();
    return {
        ...mediaData,
        label,
        imageGenerationStatus: "pending",
        imageGenerationError: undefined,
    };
}

export function isPendingChatGeneratedImageMessage(message: Pick<ChatMessage, "mediaType" | "mediaData">): boolean {
    return message.mediaType === "image" && message.mediaData?.imageGenerationStatus === "pending";
}

/** Save a text photo without invoking any image API. Its description stays editable in every app. */
export function saveChatImageDescription(message: ChatMessage, description: string): ChatMessage {
    const label = description.trim();
    if (!label) throw new Error("图片描述不能为空");
    const updated = updateChatMessage(message.id, {
        content: "",
        mediaType: "image",
        mediaUrl: undefined,
        mediaData: { ...message.mediaData, label, imageSource: undefined, photoLibraryId: undefined, imageGenerationStatus: "text", imageGenerationError: undefined },
    });
    if (!updated) throw new Error("原消息不存在，无法保存图片描述");
    dispatchChatMessagesUpdated(updated.sessionId, updated);
    return updated;
}

export async function generateAndApplyChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    options?: { signal?: AbortSignal; description?: string; useReferenceImage?: boolean; forceGenerated?: boolean },
): Promise<ChatMessage> {
    const previousDescription = message.mediaData?.label?.trim() || "";
    const description = (options?.description ?? previousDescription).trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");

    const effectiveUseReference = options?.useReferenceImage !== undefined
        ? options.useReferenceImage
        : (message.mediaData?.useReferenceImage === true);

    if (
        (previousDescription && previousDescription !== description) ||
        (options?.useReferenceImage !== undefined && options.useReferenceImage !== (message.mediaData?.useReferenceImage === true))
    ) {
        syncChatGeneratedImagePromptText(message.id, previousDescription, description, options?.useReferenceImage);
    }

    // 重试路径：先落库为 pending 并广播，气泡立刻切到"生成中"态（首次生图本来就是 pending，无需重写）。
    // 之后无论成功/失败都会再写一次状态，不会卡在 pending。
    if (message.mediaData?.imageGenerationStatus !== "pending") {
        const marked = updateChatMessage(message.id, {
            mediaData: {
                ...message.mediaData,
                label: description,
                useReferenceImage: effectiveUseReference,
                imageGenerationStatus: "pending",
                imageGenerationError: undefined,
            },
        });
        if (marked) dispatchChatMessagesUpdated(marked.sessionId, marked);
    }

    try {
        const media = await resolveMediaForUse({
            actor: { type: "character", characterId: characterId || "" },
            description,
            channel: "dm_user",
            appId: "chat",
            mode: options?.forceGenerated ? "generate" : "auto",
            intentKind: effectiveUseReference || /自拍|合照|人像|selfie|portrait/i.test(description) ? "selfie" : /食物|料理|餐|吃|food|meal/i.test(description) ? "food" : "other",
            useReferenceImage: effectiveUseReference,
            signal: options?.signal,
        });
        if (!media?.imageUrl) return saveChatImageDescription(message, description);
        const photoAssetId = media.imageUrl.startsWith("asset://") ? media.imageUrl.slice(8) : "";
        const albumUrl = media.source === "album" && photoAssetId ? await getChatImageFromIndexedDB(photoAssetId) : null;
        const fileName = media.source === "album" ? `${description.slice(0, 24) || "照片"}.png` : generatedImageFilename(description, media.generatedMimeType || "image/png");
        const previousData = message.mediaData ?? {};
        const nextData: ChatMessage["mediaData"] = {
            ...previousData,
            label: description,
            fileType: "image",
            fileName,
            useReferenceImage: effectiveUseReference,
            imageGenerationMediaRef: media.generatedMediaRef,
            imageGenerationPrompt: media.generatedPrompt,
            imageGenerationUsedReference: media.generatedUsedReference,
            imageSource: media.source === "album" ? "album" : "generated",
            photoLibraryId: media.photoLibraryId,
            imageGenerationStatus: "generated",
            imageGenerationError: undefined,
        };
        const updated = updateChatMessage(message.id, {
            content: fileName,
            mediaType: "media_file",
            mediaUrl: media.generatedDataUrl || albumUrl || media.imageUrl,
            mediaData: nextData,
        });
        if (!updated) throw new Error("原消息不存在，无法替换图片");
        dispatchChatMessagesUpdated(updated.sessionId, updated);
        return updated;
    } catch (error) {
        const failed = updateChatMessage(message.id, {
            mediaData: {
                ...message.mediaData,
                label: description,
                useReferenceImage: effectiveUseReference,
                imageGenerationStatus: "failed",
                imageGenerationError: errorToMessage(error),
            },
        });
        if (failed) dispatchChatMessagesUpdated(failed.sessionId, failed);
        throw error;
    }
}

export async function retryChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    nextDescription?: string,
    useReferenceImage?: boolean,
): Promise<ChatMessage> {
    return generateAndApplyChatGeneratedImage(message, characterId, {
        description: nextDescription,
        useReferenceImage,
        forceGenerated: true,
    });
}

export async function retryMomentGeneratedPhoto(
    post: MomentPost,
    nextDescription?: string,
    useReferenceImage?: boolean,
): Promise<MomentPost> {
    const description = (nextDescription ?? post.photoDescription)?.trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");

    const effectiveUseReference = useReferenceImage !== undefined
        ? useReferenceImage
        : (post.photoUseReferenceImage === true);

    // 同聊天：重试先置 pending 并广播，卡片立刻显示"图片生成中…"；成功/失败都会再写状态。
    updateMomentPost(post.id, {
        photoDescription: description,
        photoUseReferenceImage: effectiveUseReference,
        photoGenerationStatus: "pending",
        photoGenerationError: undefined,
    });
    dispatchMomentsUpdated();

    try {
        const generated = await generateImageFromConfiguredApi({
            description,
            characterId: post.authorType === "character" ? post.authorId : undefined,
            appId: "moments",
            useReferenceImage: effectiveUseReference,
        });
        if (!generated) throw new Error("生图配置未启用或不完整");

        const assetId = await saveChatImageToIndexedDB(generated.blob);
        const updated = updateMomentPost(post.id, {
            photoUrl: `asset://${assetId}`,
            photoDescription: description,
            photoUseReferenceImage: effectiveUseReference,
            photoGenerationStatus: "generated",
            photoGenerationPrompt: generated.prompt,
            photoSource: "generated",
            photoLibraryId: undefined,
            photoGenerationError: undefined,
        });
        if (!updated) throw new Error("原朋友圈不存在，无法替换图片");
        dispatchMomentsUpdated();
        return updated;
    } catch (error) {
        updateMomentPost(post.id, {
            photoDescription: description,
            photoUseReferenceImage: effectiveUseReference,
            photoGenerationStatus: "failed",
            photoGenerationError: errorToMessage(error),
        });
        dispatchMomentsUpdated();
        throw error;
    }
}
