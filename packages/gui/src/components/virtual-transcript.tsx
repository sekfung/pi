import type { JsonValue } from "@earendil-works/pi-protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { TranscriptMessage } from "@/components/transcript-message";

const ESTIMATED_ITEM_HEIGHT = 140;
const OVERSCAN_PX = 800;

function messageKey(message: JsonValue, index: number): string {
	if (typeof message !== "object" || message === null || Array.isArray(message)) return `message-${index}`;
	const role = typeof message.role === "string" ? message.role : "message";
	const identity = typeof message.toolCallId === "string" ? message.toolCallId : message.timestamp;
	return `${role}-${String(identity ?? index)}`;
}

function MeasuredMessage({ message, index, top, measured }: { message: JsonValue; index: number; top: number; measured: (height: number) => void }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(() => measured(element.getBoundingClientRect().height));
		observer.observe(element);
		measured(element.getBoundingClientRect().height);
		return () => observer.disconnect();
	}, [measured]);
	return <div ref={ref} className="absolute left-0 w-full pb-6" style={{ transform: `translateY(${top}px)` }}><TranscriptMessage message={message} index={index} /></div>;
}

export function VirtualTranscript({ messages }: { messages: JsonValue[] }) {
	const scroller = useRef<HTMLElement>(null);
	const pinnedToBottom = useRef(true);
	const heights = useRef(new Map<string, number>());
	const [viewport, setViewport] = useState({ top: 0, height: 0, revision: 0 });
	const layout = useMemo(() => {
		let top = 0;
		const items = messages.map((message, index) => {
			const key = messageKey(message, index);
			const item = { key, message, index, top, height: heights.current.get(key) ?? ESTIMATED_ITEM_HEIGHT };
			top += item.height;
			return item;
		});
		return { items, height: top };
	}, [messages, viewport.revision]);

	useEffect(() => {
		const element = scroller.current;
		if (!element) return;
		const update = () => {
			pinnedToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
			setViewport((current) => ({ ...current, top: element.scrollTop, height: element.clientHeight }));
		};
		const observer = new ResizeObserver(update);
		observer.observe(element);
		element.addEventListener("scroll", update, { passive: true });
		update();
		return () => {
			observer.disconnect();
			element.removeEventListener("scroll", update);
		};
	}, []);

	useEffect(() => {
		if (!pinnedToBottom.current) return;
		const frame = requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
		return () => cancelAnimationFrame(frame);
	}, [layout.height]);

	const visible = layout.items.filter((item) =>
		item.top + item.height >= viewport.top - OVERSCAN_PX && item.top <= viewport.top + viewport.height + OVERSCAN_PX,
	);
	return (
		<section ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-8" aria-label="Conversation">
			<div className="relative mx-auto max-w-3xl" style={{ height: `${layout.height}px` }}>
				{visible.map((item) => <MeasuredMessage key={item.key} message={item.message} index={item.index} top={item.top} measured={(height) => {
					if (heights.current.get(item.key) === height) return;
					heights.current.set(item.key, height);
					setViewport((current) => ({ ...current, revision: current.revision + 1 }));
				}} />)}
			</div>
		</section>
	);
}
