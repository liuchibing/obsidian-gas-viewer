import { Plugin, WorkspaceLeaf, TextFileView, MarkdownRenderer } from 'obsidian';

// --- 类型定义 ---

interface GASPart {
    text: string;
    thought?: boolean;
}

interface GASChunk {
    role: "user" | "model";
    text?: string;
    parts?: GASPart[];
    isThought?: boolean;
}

interface GASData {
    runSettings?: {
        model: string;
        temperature: number;
    };
    systemInstruction?: {
        text: string;
    };
    chunkedPrompt: {
        chunks: GASChunk[];
    };
}

const VIEW_TYPE_GAS = "gas-view";

// --- 视图类 ---

class GASView extends TextFileView {
    // 1. 修复 TS2416: 重命名 data 为 gasData，避免与父类 TextFileView.data (string 类型) 冲突
    gasData: GASData | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_GAS;
    }

    getDisplayText() {
        return this.file ? this.file.basename : "AI Studio Chat";
    }

    getIcon() {
        return "bot";
    }

    // 2. 修复 TS2515: 实现抽象方法 getViewData
    // 当 Obsidian 保存文件时会调用此方法获取要写入的文本
    getViewData(): string {
        return JSON.stringify(this.gasData, null, 2);
    }

    // 核心渲染逻辑：从文本加载数据
    setViewData(data: string, clear: boolean) {
        try {
            this.gasData = JSON.parse(data) as GASData;
        } catch (e) {
            this.gasData = null;
            console.error("Failed to parse GAS JSON", e);
        }
        void this.render();
    }

    clear() {
        this.gasData = null;
        this.contentEl.empty();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass("gas-container");

        if (!this.gasData) {
            container.createEl("div", { text: "Invalid or empty JSON data." });
            return;
        }

        // 渲染头部
        const headerEl = container.createDiv("gas-header");
        if (this.gasData.runSettings) {
            headerEl.createEl("span", { text: `Model: ${this.gasData.runSettings.model}`, cls: "gas-meta" });
            headerEl.createEl("span", { text: `Temp: ${this.gasData.runSettings.temperature}`, cls: "gas-meta" });
        }
        
        // 渲染 System Instruction
        if (this.gasData.systemInstruction?.text) {
            const sysEl = container.createDiv("gas-system-instruction");
            sysEl.createEl("strong", { text: "System instruction:" });
            await MarkdownRenderer.render(this.app, this.gasData.systemInstruction.text, sysEl, this.file?.path || "", this);
        }

        // 渲染对话流
        const chatContainer = container.createDiv("gas-chat-stream");
        const chunks = this.gasData.chunkedPrompt?.chunks || [];
        
        for (const chunk of chunks) {
            const msgRow = chatContainer.createDiv(`gas-msg-row ${chunk.role}`);
            const msgBubble = msgRow.createDiv("gas-msg-bubble");

            const roleLabel = msgBubble.createDiv("gas-role-label");
            roleLabel.innerText = chunk.role === "user" ? "User" : "Model";

            // 辅助函数：渲染 Markdown
            const renderMd = async (text: string, el: HTMLElement) => {
                 await MarkdownRenderer.render(this.app, text, el, this.file?.path || "", this);
            };

            // 处理 Parts
            if (chunk.text) {
                // 处理旧格式/简单格式
                if (chunk.isThought) {
                     // 3. 修复 TS2339: 使用 createEl('details')
                     const thoughtEl = msgBubble.createEl("details", { cls: "gas-thought-block" });
                     thoughtEl.createEl("summary", { text: "Thinking process..." });
                     const thoughtContent = thoughtEl.createDiv("gas-thought-content");
                     await renderMd(chunk.text, thoughtContent);
                } else {
                    const textEl = msgBubble.createDiv("gas-text-content");
                    await renderMd(chunk.text, textEl);
                }
            } else if (chunk.parts && chunk.parts.length > 0) {
                for (const part of chunk.parts) {
                    if (part.thought) {
                        // 3. 修复 TS2339: 使用 createEl('details') 代替 createDetails
                        const thoughtEl = msgBubble.createEl("details", { cls: "gas-thought-block" });
                        thoughtEl.createEl("summary", { text: "Thinking process..." });
                        const thoughtContent = thoughtEl.createDiv("gas-thought-content");
                        await renderMd(part.text, thoughtContent);
                    } else {
                        const textEl = msgBubble.createDiv("gas-text-content");
                        await renderMd(part.text, textEl);
                    }
                }
            }
        }
    }
}

// --- 插件主类 ---

export default class GASPlugin extends Plugin {

    async onload() {

        this.registerView(VIEW_TYPE_GAS, (leaf) => new GASView(leaf));
        this.registerExtensions(["gas"], VIEW_TYPE_GAS);

        // 添加设置页 (如果你保留了 settings.ts，需要取消下面这行的注释并导入 GASSettingTab)
        // this.addSettingTab(new GASSettingTab(this.app, this));
    }

    onunload() {
        // 清理工作
    }
}