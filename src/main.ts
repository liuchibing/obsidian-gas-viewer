import {
	Plugin,
	WorkspaceLeaf,
	TextFileView,
	MarkdownRenderer,
	Notice,
	TFile,
} from "obsidian";

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

interface GASRunSettings {
	temperature?: number;
	model?: string;
	topP?: number;
	topK?: number;
	maxOutputTokens?: number;
	safetySettings?: {
		category: string;
		threshold: string;
	}[];
}

interface GASData {
	runSettings?: GASRunSettings;
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
	gasData: GASData | null = null;
	rawData: string = "";

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

	// 当 Obsidian 保存文件时会调用此方法获取要写入的文本
	getViewData(): string {
		return this.rawData;
	}

	// 核心渲染逻辑：从文本加载数据
	setViewData(data: string, clear: boolean) {
		this.rawData = data;
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
		this.rawData = "";
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
			headerEl.createEl("span", {
				text: `Model: ${this.gasData.runSettings.model}`,
				cls: "gas-meta",
			});
			headerEl.createEl("span", {
				text: `Temp: ${this.gasData.runSettings.temperature}`,
				cls: "gas-meta",
			});
		}

		// 在气泡右上角添加复制原始 Markdown 的图标按钮
		const addCopyButton = (text: string, bubbleEl: HTMLElement) => {
			if (!text) return;
			const btn = bubbleEl.createDiv("gas-copy-btn");
			// 简单的剪贴板图标（SVG）
			// eslint-disable-next-line @microsoft/sdl/no-inner-html
			btn.innerHTML = `
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
					</svg>
				`;

			btn.addEventListener("click", (e) => {
				e.stopPropagation();

				navigator.clipboard
					.writeText(text)
					.then(() => {
						new Notice("已复制 Markdown 到剪贴板");
					})
					.catch((err) => {
						const ta = document.createElement("textarea");
						ta.value = text;
						document.body.appendChild(ta);
						ta.select();
						// eslint-disable-next-line @typescript-eslint/no-deprecated
						document.execCommand("copy");
						document.body.removeChild(ta);
						new Notice("已复制 Markdown 到剪贴板");
					});
			});
		};

		// 渲染 System Instruction
		if (this.gasData.systemInstruction?.text) {
			const sysEl = container.createDiv("gas-system-instruction");
			sysEl.createEl("strong", { text: "System instruction:" });
			await MarkdownRenderer.render(
				this.app,
				this.gasData.systemInstruction.text,
				sysEl,
				this.file?.path || "",
				this
			);
			addCopyButton(this.gasData.systemInstruction.text, sysEl);
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
				await MarkdownRenderer.render(
					this.app,
					text,
					el,
					this.file?.path || "",
					this
				);
			};

			if (chunk.text) {
				// 处理简单格式
				if (chunk.isThought) {
					const thoughtEl = msgBubble.createEl("details", {
						cls: "gas-thought-block",
					});
					thoughtEl.createEl("summary", {
						text: "Thinking process...",
					});
					const thoughtContent = thoughtEl.createDiv(
						"gas-thought-content"
					);
					await renderMd(chunk.text, thoughtContent);
					addCopyButton(chunk.text, msgBubble);
				} else {
					const textEl = msgBubble.createDiv("gas-text-content");
					await renderMd(chunk.text, textEl);
					addCopyButton(chunk.text, msgBubble);
				}
			} else if (chunk.parts && chunk.parts.length > 0) {
				// 处理 Parts 格式
				for (const part of chunk.parts) {
					if (part.thought) {
						const thoughtEl = msgBubble.createEl("details", {
							cls: "gas-thought-block",
						});
						thoughtEl.createEl("summary", {
							text: "Thinking process...",
						});
						const thoughtContent = thoughtEl.createDiv(
							"gas-thought-content"
						);
						await renderMd(part.text, thoughtContent);
						addCopyButton(part.text, msgBubble);
					} else {
						const textEl = msgBubble.createDiv("gas-text-content");
						await renderMd(part.text, textEl);
						addCopyButton(part.text, msgBubble);
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

		this.addCommand({
			id: "export-gas-to-markdown",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			name: "Export GAS JSON to Markdown.",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(GASView);
				if (!view) return false;

				const file = view.file;
				if (!file) return false;

				if (checking) return true;

				void this.doExportMarkdown(file);

				return true;
			},
		});
	}

	onunload() {
		// 清理工作
	}

	async doExportMarkdown(file: TFile | null) {
		if (!file) {
			new Notice("No file provided for export.");
			return;
		}
		const data = await this.app.vault.read(file);
		let gasData: GASData;
		try {
			gasData = JSON.parse(data) as GASData;
		} catch (e: unknown) {
			new Notice(`Invalid GAS JSON format. ${String(e)}`);
			return;
		}

		const mdContent = convertAIStudioJsonToMarkdown(gasData, file.basename);
		const mdFileName = file.parent?.path + "/" + file.basename + ".md";
		await this.app.vault.adapter.write(mdFileName, mdContent);
		new Notice(`Exported to ${mdFileName}`);
	}
}

/**
 * 将 Google AI Studio 的 JSON 导出格式转换为 Markdown
 * @param {GASData|String} jsonInput - JSON 对象或 JSON 字符串
 * @returns {String} - 格式化后的 Markdown 字符串
 */
function convertAIStudioJsonToMarkdown(
	jsonInput: string | GASData,
	fileName: string = "AI Studio Chat Export"
): string {
	let data;
	try {
		data =
			typeof jsonInput === "string"
				? (JSON.parse(jsonInput) as GASData)
				: jsonInput;
	} catch (e: unknown) {
		return `Error: Invalid JSON format. ${String(e)}`;
	}

	let md = "";

	// 辅助函数：生成 Obsidian Callout 块
	// type: info, abstract, example, etc.
	// folded: true (默认折叠 -) / false (默认展开 +)
	function createCallout(
		type: string,
		title: string,
		content: string,
		folded = true
	) {
		const foldSymbol = folded ? "-" : "+";
		// 1. 生成头部 > [!TYPE]- Title
		let block = `> [!${type}]${foldSymbol} ${title}\n`;
		// 2. 处理内容：确保每一行前都有 "> "，包括空行
		// 移除内容末尾多余的换行，防止 Callout 过长
		const cleanContent = content.replace(/\n+$/, "");
		block += cleanContent
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		return block + "\n\n";
	}

	// 1. 处理元数据 (Configuration) -> 使用 [!info]- Callout
	const settings = data.runSettings || {};
	md += `# ${fileName}\n\n`;

	let configContent = `| Setting | Value |\n`;
	configContent += `| :--- | :--- |\n`;
	configContent += `| **Model** | \`${settings.model || "N/A"}\` |\n`;
	configContent += `| **Temperature** | ${settings.temperature ?? "N/A"} |\n`;
	configContent += `| **Top P** | ${settings.topP ?? "N/A"} |\n`;
	configContent += `| **Top K** | ${settings.topK ?? "N/A"} |\n`;

	if (settings.safetySettings) {
		const safetySummary = settings.safetySettings
			.map((s) => `${s.category.split("_").pop()}: ${s.threshold}`)
			.join("<br>");
		configContent += `| **Safety** | ${safetySummary} |\n`;
	}

	md += createCallout(
		"info",
		`⚙️ Configuration & Metadata (Model: ${settings.model || "Unknown"})`,
		configContent
	);

	md += `---\n\n`;

	// 2. 处理系统指令 (System Instruction)
	if (data.systemInstruction && data.systemInstruction.text) {
		md += `### 🛠️ System Instruction\n\n`;
		// 系统指令通常比较重要，可以使用引用块，也可以用 [!summary]
		md += `> ${data.systemInstruction.text.replace(/\n/g, "\n> ")}\n\n`;
		md += `---\n\n`;
	}

	// 3. 处理对话内容 (Chunks)
	const chunks = data.chunkedPrompt?.chunks || [];

	chunks.forEach((chunk, index) => {
		const role = chunk.role;
		const text = chunk.text || "";
		const isThought = chunk.isThought || false;

		// 如果是 User
		if (role === "user") {
			md += `### 👤 User\n\n${text}\n\n`;
		}
		// 如果是 Model
		else if (role === "model") {
			// 检查是否是思维链 (Thought Process)
			if (isThought) {
				// 思维链 -> 使用 [!abstract]- 或 [!thought]- (如果你的主题支持)
				// 这里使用 'abstract' (摘要) 作为通用图标，表示内部思考
				md += createCallout(
					"abstract",
					"🧠 Thinking Process",
					text // 这里的 text 是原始的多行文本，createCallout 会自动添加 "> "
				);
			} else {
				// 普通回答
				md += `### 🤖 Model\n\n${text}\n\n`;
			}
		}

		// 段落分隔
		if (index < chunks.length - 1) {
			md += `\n`;
		}
	});

	return md;
}
