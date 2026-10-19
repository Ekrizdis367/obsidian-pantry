// Runtime stand-ins for the types-only "obsidian" package, used only by tests.
type Handler = (...args: unknown[]) => unknown;

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Events {
	private handlers = new Map<string, Set<Handler>>();

	on(name: string, callback: Handler): { name: string; callback: Handler } {
		const set = this.handlers.get(name) ?? new Set<Handler>();
		set.add(callback);
		this.handlers.set(name, set);
		return { name, callback };
	}

	offref(ref: { name: string; callback: Handler }): void {
		this.handlers.get(ref.name)?.delete(ref.callback);
	}

	trigger(name: string, ...args: unknown[]): void {
		for (const handler of this.handlers.get(name) ?? []) handler(...args);
	}
}
