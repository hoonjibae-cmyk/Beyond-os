'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { calculateSeatMapFit, MIN_SEAT_MAP_SCALE } from '../../lib/seatMapFit';
import './ResponsiveSeatMap.css';

export default function ResponsiveSeatMap({ width, height, className = 'seat-map-wrap', canvasClassName = 'seat-map', canvasStyle, mode = 'dashboard', children }) {
  const viewportRef = useRef(null);
  const [fit, setFit] = useState(() => calculateSeatMapFit({
    width, height, availableWidth: width * MIN_SEAT_MAP_SCALE, availableHeight: height * MIN_SEAT_MAP_SCALE,
  }));

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    let frame = 0;

    function measure() {
      frame = 0;
      if (!viewport.clientWidth) return;
      const screenHeight = window.visualViewport?.height || window.innerHeight;
      const modal = viewport.closest('.student-editor-modal');
      let availableHeight;
      if (mode === 'picker' && modal) {
        const modalHeight = Math.min(modal.clientHeight, screenHeight - 32);
        const header = modal.querySelector('.popup-head')?.offsetHeight || 0;
        const actions = modal.querySelector('.student-editor-actions')?.offsetHeight || 0;
        const card = viewport.closest('.seat-editor-card');
        const title = card?.querySelector('h3')?.offsetHeight || 0;
        const unassign = card?.querySelector('.unassign-seat')?.offsetHeight || 0;
        const hint = card?.querySelector('.hint')?.offsetHeight || 0;
        availableHeight = modalHeight - header - actions - title - unassign - hint - 48;
      } else {
        // Document position stays constant while scrolling; scrolling must not resize the map.
        const layoutTop = viewport.getBoundingClientRect().top + window.scrollY;
        const consolePanel = document.querySelector('.patrol-shell.is-patrol .quick-patrol-console');
        const bottom = consolePanel && window.getComputedStyle(consolePanel).position === 'fixed'
          ? Math.min(screenHeight, consolePanel.getBoundingClientRect().top)
          : screenHeight;
        availableHeight = bottom - layoutTop - 20;
      }
      const next = calculateSeatMapFit({ width, height, availableWidth: viewport.clientWidth, availableHeight: Math.max(160, availableHeight) });
      setFit(previous => previous.scale === next.scale && previous.scaledWidth === next.scaledWidth && previous.scaledHeight === next.scaledHeight && previous.viewportHeight === next.viewportHeight ? previous : next);
    }

    function scheduleMeasure() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }

    const observer = new window.ResizeObserver(scheduleMeasure);
    const targets = new Set([
      viewport, viewport.parentElement, viewport.closest('.main'), viewport.closest('.map-shell'),
      viewport.closest('.student-editor-modal'), document.querySelector('.sidebar'),
      document.querySelector('.quick-patrol-console'),
    ]);
    for (const target of targets) if (target) observer.observe(target);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    measure();
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('orientationchange', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
    };
  }, [width, height, mode]);

  return (
    <div ref={viewportRef} className={`${className} responsive-seat-viewport`} data-seat-map-scale={fit.scale}
      style={{ '--seat-viewport-height': `${fit.viewportHeight}px` }}>
      <div className="responsive-seat-stage" style={{ width: fit.scaledWidth, height: fit.scaledHeight }}>
        <div className={`${canvasClassName} responsive-seat-canvas`} style={{ ...canvasStyle,
          '--seat-base-width': `${width}px`, '--seat-base-height': `${height}px`, transform: `scale(${fit.scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
