import type { Frame } from 'playwright';

// A frame's own DOM can have layout even when its iframe (or an ancestor) is hidden.
export async function visibleFrame(frame: Frame): Promise<boolean> {
  try {
    for (let current = frame; current.parentFrame(); current = current.parentFrame()!) {
      const element = await current.frameElement();
      try { if (!await element.isVisible()) return false; }
      finally { await element.dispose(); }
    }
    return !frame.isDetached();
  } catch { return false; }
}
