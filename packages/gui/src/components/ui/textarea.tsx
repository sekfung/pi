import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			className={cn(
				"min-h-20 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
