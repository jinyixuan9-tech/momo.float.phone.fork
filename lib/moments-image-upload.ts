import { saveChatImageToIndexedDB } from "./chat-asset-storage";

export async function saveMomentsImage(file: File): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = objectUrl;
        });
        const ratio = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法处理照片");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("无法保存照片")), "image/jpeg", .85));
        return `asset://${await saveChatImageToIndexedDB(blob)}`;
    } finally { URL.revokeObjectURL(objectUrl); }
}
