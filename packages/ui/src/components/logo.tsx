import type * as React from "react";

const LOGO_VIEWBOX = "0 0 56 56";

const LOGO_CENTER = 28;

const LOGO_SLAB =
	"M41 13.3327L39.3682 12.16L28.5853 4.41866C28.2368 4.16845 27.7675 4.16844 27.419 4.41863L2.41685 22.3661C2.15517 22.5539 2 22.8563 2 23.1784V32.8194C2 33.1415 2.15515 33.4439 2.41681 33.6317L27.4189 51.5813C27.7675 51.8315 28.2368 51.8315 28.5854 51.5812L53.5833 33.6317C53.8449 33.4439 54 33.1415 54 32.8194V23.1784C54 22.8563 53.8448 22.5539 53.5832 22.3661L41 13.3327Z";

const LOGO_OPEN_CELLS =
	"M39.9167 15.6667L49.6667 22.6667L39.9167 29.6667L30.1667 22.6667Z M16.0833 15.6667L25.8333 22.6667L16.0833 29.6667L6.3333 22.6667Z M28 24.2222L37.75 31.2222L28 38.2222L18.25 31.2222Z";

const LOGO_ACCENT_CELL = "M28 7.1111L37.75 14.1111L28 21.1111L18.25 14.1111Z";

const LOGO_COLORS = {
	slab: "#16171B",
	accent: "#A03E0F",
	tile: "#FFFFFF",
} as const;

function logoPaths({
	slab = "currentColor",
	accent = LOGO_COLORS.accent,
	slabOpacity,
}: {
	slab?: string;
	accent?: string;
	slabOpacity?: number;
}) {
	return [
		<path
			key="slab"
			d={`${LOGO_SLAB} ${LOGO_OPEN_CELLS}`}
			fill={slab}
			fillRule="evenodd"
			fillOpacity={slabOpacity}
		/>,
		<path key="accent" d={LOGO_ACCENT_CELL} fill={accent} />,
	];
}

const Logo = ({
	slab,
	accent,
	...props
}: React.SVGProps<SVGSVGElement> & { slab?: string; accent?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={56}
		height={56}
		viewBox={LOGO_VIEWBOX}
		fill="none"
		role="img"
		aria-label="CRM logo"
		data-slot="logo"
		{...props}
	>
		{logoPaths({ slab, accent })}
	</svg>
);

export default Logo;
export { LOGO_CENTER, LOGO_COLORS, LOGO_SLAB, logoPaths };
