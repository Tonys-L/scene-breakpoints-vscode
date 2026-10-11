import type { JSX } from "preact";

interface IconProps {
	className?: string;
	size?: number;
}

export function LineIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<circle cx="8" cy="8" r="6" />
		</svg>
	);
}

export function ConditionIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M2 4.5h12v1.5H2zm0 3.25h8v1.5H2zm0 3.25h12v1.5H2z" />
		</svg>
	);
}

export function LogpointIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M14 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3.5-3H14a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 8H7.1L5 11.8V10H3V4h10v6z" />
		</svg>
	);
}

export function HitCountIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M6.5 1h-1.5l-.75 4H1.5v1.5h2.47l-.75 4H.5V12h2.44L2.2 15h1.5l.75-3h4.1l-.75 3h1.5l.75-3h2.7v-1.5h-2.42l.75-4h2.67V5h-2.39L12 1h-1.5l-.75 4h-4.1L6.5 1zm-.7 5.5h4.1l-.75 4h-4.1l.75-4z" />
		</svg>
	);
}

export function FunctionIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M12.5 1.5C11.1 1.5 10 2.6 10 4v2H8v2h2v6.5h2V8h2.5V6H12V4c0-.6.4-1 1-1h1.5V1.5H12.5z" />
		</svg>
	);
}

export function RefIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M6.88 9.12a2.99 2.99 0 0 0 4.24 0l2.12-2.12a3 3 0 1 0-4.24-4.24L7.5 4.26l1.06 1.06 1.5-1.5a1.5 1.5 0 0 1 2.12 2.12L10.06 8.06a1.5 1.5 0 0 1-2.12 0l-1.06 1.06zm2.24-2.24a2.99 2.99 0 0 0-4.24 0L2.76 9a3 3 0 1 0 4.24 4.24l1.5-1.5-1.06-1.06-1.5 1.5a1.5 1.5 0 0 1-2.12-2.12l2.12-2.12a1.5 1.5 0 0 1 2.12 0l1.06-1.06z" />
		</svg>
	);
}

export function WarningIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M7.56 1.44a1 1 0 0 1 1.76 0l6.4 12.06A1 1 0 0 1 14.84 15H1.16a1 1 0 0 1-.88-1.5l6.4-12.06h.88zM8 5a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-4.5A.75.75 0 0 0 8 5zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
		</svg>
	);
}

export function OpenExternalIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M1.5 1h6v1.5H3v10.5h10.5V9.5H15v6H1.5V1zm8.5 0h5v5l-1.5-1.5-4.8 4.8-1.06-1.06 4.8-4.8L10 1z" />
		</svg>
	);
}

export function ZapIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M8.5 1.5L2 9.5h5L6 14.5l7.5-8.5H8.5l1.5-4.5h-1.5z" />
		</svg>
	);
}

export function SearchIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04-.71.71-3.39-2.69z" />
		</svg>
	);
}

export function CloseIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
		</svg>
	);
}

export function LoopIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M13.44 2.56A7.5 7.5 0 0 0 1.25 7h1.53a6 6 0 0 1 9.6-3.38L10 6h5V1l-1.56 1.56zM2.56 13.44A7.5 7.5 0 0 0 14.75 9h-1.53a6 6 0 0 1-9.6 3.38L6 10H1v5l1.56-1.56z" />
		</svg>
	);
}

export function TrashIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M11 3h3v1h-1v10.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V4H2V3h3V1.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V3zm-5-1v1h4V2H6zm6 2H4v10h8V4zm-5 2h1v6H7V6zm3 0h1v6h-1V6z" />
		</svg>
	);
}

export function FileIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M3 1.5A1.5 1.5 0 0 1 4.5 0h6L14 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 14.5v-13zM10 1v3h3L10 1zm-6 0v13.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5H9.5A.5.5 0 0 1 9 4.5V1H4.5a.5.5 0 0 0-.5.5z" />
		</svg>
	);
}

export function ClockIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.5-12.5v4.29l2.85 2.86-.7.71L7.5 9.21V3.5h1z" />
		</svg>
	);
}

export function PinIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M8 0a5.5 5.5 0 0 0-5.5 5.5c0 3.82 4.6 9.87 5.09 10.5a.5.5 0 0 0 .82 0c.49-.63 5.09-6.68 5.09-10.5A5.5 5.5 0 0 0 8 0zm0 14.73C6.72 13 3.5 8.54 3.5 5.5a4.5 4.5 0 1 1 9 0c0 3.04-3.22 7.5-4.5 9.23zM8 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
		</svg>
	);
}

export function ArrowUpRightIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 3h8a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4.71L4.85 11.85a.5.5 0 0 1-.7-.71L11.29 4H4.5a.5.5 0 0 1 0-1z" />
		</svg>
	);
}

export function CheckIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path fill-rule="evenodd" clip-rule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
		</svg>
	);
}

export function PlayIcon({ className, size = 12 }: IconProps): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			style={{ display: "inline-block", verticalAlign: "middle" }}
		>
			<path d="M4 2.5v11l9-5.5-9-5.5z" />
		</svg>
	);
}
