import type { Ref } from "vue";
import Quagga from "@ericblade/quagga2";

// Quagga is a module singleton wrapping one camera, so the lifecycle state that tracks who owns
// it has to be module-level too — per-composable copies let a torn-down instance's late init
// callback act on a stream a *newer* instance now owns (leave /scanner mid-init, come back, and
// the dead callback stops the live camera, which nothing then restarts).
//
// `generation` is bumped by every start() and every stop(); an init callback whose token is no
// longer current knows it lost the camera. `owner` is the token of whoever currently holds it
// (or has an init in flight), `started` whether the stream is actually running.
//
// The reason a *pending* init keeps `owner` (rather than stop() clearing it) is that only that
// callback can release the stream it is acquiring: Quagga is a singleton, so a second init started
// before the first lands overwrites `_inputStream` and the first stream becomes unreachable —
// `Quagga.stop()` can never get to it and the camera stays lit until the tab is reloaded. So a
// start() arriving while an init is in flight doesn't init; it parks itself in `pendingStart` and
// the stale callback hands the camera over once it has cleaned up after itself.
let generation = 0;
let owner: number | null = null;
let started = false;
let pendingStart: (() => void) | null = null;

/**
 * Wraps the Quagga2 live-camera barcode scanner: init/start/stop lifecycle plus a
 * small consecutive-read buffer that filters decoder noise. Isolates the only
 * third-party integration in the scanner page so it can be reasoned about (and
 * swapped) independently of the scan state machine.
 *
 * - `container` — the element Quagga renders the camera stream into
 * - `onDetect`  — fires with an ISBN once `requiredHits` consecutive reads agree
 * - `onError`   — fires if the camera fails to initialise
 */
export function useBarcodeScanner(options: {
  container: Ref<HTMLElement | null>;
  onDetect: (code: string) => void;
  onError: (err: unknown) => void;
  requiredHits?: number;
}) {
  const { container, onDetect, onError, requiredHits = 2 } = options;

  // Require N consecutive reads of the same code before firing — filters noise
  // without adding perceptible delay at typical camera frame rates.
  const detectionBuffer: string[] = [];

  const onQuaggaDetected = (result: {
    codeResult: { code: string | null };
  }) => {
    const code = result.codeResult.code;
    if (!code) return;

    detectionBuffer.push(code);
    if (detectionBuffer.length > requiredHits) detectionBuffer.shift();

    if (
      detectionBuffer.length === requiredHits &&
      detectionBuffer.every((c) => c === code)
    ) {
      detectionBuffer.length = 0;
      onDetect(code);
    }
  };

  function start() {
    if (!container.value || started) return;
    if (owner !== null) {
      // An init is still negotiating the camera. Queue *this* instance's start — not a re-entry
      // into the in-flight one's, whose container ref is already null after its unmount.
      pendingStart = start;
      return;
    }
    const token = ++generation;
    owner = token;

    Quagga.init(
      {
        inputStream: {
          type: "LiveStream",
          target: container.value,
          constraints: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        locator: { patchSize: "medium", halfSample: true },
        // numOfWorkers: 0 avoids Vite/worker-blob compatibility issues
        numOfWorkers: 0,
        decoder: { readers: ["ean_reader", "ean_8_reader"] },
        locate: true,
      },
      (err: unknown) => {
        if (token !== generation) {
          // We lost the camera while negotiating it. Nothing else can have started an init in the
          // meantime (start() parks instead), so this callback is the only thing that can still
          // reach the stream it just acquired — release it here or it leaks for the life of the
          // tab. Then hand over to whoever queued up behind us.
          owner = null;
          if (!err) Quagga.stop();
          const next = pendingStart;
          pendingStart = null;
          next?.();
          return;
        }
        // Still current, so any queued start is a redundant self-queue — a real one could only
        // have come after a stop(), which would have made this callback stale.
        pendingStart = null;
        owner = null;
        if (err) {
          console.error(err);
          onError(err);
          return;
        }
        Quagga.start();
        started = true;
      },
    );

    Quagga.onDetected(onQuaggaDetected);
  }

  function stop() {
    Quagga.offDetected(onQuaggaDetected);
    // Bumping the generation is what tells an in-flight init it no longer owns the camera; it
    // releases the stream itself (see start), since it can't be stopped before it exists — which
    // is also why `owner` is left alone here when nothing is running.
    generation++;
    pendingStart = null;
    if (started) {
      Quagga.stop();
      started = false;
      owner = null;
    }
  }

  const isRunning = () => started;

  return { start, stop, isRunning };
}
