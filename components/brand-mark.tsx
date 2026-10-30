"use client";

import { useId } from "react";

type Props = {
  size?: number;
  className?: string;
};

/**
 * IntegrationOS original identity: four systems connected through
 * an orchestration core. Vector art remains sharp in the Studio UI.
 */
export default function BrandMark({ size = 42, className = "" }: Props) {
  const uid = useId().replace(/:/g, "");
  const fill = "io-bg-" + uid;
  const route = "io-route-" + uid;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#33255E" />
          <stop offset=".53" stopColor="#19162F" />
          <stop offset="1" stopColor="#101423" />
        </linearGradient>
        <linearGradient id={route} x1="9" y1="12" x2="47" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E9DCFF" />
          <stop offset=".51" stopColor="#B09AFF" />
          <stop offset="1" stopColor="#75D9EE" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="54" height="54" rx="15" fill={"url(#" + fill + ")"} stroke="#A992F1" strokeOpacity=".51" />
      <path d="M14 15h9c4.7 0 6.6 3.1 6.6 7v4.1M42 41h-8.7c-4.7 0-6.7-3.1-6.7-7v-3.1" stroke={"url(#" + route + ")"} strokeWidth="3.1" strokeLinecap="round" />
      <path d="M42 15h-8.7c-4.7 0-6.7 3.1-6.7 7v4.1M14 41h9c4.7 0 6.6-3.1 6.6-7v-3.1" stroke={"url(#" + route + ")"} strokeWidth="3.1" strokeLinecap="round" strokeOpacity=".82" />
      <rect x="23.6" y="23.6" width="8.8" height="8.8" rx="2.5" transform="rotate(45 28 28)" fill="#B59EFF" stroke="#E8DEFF" strokeWidth="1.25" />
      <circle cx="14" cy="15" r="3" fill="#E8DEFF" />
      <circle cx="42" cy="15" r="3" fill="#C5B3FF" />
      <circle cx="14" cy="41" r="3" fill="#C5B3FF" />
      <circle cx="42" cy="41" r="3" fill="#8FDDFA" />
      <path d="M12.6 7.9h8.2M35.2 48.1h8.2" stroke="#B69FFF" strokeOpacity=".4" strokeLinecap="round" />
    </svg>
  );
}
