import type { JsonValue } from "@earendil-works/pi-protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function HostInteraction({ interaction, respond }: { interaction: JsonValue; respond: (value: JsonValue) => void }) {
	const record = isRecord(interaction) ? interaction : undefined;
	const [value, setValue] = useState("");
	const id = typeof record?.id === "string" ? record.id : "";
	const kind = typeof record?.kind === "string" ? record.kind : "input";
	const title = typeof record?.title === "string" ? record.title : "Extension request";
	const options = Array.isArray(record?.options)
		? record.options.filter((option): option is string => typeof option === "string")
		: [];
	const optionLabels = isRecord(record?.optionLabels) ? record.optionLabels : undefined;

	useEffect(() => {
		setValue(typeof record?.prefill === "string" ? record.prefill : "");
	}, [id, record?.prefill]);

	if (!record || !id) return null;
	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation">
			<div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby={`interaction-${id}`}>
				<h2 id={`interaction-${id}`} className="font-semibold">{title}</h2>
				{typeof record.message === "string" && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{record.message}</p>}
				{kind === "select" ? (
					<div className="mt-4 space-y-2">{options.map((option) => <button key={option} type="button" className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => respond(option)}>{typeof optionLabels?.[option] === "string" ? optionLabels[option] : option}</button>)}</div>
				) : kind === "confirm" ? (
					<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => respond(false)}>Cancel</Button><Button onClick={() => respond(true)}>Confirm</Button></div>
				) : (
					<form className="mt-4" onSubmit={(event) => { event.preventDefault(); respond(value); }}>
						{kind === "editor" ? <textarea autoFocus className="min-h-40 w-full rounded-lg border bg-background p-3 text-sm outline-none" value={value} onChange={(event) => setValue(event.target.value)} /> : <input autoFocus type={record.secret === true ? "password" : "text"} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none" value={value} placeholder={typeof record.placeholder === "string" ? record.placeholder : undefined} onChange={(event) => setValue(event.target.value)} />}
						<div className="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => respond(null)}>Cancel</Button><Button type="submit">Submit</Button></div>
					</form>
				)}
			</div>
		</div>
	);
}

export function ExtensionPresentation({ value, onOpenUrl }: { value: JsonValue | undefined; onOpenUrl: (url: string) => void }) {
	if (!isRecord(value)) return null;
	const statuses = isRecord(value.statuses)
		? Object.entries(value.statuses).filter((entry): entry is [string, string] => typeof entry[1] === "string")
		: [];
	const widgets = isRecord(value.widgets) ? Object.entries(value.widgets) : [];
	const notifications = Array.isArray(value.notifications) ? value.notifications.filter(isRecord) : [];
	const latest = notifications.at(-1);
	const authEvents = Array.isArray(value.authEvents) ? value.authEvents.filter(isRecord) : [];
	const latestAuth = authEvents.at(-1);
	if (statuses.length === 0 && widgets.length === 0 && !latest && !latestAuth) return null;
	return <div className="border-b bg-muted/40 px-6 py-2 text-xs">
		<div className="mx-auto max-w-3xl space-y-1">
			{statuses.map(([key, text]) => <div key={key}><span className="font-medium">{key}:</span> {text}</div>)}
			{widgets.map(([key, widget]) => isRecord(widget) && Array.isArray(widget.lines) ? <div key={key} className="whitespace-pre-wrap">{widget.lines.filter((line): line is string => typeof line === "string").join("\n")}</div> : null)}
			{latest && typeof latest.message === "string" && <div className={latest.type === "error" ? "text-destructive" : "text-muted-foreground"}>{latest.message}</div>}
			{latestAuth && <div className="flex flex-wrap items-center gap-2">
				{typeof latestAuth.message === "string" && <span>{latestAuth.message}</span>}
				{typeof latestAuth.instructions === "string" && <span>{latestAuth.instructions}</span>}
				{typeof latestAuth.userCode === "string" && <button type="button" className="rounded border px-2 py-1 font-mono" onClick={() => void navigator.clipboard.writeText(latestAuth.userCode as string)}>{latestAuth.userCode}</button>}
				{typeof latestAuth.url === "string" && latestAuth.url.startsWith("https://") && <Button size="sm" onClick={() => onOpenUrl(latestAuth.url as string)}>Open browser</Button>}
				{typeof latestAuth.verificationUri === "string" && latestAuth.verificationUri.startsWith("https://") && <Button size="sm" onClick={() => onOpenUrl(latestAuth.verificationUri as string)}>Open verification page</Button>}
			</div>}
		</div>
	</div>;
}
