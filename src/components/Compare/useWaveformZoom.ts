import { useCallback, useEffect, useRef, useState } from "react";

const MAX_PX_PER_SEC = 1000;
/** Wheel delta that zooms by a factor of e. */
const WHEEL_ZOOM_SCALE = 600;
/** How long a wheel gesture keeps zooming around the same point. */
const ANCHOR_RESET_MS = 300;

export interface WaveformZoom {
  containerRef: React.RefObject<HTMLDivElement>;
  containerWidth: number;
  /** Longest track, in seconds. */
  duration: number;
  pxPerSec: number;
  scrollLeft: number;
  handleDurationChange: (duration: number) => void;
  /** Fit the whole song in view. */
  reset: () => void;
  /** Zoom by `factor`, keeping `anchorTime` in the middle of the view. */
  zoomBy: (factor: number, anchorTime: number) => void;
  /** Jump to a view, e.g. from the minimap. */
  setView: (scrollLeft: number, pxPerSec: number) => void;
  /** Song time under a screen x, or null outside the waveform. */
  timeAt: (clientX: number) => number | null;
}

/**
 * Horizontal zoom and scroll for the waveforms: fit to width by default,
 * Cmd/Ctrl + wheel zooms around the pointer, Shift + wheel or a sideways
 * swipe pans. Zooming never goes below fit-to-width.
 */
export function useWaveformZoom(isMobile: boolean): WaveformZoom {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const ppsRef = useRef(0);
  const slRef = useRef(0);
  const durationRef = useRef(0);
  // Showing the whole song: stays so when the width or the longest track changes.
  const fittedRef = useRef(true);

  const apply = useCallback((pps: number, sl: number, fitted = false) => {
    fittedRef.current = fitted;
    ppsRef.current = pps;
    slRef.current = sl;
    setPxPerSec(pps);
    setScrollLeft(sl);
  }, []);

  const basePps = useCallback(() => {
    const el = containerRef.current;
    return el && durationRef.current > 0 ? el.clientWidth / durationRef.current : 0;
  }, []);

  const clampScroll = useCallback((sl: number, pps: number) => {
    const el = containerRef.current;
    if (!el || durationRef.current <= 0) return 0;
    return Math.max(0, Math.min(sl, pps * durationRef.current - el.clientWidth));
  }, []);

  const handleDurationChange = useCallback((d: number) => {
    durationRef.current = d;
    setDuration(d);
    const base = basePps();
    if (base > 0 && (fittedRef.current || ppsRef.current < base)) apply(base, 0, true);
  }, [apply, basePps]);

  // Track the width; stay fitted on resize when not zoomed in.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
      const base = basePps();
      if (base > 0 && (fittedRef.current || ppsRef.current < base)) apply(base, 0, true);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [isMobile, apply, basePps]);

  const reset = useCallback(() => {
    const base = basePps();
    if (base > 0) apply(base, 0, true);
  }, [apply, basePps]);

  const zoomBy = useCallback((factor: number, anchorTime: number) => {
    const el = containerRef.current;
    const base = basePps();
    if (!el || base <= 0) return;
    const pps = Math.max(base, Math.min(ppsRef.current * factor, MAX_PX_PER_SEC));
    apply(pps, clampScroll(anchorTime * pps - el.clientWidth / 2, pps), pps <= base);
  }, [apply, clampScroll, basePps]);

  const setView = useCallback((sl: number, pps: number) => {
    apply(pps, clampScroll(sl, pps), pps <= basePps());
  }, [apply, clampScroll, basePps]);

  const timeAt = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el || ppsRef.current <= 0) return null;
    return (clientX - el.getBoundingClientRect().left + slRef.current) / ppsRef.current;
  }, []);

  // Wheel: Cmd/Ctrl zooms around the pointer, sideways or Shift pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || isMobile) return;
    let anchor: { time: number; x: number } | null = null;
    let anchorTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = 0;
    let raf = 0;

    const flush = () => {
      raf = 0;
      const delta = pending;
      pending = 0;
      const base = basePps();
      if (Math.abs(delta) < 0.1 || base <= 0) return;
      const pps = Math.max(base, Math.min(ppsRef.current * Math.exp(-delta / WHEEL_ZOOM_SCALE), MAX_PX_PER_SEC));
      const a = anchor ?? { time: (slRef.current + el.clientWidth / 2) / ppsRef.current, x: el.clientWidth / 2 };
      apply(pps, clampScroll(a.time * pps - a.x, pps), pps <= base);
    };

    const onWheel = (e: WheelEvent) => {
      const zooming = e.ctrlKey || e.metaKey;
      if (!zooming && (Math.abs(e.deltaX) > 0 || e.shiftKey)) {
        e.preventDefault();
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        apply(ppsRef.current, clampScroll(slRef.current + delta, ppsRef.current), fittedRef.current);
        return;
      }
      if (!zooming) return;
      e.preventDefault();
      if (!anchor) {
        const x = e.clientX - el.getBoundingClientRect().left;
        anchor = { time: (x + slRef.current) / ppsRef.current, x };
      }
      clearTimeout(anchorTimer);
      anchorTimer = setTimeout(() => { anchor = null; }, ANCHOR_RESET_MS);
      pending += e.deltaY;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(anchorTimer);
      cancelAnimationFrame(raf);
    };
  }, [isMobile, apply, clampScroll, basePps]);

  return {
    containerRef, containerWidth, duration, pxPerSec, scrollLeft,
    handleDurationChange, reset, zoomBy, setView, timeAt,
  };
}
