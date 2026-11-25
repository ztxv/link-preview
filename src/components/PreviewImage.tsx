"use client";

/* eslint-disable @next/next/no-img-element -- images are already validated and proxied by /api/image */
import { useState } from "react";
import type { CardImage } from "@/lib/preview/types";

/** An image served through the validated image endpoint, with a visible failure state. */
export function PreviewImage({
  image,
  className,
  alt = "",
  fit = "cover",
}: {
  image?: CardImage;
  className?: string;
  alt?: string;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const check = image?.check;
  if (!image || !check || !check.ok || failed) {
    const reason = !image
      ? "No image"
      : failed
        ? "Image didn't load"
        : check && !check.ok
          ? check.code === "http_error"
            ? `Image returned HTTP ${check.status}`
            : "Image unavailable"
          : "Image not checked";
    return (
      <div className={`img-missing ${className ?? ""}`} role="img" aria-label={reason}>
        <span aria-hidden="true">⌧</span>
        <span>{reason}</span>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={`/api/image/${check.proxy}`}
      alt={alt}
      style={{ objectFit: fit }}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
